import { newId, readDB, writeDB } from "@/lib/db";
import { MAX_CONCURRENT_GENERATIONS, MAX_VARIANTS, PROVIDER_IDS, PROVIDERS, STALE_STEP_MS } from "./config";
import { quote } from "./costs";
import { warmThumb } from "@/lib/thumbs";
import { downloadToMedia, ensureLocal, extractAudioMp3, isAllowedRemote, localMediaPath, MediaError, muxAudio, probe, retimeVideo, storeBuffer, stripAudio } from "./media";
import { lipSyncVideo, LipSyncError } from "./providers/lipsync";
import { buildPrompt, DEFAULT_NEGATIVE_PROMPT } from "./prompts";
import {
  ACTIVE_STATUSES,
  type StudioJob,
  type StudioJobStatus,
  type TransformRequest,
} from "./types";
import { pollTransformation, readableProviderError, startTransformation, TransformError } from "./video-transform";
import { pollTalkingPhoto, startTalkingPhoto, TalkError } from "./talking-photo";
import { CreationError, pollCreation, startCreation } from "./creation";
import { transformVoice, VoiceError } from "./voice-transform";

/**
 * File de jobs du Swap vidéo.
 *
 * Il n'y a pas de worker séparé : comme pour les générations classiques, c'est
 * le sondage du navigateur (GET /api/studio-ia/jobs) qui fait avancer la file, en
 * plus d'un coup de pouce à la création. Les étapes longues (upload, voix,
 * assemblage) tournent en tâche de fond dans le processus Node, protégées par
 * un verrou mémoire pour ne jamais s'exécuter deux fois.
 */

const g = globalThis as unknown as { __studioLocks?: Set<string> };
const locks = (g.__studioLocks ??= new Set<string>());

const now = () => new Date().toISOString();
const TRANSFORMS = new Set(["full", "face", "outfit", "face-outfit", "character"]);
const STYLES = new Set(["natural", "strong", "ugc", "cinematic"]);
const VOICE_MODES = new Set(["keep", "transform", "none"]);
const RESOLUTIONS = new Set(["720p", "1080p"]);
const ASPECTS = new Set(["original", "9:16", "16:9", "1:1"]);
const AMBIENCES = new Set(["raw", "close", "room", "far"]);
const PROVIDER_IDS_WITH_PRODUCT = new Set(PROVIDER_IDS.filter((id) => PROVIDERS[id].supportsProduct));

