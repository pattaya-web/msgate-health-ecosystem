import { NextResponse } from "next/server";
import { expandBrief } from "@/lib/studio/expand";
import { createKieTask, getKieTask, uploadBase64 } from "@/lib/studio/kie";
import type { Ratio } from "@/lib/studio/ratios";
import { expandVoiceScripts } from "@/lib/studio/vo-scripts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Espacement entre deux créations : Kie compte les appels, pas les images. */
const CREATE_GAP_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Resolution = "1K" | "2K";

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
      count?: number;
      ratio?: Ratio;
      resolution?: Resolution;
      imageDataUrl?: string;
      fileName?: string;
      referenceUrls?: string[];
      removeWhat?: string;
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
      const jobs: Array<{ prompt: string; taskId: string }> = [];
      const failures: string[] = [];

      for (const [index, prompt] of prompts.entries()) {
        if (index) await sleep(CREATE_GAP_MS);

        let created: string | null = null;
        for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
          try {
            created = referenceUrls.length
              ? await createKieTask("gpt-image-2-image-to-image", {
                  prompt,
                  input_urls: referenceUrls,
                  aspect_ratio: body.ratio || "3:4",
                  resolution: body.resolution || "1K",
                })
              : await createKieTask("gpt-image-2-text-to-image", {
                  prompt,
                  aspect_ratio: body.ratio || "3:4",
                  resolution: body.resolution || "1K",
                });
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
      });
    }

    if (body.action === "remove") {
      if (!body.imageDataUrl) return NextResponse.json({ error: "Image manquante" }, { status: 400 });
      const uploaded = await uploadBase64(body.imageDataUrl, `remove-${Date.now()}.png`);
      const taskId = await createKieTask("gpt-image-2-image-to-image", {
        prompt:
          "Inpaint and remove whatever is covered by the bright magenta/pink brush strokes. Restore a clean photoreal background. Keep every unmarked pixel unchanged. Do not add text, logos, or new objects.",
        input_urls: [uploaded],
        aspect_ratio: "auto",
        resolution: "1K",
      });
      return NextResponse.json({ taskId });
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
