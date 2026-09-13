import { NextResponse } from "next/server";
import { createKieTask, getKieTask, isKieDone, isKieFailed, uploadBase64 } from "@/lib/studio/kie";
import { applyVideoResults, createVideoBatch, listVideoBatches } from "@/lib/studio/video-creative";
import { recipeFor, type RecipeShot } from "@/lib/reproduce/recipes";
import { assembleRecipeBatch, composeRecipeShotPrompt, writeRecipeScript } from "@/lib/reproduce/server";
import { fetchProductFromUrl } from "@/lib/ugc/fetch-product";
import type { ProductInput } from "@/lib/ugc/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "bytedance/seedance-2";
const MAX_REFS = 6;
const CREATE_GAP_MS = 800;
const TRANSIENT = /frequency is too high|rate.?limit|too many requests|\b429\b|timeout|ETIMEDOUT|ECONNRESET/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Body = {
  action?: "fetch" | "upload" | "script" | "keyframe" | "generate" | "status" | "batches" | "assemble";
  url?: string;
  imageDataUrl?: string;
  recipeId?: string;
  product?: ProductInput | null;
  language?: "en" | "fr";
  shots?: RecipeShot[];
  keyframePrompt?: string;
  keyframeUrl?: string;
  resolution?: "720p" | "1080p";
  endCard?: string;
  taskIds?: string[];
  batchId?: string;
};

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
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

      case "upload": {
        if (!body.imageDataUrl) return NextResponse.json({ error: "Image manquante" }, { status: 400 });
        return NextResponse.json({ url: await uploadBase64(body.imageDataUrl, `reproduce-${Date.now()}.png`) });
      }

      case "batches": {
        const batches = (await listVideoBatches()).filter((batch) => batch.recipeId);
        return NextResponse.json({ batches });
      }

      case "script": {
        const recipe = recipeFor(body.recipeId);
        if (!recipe) return NextResponse.json({ error: "Recette inconnue" }, { status: 400 });
        if (!body.product?.name) return NextResponse.json({ error: "Charge d'abord le produit" }, { status: 400 });
        const result = await writeRecipeScript({ recipe, product: body.product, language: body.language || "en" });
        return NextResponse.json(result);
      }

      case "keyframe": {
        if (!body.keyframePrompt?.trim()) return NextResponse.json({ error: "Prompt d'image clé manquant" }, { status: 400 });
        const refs = (body.product?.imageUrls ?? []).filter((url) => /^https:\/\//i.test(url)).slice(0, 4);
        const prompt = `${body.keyframePrompt.trim()} No text, no watermark, no logo.`;
        const taskId = await withRetry(() =>
          refs.length
            ? createKieTask("gpt-image-2-image-to-image", { prompt, input_urls: refs, aspect_ratio: "9:16", resolution: "1K" })
            : createKieTask("gpt-image-2-text-to-image", { prompt, aspect_ratio: "9:16", resolution: "1K" })
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
        const recipe = recipeFor(body.recipeId);
        if (!recipe) return NextResponse.json({ error: "Recette inconnue" }, { status: 400 });
        const product = body.product;
        if (!product?.name) return NextResponse.json({ error: "Charge d'abord le produit" }, { status: 400 });
        const shots = (body.shots ?? []).filter((shot) => shot && shot.action);
        if (!shots.length) return NextResponse.json({ error: "Écris d'abord le script" }, { status: 400 });

        const keyframe = body.keyframeUrl && /^https:\/\//i.test(body.keyframeUrl) ? body.keyframeUrl : undefined;
        const productRefs = product.imageUrls.filter((url) => /^https:\/\//i.test(url)).slice(0, MAX_REFS - (keyframe ? 1 : 0));
        if (!productRefs.length) {
          return NextResponse.json({ error: "Aucune image produit : sans elle le produit serait inventé." }, { status: 400 });
        }
        const references = [...(keyframe ? [keyframe] : []), ...productRefs];

        const jobs = [];
        for (const [index, shot] of shots.entries()) {
          if (index) await sleep(CREATE_GAP_MS);
          const prompt = composeRecipeShotPrompt({ recipe, shot, product, hasKeyframe: Boolean(keyframe) });
          try {
            const taskId = await withRetry(() =>
              createKieTask(MODEL, {
                prompt,
                aspect_ratio: "9:16",
                resolution: body.resolution || "720p",
                duration: shot.seconds,
                generate_audio: !shot.silent,
                reference_image_urls: references,
              })
            );
            jobs.push({ label: shot.label, prompt, duration: shot.seconds, taskId, error: null, state: "pending" as const, urls: [] as string[], block: shot.block, silent: shot.silent });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Création impossible";
            jobs.push({ label: shot.label, prompt, duration: shot.seconds, taskId: null, error: TRANSIENT.test(message) ? "Kie saturé — relance" : message, state: "fail" as const, urls: [] as string[], block: shot.block, silent: shot.silent });
          }
        }

        // La voix off d'un bloc muet, c'est ses phrases mises bout à bout.
        const voiceover: Record<string, string> = {};
        for (const block of recipe.blocks.filter((item) => item.kind === "broll")) {
          const text = shots.filter((shot) => shot.block === block.id).map((shot) => shot.line).filter(Boolean).join(" ");
          if (text) voiceover[block.id] = text;
        }

        const batch = await createVideoBatch({
          title: `${recipe.name} — ${product.name}`,
          mode: "product",
          style: recipe.blocks[0]?.style ?? "ugc",
          ratio: "9:16",
          resolution: body.resolution || "720p",
          keyframeUrl: keyframe,
          productName: product.name,
          jobs,
          recipeId: recipe.id,
          voiceover: Object.keys(voiceover).length ? voiceover : undefined,
          endCard: recipe.endCard ? body.endCard?.trim() || `${product.brand || product.name}\nBUY 1 GET 1 FREE TODAY\n${product.price || ""}` : undefined,
        });
        return NextResponse.json({ batch });
      }

      case "assemble": {
        if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });
        const batches = await listVideoBatches();
        const found = batches.find((batch) => batch.id === body.batchId);
        const recipe = recipeFor(found?.recipeId);
        if (!found || !recipe) return NextResponse.json({ error: "Lot ou recette introuvable" }, { status: 404 });
        const batch = await assembleRecipeBatch(found.id, recipe);
        return NextResponse.json({ batch });
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reproduction indisponible" }, { status: 502 });
  }
}
