import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import { createKieTask, kieClaude, pollKieTask } from "@/lib/studio/kie";
import { VIDEO_STYLES, type VideoBatch } from "@/lib/studio/video-types";
import { readVideoBatch, writeVideoBatch, videoBatchDir } from "@/lib/studio/video-creative";
import { stitchClips } from "@/lib/ugc/stitch";
import type { ProductInput } from "@/lib/ugc/types";
import { clampDuration } from "@/lib/ugc/types";
import type { Recipe, RecipeBlock, RecipeShot } from "@/lib/reproduce/recipes";

const run = promisify(execFile);

export type { RecipeShot } from "@/lib/reproduce/recipes";

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

function productBrief(product: ProductInput) {
  const points = product.keyPoints.filter(Boolean);
  return [
    `Name: ${product.name}`,
    product.brand ? `Brand: ${product.brand}` : "",
    product.description ? `What it is: ${product.description}` : "",
    product.price ? `Price: ${product.price}` : "",
    product.comparePrice ? `Was: ${product.comparePrice}` : "",
    points.length ? `Selling points: ${points.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Réécrit le script de la référence pour le produit, bloc par bloc, en
 * gardant exactement le nombre de plans. Même mécanique rhétorique, même
 * calibre, autre produit — et jamais la marque d'origine.
 */
export async function writeRecipeScript(input: {
  recipe: Recipe;
  product: ProductInput;
  language: "en" | "fr";
}): Promise<{ shots: RecipeShot[]; keyframePrompt: string; fallback?: string }> {
  const { recipe, product } = input;
  const language = input.language === "fr" ? "French" : "English";
  const keyframePrompt = `${recipe.keyframe || "Photorealistic phone video still of a creator holding the product."} The product is "${product.name}" and must look exactly like the reference images.`;

  const blocks = recipe.blocks
    .map(
      (block) =>
        `BLOCK "${block.id}" (${block.kind === "speaking" ? "the creator speaks on camera" : "silent b-roll under a voice-over"}, exactly ${block.shots} shots of ${block.seconds}s, about ${Math.round(block.seconds * 2.3)} words per shot):\nSETUP: ${block.setup}\nORIGINAL SCRIPT, one beat per line:\n${block.script.map((line, i) => `${i + 1}. ${line}`).join("\n")}`
    )
    .join("\n\n");

  let raw: string;
  try {
    raw = await kieClaude(
    `I rebuild a winning short video ad for MY product. Below is the reference, block by block, with its original script. Rewrite it for my product: keep the same structure beat for beat, the same hook shape, the same emotional moves and the same closing offer style, but talk about MY product truthfully. Never carry over the original brand, product category or claims my product cannot support. Keep speaker prefixes (WOMAN:, PRODUCT:) when the original has them — "PRODUCT" is my product talking as a character.

MY PRODUCT:
${productBrief(product)}

REFERENCE:
${blocks}

For every block return exactly the same number of shots as requested. Each shot:
- "label": two words
- "action": one sentence, what we see (who, gesture, framing), consistent with the block SETUP
- "line": for a speaking block, the EXACT dialogue in ${language} (12 to 22 words, already talking when the clip starts); for a b-roll block, the voice-over sentence in ${language} that plays over this shot (10 to 18 words)

Return ONLY JSON: {"blocks":[{"id":"...","shots":[{"label":"...","action":"...","line":"..."}]}]}`,
    4000
    );
  } catch (error) {
    /*
     * L'IA d'écriture est tombée : on ne bloque pas le flux. Le script de la
     * référence est livré tel quel, les mots qui désignaient son produit
     * remplacés par le nôtre, et l'interface prévient qu'il faut relire.
     */
    return {
      shots: fallbackShots(recipe, product),
      keyframePrompt,
      fallback: error instanceof Error ? error.message : "IA d'écriture indisponible",
    };
  }
  const json = extractJson(raw);
  if (!json) return { shots: fallbackShots(recipe, product), keyframePrompt, fallback: "Réponse illisible de l'IA" };
  const parsed = JSON.parse(json) as { blocks?: Array<{ id?: string; shots?: Array<{ label?: string; action?: string; line?: string }> }> };

  const shots: RecipeShot[] = [];
  for (const block of recipe.blocks) {
    const got = parsed.blocks?.find((item) => item.id === block.id)?.shots ?? [];
    for (let index = 0; index < block.shots; index += 1) {
      const shot = got[index];
      shots.push({
        block: block.id,
        label: String(shot?.label || `${block.label} ${index + 1}`),
        seconds: clampDuration(block.seconds),
        action: String(shot?.action || block.setup),
        line: String(shot?.line || block.script[index] || "").replace(/"/g, "'").trim(),
        silent: block.kind === "broll",
      });
    }
  }

  return { shots, keyframePrompt };
}

/** Script d'origine, produit renommé : utilisable sans IA, à relire. */
function fallbackShots(recipe: Recipe, product: ProductInput): RecipeShot[] {
  const terms = [...(recipe.sourceTerms ?? [])].sort((a, b) => b.length - a.length);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rename = (line: string) =>
    terms.reduce((text, term) => text.replace(new RegExp(escape(term), "gi"), product.name), line);
  const shots: RecipeShot[] = [];
  for (const block of recipe.blocks) {
    for (let index = 0; index < block.shots; index += 1) {
      shots.push({
        block: block.id,
        label: `${block.label} ${index + 1}`,
        seconds: clampDuration(block.seconds),
        action: block.setup,
        line: rename(block.script[index] || "").replace(/"/g, "'").trim(),
        silent: block.kind === "broll",
      });
    }
  }
  return shots;
}

function styleBlock(block: RecipeBlock) {
  return VIDEO_STYLES.find((style) => style.id === block.style)?.block ?? "";
}

/** Prompt complet d'un plan : style, cohérence, produit, mise en scène, plan. */
export function composeRecipeShotPrompt(input: {
  recipe: Recipe;
  shot: RecipeShot;
  product: ProductInput;
  hasKeyframe: boolean;
}) {
  const block = input.recipe.blocks.find((item) => item.id === input.shot.block) ?? input.recipe.blocks[0];
  const parts = [`VISUAL STYLE: ${styleBlock(block)}`];
  if (input.hasKeyframe) {
    parts.push(
      "CONSISTENCY — the FIRST reference image fixes the look of the character(s), the setting and the art style. Reproduce them exactly: same face, hair, outfit, colours, same room. Do not redesign anything between shots."
    );
  }
  if (input.product.imageUrls.length) {
    parts.push(
      `PRODUCT FIDELITY — the product "${input.product.name}" is the object in the reference images${input.hasKeyframe ? " after the first one" : ""}. Reproduce it EXACTLY: shape, proportions, colours, materials, labels. Never substitute, redesign, recolour or add branding. Ignore any person in those product images.`
    );
  }
  parts.push(`SETUP: ${block.setup}`);
  parts.push("Vertical 9:16. One continuous take, no cuts, no on-screen text, no captions, no watermark, no logo overlay.");
  parts.push(`SHOT: ${input.shot.action}`);
  if (input.shot.silent) {
    parts.push("SILENT SHOT — nobody speaks, no lip movement, no narration. Ambient sound only. The voice-over is added later.");
  } else {
    parts.push(
      `DIALOGUE (exact, no improv): "${input.shot.line}"\nDELIVERY: the speaker is already talking when the clip starts and still talking when it ends, natural pace filling the whole clip, perfectly lip-synced, no dead air.`
    );
  }
  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Montage : blocs, voix off, carton final                              */
/* ------------------------------------------------------------------ */

function ffmpeg() {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable sur le serveur");
  return ffmpegPath;
}

/** Voix off ElevenLabs : le texte du bloc, en un seul fichier mp3. */
async function synthesize(text: string, dir: string, name: string) {
  const taskId = await createKieTask("elevenlabs/text-to-speech-multilingual-v2", {
    text,
    voice: "TX3LPaxmHKxFdv7VOQHJ",
    stability: 0.45,
    similarity_boost: 0.75,
    style: 0.25,
    speed: 1,
    timestamps: false,
  });
  const task = await pollKieTask(taskId, 60);
  const url = task.urls.find((item) => /\.(mp3|wav|m4a)(\?|$)/i.test(item)) ?? task.urls[0];
  if (!url) throw new Error("Voix off sans fichier");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Voix off introuvable");
  const file = `${name}.mp3`;
  await writeFile(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Pose la voix off sur un bloc muet. L'audio est complété de silence jusqu'à
 * la fin de la vidéo (`apad`) et coupé à sa longueur (`-shortest`) : la vidéo
 * garde sa durée, la voix s'y cale.
 */
async function muxVoiceover(dir: string, video: string, audio: string, out: string) {
  await run(
    ffmpeg(),
    [
      "-y",
      "-i", path.join(dir, video),
      "-i", path.join(dir, audio),
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-af", "apad",
      "-shortest",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      path.join(dir, out),
    ],
    { maxBuffer: 1024 * 1024 * 32 }
  );
  return out;
}

function drawtextEscape(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

/** Carton final : fond blanc, trois lignes centrées, trois secondes, piste audio muette. */
async function makeEndCard(dir: string, lines: string[], out: string) {
  const fonts = ["C:/Windows/Fonts/arialbd.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"];
  const font = fonts.find((candidate) => existsSync(candidate));
  if (!font) return null;
  const fontfile = font.replace(/\\/g, "/").replace(/:/g, "\\:");
  const sizes = [44, 64, 34];
  const ys = [520, 620, 720];
  const filters = lines.slice(0, 3).map(
    (line, index) =>
      `drawtext=fontfile='${fontfile}':text='${drawtextEscape(line)}':fontcolor=#233137:fontsize=${sizes[index]}:x=(w-text_w)/2:y=${ys[index]}`
  );
  await run(
    ffmpeg(),
    [
      "-y",
      "-f", "lavfi", "-i", "color=c=white:s=720x1280:d=3:r=30",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-vf", filters.join(","),
      "-t", "3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
      "-shortest",
      path.join(dir, out),
    ],
    { maxBuffer: 1024 * 1024 * 32 }
  );
  return out;
}

