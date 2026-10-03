import { createTask, getTask, KieError } from "@/lib/kie";
import { newId, readDB, writeDB } from "@/lib/db";
import { TALKING_PHOTO } from "./config";
import { ensureLocal, extractAudioMp3, isAllowedRemote, localMediaPath, MediaError, probe, publishToKie, runFf, storeBuffer } from "./media";
import { ElevenLabsError, getElevenLabsKey, textToSpeech } from "./providers/elevenlabs";
import type { StudioJob, TalkRequest } from "./types";

/**
 * « Photo qui parle » : InfiniteTalk (infinitalk/from-audio) anime une photo
 * a partir d'un audio. Le mouvement, la tete et surtout les levres sont
 * generes DEPUIS la voix : la synchro est parfaite par construction.
 *
 * L'audio vient soit d'un texte lu par une voix ElevenLabs du compte, soit
 * d'un fichier (mp3, ou une video dont on extrait la piste).
 */

export class TalkError extends Error {
  code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const validSource = (u: string) => Boolean(localMediaPath(u)) || isAllowedRemote(u);

export function createTalkJobs(req: TalkRequest): StudioJob[] {
  if (!req.referenceImage || !validSource(req.referenceImage)) throw new TalkError("Photo manquante ou invalide.");
  const text = (req.talkText ?? "").trim();
  const audio = (req.talkAudio ?? "").trim();
  if (!text && !audio) throw new TalkError("Écris le texte à dire, ou dépose un fichier audio ou vidéo.");
  if (text && !req.voiceId?.trim()) throw new TalkError("Choisis la voix qui lira le texte.");
  if (text && !getElevenLabsKey()) throw new TalkError("Le texte lu demande une clé ElevenLabs (Réglages, section Voix).", 401);
  if (audio && !validSource(audio)) throw new TalkError("Fichier audio invalide : dépose-le à nouveau.");
  if (text.length > 2500) throw new TalkError("Texte trop long : 2 500 caractères maximum (environ 2 minutes 30).");
  const resolution = req.resolution === "720p" ? "720p" : "480p";
  const variants = Math.min(4, Math.max(1, Math.round(Number(req.variants) || 1)));

  const db = readDB();
  const batchId = newId();
  const created: StudioJob[] = [];
  for (let i = 0; i < variants; i++) {
    const t = now();
    const job: StudioJob = {
      id: newId(),
      type: "talking-photo",
      batchId,
      provider: "infinitalk",
      requestedProvider: "auto",
      transform: "full",
      style: "natural",
      sourceVideo: "",
      sourceVideoName: "",
      sourceDurationSec: 0,
      referenceImage: req.referenceImage,
      referenceImageName: req.referenceImageName ?? "",
      referenceImages: [req.referenceImage],
      remoteReferenceUrls: [],
      referenceSheet: "",
      sceneImage: "",
      remoteSceneImageUrl: "",
      userPrompt: (req.talkPrompt ?? "").trim(),
      prompt: (req.talkPrompt ?? "").trim() || TALKING_PHOTO.defaultPrompt,
      negativePrompt: "",
      voiceMode: text ? "transform" : "keep",
      voiceId: text ? req.voiceId!.trim() : "",
      voiceName: text ? req.voiceName ?? "" : "",
      voiceEngine: "",
      voiceAmbience: "raw",
      lipSync: false,
      lipSyncError: "",
      productImages: [],
      productDescription: "",
      remoteProductUrls: [],
      talkText: text,
      talkAudio: audio,
      remoteAudioUrl: "",
      resolution: resolution === "720p" ? "720p" : "720p",
      talkResolution: resolution,
      aspectRatio: "original",
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
      creditsEstimated: 0,
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

/** Duree d'un fichier audio, en secondes. */
async function audioSeconds(file: string): Promise<number> {
  const { stdout } = await runFf("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], 30_000);
  return Number(stdout.trim()) || 0;
}

export interface TalkStartOutcome {
  remoteReferenceUrl: string;
  remoteAudioUrl: string;
  audioOutput: string;
  sourceDurationSec: number;
  providerJobId: string;
  providerInput: Record<string, unknown>;
  creditsEstimated: number;
}

export async function startTalkingPhoto(
  job: StudioJob,
  onProgress: (patch: Partial<StudioJob>) => Promise<void>,
): Promise<TalkStartOutcome> {
  const photo = await ensureLocal(job.referenceImage);

  // 1. La piste audio : texte lu, ou fichier fourni (video acceptee, on extrait).
  let audioOutput = job.audioOutput;
  if (!audioOutput) {
    let buf: Buffer;
    if (job.talkText) {
      try {
        buf = await textToSpeech(job.talkText, job.voiceId);
      } catch (e) {
        const err = e as ElevenLabsError;
        throw new TalkError(err.message, err.code === 401 ? 401 : 502);
      }
    } else {
      const src = await ensureLocal(job.talkAudio ?? "");
      buf = await extractAudioMp3(src.path);
    }
    const stored = await storeBuffer(buf, ".mp3");
    audioOutput = stored.url;
    await onProgress({ audioOutput });
  }
  const audioPath = localMediaPath(audioOutput);
  if (!audioPath) throw new MediaError("Piste audio introuvable.");
  const seconds = await audioSeconds(audioPath);
  if (seconds < 1) throw new TalkError("Audio vide ou trop court.");
  if (seconds > TALKING_PHOTO.maxAudioSec) {
    throw new TalkError(`Audio de ${Math.round(seconds)} s : ${TALKING_PHOTO.maxAudioSec} s maximum par vidéo. Coupe le texte ou le fichier.`);
  }

  // 2. Publication chez KIE.
  let remoteReferenceUrl = job.remoteReferenceUrl;
  if (!remoteReferenceUrl) {
    remoteReferenceUrl = await publishToKie(photo.path, job.referenceImageName || "photo");
    await onProgress({ remoteReferenceUrl });
  }
  let remoteAudioUrl = job.remoteAudioUrl;
  if (!remoteAudioUrl) {
    remoteAudioUrl = await publishToKie(audioPath, "voix.mp3");
    await onProgress({ remoteAudioUrl });
  }

  // 3. La tache.
  const resolution: "480p" | "720p" = job.talkResolution === "720p" ? "720p" : "480p";
  const payload = {
    image_url: remoteReferenceUrl,
    audio_url: remoteAudioUrl,
    prompt: (job.prompt || TALKING_PHOTO.defaultPrompt).slice(0, 5000),
    resolution,
  };
  try {
    const providerJobId = await createTask(TALKING_PHOTO.kieModel, payload);
    return {
      remoteReferenceUrl,
      remoteAudioUrl,
      audioOutput,
      sourceDurationSec: seconds,
      providerJobId,
      providerInput: payload,
      creditsEstimated: Math.round(TALKING_PHOTO.creditsPerSec[resolution] * Math.ceil(seconds)),
    };
  } catch (e) {
    const err = e as KieError;
    throw new TalkError(`InfiniteTalk a refusé la demande : ${err.message}`, err.code === 401 ? 401 : 502);
  }
}

export async function pollTalkingPhoto(job: StudioJob) {
  const rec = await getTask(job.providerJobId);
  return {
    state: rec.state === "success" ? "success" : rec.state === "fail" ? "fail" : rec.state === "generating" ? "generating" : "waiting",
    progress: rec.progress,
    resultUrl: rec.resultUrls[0] ?? "",
    error: rec.failMsg,
    creditsConsumed: rec.creditsConsumed,
  } as const;
}

/** Utilise par la fiche : la photo a-t-elle un visage exploitable ? (simple garde-fou de taille) */
export async function checkPhoto(path: string) {
  const info = await probe(path).catch(() => null);
  return info;
}
