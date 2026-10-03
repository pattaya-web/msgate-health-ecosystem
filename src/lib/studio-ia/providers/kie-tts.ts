import { createTask, getTask, KieError } from "@/lib/kie";
import { KIE_TTS_MODEL } from "../kie-voices";

/**
 * Text-to-speech ElevenLabs via KIE.
 *
 * KIE n'expose PAS le speech-to-speech d'ElevenLabs (verifie : la doc ne
 * liste que le TTS et l'isolation audio, et createTask repond « model not
 * supported »). Ce module est donc le REPLI quand aucune cle ElevenLabs
 * directe n'est configuree : on transcrit la voix d'origine, puis on la fait
 * relire par la voix choisie. Les mots sont gardes, pas l'intonation exacte.
 */

export class KieTtsError extends Error {
  code: number;
  constructor(message: string, code = 502) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export async function ttsViaKie(
  text: string,
  voiceId: string,
  opts: { languageCode?: string; speed?: number } = {},
): Promise<{ audio: Buffer; creditsConsumed: number }> {
  const clean = text.trim().slice(0, 5000);
  if (!clean) throw new KieTtsError("Rien à dire : la transcription est vide.", 400);
  if (!voiceId) throw new KieTtsError("Aucune voix sélectionnée.", 400);

  let taskId: string;
  try {
    taskId = await createTask(KIE_TTS_MODEL, {
      text: clean,
      voice: voiceId,
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      speed: Math.min(1.2, Math.max(0.7, opts.speed ?? 1)),
      ...(opts.languageCode && /^[a-z]{2}$/.test(opts.languageCode) ? { language_code: opts.languageCode } : {}),
    });
  } catch (e) {
    const err = e as KieError;
    throw new KieTtsError(`KIE a refusé la synthèse vocale : ${err.message}`, err.code === 401 ? 401 : 502);
  }

  // Une synthese prend quelques secondes : on attend ici, plafonne a 3 minutes.
  const deadline = Date.now() + 180_000;
  let resultUrl = "";
  let credits = 0;
  while (Date.now() < deadline) {
    await sleep(2500);
    const rec = await getTask(taskId).catch(() => null);
    if (!rec) continue;
    if (rec.state === "success") {
      resultUrl = rec.resultUrls[0] ?? "";
      credits = rec.creditsConsumed;
      break;
    }
    if (rec.state === "fail") {
      // Constate le 2026-09-25 : meme l'exemple de la doc KIE echoue ainsi. C'est chez eux.
      if (/internal error/i.test(rec.failMsg)) {
        throw new KieTtsError(
          "La synthèse vocale ElevenLabs via KIE est indisponible pour le moment (erreur interne côté KIE). Réessaie la voix plus tard, ou ajoute une clé ElevenLabs directe dans Réglages.",
        );
      }
      throw new KieTtsError(`Synthèse vocale KIE échouée : ${rec.failMsg || "sans détail"}`);
    }
  }
  if (!resultUrl) throw new KieTtsError("La synthèse vocale KIE n'a pas répondu à temps.", 504);

  let res: Response | null = null;
  for (let i = 0; i < 3 && !res; i++) {
    try {
      const r = await fetch(resultUrl, { cache: "no-store" });
      if (r.ok) res = r;
    } catch {
      // nouvel essai
    }
    if (!res) await sleep(1500 * (i + 1));
  }
  if (!res) throw new KieTtsError("Impossible de récupérer l'audio synthétisé.", 502);
  return { audio: Buffer.from(await res.arrayBuffer()), creditsConsumed: credits };
}