/**
 * Assemble un lot de recette : les blocs dans l'ordre, la voix off posée sur
 * les blocs muets, le carton final s'il y en a un. Tout est réencodé au
 * même format par `stitchClips`, donc la concaténation finale est sûre.
 */
export async function assembleRecipeBatch(batchId: string, recipe: Recipe): Promise<VideoBatch> {
  const batch = await readVideoBatch(batchId);
  if (!batch) throw new Error("Lot introuvable");
  if (batch.jobs.some((job) => job.state !== "done" || !job.file)) {
    throw new Error("Tous les plans ne sont pas encore prêts");
  }
  const dir = videoBatchDir(batchId);
  await mkdir(dir, { recursive: true });

  const parts: string[] = [];
  for (const block of recipe.blocks) {
    const files = batch.jobs.filter((job) => job.block === block.id).map((job) => job.file as string);
    if (!files.length) continue;
    let part = `block-${block.id}.mp4`;
    if (files.length === 1) {
      // `stitchClips` exige deux fichiers : un bloc d'un seul plan est copié tel quel.
      await writeFile(path.join(dir, part), await readFile(path.join(dir, files[0])));
    } else {
      await stitchClips(dir, files, part);
    }
    const voice = batch.voiceover?.[block.id];
    if (voice?.trim()) {
      const audio = batch.voiceoverFile?.[block.id] ?? (await synthesize(voice, dir, `vo-${block.id}`));
      batch.voiceoverFile = { ...(batch.voiceoverFile ?? {}), [block.id]: audio };
      part = await muxVoiceover(dir, part, audio, `block-${block.id}-vo.mp4`);
    }
    parts.push(part);
  }

  if (batch.endCard) {
    const lines = batch.endCard.split("\n").map((line) => line.trim()).filter(Boolean);
    const card = await makeEndCard(dir, lines, "endcard.mp4").catch(() => null);
    if (card) parts.push(card);
  }

  if (!parts.length) throw new Error("Rien à assembler");
  const final = "final.mp4";
  if (parts.length === 1) {
    await writeFile(path.join(dir, final), await readFile(path.join(dir, parts[0])));
  } else {
    await stitchClips(dir, parts, final);
  }
  batch.cut = final;
  await writeVideoBatch(batch);
  return batch;
}
