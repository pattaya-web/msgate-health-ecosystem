import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { askText, askVision, KieError } from "@/lib/kie";
import { getOpenAiKey, OPENAI_BASE } from "@/lib/openai";
import { ensureLocal, probe, publishToKie, runFf } from "./media";

/**
 * Repli OpenAI (vision) quand le modele texte de KIE est en panne.
 * Meme format de messages ; le modele lit les URL publiques des images.
 */
async function askVisionOpenAi(prompt: string, system: string, imageUrls: string[], maxTokens: number): Promise<string> {
  const key = getOpenAiKey();
  if (!key) throw new EnhanceError("Ni KIE ni OpenAI ne peuvent rédiger la consigne pour l'instant (clé OpenAI absente).", 502);
  const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  for (const url of imageUrls) content.push({ type: "image_url", image_url: { url, detail: "low" } });
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!res.ok || json.error) throw new EnhanceError(`OpenAI : ${json.error?.message ?? `HTTP ${res.status}`}`, res.status === 401 ? 401 : 502);
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new EnhanceError("OpenAI a renvoyé une réponse vide.");
  return out;
}

/**
 * Rédaction automatique de la consigne, façon Higgsfield.
 *
 * Leur « enhancer » regarde la vidéo et les références, puis écrit un prompt
 * structuré : quoi remplacer, quoi garder, plan par plan avec les temps,
 * décor, expressions, physique, lumière, avec des balises @Video 1 / @Image N.
 * On fait pareil : trois images de la vidéo + les références partent chez le
 * modèle vision de KIE, qui rend le texte. La numérotation des images suit
 * exactement l'ordre envoyé ensuite aux modèles : personne, produit, décor.
 *
 * Les images sont publiées sur le stockage KIE et passées en URL : en data
 * URI, plusieurs mégaoctets de base64 faisaient répondre « internal error ».
 */

export class EnhanceError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

const SYSTEM = `You write video-editing prompts for AI character-swap models (Seedance, Kling, Higgsfield Genjutsu).
You look at frames of the SOURCE VIDEO and at REFERENCE IMAGES, then write ONE prompt in English, in the exact house style below.
Rules:
- Refer to the source video as @Video 1 and to the reference images as @Image 1, @Image 2… in the order given.
- Describe only what you can see. Never invent props, gestures or camera moves that are not in the frames.
- The performer must be replaced by the person of the person references: face, skin tone, hair, apparent gender, body build, and the full outfit visible in those references. Nothing of the source performer's face, body or clothes survives.
- Everything else stays exactly as in @Video 1: camera movement, framing progression, pose progression, hand gestures, head movement, mouth-performance timing, cuts, pacing, lighting direction, and the environment — unless a location reference is provided, in which case the whole environment is replaced by that location while motion and camera stay identical.
- If product references are provided, the held product must be reproduced exactly (label, colors, shape, position in hand).
- Plain text, no markdown, no bullet symbols other than section titles in CAPITALS. 1500 to 2800 characters.

Structure (keep these section titles, in this order):
<one paragraph starting with "Edit @Video 1. Replace …" that states the replacement, the references used, what is kept>

ACTIVE REFERENCES
<one line per reference image: what it is and how it must be used>

SOURCE VIDEO
<what happens in @Video 1, as a continuous performance>

SHOT-BY-SHOT GUIDE
<Shot 1 (0.0-Xs): … ; add more shots only if the framing clearly changes>

SETTING
<the environment: kept as in @Video 1, or replaced by the location reference>

EXPRESSION NOTES
<how the performer's expression evolves>

PHYSICS
<contact points, clothing and hair motion, hands stability>

LIGHTING
<how to light the new person to match the scene>`;

/** Trois images de la vidéo (début, milieu, fin), réduites, publiées chez KIE. */
async function publishFrames(videoPath: string, durationSec: number): Promise<string[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-enh-"));
  try {
    const d = Math.max(0.5, durationSec);
    const times = [0.2, d * 0.5, Math.max(0.2, d - 0.3)];
    const urls: string[] = [];
    for (const [k, t] of times.entries()) {
      const f = path.join(dir, `frame-${k + 1}.jpg`);
      await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(2), "-i", videoPath, "-frames:v", "1", "-vf", "scale=-2:640", "-q:v", "5", f], 60_000);
      urls.push(await publishToKie(f, `enhance-frame-${k + 1}.jpg`));
    }
    return urls;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Une image de référence, réduite si besoin, publiée chez KIE. */
