import { NextResponse } from "next/server";
import { createKieTask, getKieTask, isKieDone, isKieFailed, uploadBase64 } from "@/lib/studio/kie";
import { ANGLES, composeScenePrompt } from "@/lib/ugc/angles";
import {
  deleteAvatar,
  freshAvatarUrl,
  listAvatars,
  renameAvatar,
  saveAvatar,
  setActiveAvatar,
  toMeta,
} from "@/lib/ugc/avatar-store";
import { DEFAULT_CASTING, avatarPrompt, avatarPromptFromText, type Casting } from "@/lib/ugc/casting";
import { fetchProductFromUrl } from "@/lib/ugc/fetch-product";
import type { FormatId, NicheId } from "@/lib/ugc/formats";
import { isPhysical } from "@/lib/ugc/kinds";
import { OUTFIT_ANGLES, composeOutfitPrompt } from "@/lib/ugc/outfit";
import { chatStory, writeAngles, writeStory, type ChatMessage } from "@/lib/ugc/script-writer";
import { getScript } from "@/lib/creative-library/store";
import { scrapeProduct } from "@/lib/meta/ad-copy";
import { applyResults, createBatch, listBatches, stitchAngle } from "@/lib/ugc/store";
import { withDuration, type Angle, type ProductInput, type Resolution } from "@/lib/ugc/types";

/** `outfit` = clips muets où la tenue est portée et montrée, sans parole. */
type UgcMode = "speaking" | "outfit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reference-to-video : c'est ce mode qui garde le vrai produit dans le plan. */
const MODEL = "bytedance/seedance-2";

/** Les créatives partent en ads verticales : le format n'est pas négociable. */
const ASPECT_RATIO = "9:16";

/** Seedance accepte 9 images de référence ; au-delà il ignore silencieusement. */
const MAX_REFS = 6;

const CREATE_CONCURRENCY = 2;
const CREATE_GAP_MS = 700;
const CREATE_RETRIES = 3;
const POLL_CHUNK = 4;
const POLL_GAP_MS = 350;

const TRANSIENT =
  /frequency is too high|rate.?limit|too many requests|\b429\b|timeout|ETIMEDOUT|ECONNRESET/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Body = {
  action?:
    | "fetch"
    | "avatar"
    | "upload-avatar"
    | "preview"
    | "generate"
    | "status"
    | "batches"
    | "stitch"
    | "avatar-list"
    | "avatar-save"
    | "avatar-use"
    | "avatar-rename"
    | "avatar-delete"
    | "upload-image"
    | "write-angles"
    | "write-story"
    | "story-chat";
  /** Mode histoire : texte libre, source facultative, script de base facultatif. */
  story?: string;
  sourceUrl?: string;
  scriptId?: string;
  imageUrls?: string[];
  /** Durée totale visée pour la vidéo, en secondes. */
  targetSeconds?: number;
  /** Conversation de cadrage avec l'IA. */
  messages?: ChatMessage[];
  mode?: UgcMode;
  /** Comment c'est filmé : selfie, facecam, podcast, interview… */
  formatId?: FormatId;
  /** Qui parle et d'où : mode, beauté, fitness… */
  nicheId?: NicheId;
  /** Angles écrits sur mesure (Claude, main, bibliothèque) : générés comme les autres. */
  customAngles?: Angle[];
  /** Bloc de style relevé sur une vidéo de référence. */
  styleBlock?: string;
  /** Brief pour `write-angles`. */
  brief?: string;
  count?: number;
  language?: "en" | "fr";
  /** Durée par plan, en secondes. Mode outfit uniquement. */
  clipDuration?: number;
  /** Avatar enregistré à réutiliser — c'est lui qui garantit le même visage. */
  avatarId?: string;
  avatarName?: string;
  url?: string;
  product?: ProductInput;
  angleIds?: string[];
  resolution?: Resolution;
  casting?: Casting;
  /** Sujet libre sans casting : la personne est celle du prompt. */
  castingFree?: boolean;
  /** Avatar décrit en toutes lettres — prime sur le casting. */
  description?: string;
  avatarUrl?: string;
  avatarDataUrl?: string;
  /** Un avatar chargé décrit lui-même la personne : le casting ne l'écrase pas. */
  avatarUploaded?: boolean;
  taskIds?: string[];
  batchId?: string;
  angleId?: string;
};

