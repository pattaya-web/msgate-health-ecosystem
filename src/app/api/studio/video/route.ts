import { NextResponse } from "next/server";
import { createKieTask, getKieTask, isKieDone, isKieFailed, uploadBase64 } from "@/lib/studio/kie";
import {
  applyVideoResults,
  composeShotPrompt,
  createVideoBatch,
  listVideoBatches,
  stitchVideoBatch,
  styleFor,
  writeStoryboard,
  type ShotDraft,
  type VideoRatio,
  type VideoStyleId,
} from "@/lib/studio/video-creative";
import { fetchProductFromUrl } from "@/lib/ugc/fetch-product";
import type { ProductInput } from "@/lib/ugc/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reference-to-video avec audio : le même modèle que l'UGC, coût connu. */
const MODEL = "bytedance/seedance-2";
const MAX_REFS = 6;
const CREATE_GAP_MS = 800;
const TRANSIENT = /frequency is too high|rate.?limit|too many requests|\b429\b|timeout|ETIMEDOUT|ECONNRESET/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Body = {
  action?: "fetch" | "storyboard" | "keyframe" | "upload" | "generate" | "status" | "batches" | "stitch";
  url?: string;
  idea?: string;
  mode?: "product" | "scene";
  style?: VideoStyleId;
  shots?: ShotDraft[];
  count?: number;
  seconds?: number;
  ratio?: VideoRatio;
  resolution?: "720p" | "1080p";
  speech?: boolean;
  language?: "en" | "fr";
  product?: ProductInput | null;
  keyframePrompt?: string;
  keyframeUrl?: string;
  imageDataUrl?: string;
  title?: string;
  taskIds?: string[];
  batchId?: string;
};

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!TRANSIENT.test(error instanceof Error ? error.message : String(error))) throw error;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw last;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "fetch": {
        if (!body.url) return NextResponse.json({ error: "URL manquante" }, { status: 400 });
        return NextResponse.json({ product: await fetchProductFromUrl(body.url) });
      }

      case "batches":
        return NextResponse.json({ batches: await listVideoBatches() });

      case "stitch": {
        if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });
        return NextResponse.json({ file: await stitchVideoBatch(body.batchId) });
      }

      case "upload": {
        if (!body.imageDataUrl) return NextResponse.json({ error: "Image manquante" }, { status: 400 });
        return NextResponse.json({ url: await uploadBase64(body.imageDataUrl, `video-ref-${Date.now()}.png`) });
      }

      case "storyboard": {
        if (!body.idea?.trim()) return NextResponse.json({ error: "Décris l'idée" }, { status: 400 });
        const result = await writeStoryboard({
          idea: body.idea,
          mode: body.mode === "scene" ? "scene" : "product",
          style: body.style || "ugc",
          shots: body.count || 4,
          seconds: body.seconds || 6,
          ratio: body.ratio || "9:16",
          product: body.product,
          speech: body.speech ?? true,
          language: body.language || "en",
        });
        return NextResponse.json(result);
      }

      /**
       * Image clé : une seule image qui fixe personnage, décor et style. Elle
       * part ensuite en première référence de chaque plan. Avec un produit,
       * ses photos servent de références à l'image clé elle-même.
       */
      case "keyframe": {
        if (!body.keyframePrompt?.trim()) return NextResponse.json({ error: "Prompt d'image clé manquant" }, { status: 400 });
        const refs = (body.product?.imageUrls ?? []).filter((url) => /^https:\/\//i.test(url)).slice(0, 4);
        const aspect = body.ratio === "16:9" ? "16:9" : body.ratio === "1:1" ? "1:1" : "9:16";
        const prompt = `${body.keyframePrompt.trim()}${refs.length ? " The product shown in the reference images appears exactly as it is, unchanged." : ""} No text, no watermark, no logo.`;
        const taskId = await withRetry(() =>
          refs.length
            ? createKieTask("gpt-image-2-image-to-image", { prompt, input_urls: refs, aspect_ratio: aspect, resolution: "1K" })
            : createKieTask("gpt-image-2-text-to-image", { prompt, aspect_ratio: aspect, resolution: "1K" })
        );
        return NextResponse.json({ taskId });
      }

      case "status": {
        const taskIds = (body.taskIds ?? []).slice(0, 60);
        const results: Array<{ taskId: string; state?: string; urls: string[]; failMsg: string | null; throttled?: boolean }> = [];
        for (const taskId of taskIds) {
          try {
            const task = await getKieTask(taskId);
            const state = isKieDone(task.state) ? "success" : isKieFailed(task.state) ? "fail" : "pending";
            results.push({ taskId, state, urls: task.urls, failMsg: task.failMsg ?? null });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Statut illisible";
            if (TRANSIENT.test(message)) results.push({ taskId, state: "pending", urls: [], failMsg: null, throttled: true });
            else results.push({ taskId, state: "fail", urls: [], failMsg: message });
          }
          await sleep(250);
        }
        await applyVideoResults(results);
        return NextResponse.json({ results, throttled: results.some((row) => row.throttled) });
      }

      case "generate": {
        const shots = (body.shots ?? []).filter((shot) => shot && shot.prompt);
        if (!shots.length) return NextResponse.json({ error: "Aucun plan à générer" }, { status: 400 });
        const mode = body.mode === "scene" ? "scene" : "product";
        const style = styleFor(body.style).id;
        const ratio: VideoRatio = body.ratio || "9:16";
        const keyframe = body.keyframeUrl && /^https:\/\//i.test(body.keyframeUrl) ? body.keyframeUrl : undefined;
        const productRefs =
          mode === "product" ? (body.product?.imageUrls ?? []).filter((url) => /^https:\/\//i.test(url)).slice(0, MAX_REFS - (keyframe ? 1 : 0)) : [];
        if (mode === "product" && !productRefs.length) {
          return NextResponse.json({ error: "Aucune image produit : charge la fiche ou passe en mode Scène." }, { status: 400 });
        }
        const references = [...(keyframe ? [keyframe] : []), ...productRefs];

        const jobs = [];
        for (const [index, shot] of shots.entries()) {
          if (index) await sleep(CREATE_GAP_MS);
          const prompt = composeShotPrompt(shot, { mode, style, hasKeyframe: Boolean(keyframe), product: body.product, ratio });
          try {
            const taskId = await withRetry(() =>
              createKieTask(MODEL, {
                prompt,
                aspect_ratio: ratio,
                resolution: body.resolution || "720p",
                duration: shot.duration,
                generate_audio: true,
                ...(references.length ? { reference_image_urls: references } : {}),
              })
            );
            jobs.push({ label: shot.label, prompt, duration: shot.duration, taskId, error: null, state: "pending" as const, urls: [] as string[] });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Création impossible";
            jobs.push({ label: shot.label, prompt, duration: shot.duration, taskId: null, error: TRANSIENT.test(message) ? "Kie saturé — relance" : message, state: "fail" as const, urls: [] as string[] });
          }
        }

        const batch = await createVideoBatch({
          title: body.title?.trim() || body.idea?.trim().slice(0, 48) || "Vidéo",
          mode,
          style,
          ratio,
          resolution: body.resolution || "720p",
          keyframeUrl: keyframe,
          productName: body.product?.name,
          jobs,
        });
        return NextResponse.json({ batch });
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Studio vidéo indisponible" }, { status: 502 });
  }
}
