import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { mirror } from "@/lib/storage";
import { kieClaude } from "@/lib/studio/kie";
import { stitchClips } from "@/lib/ugc/stitch";
import type { ProductInput } from "@/lib/ugc/types";
import { clampDuration } from "@/lib/ugc/types";

/**
 * Studio Vidéo IA : un prompt, un produit (ou pas), un style — des clips.
 *
 * Deux modes. « Produit » : une video ad avec le vrai produit, verrouillé par
 * ses photos de référence. « Scène » : on invente tout — un clip de cartoon,
 * un mini-film, une animation — sans produit, à partir d'une idée. Dans les
 * deux cas Claude écrit un storyboard de plans, une image clé fixe le style
 * et le personnage, et chaque plan part chez Seedance avec cette image en
 * première référence : c'est ce qui tient la cohérence d'un plan à l'autre.
 */

import {
  styleFor,
  type ShotDraft,
  type VideoBatch,
  type VideoRatio,
  type VideoStyleId,
} from "@/lib/studio/video-types";

export { styleFor, VIDEO_RATIOS, VIDEO_STYLES } from "@/lib/studio/video-types";
export type { ShotDraft, VideoBatch, VideoJob, VideoRatio, VideoStyle, VideoStyleId } from "@/lib/studio/video-types";

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

function productBrief(product?: ProductInput | null) {
  if (!product?.name) return "";
  const points = product.keyPoints.filter(Boolean);
  return [
    `Name: ${product.name}`,
    product.brand ? `Brand: ${product.brand}` : "",
    product.description ? `What it is: ${product.description}` : "",
    product.price ? `Price: ${product.price}` : "",
    points.length ? `Selling points: ${points.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Storyboard : Claude découpe l'idée en plans de 4 à 15 s, avec pour chacun
 * la mise en scène, le mouvement de caméra et, s'il y en a, la parole ou la
 * voix off. Il rend aussi la description du personnage/du décor qui servira
 * à fabriquer l'image clé — la même sur tous les plans.
 */
export async function writeStoryboard(input: {
  idea: string;
  mode: "product" | "scene";
  style: VideoStyleId;
  shots: number;
  seconds: number;
  ratio: VideoRatio;
  product?: ProductInput | null;
  speech: boolean;
  language: "en" | "fr";
}): Promise<{ shots: ShotDraft[]; keyframePrompt: string; title: string }> {
  const style = styleFor(input.style);
  const count = Math.min(10, Math.max(1, input.shots));
  const seconds = clampDuration(input.seconds);
  const language = input.language === "fr" ? "French" : "English";
  const brief = productBrief(input.product);

  const raw = await kieClaude(
    `You are a director writing a storyboard for an AI video generator (one clip per shot, ${seconds}s each, aspect ${input.ratio}).

VISUAL STYLE: ${style.label} — ${style.block}
MODE: ${input.mode === "product" ? "product video ad — the real product is the hero and must appear in most shots" : "invented scene — a short story, a cartoon clip or a mini film; no product unless the idea mentions one"}
${brief ? `PRODUCT:\n${brief}\n` : ""}
IDEA FROM THE USER: ${input.idea.trim()}

Write exactly ${count} consecutive shots that tell one coherent story with a hook in shot 1 and a payoff in the last shot.
For each shot give:
- "label": two or three words
- "action": one or two sentences — who is in frame, what they do, the setting, the camera move, the lighting. Concrete and visual. Same characters and same setting language across shots.
- "speech": ${input.speech ? `the exact spoken line or voice-over in ${language}, 6 to 22 words, or empty string if the shot is silent` : "empty string — this video has no speech"}
Also give:
- "title": a short title in French
- "keyframe": one paragraph describing the main character(s) and the setting in the chosen visual style, precise enough to draw a reference image that fixes their look (age, hair, outfit, colours, key props). No text in the image.

Return ONLY JSON: {"title":"...","keyframe":"...","shots":[{"label":"...","action":"...","speech":"..."}]}`,
    4000
  );
  const json = extractJson(raw);
  if (!json) throw new Error(`Storyboard illisible — « ${raw.slice(0, 100)}… »`);
  const parsed = JSON.parse(json) as {
    title?: string;
    keyframe?: string;
    shots?: Array<{ label?: string; action?: string; speech?: string }>;
  };
  const shots: ShotDraft[] = (parsed.shots ?? [])
    .filter((shot) => shot && shot.action)
    .map((shot, index) => ({
      label: String(shot.label || `Plan ${index + 1}`),
      duration: seconds,
      prompt: [
        `SHOT ${index + 1}: ${String(shot.action).trim()}`,
        shot.speech?.trim()
          ? `DIALOGUE / VOICE-OVER (exact, no improv): "${String(shot.speech).replace(/"/g, "'").trim()}"`
          : "No speech in this shot. Ambient sound and music only.",
      ].join("\n\n"),
    }));
  if (!shots.length) throw new Error("Le storyboard est vide");
  return {
    shots,
    keyframePrompt: `${String(parsed.keyframe || input.idea)} — ${style.keyframe}`,
    title: String(parsed.title || input.idea.slice(0, 48)),
  };
}

