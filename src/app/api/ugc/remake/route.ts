import path from "path";
import { NextResponse } from "next/server";
import { createKieTask, kieClaude } from "@/lib/studio/kie";
import { freshAvatarUrl } from "@/lib/ugc/avatar-store";
import { characterLock, DEFAULT_CASTING, type Casting } from "@/lib/ugc/casting";
import { fetchProductFromUrl } from "@/lib/ugc/fetch-product";
import { PRODUCT_LOCK } from "@/lib/ugc/angles";
import { handlingFor, type ProductKind } from "@/lib/ugc/kinds";
import { analyzeCreative, extractAudio, muxAudio, shotFrames, type Shot } from "@/lib/ugc/remake";
import { createBatch, stitchAngle } from "@/lib/ugc/store";
import type { ProductInput, Resolution } from "@/lib/ugc/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Seedance 2.5 — la version que Kie accepte sous ce nom exact. */
const MODEL = "bytedance/seedance-2-5";
const ASPECT_RATIO = "9:16";
const MAX_REFS = 6;
const CREATE_GAP_MS = 700;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Body = {
  action?: "analyze" | "generate" | "assemble";
  batchId?: string;
  /** Bande son d.origine, renvoyee au remontage. */
  audioBase64?: string;
  /** Créative source, en data URL. */
  videoBase64?: string;
  productUrl?: string;
  product?: ProductInput;
  shots?: Shot[];
  /** Cadrage relevé plan par plan sur la créa source. */
  framing?: string[];
  avatarId?: string;
  casting?: Casting;
  resolution?: Resolution;
};

function decode(dataUrl: string) {
  const base64 = dataUrl.includes("base64,")
    ? dataUrl.slice(dataUrl.indexOf("base64,") + 7)
    : dataUrl;
  return Buffer.from(base64, "base64");
}

/**
 * Fait décrire le cadrage de chaque plan à partir de son image clé.
 *
 * On ne demande QUE la mise en scène — échelle de plan, angle, mouvement,
 * lumière. Ni le décor précis ni les personnes de la source : le contenu vient
 * de l'avatar et du produit, seule la grammaire visuelle est reprise.
 */
async function describeShots(frames: string[]): Promise<string[]> {
  const raw = await kieClaude(
    `Each image is one shot from a short vertical ad, in order.

For every shot, describe ONLY the camera work in one sentence:
- shot size (extreme close-up, close-up, medium, wide)
- camera angle and height (eye level, low, high, over the shoulder, mirror shot)
- camera movement if any (static, handheld drift, push in, pan, tilt)
- lighting quality (soft daylight, hard sun, indoor lamp, backlit)

Do NOT describe the people, the products, the brand, the setting details or any on-screen text.

Return ONLY a JSON array of strings, one per image, in order:
["...", "..."]`,
    1500,
    frames
  );

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Description des plans illisible");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown[];
  return parsed.map((item) => String(item || "").trim());
}

const SHOT_INTENTS = [
  "faces the camera holding the product up at chest height, presenting it plainly",
  "uses the product the way it is meant to be used, hands visible, natural gestures",
  "closer framing on the product itself, turning it so the label and texture read clearly",
  "steps back so the product is seen in its everyday setting, then looks at the lens",
  "reacts to the product with a genuine, unexaggerated expression, product still in frame",
];

