import { createTask, getTask, KieError } from "@/lib/kie";
import { newId, readDB, writeDB } from "@/lib/db";
import { CREATION } from "./config";
import { ensureLocal, isAllowedRemote, localMediaPath, publishToKie } from "./media";
import { toEnglish } from "./prompt-enhancer";
import type { CreateRequest, StudioJob } from "./types";

/**
 * « Création » : une vidéo depuis zéro, sans rien filmer.
 *
 * L'image de départ (générée dans l'onglet Image, ou n'importe quelle photo)
 * devient la première image de la vidéo : Seedance 2.5 l'anime et fait
 * parler la personne, voix comprise, à partir du script écrit. C'est le
 * workflow des créatives UGC « full IA » : image soignée en amont, puis
 * image → vidéo avec dialogue.
 *
 * Deux façons de l'appeler, exclusives chez KIE :
 *  - `first-frame` : l'image est la première image exacte (fidélité maximale
 *    au cadrage et au visage) ;
 *  - `references` : l'image et les photos du produit sont des références
 *    (quand un produit doit rester identique quand la main bouge).
 */

export class CreationError extends Error {
  code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const validSource = (u: string) => Boolean(localMediaPath(u)) || isAllowedRemote(u);

const LANGUAGES: Record<string, string> = { fr: "French", en: "English", es: "Spanish", ar: "Arabic", it: "Italian", de: "German", pt: "Portuguese" };

/** Secondes estimées pour le devis : la durée choisie, sinon la longueur du script. */
export function estimatedSeconds(script: string, durationSec: number): number {
  if (durationSec > 0) return durationSec;
  return Math.min(CREATION.maxDurationSec, Math.max(CREATION.minDurationSec, Math.ceil(script.trim().length / 15)));
}

export function createCreationJobs(req: CreateRequest): StudioJob[] {
  if (!req.startImage || !validSource(req.startImage)) throw new CreationError("Image de départ manquante ou invalide.");
  const script = (req.script ?? "").trim();
  if (!script) throw new CreationError("Écris ce que la personne doit dire.");
  if (script.length > 2000) throw new CreationError("Script trop long : 2 000 caractères maximum (30 secondes de parole, c'est environ 450 caractères).");
  const duration = Number(req.durationSec);
  if (!(duration === -1 || (Number.isInteger(duration) && duration >= CREATION.minDurationSec && duration <= CREATION.maxDurationSec))) {
    throw new CreationError(`Durée invalide : entre ${CREATION.minDurationSec} et ${CREATION.maxDurationSec} secondes, ou automatique.`);
  }
  const resolution = CREATION.resolutions.includes(req.resolution) ? req.resolution : "720p";
  const aspect = (["9:16", "16:9", "1:1", "adaptive"] as const).includes(req.aspectRatio) ? req.aspectRatio : "9:16";
  const language = LANGUAGES[req.language ?? "fr"] ? (req.language ?? "fr") : "fr";
  const variants = Math.min(4, Math.max(1, Math.round(Number(req.variants) || 1)));
  const productImages = (Array.isArray(req.productImages) ? req.productImages : []).filter(validSource).slice(0, 4);
  const mode: StudioJob["createMode"] = productImages.length ? "references" : "first-frame";
  const seconds = estimatedSeconds(script, duration);
  const credits = Math.round(CREATION.creditsPerSec[resolution] * seconds);

  const db = readDB();
  const batchId = newId();
  const created: StudioJob[] = [];
  for (let i = 0; i < variants; i++) {
    const t = now();
    const job: StudioJob = {
      id: newId(),
      type: "creation",
      batchId,
      provider: "seedance25",
      requestedProvider: "seedance25",
      transform: "full",
      style: "ugc",
      sourceVideo: "",
      sourceVideoName: "",
      sourceDurationSec: 0,
      referenceImage: req.startImage,
      referenceImageName: req.startImageName ?? "",
      referenceImages: [req.startImage],
      remoteReferenceUrls: [],
      referenceSheet: "",
      sceneImage: "",
      remoteSceneImageUrl: "",
      userPrompt: (req.scenePrompt ?? "").trim(),
      prompt: "",
      negativePrompt: "",
      voiceMode: "keep",
      voiceId: "",
      voiceName: "",
      voiceEngine: "",
      voiceAmbience: "raw",
      lipSync: false,
      lipSyncError: "",
      productImages,
      productDescription: (req.productDescription ?? "").trim(),
      remoteProductUrls: [],
      talkText: script,
      talkAudio: "",
      remoteAudioUrl: "",
      resolution: resolution === "1080p" ? "1080p" : "720p",
      createResolution: resolution,
      createDurationSec: duration,
      createMode: mode,
      createLanguage: language,
      aspectRatio: aspect === "adaptive" ? "original" : aspect,
      status: "queued",
      progress: 0,
      providerJobId: "",
      providerInput: {},
      remoteSourceUrl: "",
      remoteReferenceUrl: "",
      remoteVideoUrl: "",
      videoOutput: "",
      audioOutput: "",
      finalOutput: "",
      error: "",
      voiceError: "",
      creditsEstimated: credits,
      creditsConsumed: 0,
      createdAt: t,
      updatedAt: t,
      startedAt: "",
      completedAt: "",
    };
    db.studioJobs.unshift(job);
    created.push(job);
  }
  writeDB(db);
  return created;
}

/**
 * Le prompt envoyé à Seedance. Les consignes sont en anglais (le modèle les
 * suit mieux), le script reste tel quel : c'est ce qui doit être dit, dans la
 * langue choisie, mot pour mot.
 */
export function buildCreationPrompt(opts: {
  mode: "first-frame" | "references";
  sceneEn: string;
  script: string;
  language: string;
  productCount: number;
  productDescription: string;
}): string {
  const lang = LANGUAGES[opts.language] ?? "French";
  const parts: string[] = [];
  parts.push("Ultra-realistic UGC selfie-style video, shot on a phone, natural light, authentic creator footage, no cinematic grading.");
  if (opts.mode === "first-frame") {
    parts.push("Start exactly from the first frame: same person, same face, same clothes, same place, same framing and lighting. Keep the person's identity identical for the whole video.");
  } else {
    parts.push("The first reference image is the exact opening shot of the video: same person, same face, same clothes, same place, same framing and lighting. Keep the person's identity identical for the whole video.");
    parts.push(
      `The next ${opts.productCount} reference image${opts.productCount > 1 ? "s show" : " shows"} the product (${opts.productDescription || "the product"}): reproduce it exactly, same shape, colors, materials and text, whenever it is visible.`,
    );
  }
  if (opts.sceneEn) parts.push(opts.sceneEn);
  parts.push(
    `The person looks at the camera and speaks in ${lang}, lips perfectly synchronized with the words, natural pauses, small natural hand gestures and head movements, steady framing.`,
  );
  parts.push("Audio: only the person's voice, clear and close, with light room ambience. No music, no subtitles, no captions, no on-screen text, no logo.");
  parts.push(`Spoken lines, said exactly in this order and nothing else: "${opts.script.replace(/\s+/g, " ").trim()}"`);
  return parts.join("\n");
}

/** Charge utile KIE (bytedance/seedance-2-5), dans l'un des deux modes. */
export function buildCreationPayload(job: StudioJob, urls: { start: string; products: string[] }, prompt: string): Record<string, unknown> {
  const base = {
    prompt: prompt.slice(0, 30000),
    generate_audio: true,
    resolution: job.createResolution ?? "720p",
    aspect_ratio: job.aspectRatio === "original" ? "adaptive" : job.aspectRatio,
    duration: job.createDurationSec ?? -1,
    return_last_frame: false,
  };
  if (job.createMode === "references") {
    return { ...base, reference_image_urls: [urls.start, ...urls.products].slice(0, 9) };
  }
  return { ...base, first_frame_url: urls.start };
}

export interface CreationStartOutcome {
  remoteReferenceUrl: string;
  remoteProductUrls: string[];
  userPromptEn: string;
  prompt: string;
  providerJobId: string;
  providerInput: Record<string, unknown>;
  creditsEstimated: number;
}

export async function startCreation(job: StudioJob, onProgress: (patch: Partial<StudioJob>) => Promise<void>): Promise<CreationStartOutcome> {
  // 1. L'image de départ et les photos du produit, publiées une fois.
  let remoteReferenceUrl = job.remoteReferenceUrl;
  if (!remoteReferenceUrl) {
    const start = await ensureLocal(job.referenceImage);
    remoteReferenceUrl = await publishToKie(start.path, job.referenceImageName || "image-depart");
    await onProgress({ remoteReferenceUrl });
  }
  let remoteProductUrls = job.remoteProductUrls ?? [];
  if (job.productImages.length && remoteProductUrls.length !== job.productImages.length) {
    remoteProductUrls = [];
    for (const [k, u] of job.productImages.entries()) {
      const local = await ensureLocal(u);
      remoteProductUrls.push(await publishToKie(local.path, `produit-${k + 1}`));
    }
    await onProgress({ remoteProductUrls });
  }

  // 2. La consigne d'attitude en anglais ; le script, lui, ne bouge pas.
  let userPromptEn = job.userPromptEn ?? "";
  if (!userPromptEn && job.userPrompt.trim()) {
    userPromptEn = await toEnglish(job.userPrompt).catch(() => job.userPrompt.trim());
    await onProgress({ userPromptEn });
  }
  const prompt = buildCreationPrompt({
    mode: job.createMode ?? "first-frame",
    sceneEn: userPromptEn,
    script: job.talkText ?? "",
    language: job.createLanguage ?? "fr",
    productCount: remoteProductUrls.length,
    productDescription: job.productDescription,
  });
  await onProgress({ prompt });

  // 3. La tâche.
  const payload = buildCreationPayload(job, { start: remoteReferenceUrl, products: remoteProductUrls }, prompt);
  try {
    const providerJobId = await createTask(CREATION.kieModel, payload, callbackUrl());
    const seconds = estimatedSeconds(job.talkText ?? "", job.createDurationSec ?? -1);
    return {
      remoteReferenceUrl,
      remoteProductUrls,
      userPromptEn,
      prompt,
      providerJobId,
      providerInput: payload,
      creditsEstimated: Math.round(CREATION.creditsPerSec[job.createResolution ?? "720p"] * seconds),
    };
  } catch (e) {
    const err = e as KieError;
    throw new CreationError(`Seedance 2.5 a refusé la demande : ${err.message}`, err.code === 401 ? 401 : 502);
  }
}

function callbackUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  return base && !base.includes("localhost") ? `${base}/api/kie/callback` : undefined;
}

export async function pollCreation(job: StudioJob) {
  const rec = await getTask(job.providerJobId);
  return {
    state: rec.state === "success" ? "success" : rec.state === "fail" ? "fail" : rec.state === "generating" ? "generating" : "waiting",
    progress: rec.progress,
    resultUrl: rec.resultUrls[0] ?? "",
    error: rec.failMsg,
    creditsConsumed: rec.creditsConsumed,
  } as const;
}