export class JobError extends Error {
  code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------ Persistance ------------------------------ */

export function listJobs(): StudioJob[] {
  return readDB().studioJobs;
}

export function getJob(id: string): StudioJob | null {
  return readDB().studioJobs.find((j) => j.id === id) ?? null;
}

/** Fusionne un correctif dans la version fraîche du job (la base a pu bouger). */
async function patchJob(id: string, patch: Partial<StudioJob>): Promise<StudioJob | null> {
  const db = readDB();
  const i = db.studioJobs.findIndex((j) => j.id === id);
  if (i === -1) return null;
  db.studioJobs[i] = { ...db.studioJobs[i], ...patch, updatedAt: now() };
  writeDB(db);
  return db.studioJobs[i];
}

export function deleteJob(id: string) {
  const db = readDB();
  const before = db.studioJobs.length;
  db.studioJobs = db.studioJobs.filter((j) => j.id !== id);
  if (db.studioJobs.length !== before) writeDB(db);
  return before !== db.studioJobs.length;
}

/* ------------------------------ Création ------------------------------ */

function validSource(url: string) {
  return Boolean(localMediaPath(url)) || isAllowedRemote(url);
}

export function createJobs(req: TransformRequest): StudioJob[] {
  if (!req.sourceVideo || !validSource(req.sourceVideo)) throw new JobError("Vidéo source manquante ou invalide.");
  if (!req.referenceImage || !validSource(req.referenceImage)) throw new JobError("Image de référence manquante ou invalide.");
  if (req.provider !== "auto" && !PROVIDER_IDS.includes(req.provider)) throw new JobError("Modèle inconnu.");
  if (!TRANSFORMS.has(req.transform)) throw new JobError("Type de transformation inconnu.");
  if (!STYLES.has(req.style)) throw new JobError("Style inconnu.");
  if (!VOICE_MODES.has(req.voiceMode)) throw new JobError("Mode audio inconnu.");
  if (req.voiceMode === "transform" && !req.voiceId?.trim()) throw new JobError("Choisis une voix ElevenLabs.");
  if (!RESOLUTIONS.has(req.resolution)) throw new JobError("Résolution inconnue.");
  if (!ASPECTS.has(req.aspectRatio)) throw new JobError("Format inconnu.");
  const variants = Math.min(MAX_VARIANTS, Math.max(1, Math.round(Number(req.variants) || 1)));

  const referenceImages = [req.referenceImage, ...(Array.isArray(req.referenceImages) ? req.referenceImages : [])]
    .filter((u, k, arr) => u && validSource(u) && arr.indexOf(u) === k)
    .slice(0, 3);
  const productImages = (Array.isArray(req.productImages) ? req.productImages : []).filter(validSource).slice(0, 4);
  const productDescription = (req.productDescription ?? "").trim();
  if (productImages.length && req.provider !== "auto" && !PROVIDER_IDS_WITH_PRODUCT.has(req.provider)) {
    throw new JobError("Ce modèle ne sait pas protéger le produit. Choisis Auto ou Kling 3.0 Omni, ou retire les photos du produit.");
  }

  const prompt = buildPrompt(req.transform, req.style, req.userPrompt ?? "", productImages.length ? { description: productDescription } : null);
  let negativePrompt = (req.negativePrompt ?? "").trim() || DEFAULT_NEGATIVE_PROMPT;
  // Interdire « changing clothes » contredit tout preset qui change la tenue : on retire la clause.
  if (req.transform !== "face") {
    negativePrompt = negativePrompt
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !/changing clothes|clothes change|different clothes/i.test(s))
      .join(", ");
  }
  const hint = Number(req.sourceDurationSec) || 0;
  const q = quote({ provider: req.provider, transform: req.transform, durationSec: hint || 5, resolution: req.resolution, variants: 1, hasProduct: productImages.length > 0 });