async function publishImage(localPath: string, name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-enh-i-"));
  try {
    const f = path.join(dir, "ref.jpg");
    await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", localPath, "-vf", "scale='min(1024,iw)':-2", "-q:v", "5", f], 60_000);
    return await publishToKie(f, `${name}.jpg`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function enhancePrompt(args: {
  sourceVideo: string;
  referenceImages: string[];
  productImages: string[];
  productDescription?: string;
  sceneImage?: string;
  userPrompt?: string;
}): Promise<string> {
  const src = await ensureLocal(args.sourceVideo);
  const info = await probe(src.path);
  const frames = await publishFrames(src.path, info.durationSec);

  const refs: { label: string; url: string }[] = [];
  for (const [k, u] of args.referenceImages.slice(0, 3).entries()) {
    refs.push({ label: `person reference (view ${k + 1}; a multi-panel sheet shows the same person from several angles)`, url: await publishImage((await ensureLocal(u)).path, `enhance-person-${k + 1}`) });
  }
  for (const [k, u] of args.productImages.slice(0, 4).entries()) {
    refs.push({ label: `product reference ${k + 1}${args.productDescription ? ` (${args.productDescription})` : ""}`, url: await publishImage((await ensureLocal(u)).path, `enhance-product-${k + 1}`) });
  }
  if (args.sceneImage) {
    refs.push({ label: "location reference (the NEW environment for the whole video)", url: await publishImage((await ensureLocal(args.sceneImage)).path, "enhance-scene") });
  }

  const legend = refs.map((r, k) => `@Image ${k + 1} = ${r.label}`).join("\n");
  const prompt = `Source video duration: ${info.durationSec.toFixed(1)} s, ${info.width}x${info.height}.
The first ${frames.length} images are frames of @Video 1 in chronological order (start, middle, end).
Then come the reference images, numbered as they will be sent to the model:
${legend || "(no reference images provided)"}
${args.userPrompt?.trim() ? `\nUser wishes (must be honored, they take priority when specific): ${args.userPrompt.trim()}` : ""}

Write the prompt now.`;

  const images = [...frames, ...refs.map((r) => r.url)];
  const finish = (text: string) => {
    const clean = text.replace(/```[a-z]*\n?/g, "").trim();
    if (clean.length < 200) throw new EnhanceError("Le modèle a renvoyé une consigne trop courte.");
    return clean.slice(0, 3900);
  };

  /*
   * OpenAI d'abord quand la cle existe : reponse en une vingtaine de secondes,
   * pour une fraction de centime. KIE (gemini) sert de repli, il tombe
   * regulierement en « internal error » et fait attendre 35 s avant d'echouer.
   */
  if (getOpenAiKey()) {
    try {
      return finish(await askVisionOpenAi(prompt, SYSTEM, images, 3000));
    } catch {
      // On tente KIE ci-dessous.
    }
  }
  try {
    return finish(await askVision(prompt, SYSTEM, images, 3000));
  } catch (e) {
    const err = e as KieError;
    throw new EnhanceError(
      /internal error|maintain/i.test(err.message)
        ? "Les modèles texte (OpenAI et KIE) n'ont pas répondu : réessaie dans une minute."
        : err.message,
      err.code === 401 ? 401 : 502,
    );
  }
}

/* ------------------------- Planche de référence ------------------------- */

export interface SheetPanel {
  x0: number;
  x1: number;
  kind: "portrait" | "front" | "back" | "other";
}

/**
 * Une image de référence large est-elle une planche (face, dos, portrait
 * côte à côte) ? Le modèle vision renvoie les bornes de chaque panneau.
 * Aucune détection locale fiable : les gouttières ne sont pas toujours
 * blanches, les panneaux pas toujours égaux. Vide si ce n'est pas une planche.
 */
export async function analyzeSheet(imageUrl: string): Promise<SheetPanel[]> {
  const system = "You analyse reference images for a video tool. Answer with JSON only, no prose.";
  const prompt =
    "Is this image a character sheet made of several separate photos placed side by side (for example: full-body front view, back view, close-up portrait)? " +
    "If yes, list the panels from left to right with their horizontal bounds as fractions of the image width (0 to 1), and their kind: " +
    '"portrait" (close-up of the face), "front" (full body from the front), "back" (from behind) or "other". ' +
    'Reply exactly like {"panels":[{"x0":0,"x1":0.33,"kind":"front"},...]} . If it is a single photo, reply {"panels":[]}.';
  let raw = "";
  try {
    raw = await askVisionOpenAi(prompt, system, [imageUrl], 300);
  } catch {
    try {
      raw = await askVision(prompt, system, [imageUrl], 300);
    } catch {
      return [];
    }
  }
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim()) as { panels?: SheetPanel[] };
    const panels = (json.panels ?? [])
      .map((p) => ({ x0: Number(p.x0), x1: Number(p.x1), kind: p.kind }))
      .filter((p) => Number.isFinite(p.x0) && Number.isFinite(p.x1) && p.x1 - p.x0 >= 0.12 && p.x0 >= 0 && p.x1 <= 1.001);
    return panels.length >= 2 && panels.length <= 4 ? panels : [];
  } catch {
    return [];
  }
}

/* ------------------------------ Traduction ------------------------------ */

const FRENCH_HINT = /\b(remplace|remplacer|garde|garder|mon|ma|mes|le|la|les|avec|dans|même|comme|elle|tient|décor|cadrage|vidéo|visage|tenue)\b/i;

/**
 * Les modèles vidéo comprennent l'anglais bien mieux que le français : une
 * consigne écrite en français est traduite avant l'envoi, sans rien changer
 * au sens ni aux balises (@Video 1, @Image 2). Déjà en anglais : inchangée.
 * En cas de panne du modèle texte, la consigne part telle quelle.
 */
export async function toEnglish(text: string): Promise<string> {
  const t = text.trim();
  if (!t || !FRENCH_HINT.test(t)) return t;
  const system = "You translate video-generation instructions from French to English. Keep the meaning, the imperative tone and every @Video / @Image tag exactly. Reply with the translation only.";
  try {
    return (await askVisionOpenAi(t, system, [], 800)).trim() || t;
  } catch {
    try {
      return (await askText(t, system, 800)).trim() || t;
    } catch {
      return t;
    }
  }
}