/** Réessaie tant que l'erreur est une saturation, avec un délai qui double. */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CREATE_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!TRANSIENT.test(message)) throw error;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Petits lots espacés : Kie refuse les rafales de créations de tâches. */
async function runQueue<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CREATE_CONCURRENCY) {
    const batch = await Promise.all(items.slice(i, i + CREATE_CONCURRENCY).map(worker));
    out.push(...batch);
    if (i + CREATE_CONCURRENCY < items.length) await sleep(CREATE_GAP_MS);
  }
  return out;
}

function buildScenes(
  product: ProductInput,
  angleIds: string[],
  casting: Casting,
  describeCasting: boolean,
  mode: UgcMode,
  clipDuration?: number,
  customAngles: Angle[] = [],
  context: { format?: FormatId; niche?: NicheId; styleBlock?: string; hasAvatar?: boolean; castingFree?: boolean } = {}
) {
  const wanted = new Set(angleIds);
  // Les angles sur mesure passent devant : un même identifiant est le leur.
  const library = mode === "outfit" ? OUTFIT_ANGLES : [...customAngles, ...ANGLES];
  const seen = new Set<string>();
  return library
    .filter((angle) => {
      if (!wanted.has(angle.id) || seen.has(angle.id)) return false;
      seen.add(angle.id);
      return true;
    })
    .flatMap((angle) =>
      // La durée choisie ne s'applique qu'aux clips muets : en mode parlant,
      // elle est calée sur la longueur du dialogue et l'allonger désynchronise.
      withDuration(angle.scenes, mode === "outfit" ? clipDuration : undefined).map((scene) => ({
        angleId: angle.id,
        angleName: angle.name,
        sceneLabel: scene.label,
        duration: scene.duration,
        prompt:
          mode === "outfit"
            ? composeOutfitPrompt(scene.prompt, product, casting, describeCasting)
            : composeScenePrompt(scene.prompt, product, casting, product.kind, describeCasting, context),
      }))
    );
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  try {
    if (body.action === "batches") {
      return NextResponse.json({ batches: await listBatches() });
    }

    if (body.action === "stitch") {
      if (!body.batchId || !body.angleId) {
        return NextResponse.json({ error: "Lot ou angle manquant" }, { status: 400 });
      }
      const file = await stitchAngle(body.batchId, body.angleId);
      return NextResponse.json({ file });
    }

    /* --- Avatars enregistrés : la même personne d'un lot à l'autre --- */

    if (body.action === "avatar-list") {
      return NextResponse.json(await listAvatars());
    }

    if (body.action === "avatar-save") {
      const source = body.avatarDataUrl || body.avatarUrl;
      if (!source) return NextResponse.json({ error: "Aucun avatar à enregistrer" }, { status: 400 });
      const avatar = await saveAvatar({
        urlOrDataUrl: source,
        casting: body.casting ?? DEFAULT_CASTING,
        uploaded: Boolean(body.avatarUploaded),
        name: body.avatarName,
      });
      return NextResponse.json({ avatar: toMeta(avatar) });
    }

    if (body.action === "avatar-use") {
      if (!body.avatarId) return NextResponse.json({ error: "Avatar manquant" }, { status: 400 });
      const ok = await setActiveAvatar(body.avatarId);
      if (!ok) return NextResponse.json({ error: "Avatar introuvable" }, { status: 404 });
      return NextResponse.json(await listAvatars());
    }

    if (body.action === "avatar-rename") {
      if (!body.avatarId) return NextResponse.json({ error: "Avatar manquant" }, { status: 400 });
      await renameAvatar(body.avatarId, body.avatarName || "");
      return NextResponse.json(await listAvatars());
    }

    if (body.action === "avatar-delete") {
      if (!body.avatarId) return NextResponse.json({ error: "Avatar manquant" }, { status: 400 });
      await deleteAvatar(body.avatarId);
      return NextResponse.json(await listAvatars());
    }

    // Un visage trouvé ailleurs vaut une génération, et va bien plus vite.
    // `upload-image` sert aussi aux photos de tenue, qui suivent le même chemin.
    if (body.action === "upload-avatar" || body.action === "upload-image") {
      if (!body.avatarDataUrl) return NextResponse.json({ error: "Image manquante" }, { status: 400 });
      const url = await uploadBase64(body.avatarDataUrl, `ugc-${Date.now()}.png`);
      return NextResponse.json({ url });
    }

    /**
     * L'avatar est généré une seule fois, en amont du lot. C'est lui qui rend
     * le personnage identique d'un clip à l'autre : il part ensuite en première
     * image de référence à chaque scène.
     */
    if (body.action === "avatar") {
      const taskId = await withRetry(() =>
        createKieTask("gpt-image-2-text-to-image", {
          prompt: body.description?.trim()
            ? avatarPromptFromText(body.description)
            : avatarPrompt(body.casting ?? DEFAULT_CASTING),
          aspect_ratio: "3:4",
          resolution: "1K",
        })
      );
      return NextResponse.json({ taskId });
    }

    // Une URL de page produit suffit : plus rapide qu'un export CSV.
    if (body.action === "fetch") {
      if (!body.url) return NextResponse.json({ error: "URL manquante" }, { status: 400 });
      return NextResponse.json({ product: await fetchProductFromUrl(body.url) });
    }

    if (body.action === "status") {
      const taskIds = (body.taskIds ?? []).slice(0, 60);
      const results: Array<{
        taskId: string;
        state?: string;
        urls: string[];
        failMsg: string | null;
        throttled?: boolean;
      }> = [];

      for (let i = 0; i < taskIds.length; i += POLL_CHUNK) {
        const chunk = taskIds.slice(i, i + POLL_CHUNK);
        const batch = await Promise.all(
          chunk.map(async (taskId) => {
            try {
              const task = await getKieTask(taskId);
              /**
               * Kie annonce la réussite sous trois libellés — success, completed
               * ou finished — et l'échec sous trois autres. Comparer à « success »
               * seul laissait un clip terminé tourner en chargement pour toujours.
               * On normalise ici, une fois, pour tous ceux qui lisent ce statut.
               */
              const state = isKieDone(task.state)
                ? "success"
                : isKieFailed(task.state)
                  ? "fail"
                  : "pending";
              return { taskId, state, urls: task.urls, failMsg: task.failMsg ?? null };
            } catch (error) {
              const message = error instanceof Error ? error.message : "Statut illisible";
              // Une limite de cadence n'est pas un échec : on repollera.
              if (TRANSIENT.test(message)) {
                return { taskId, state: "pending", urls: [], failMsg: null, throttled: true };
              }
              return { taskId, state: "fail", urls: [], failMsg: message };
            }
          })
        );
        results.push(...batch);
        if (i + POLL_CHUNK < taskIds.length) await sleep(POLL_GAP_MS);
      }

      // Le disque suit les tâches : un onglet fermé ne perd plus rien.
      await applyResults(results);

      return NextResponse.json({ results, throttled: results.some((row) => row.throttled) });
    }

    /**
     * Mode histoire : un texte libre, une source facultative (fiche produit
     * ou site entier), un script de base facultatif. On lit la source ici —
     * une fiche Shopify donne images et prix, n'importe quelle autre page
     * donne son texte — puis Claude reformule et écrit le script.
     */
    if (body.action === "story-chat") {
      const messages = (body.messages ?? []).filter((message) => message && message.content?.trim());
      if (!messages.length) return NextResponse.json({ error: "Dis-moi ce que tu veux" }, { status: 400 });
      const result = await chatStory({ messages, targetSeconds: body.targetSeconds, language: body.language });
      return NextResponse.json(result);
    }

    if (body.action === "write-story") {
      if (!body.story?.trim()) return NextResponse.json({ error: "Écris ton histoire d'abord" }, { status: 400 });

      let product: ProductInput | null = null;
      let sourceText = "";
      let sourceTitle = "";
      let sourceError: string | null = null;
      const source = body.sourceUrl?.trim();
      if (source) {
        try {
          product = await fetchProductFromUrl(source);
          if (!product.imageUrls.length && !product.price) {
            // Pas une fiche produit : on garde le texte de la page, rien d'autre.
            sourceTitle = product.name;
            sourceText = product.description;
            product = null;
          }
        } catch {
          product = null;
        }
        if (!product) {
          try {
            const page = await scrapeProduct(source);
            sourceTitle = page.title || sourceTitle;
            sourceText = [page.description, page.text].filter(Boolean).join("\n").slice(0, 4000) || sourceText;
          } catch (error) {
            sourceError = error instanceof Error ? error.message : "Source illisible";
          }
        }
      }

      let scriptText = "";
      if (body.scriptId) {
        const script = await getScript(body.scriptId);
        scriptText = script?.text ?? "";
      }

      const draft = await writeStory({
        story: body.story,
        sourceText: product ? [product.description, product.keyPoints.join("; ")].filter(Boolean).join("\n") : sourceText,
        sourceTitle: product ? product.name : sourceTitle,
        scriptText,
        hasProduct: Boolean(product?.imageUrls.length) || Boolean(body.imageUrls?.length),
        format: body.formatId,
        niche: body.nicheId,
        language: body.language,
        targetSeconds: body.targetSeconds,
      });
      return NextResponse.json({ draft, product, sourceError });
    }

    const product = body.product;
    if (!product?.name) {
      return NextResponse.json({ error: "Renseigne au moins le nom du produit" }, { status: 400 });
    }

    /**
     * Angles sur mesure : Claude écrit les scènes depuis le sujet, le format
     * et le brief. Rien n'est dépensé chez Kie côté vidéo — seul le texte.
     */
    if (body.action === "write-angles") {
      const angles = await writeAngles({
        product,
        brief: body.brief ?? "",
        count: body.count ?? 2,
        format: body.formatId,
        niche: body.nicheId,
        language: body.language,
      });
      if (!angles.length) return NextResponse.json({ error: "Aucun angle écrit" }, { status: 502 });
      return NextResponse.json({ angles });
    }

    const angleIds = body.angleIds ?? [];
    if (!angleIds.length) {
      return NextResponse.json({ error: "Sélectionne au moins un angle" }, { status: 400 });
    }

    const casting = body.casting ?? DEFAULT_CASTING;
    const mode: UgcMode = body.mode === "outfit" ? "outfit" : "speaking";
    const scenes = buildScenes(
      product,
      angleIds,
      casting,
      // Un avatar chargé ou décrit fait foi ; en sujet libre le casting n'a rien à dire.
      !body.avatarUploaded && !body.castingFree,
      mode,
      body.clipDuration,
      body.customAngles ?? [],
      {
        format: body.formatId,
        niche: body.nicheId,
        styleBlock: body.styleBlock,
        hasAvatar: Boolean(body.avatarId || (body.avatarUrl && /^https:\/\//i.test(body.avatarUrl))),
        castingFree: Boolean(body.castingFree),
      }
    );

    // Prévisualisation : on montre les prompts finaux sans rien dépenser.
    if (body.action === "preview") {
      return NextResponse.json({ scenes });
    }

    const productRefs = (product.imageUrls ?? [])
      .filter((url) => /^https:\/\//i.test(url))
      .slice(0, MAX_REFS);

    // Sans photo du produit, Seedance en invente un. On refuse plutôt que de
    // laisser partir un lot payant qui ne montrera pas le bon article. Un
    // sujet sans objet (app, service, histoire) n'a rien à montrer : il passe.
    if (!productRefs.length && isPhysical(product.kind)) {
      return NextResponse.json(
        {
          error:
            "Aucune image produit : la génération inventerait le produit. Charge la fiche depuis son URL.",
        },
        { status: 400 }
      );
    }

    /**
     * L'avatar passe en PREMIER : tout le verrou d'identité repose sur ce rang.
     * Un avatar enregistré est ré-uploadé ici pour obtenir une URL fraîche —
     * c'est ce qui permet de retrouver la même personne des semaines plus tard,
     * alors que les URLs Kie ont expiré depuis longtemps.
     */
    let avatarUrl = body.avatarUrl && /^https:\/\//i.test(body.avatarUrl) ? body.avatarUrl : null;
    if (body.avatarId) {
      const fresh = await freshAvatarUrl(body.avatarId);
      if (!fresh) {
        return NextResponse.json({ error: "Avatar enregistré introuvable" }, { status: 404 });
      }
      avatarUrl = fresh.url;
    }

    const references = avatarUrl ? [avatarUrl, ...productRefs] : productRefs;

    const jobs = await runQueue(scenes, async (scene) => {
      try {
        const taskId = await withRetry(() =>
          createKieTask(MODEL, {
            prompt: scene.prompt,
            aspect_ratio: ASPECT_RATIO,
            resolution: body.resolution || "720p",
            duration: scene.duration,
            generate_audio: true,
            ...(references.length ? { reference_image_urls: references } : {}),
          })
        );
        return { ...scene, taskId, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Création impossible";
        return {
          ...scene,
          taskId: null,
          error: TRANSIENT.test(message) ? "Kie saturé — relance cet angle" : message,
        };
      }
    });

    const stored = await createBatch({
      product,
      resolution: body.resolution || "720p",
      jobs: jobs.map((job) => ({
        ...job,
        state: job.taskId ? ("pending" as const) : ("fail" as const),
        urls: [] as string[],
      })),
    });

    return NextResponse.json({ jobs, batchId: stored.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération impossible" },
      { status: 502 }
    );
  }
}