function shotPrompt(
  shot: Shot,
  product: ProductInput,
  casting: Casting,
  kind: ProductKind,
  framing?: string
) {
  const intent = SHOT_INTENTS[shot.index % SHOT_INTENTS.length];
  return [
    characterLock(casting, false),
    PRODUCT_LOCK,
    handlingFor(kind),
    [
      "Photorealistic UGC video shot on a modern iPhone, handheld with natural micro-shake, ",
      "realistic skin texture, true-to-life lighting, believable everyday location. ",
      "NOT cinematic, NOT studio-lit, NOT glossy advertising, NOT AI-smooth. ",
      "One continuous take, no cuts, no zooms, no on-screen text, no captions, no watermark. ",
      "SILENT PERFORMANCE — the protagonist does not speak and does not mouth words; the final ",
      "montage carries its own soundtrack. Ambient sound only.",
    ].join(""),
    framing
      ? `CAMERA (match this exactly): ${framing}`
      : "CAMERA: eye-level medium shot, handheld, soft natural light.",
    `SCENE: The protagonist ${intent}. The product is ${product.name}.`,
  ].join("\n\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;

    /* ---------- Analyse de la créative source ---------- */
    if (body.action === "analyze") {
      if (!body.videoBase64) return NextResponse.json({ error: "Vidéo manquante" }, { status: 400 });
      const buffer = decode(body.videoBase64);

      const analysis = await analyzeCreative(buffer);
      const audio = await extractAudio(buffer);

      /**
       * Cadrage plan par plan. C'est ce qui donne « les mêmes angles, le même
       * zoom » : la structure seule ne dit que le rythme. Si le service de
       * description est indisponible, on garde la grille de plans et les
       * intentions génériques — le montage reste juste, seul le cadrage est
       * approximé.
       */
      let framing: string[] = [];
      let framingError: string | null = null;
      try {
        const frames = await shotFrames(buffer, analysis.shots);
        if (frames.some(Boolean)) {
          framing = await describeShots(frames);
        }
      } catch (error) {
        framingError = error instanceof Error ? error.message : "Description des plans indisponible";
      }

      // Le produit est chargé dans la foulée : une seule attente pour l'utilisateur.
      let product: ProductInput | null = null;
      let productError: string | null = null;
      if (body.productUrl) {
        try {
          product = await fetchProductFromUrl(body.productUrl);
        } catch (error) {
          productError = error instanceof Error ? error.message : "Fiche produit illisible";
        }
      }

      return NextResponse.json({
        analysis,
        framing,
        framingError,
        product,
        productError,
        // La bande son repart au client, qui la renverra au montage final.
        audioBase64: audio ? `data:audio/mp4;base64,${audio.toString("base64")}` : null,
      });
    }

    /* ---------- Remontage avec la bande son d'origine ---------- */
    if (body.action === "assemble") {
      if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });

      // Les clips sont d'abord recollés bout à bout par le montage existant.
      const stitched = await stitchAngle(body.batchId, "remake");
      if (!body.audioBase64) return NextResponse.json({ file: stitched, audio: false });

      const dir = path.join(process.cwd(), ".msgate-cache", "ugc-batches", body.batchId);
      const withAudio = `remake-audio-${Date.now().toString(36)}.mp4`;
      await muxAudio(
        path.join(dir, stitched),
        decode(body.audioBase64),
        path.join(dir, withAudio)
      );
      return NextResponse.json({ file: withAudio, audio: true });
    }

    /* ---------- Génération des plans ---------- */
    const product = body.product;
    const shots = body.shots || [];
    if (!product?.name) return NextResponse.json({ error: "Produit manquant" }, { status: 400 });
    if (!shots.length) return NextResponse.json({ error: "Aucun plan à générer" }, { status: 400 });
    if (!body.avatarId) {
      return NextResponse.json(
        { error: "Choisis un avatar enregistré — c'est lui qui garde le même visage" },
        { status: 400 }
      );
    }

    const productRefs = (product.imageUrls ?? [])
      .filter((url) => /^https:\/\//i.test(url))
      .slice(0, MAX_REFS);
    if (!productRefs.length) {
      return NextResponse.json(
        { error: "Aucune image produit : la génération inventerait le produit." },
        { status: 400 }
      );
    }

    const fresh = await freshAvatarUrl(body.avatarId);
    if (!fresh) return NextResponse.json({ error: "Avatar introuvable" }, { status: 404 });

    const casting = body.casting ?? DEFAULT_CASTING;
    const references = [fresh.url, ...productRefs];

    const jobs: Array<{
      angleId: string;
      angleName: string;
      sceneLabel: string;
      duration: number;
      prompt: string;
      taskId: string | null;
      error: string | null;
    }> = [];

    for (const shot of shots) {
      const prompt = shotPrompt(shot, product, casting, product.kind, body.framing?.[shot.index]);
      try {
        const taskId = await createKieTask(MODEL, {
          prompt,
          aspect_ratio: ASPECT_RATIO,
          resolution: body.resolution || "720p",
          duration: shot.duration,
          generate_audio: false,
          reference_image_urls: references,
        });
        jobs.push({
          angleId: "remake",
          angleName: "Remake",
          sceneLabel: `Plan ${shot.index + 1}`,
          duration: shot.duration,
          prompt,
          taskId,
          error: null,
        });
      } catch (error) {
        jobs.push({
          angleId: "remake",
          angleName: "Remake",
          sceneLabel: `Plan ${shot.index + 1}`,
          duration: shot.duration,
          prompt,
          taskId: null,
          error: error instanceof Error ? error.message : "Création impossible",
        });
      }
      await sleep(CREATE_GAP_MS);
    }

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
      { error: error instanceof Error ? error.message : "Remake impossible" },
      { status: 502 }
    );
  }
}
