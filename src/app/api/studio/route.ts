import { NextResponse } from "next/server";
import { expandBrief } from "@/lib/studio/expand";
import { modelFamily, resolveModel } from "@/lib/studio/models";
import { createKieTask, getKieTask, uploadBase64 } from "@/lib/studio/kie";
import { RATIOS, type Ratio } from "@/lib/studio/ratios";
import { expandVoiceScripts } from "@/lib/studio/vo-scripts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Espacement entre deux créations : Kie compte les appels, pas les images. */
const CREATE_GAP_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Resolution = "1K" | "2K";

/** Le ratio nommé le plus proche du cadre de l'image : le résultat garde ses proportions. */
function nearestRatio(width?: number, height?: number): Ratio {
  if (!width || !height) return "3:4";
  const target = width / height;
  let best: Ratio = RATIOS[0].id;
  let gap = Infinity;
  for (const entry of RATIOS) {
    const [w, h] = entry.id.split(":").map(Number);
    const diff = Math.abs(w / h - target);
    if (diff < gap) {
      gap = diff;
      best = entry.id;
    }
  }
  return best;
}

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) return NextResponse.json({ error: "taskId manquant" }, { status: 400 });
  try {
    const task = await getKieTask(taskId);
    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Poll impossible" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "expand" | "image" | "remove" | "tts" | "upload" | "vo";
      brief?: string;
      /** Créa de référence (data URL) pour le moteur de prompts. */
      referenceDataUrl?: string;
      prompt?: string;
      prompts?: string[];
      /** Famille du catalogue (src/lib/studio/models.ts) ; gpt-image-2 par défaut. */
      model?: string;
      /** Durée en secondes pour une famille vidéo. */
      duration?: number;
      count?: number;
      ratio?: Ratio;
      resolution?: Resolution;
      imageDataUrl?: string;
      fileName?: string;
      referenceUrls?: string[];
      removeWhat?: string;
      /** Remove Magic : pinceau (masque), auto (détection) ou fond. */
      removeMode?: "brush" | "auto" | "background";
      /** Masque noir sur blanc, mêmes dimensions que l'image : noir = à reboucher. */
      maskDataUrl?: string;
      /** Dimensions de l'image envoyée, pour garder son cadre quand le modèle exige un ratio nommé. */
      imageWidth?: number;
      imageHeight?: number;
      text?: string;
      voice?: string;
      timestamps?: boolean;
    };

    if (body.action === "upload") {
      if (!body.imageDataUrl) return NextResponse.json({ error: "Image manquante" }, { status: 400 });
      const url = await uploadBase64(body.imageDataUrl, body.fileName || `ref-${Date.now()}.png`);
      return NextResponse.json({ url });
    }

    if (body.action === "expand") {
      const result = await expandBrief({
        brief: body.brief || "",
        count: body.count || 1,
        ratio: body.ratio || "3:4",
        referenceDataUrl: body.referenceDataUrl || undefined,
      });
      return NextResponse.json(result);
    }

    if (body.action === "vo") {
      const result = await expandVoiceScripts(body.brief || "", body.count || 3);
      return NextResponse.json(result);
    }

    if (body.action === "image") {
      const prompts = (body.prompts?.length ? body.prompts : [body.prompt || ""]).filter(Boolean);
      if (!prompts.length) return NextResponse.json({ error: "Prompt manquant" }, { status: 400 });
      const referenceUrls = (body.referenceUrls || []).filter((url) => /^https:\/\//i.test(url)).slice(0, 8);
      /**
       * Les créations partent une par une, espacées.
       *
       * Lancées ensemble, vingt prompts déclenchent « Your call frequency is
       * too high » et le lot entier est perdu. Kie compte les appels, pas les
       * images : les échelonner suffit, et un lot n'a de toute façon rien à
       * gagner à démarrer en un dixième de seconde puisque chaque rendu prend
       * ensuite une minute.
       */
      const family = modelFamily(body.model);
      if (!family) return NextResponse.json({ error: "Modèle inconnu" }, { status: 400 });
      const resolved = resolveModel(family, referenceUrls);
      if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
      const jobs: Array<{ prompt: string; taskId: string }> = [];
      const failures: string[] = [];

      for (const [index, prompt] of prompts.entries()) {
        if (index) await sleep(CREATE_GAP_MS);

        let created: string | null = null;
        for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
          try {
            created = await createKieTask(
              resolved.model,
              family.build({
                prompt,
                ratio: (body.ratio || "3:4") as Ratio,
                resolution: body.resolution || family.resolutions[0] || "",
                referenceUrls: referenceUrls.slice(0, family.maxRefs || 8),
                duration: body.duration,
              })
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            // Une limite de cadence se traverse en patientant ; le reste, non.
            if (!/frequency|too high|rate limit|429/i.test(message) || attempt === 3) {
              failures.push(message || "Création refusée");
              break;
            }
            await sleep(2000 * (attempt + 1));
          }
        }

        if (created) jobs.push({ prompt, taskId: created });
      }

      // Un lot partiel vaut mieux qu'un lot perdu : on rend ce qui est parti.
      if (!jobs.length) {
        return NextResponse.json(
          { error: failures[0] || "Aucune création acceptée par Kie" },
          { status: 502 }
        );
      }

      return NextResponse.json({
        jobs,
        referenceUrls,
        skipped: failures.length,
        skippedReason: failures[0] || null,
        model: family.id,
        kieModel: resolved.model,
        kind: family.kind,
      });
    }

    if (body.action === "remove") {
      if (!body.imageDataUrl) return NextResponse.json({ error: "Image manquante" }, { status: 400 });
      const mode = body.removeMode ?? "brush";
      const stamp = Date.now();
      const ext = body.imageDataUrl.startsWith("data:image/png") ? "png" : "jpg";
      const image = await uploadBase64(body.imageDataUrl, `remove-${stamp}.${ext}`);
      if (mode === "background") {
        // Recraft : un détourage dédié, quelques secondes, PNG transparent.
        const taskId = await createKieTask("recraft/remove-background", { image });
        return NextResponse.json({ taskId, mode });
      }
      if (mode === "auto") {
        // Pas de masque : le modèle repère lui-même ce qu'il faut enlever.
        // Une cible décrite → Nano Banana Edit (≈15 s, ne touche que la cible).
        // Rien de décrit → Nano Banana Pro (≈40 s), le seul qui nettoie vraiment tous les textes et badges d'un coup.
        const what = body.removeWhat?.trim();
        if (what) {
          const taskId = await createKieTask("google/nano-banana-edit", {
            prompt: `Remove ${what} from this image. Fill the freed area with the surrounding background so nothing looks edited. Keep everything else exactly identical: same framing, same colors, same product, same people, same lighting. Do not add any text, logo or object.`,
            image_urls: [image],
            aspect_ratio: "auto",
            output_format: "png",
          });
          return NextResponse.json({ taskId, mode });
        }
        const taskId = await createKieTask("nano-banana-pro", {
          prompt:
            "Remove every piece of text, caption, headline, logo, watermark, badge, sticker and overlaid graphic from this image. Fill the freed areas with the surrounding background so nothing looks edited. Keep everything else exactly identical: same framing, same colors, same product, same people, same lighting. Do not add any text, logo or object.",
          image_input: [image],
          aspect_ratio: nearestRatio(body.imageWidth, body.imageHeight),
          resolution: "1K",
          output_format: "png",
        });
        return NextResponse.json({ taskId, mode });
      }
      // Pinceau : Ideogram v3 Edit, un vrai inpainting qui ne touche que la zone noire du masque.
      if (!body.maskDataUrl) return NextResponse.json({ error: "Zone à effacer manquante" }, { status: 400 });
      const mask = await uploadBase64(body.maskDataUrl, `remove-mask-${stamp}.png`);
      const taskId = await createKieTask("ideogram/v3-edit", {
        prompt:
          "Fill the masked area with the surrounding background so the removed element disappears completely: continue the same surface, texture, lighting, colors and perspective seamlessly, as if nothing had ever been there. Do not add any text, letters, logo, object or person.",
        image_url: image,
        mask_url: mask,
        rendering_speed: "TURBO",
        expand_prompt: false,
      });
      return NextResponse.json({ taskId, mode });
    }

    if (body.action === "tts") {
      if (!body.text?.trim()) return NextResponse.json({ error: "Texte voix-off manquant" }, { status: 400 });
      const taskId = await createKieTask("elevenlabs/text-to-speech-multilingual-v2", {
        text: body.text.trim(),
        voice: body.voice || "TX3LPaxmHKxFdv7VOQHJ",
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.2,
        speed: 1,
        timestamps: body.timestamps ?? true,
      });
      return NextResponse.json({ taskId });
    }

    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Studio indisponible" },
      { status: 500 }
    );
  }
}