/** Prompt complet d'un plan : style, cohérence, verrou produit, puis le plan. */
export function composeShotPrompt(
  shot: ShotDraft,
  input: { mode: "product" | "scene"; style: VideoStyleId; hasKeyframe: boolean; product?: ProductInput | null; ratio: VideoRatio }
) {
  const style = styleFor(input.style);
  const refs: string[] = [];
  if (input.hasKeyframe) {
    refs.push(
      "CONSISTENCY — the FIRST reference image fixes the look of the main character(s), the setting and the visual style. Reproduce them exactly in this shot: same face, same hair, same outfit, same colours, same art style. Do not redesign anything between shots."
    );
  }
  if (input.mode === "product" && input.product?.imageUrls.length) {
    refs.push(
      `PRODUCT FIDELITY — the product "${input.product.name}" is the object shown in the reference images${input.hasKeyframe ? " after the first one" : ""}. Reproduce it EXACTLY: same shape, proportions, colours, materials, labels. Do not substitute, redesign, recolour or add branding. Ignore any person appearing in those product images.`
    );
  }
  return [
    `VISUAL STYLE: ${style.block}`,
    ...refs,
    `Aspect ratio ${input.ratio}. One continuous shot, no cuts inside the clip, no on-screen text, no captions, no watermark, no logo overlay.`,
    shot.prompt,
  ].join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Stockage des lots                                                   */
/* ------------------------------------------------------------------ */

const ROOT = path.join(process.cwd(), ".msgate-cache", "video-creatives");

function batchDir(id: string) {
  return path.join(ROOT, path.basename(id));
}

async function readBatch(id: string): Promise<VideoBatch | null> {
  try {
    return JSON.parse(await readFile(path.join(batchDir(id), "batch.json"), "utf8")) as VideoBatch;
  } catch {
    return null;
  }
}

async function writeBatch(batch: VideoBatch) {
  await mkdir(batchDir(batch.id), { recursive: true });
  const file = path.join(batchDir(batch.id), "batch.json");
  const payload = JSON.stringify(batch, null, 2);
  await writeFile(file, payload);
  mirror(file, Buffer.from(payload));
}

export async function createVideoBatch(input: Omit<VideoBatch, "id" | "createdAt">): Promise<VideoBatch> {
  const batch: VideoBatch = {
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await writeBatch(batch);
  return batch;
}

async function download(batchId: string, taskId: string, url: string) {
  const file = `${taskId}.mp4`;
  const target = path.join(batchDir(batchId), file);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = Buffer.from(await res.arrayBuffer());
    await writeFile(target, body);
    mirror(target, body);
    return file;
  } catch {
    return null;
  }
}

export async function applyVideoResults(
  results: Array<{ taskId: string; state?: string; urls: string[]; failMsg: string | null }>
) {
  const byTask = new Map(results.map((row) => [row.taskId, row]));
  let ids: string[] = [];
  try {
    ids = await readdir(ROOT);
  } catch {
    return;
  }
  for (const id of ids) {
    const batch = await readBatch(id);
    if (!batch) continue;
    let touched = false;
    for (const job of batch.jobs) {
      if (!job.taskId || job.state !== "pending") continue;
      const hit = byTask.get(job.taskId);
      if (!hit) continue;
      if (hit.state === "success" && hit.urls.length) {
        job.state = "done";
        job.urls = hit.urls;
        const saved = await download(batch.id, job.taskId, hit.urls[0]);
        if (saved) job.file = saved;
        touched = true;
      } else if (hit.state === "fail") {
        job.state = "fail";
        job.error = hit.failMsg || "Échec";
        touched = true;
      }
    }
    if (touched) await writeBatch(batch);
  }
}

export async function listVideoBatches(): Promise<VideoBatch[]> {
  let ids: string[] = [];
  try {
    ids = await readdir(ROOT);
  } catch {
    return [];
  }
  const batches = await Promise.all(ids.map(readBatch));
  return batches
    .filter((batch): batch is VideoBatch => Boolean(batch))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function stitchVideoBatch(batchId: string) {
  const batch = await readBatch(batchId);
  if (!batch) throw new Error("Lot introuvable");
  if (batch.jobs.some((job) => job.state !== "done" || !job.file)) {
    throw new Error("Tous les plans ne sont pas encore prêts");
  }
  const name = `montage-${batchId}.mp4`;
  await stitchClips(batchDir(batchId), batch.jobs.map((job) => job.file as string), name);
  batch.cut = name;
  await writeBatch(batch);
  return name;
}

export async function readVideoFile(id: string, file: string) {
  return readFile(path.join(batchDir(id), path.basename(file)));
}

/* Accès partagé avec la page Reproduire, qui assemble ses propres lots. */
export const readVideoBatch = readBatch;
export const writeVideoBatch = writeBatch;
export const videoBatchDir = batchDir;
