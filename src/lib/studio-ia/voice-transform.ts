import { getApiKey } from "@/lib/db";
import { getOpenAiKey, OpenAiError, transcribe } from "@/lib/openai";
import { ensureLocal, extractAudioMp3, fitAudioDuration, probe, storeBuffer, withTempFile } from "./media";
import { ElevenLabsError, getElevenLabsKey, speechToSpeech } from "./providers/elevenlabs";
import { KieTtsError, ttsViaKie } from "./providers/kie-tts";
import type { StudioJob, VoiceEngine } from "./types";
import { placeVoiceInScene } from "./voice-ambience";

/**
 * Moteur disponible : le speech-to-speech ElevenLabs direct des qu'une cle
 * existe (garde l'intonation), sinon le TTS ElevenLabs via KIE (garde les
 * mots), sinon rien.
 */
export function availableVoiceEngine(): VoiceEngine | null {
  if (getElevenLabsKey()) return "elevenlabs-sts";
  if (getApiKey()) return "kie-tts";
  return null;
}

/**
 * Orchestration voix : audio d'origine → ElevenLabs speech-to-speech → mp3
 * stocké. La durée est celle de la performance d'origine : le mux complète au
 * silence si le modèle rend quelques millisecondes de moins.
 */

export class VoiceError extends Error {}

export async function transformVoice(
  job: StudioJob,
): Promise<{ audioOutput: string; audioPath: string; engine: VoiceEngine }> {
  if (!job.voiceId) throw new VoiceError("Aucune voix sélectionnée.");
  const engine = availableVoiceEngine();
  if (!engine) throw new VoiceError("Aucune clé ElevenLabs ni KIE : impossible de transformer la voix.");

  const src = await ensureLocal(job.sourceVideo);
  const info = await probe(src.path);
  if (!info.hasAudio) throw new VoiceError("La vidéo source n'a pas de piste audio : rien à transformer.");
  const original = await extractAudioMp3(src.path);

  let transformed: Buffer;
  if (engine === "elevenlabs-sts") {
    try {
      transformed = await speechToSpeech(original, "source.mp3", job.voiceId);
    } catch (e) {
      const err = e as ElevenLabsError;
      // readError() renvoie deja une phrase complete : on ne la prefixe pas deux fois.
      throw new VoiceError(err.code === 504 ? "ElevenLabs n'a pas répondu." : err.message);
    }
  } else {
    // Repli KIE : ce qui est dit -> texte -> relu par la voix choisie -> cale sur la duree.
    if (!getOpenAiKey()) {
      throw new VoiceError("La voix via KIE demande une clé OpenAI (transcription) : ajoute-la dans Réglages, ou une clé ElevenLabs directe.");
    }
    let text = "";
    let language = "";
    try {
      const t = await transcribe(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) as ArrayBuffer, "source.mp3");
      text = t.text;
      language = t.language;
    } catch (e) {
      const err = e as OpenAiError;
      throw new VoiceError(err.code === 422 ? "Aucune parole détectée dans la vidéo : rien à relire." : `Transcription impossible : ${err.message}`);
    }
    try {
      const tts = await ttsViaKie(text, job.voiceId, { languageCode: language });
      transformed = await fitAudioDuration(tts.audio, info.durationSec);
    } catch (e) {
      const err = e as KieTtsError;
      throw new VoiceError(err.message);
    }
  }

  // Recalage sur ton attaque, distance, niveau et fond de pièce : la voix
  // doit sonner comme si elle avait été enregistrée dans ta vidéo.
  let placed = transformed;
  try {
    placed = await withTempFile(original, ".mp3", (originalPath) =>
      placeVoiceInScene({ originalPath, voice: transformed, ambience: job.voiceAmbience || "room", targetDurationSec: info.durationSec }),
    );
  } catch {
    // Un traitement d'ambiance qui rate ne doit pas faire perdre la voix : on livre la version brute.
    placed = transformed;
  }

  const stored = await storeBuffer(placed, ".mp3");
  return { audioOutput: stored.url, audioPath: stored.path, engine };
}
