import { NextResponse } from "next/server";
import { expandBrief } from "@/lib/studio/expand";
import { createKieTask, getKieTask, uploadBase64 } from "@/lib/studio/kie";
import { expandVoiceScripts } from "@/lib/studio/vo-scripts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ratio = "1:1" | "9:16" | "3:4";
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
      const jobs = await Promise.all(
        prompts.map(async (prompt) => {
          const taskId = referenceUrls.length
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
          return { prompt, taskId };
        })
      );
      return NextResponse.json({ jobs, referenceUrls });
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