  const batchId = newId();
  const db = readDB();
  const created: StudioJob[] = [];
  for (let i = 0; i < variants; i++) {
    const t = now();
    const job: StudioJob = {
      id: newId(),
      type: "video-transform",
      batchId,
      provider: q.provider,
      requestedProvider: req.provider,
      transform: req.transform,
      style: req.style,
      sourceVideo: req.sourceVideo,
      sourceVideoName: req.sourceVideoName ?? "",
      sourceDurationSec: hint,
      referenceImage: req.referenceImage,
      referenceImageName: req.referenceImageName ?? "",
      referenceImages,
      remoteReferenceUrls: [],
      referenceSheet: "",
      sceneImage: req.sceneImage && validSource(req.sceneImage) ? req.sceneImage : "",
      remoteSceneImageUrl: "",
      userPrompt: req.userPrompt ?? "",
      prompt,
      negativePrompt,
      voiceMode: req.voiceMode,
      voiceId: req.voiceMode === "transform" ? req.voiceId.trim() : "",
      voiceName: req.voiceMode === "transform" ? req.voiceName ?? "" : "",
      voiceEngine: "",
      voiceAmbience: AMBIENCES.has(req.voiceAmbience ?? "") ? (req.voiceAmbience as StudioJob["voiceAmbience"]) : "room",
      lipSync: Boolean(req.lipSync) && req.voiceMode !== "none",
      lipSyncError: "",
      productImages,
      productDescription,
      remoteProductUrls: [],
      resolution: req.resolution,
      aspectRatio: req.aspectRatio,
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
      creditsEstimated: q.creditsPerVideo,
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

/* ------------------------------ Étapes ------------------------------ */

function fail(id: string, error: string, extra: Partial<StudioJob> = {}) {
  return patchJob(id, { status: "failed", error, completedAt: now(), ...extra });
}

async function runStart(job: StudioJob) {
  if (locks.has(job.id)) return;
  locks.add(job.id);
  try {
    await patchJob(job.id, { status: "uploading", startedAt: job.startedAt || now(), error: "" });
    const fresh = getJob(job.id);
    if (!fresh) return;
    if (fresh.type === "talking-photo") {
      const out = await startTalkingPhoto(fresh, async (p) => { await patchJob(job.id, p); });
      await patchJob(job.id, { ...out, status: "generating_video", progress: 0 });
      return;
    }
    if (fresh.type === "creation") {
      const out = await startCreation(fresh, async (p) => { await patchJob(job.id, p); });
      await patchJob(job.id, { ...out, status: "generating_video", progress: 0 });
      return;
    }
    const out = await startTransformation(fresh, async (p) => { await patchJob(job.id, p); });
    await patchJob(job.id, { ...out, status: "generating_video", progress: 0 });
  } catch (e) {
    const err = e as Error & { code?: number };
    const msg =
      err instanceof TransformError || err instanceof MediaError || err instanceof TalkError || err instanceof CreationError ? err.message
      : readableProviderError(getJob(job.id)?.provider ?? job.provider, err.message);
    await fail(job.id, msg);
  } finally {
    locks.delete(job.id);
  }
}

/**
 * Après la vidéo : rapatriement, voix, assemblage.
 *
 * Une voix qui échoue ne fait pas échouer le job : la vidéo est livrée avec
 * son audio d'origine et `voiceError` explique ce qui s'est passé, avec un
 * bouton « Réessayer la voix » côté interface.
 */
async function runFinish(job: StudioJob) {
  if (locks.has(job.id)) return;
  locks.add(job.id);
  try {
    let current = getJob(job.id);
    if (!current) return;

    if (!current.videoOutput) {
      // L'URL vient de l'API du fournisseur : hors liste KIE pour Higgsfield.
      const dl = await downloadToMedia(current.remoteVideoUrl, { trusted: true });
      current = (await patchJob(job.id, { videoOutput: dl.url })) ?? current;
    }

    // Photo qui parle et Création : la video rendue contient deja la voix, rien a assembler.
    if (current.type === "talking-photo" || current.type === "creation") {
      await patchJob(job.id, { status: "completed", finalOutput: current.videoOutput, progress: 100, completedAt: now(), error: "" });
      warmThumb(current.videoOutput);
      return;
    }
    let videoPath = localMediaPath(current.videoOutput);
    if (!videoPath) throw new MediaError("Vidéo générée introuvable sur le serveur.");

    /*
     * Recalage temporel : la video generee doit durer exactement comme la
     * source, sinon la voix (d'origine ou transformee, toutes deux calees sur
     * la source) derive par rapport aux levres.
     */
    if (current.voiceMode !== "none" && current.sourceDurationSec > 0 && !current.retimed) {
      const gen = await probe(videoPath);
      const ratio = current.sourceDurationSec / (gen.durationSec || current.sourceDurationSec);
      if (Math.abs(gen.durationSec - current.sourceDurationSec) > 0.06 && ratio > 0.7 && ratio < 1.4) {
        const fixed = await retimeVideo(videoPath, current.sourceDurationSec);
        current = (await patchJob(job.id, { videoOutput: fixed.url, retimed: true })) ?? current;
        videoPath = fixed.path;
      } else {
        current = (await patchJob(job.id, { retimed: true })) ?? current;
      }
    }

    let audioPath: string | null = null;
    if (current.voiceMode === "transform") {
      current = (await patchJob(job.id, { status: "processing_voice", voiceError: "" })) ?? current;
      try {
        const v = await transformVoice(current);
        audioPath = v.audioPath;
        current = (await patchJob(job.id, { audioOutput: v.audioOutput, voiceEngine: v.engine })) ?? current;
      } catch (e) {
        const msg = e instanceof VoiceError || e instanceof MediaError ? e.message : `Impossible de transformer la voix : ${(e as Error).message}`;
        current = (await patchJob(job.id, { voiceError: msg, audioOutput: "" })) ?? current;
      }
    }

    current = (await patchJob(job.id, { status: "merging" })) ?? current;
    let finalOutput = current.videoOutput;
    let finalPath = videoPath;
    let muxedAudioPath: string | null = audioPath;
    if (current.voiceMode === "none") {
      const muted = await stripAudio(videoPath);
      finalOutput = muted.url;
      finalPath = muted.path;
    } else {
      if (!muxedAudioPath) {
        // Voix conservée (ou transformation ratée) : on repose l'audio d'origine,
        // exactement synchrone puisque le mouvement est celui de la source.
        const src = await ensureLocal(current.sourceVideo);
        const info = await probe(src.path);
        if (info.hasAudio) {
          const original = await storeBuffer(await extractAudioMp3(src.path), ".mp3");
          muxedAudioPath = original.path;
        }
      }
      if (muxedAudioPath) {
        const muxed = await muxAudio(videoPath, muxedAudioPath);
        finalOutput = muxed.url;
        finalPath = muxed.path;
      }
    }

    /*
     * Synchro labiale IA, en option : la video finale et sa piste repartent
     * chez KIE, qui refait la bouche sur la voix. Un echec garde la video.
     */
    const mouthKept = Boolean((PROVIDERS as Record<string, { preservesMouth?: boolean } | undefined>)[current.provider]?.preservesMouth);
    if (current.lipSync && current.voiceMode !== "none" && muxedAudioPath && !mouthKept) {
      current = (await patchJob(job.id, { status: "syncing_lips", lipSyncError: "", finalOutput })) ?? current;
      try {
        const synced = await lipSyncVideo(finalPath, muxedAudioPath);
        // La piste traitee (ambiance, niveau) prime sur celle renvoyee par le modele.
        const remuxed = await muxAudio(synced.path, muxedAudioPath);
        finalOutput = remuxed.url;
        if (synced.creditsConsumed) {
          current = (await patchJob(job.id, { creditsConsumed: (current.creditsConsumed || 0) + synced.creditsConsumed })) ?? current;
        }
      } catch (e) {
        const err = e as LipSyncError | MediaError;
        await patchJob(job.id, { lipSyncError: err.message });
      }
    }

    await patchJob(job.id, { status: "completed", finalOutput, progress: 100, completedAt: now(), error: "" });
    warmThumb(finalOutput);
  } catch (e) {
    const err = e as Error;
    await fail(job.id, err instanceof MediaError ? err.message : `Assemblage impossible : ${err.message}`);
  } finally {
    locks.delete(job.id);
  }
}

async function pollOne(job: StudioJob) {
  if (!job.providerJobId) return;
  let r;
  try {
    r = job.type === "talking-photo" ? await pollTalkingPhoto(job) : job.type === "creation" ? await pollCreation(job) : await pollTransformation(job);
  } catch {
    // Un sondage qui rate ne change rien : on réessaiera au prochain tour.
    return;
  }
  if (r.state === "success" && r.resultUrl) {
    const updated = await patchJob(job.id, {
      remoteVideoUrl: r.resultUrl,
      creditsConsumed: r.creditsConsumed || job.creditsConsumed,
      progress: 100,
      status: job.type !== "video-transform" ? "merging" : job.voiceMode === "transform" ? "processing_voice" : "merging",
    });
    if (updated) void runFinish(updated);
  } else if (r.state === "fail") {
    await fail(job.id, readableProviderError(job.provider, r.error), { creditsConsumed: r.creditsConsumed || job.creditsConsumed });
  } else if (r.progress !== job.progress) {
    await patchJob(job.id, { progress: r.progress });
  }
}

/* ------------------------------ Boucle ------------------------------ */

const isStale = (j: StudioJob) => Date.now() - new Date(j.updatedAt).getTime() > STALE_STEP_MS;

/**
 * Un tour de file : lance ce qui attend, sonde ce qui tourne, relance ce qui
 * a été interrompu par un redémarrage. Ne bloque jamais sur une étape longue.
 */
export async function tick(): Promise<StudioJob[]> {
  const jobs = listJobs();

  // Reprise après redémarrage : une étape sans verrou depuis trop longtemps.
  for (const j of jobs) {
    if (locks.has(j.id) || !isStale(j)) continue;
    if (j.status === "uploading" || (j.status === "generating_video" && !j.providerJobId)) {
      void runStart(j);
    } else if ((j.status === "processing_voice" || j.status === "merging") && j.remoteVideoUrl) {
      void runFinish(j);
    }
  }

  const generating = jobs.filter((j) => j.status === "generating_video" && j.providerJobId && !locks.has(j.id));
  await Promise.allSettled(generating.slice(0, 12).map(pollOne));

  const busy = listJobs().filter((j) => j.status === "uploading" || j.status === "generating_video").length;
  const slots = Math.max(0, MAX_CONCURRENT_GENERATIONS - busy);
  const queued = listJobs()
    .filter((j) => j.status === "queued" && !locks.has(j.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, slots);
  for (const j of queued) void runStart(j);

  return listJobs();
}

/** Appelé par le callback KIE quand une tâche se termine : on sonde tout de suite. */
export async function onProviderCallback(providerJobId: string): Promise<boolean> {
  const job = listJobs().find((j) => j.providerJobId === providerJobId);
  if (!job) return false;
  if (job.status === "generating_video" && !locks.has(job.id)) await pollOne(job);
  return true;
}

/* ------------------------------ Réessayer ------------------------------ */

export async function retryJob(
  id: string,
  scope: "all" | "voice",
  voice?: { voiceId: string; voiceName: string; voiceAmbience?: StudioJob["voiceAmbience"]; lipSync?: boolean; voiceMode?: "keep" | "transform" },
): Promise<StudioJob> {
  const job = getJob(id);
  if (!job) throw new JobError("Job introuvable.", 404);
  if (locks.has(id)) throw new JobError("Ce job est déjà en cours de traitement.", 409);

  if (scope === "voice") {
    if (!job.videoOutput && !job.remoteVideoUrl) throw new JobError("Pas encore de vidéo générée : relance la génération.");
    // Un job muet ou avec la voix d'origine peut recevoir une voix apres coup : la video est deja la.
    if (job.voiceMode !== "transform" && !voice?.voiceId && voice?.voiceMode !== "keep") {
      throw new JobError("Choisis une voix pour l'ajouter à cette vidéo.");
    }
    // On peut changer de voix au passage : la video, elle, ne bouge pas.
    const updated = await patchJob(id, {
      status: "processing_voice",
      voiceError: "",
      audioOutput: "",
      voiceEngine: "",
      error: "",
      completedAt: "",
      ...(voice?.voiceMode === "keep" ? { voiceMode: "keep" as const, voiceId: "", voiceName: "", voiceEngine: "" as const } : {}),
      ...(voice?.voiceId ? { voiceId: voice.voiceId, voiceName: voice.voiceName, voiceMode: "transform" as const } : {}),
      ...(voice?.voiceAmbience && AMBIENCES.has(voice.voiceAmbience) ? { voiceAmbience: voice.voiceAmbience } : {}),
      ...(voice && typeof voice.lipSync === "boolean" ? { lipSync: voice.lipSync } : {}),
      lipSyncError: "",
    });
    if (updated) void runFinish(updated);
    return updated as StudioJob;
  }

  /*
   * La vidéo est déjà générée (et payée) mais le rapatriement ou l'assemblage
   * a raté : on reprend là, sans relancer le fournisseur.
   */
  if (job.remoteVideoUrl && !job.finalOutput) {
    const resumed = await patchJob(id, {
      status: job.voiceMode === "transform" ? "processing_voice" : "merging",
      error: "",
      voiceError: "",
      audioOutput: "",
      completedAt: "",
    });
    if (resumed) void runFinish(resumed);
    return resumed as StudioJob;
  }

  const updated = await patchJob(id, {
    status: "queued",
    progress: 0,
    retimed: false,
    lipSyncError: "",
    // Le fichier public peut ne plus convenir (autre modèle, autre limite) : on le renvoie.
    remoteSourceUrl: "",
    remoteProductUrls: [],
    remoteReferenceUrls: [],
    remoteSceneUrl: "",
    remoteSceneImageUrl: "",
    providerJobId: "",
    providerInput: {},
    remoteVideoUrl: "",
    videoOutput: "",
    audioOutput: "",
    finalOutput: "",
    error: "",
    voiceError: "",
    completedAt: "",
  });
  void tick();
  return updated as StudioJob;
}

export function countByStatus(jobs: StudioJob[]) {
  const c = { queued: 0, running: 0, completed: 0, failed: 0 };
  for (const j of jobs) {
    if (j.status === "queued") c.queued++;
    else if (ACTIVE_STATUSES.includes(j.status)) c.running++;
    else if (j.status === "completed") c.completed++;
    else c.failed++;
  }
  return c;
}

export const isActive = (s: StudioJobStatus) => ACTIVE_STATUSES.includes(s);
