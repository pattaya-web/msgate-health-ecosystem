import { createTask, getTask, KieError } from "@/lib/kie";
import { LIPSYNC } from "../config";
import { downloadToMedia, publishToKie } from "../media";

/**
 * Synchronisation labiale vidéo → vidéo (docs.kie.ai/market/volcengine/video-to-video-lip-sync).
 *
 * Schéma vérifié dans .cache/kie-docs/volcengine_video-to-video-lip-sync.md :
 * mode (lite | basic), video_url (360p-1080p, H.264, ≤ 500 Mo), audio_url
 * (voix pure, ≤ 10 Mo), separate_vocal, align_audio. Sortie mp4 25 fps, de la
 * durée de l'audio.
 *
 * Sert après Seedance ou Kling, qui rejouent la bouche approximativement :
 * on leur redonne la piste finale et le modèle refait les lèvres dessus.
 */

export class LipSyncError extends Error {
  code: number;
  constructor(message: string, code = 502) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export async function lipSyncVideo(
  videoPath: string,
  audioPath: string,
  onTask?: (taskId: string) => Promise<void>,
): Promise<{ url: string; path: string; creditsConsumed: number }> {
  const [videoUrl, audioUrl] = await Promise.all([
    publishToKie(videoPath, "lipsync-video.mp4"),
    publishToKie(audioPath, "lipsync-audio.mp3"),
  ]);

  const isBusy = (msg: string) => /busy|try again|overload|rate limit|too many/i.test(msg);
  const payload = {
    mode: LIPSYNC.mode,
    video_url: videoUrl,
    audio_url: audioUrl,
    separate_vocal: false,
    align_audio: true,
    align_audio_reverse: false,
    templ_start_seconds: 0,
  };

  let resultUrl = "";
  let credits = 0;
  // KIE repond souvent « server is busy » sur ce modele : on insiste, en espacant.
  for (let attempt = 0; attempt < LIPSYNC.attempts && !resultUrl; attempt++) {
    if (attempt > 0) await sleep(LIPSYNC.retryDelayMs * attempt);

    let taskId: string;
    try {
      taskId = await createTask(LIPSYNC.kieModel, payload);
    } catch (e) {
      const err = e as KieError;
      if (isBusy(err.message) && attempt < LIPSYNC.attempts - 1) continue;
      throw new LipSyncError(
        isBusy(err.message)
          ? "Le service de synchro des lèvres de KIE est saturé : réessaie dans quelques minutes (menu ⋯ → Ajouter une voix, case cochée)."
          : `KIE a refusé la synchro des lèvres : ${err.message}`,
        err.code === 401 ? 401 : 502,
      );
    }
    if (onTask) await onTask(taskId);

    const deadline = Date.now() + LIPSYNC.timeoutMs;
    let failMsg = "";
    while (Date.now() < deadline) {
      await sleep(5000);
      const rec = await getTask(taskId).catch(() => null);
      if (!rec) continue;
      if (rec.state === "success") {
        resultUrl = rec.resultUrls[0] ?? "";
        credits = rec.creditsConsumed;
        break;
      }
      if (rec.state === "fail") {
        failMsg = rec.failMsg || "sans détail";
        break;
      }
    }
    if (resultUrl) break;
    if (failMsg && isBusy(failMsg) && attempt < LIPSYNC.attempts - 1) continue;
    if (failMsg) {
      throw new LipSyncError(
        isBusy(failMsg)
          ? "Le service de synchro des lèvres de KIE est saturé : réessaie dans quelques minutes (menu ⋯ → Ajouter une voix, case cochée)."
          : `Synchro des lèvres échouée : ${failMsg}`,
      );
    }
    throw new LipSyncError("La synchro des lèvres n'a pas répondu à temps.", 504);
  }
  if (!resultUrl) throw new LipSyncError("La synchro des lèvres n'a pas répondu à temps.", 504);

  const local = await downloadToMedia(resultUrl);
  return { ...local, creditsConsumed: credits };
}
