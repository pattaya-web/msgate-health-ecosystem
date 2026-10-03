import { getSettings } from "./db";
import { formatTranscript } from "./format";

export const OPENAI_BASE = "https://api.openai.com/v1";

/** L'API refuse au-delà de 25 Mo : on le vérifie avant d'envoyer. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class OpenAiError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

/** La variable d'environnement l'emporte sur la clé saisie dans l'UI. */
export function getOpenAiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || getSettings().openaiApiKey.trim();
}

/** Mots significatifs, pour comparer une sortie au lexique fourni. */
function wordSet(v: string): Set<string> {
  return new Set(
    v.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3),
  );
}

/**
 * Vrai quand la sortie n'est qu'un renvoi du lexique.
 * On compare les mots plutot que les chaines : le modele reformule parfois
 * legerement ce qu'il recrache.
 */
function echoesPrompt(text: string, prompt: string): boolean {
  const out = wordSet(text);
  const src = wordSet(prompt);
  if (!out.size || !src.size) return false;

  let shared = 0;
  for (const w of out) if (src.has(w)) shared++;
  // Presque tous les mots viennent du lexique, et rien n'a ete ajoute.
  return shared / out.size >= 0.8;
}

interface TranscriptionResponse {
  text?: string;
  languages?: { code?: string }[];
  error?: { message?: string; type?: string };
}

/**
 * Transcription audio via /v1/audio/transcriptions.
 *
 * Le mp4 est accepté tel quel par l'API, donc on envoie le reel Instagram
 * directement : pas besoin d'extraire la piste audio, donc pas de ffmpeg.
 */
export async function transcribe(
  data: ArrayBuffer,
  filename: string,
  opts: { model?: string; prompt?: string } = {},
): Promise<{ text: string; language: string }> {
  const key = getOpenAiKey();
  if (!key) {
    throw new OpenAiError(
      "Aucune clé OpenAI configurée (Réglages, ou OPENAI_API_KEY dans .env.local).",
      401,
    );
  }

  if (data.byteLength > MAX_UPLOAD_BYTES) {
    const mb = (data.byteLength / 1024 / 1024).toFixed(1);
    throw new OpenAiError(
      `Vidéo trop lourde pour la transcription : ${mb} Mo, la limite OpenAI est de 25 Mo.`,
      413,
    );
  }

  const model = opts.model?.trim() || getSettings().transcribeModel || "gpt-4o-mini-transcribe";

  const form = new FormData();
  form.append("file", new Blob([data], { type: "video/mp4" }), filename);
  form.append("model", model);
  form.append("response_format", "json");
  // Le prompt sert de lexique. Il doit rester une LISTE DE TERMES : une phrase
  // complète est recrachée telle quelle par le modèle quand l'audio est muet
  // ou purement musical (constaté sur 40 vidéos sur 186).
  const hint = opts.prompt?.trim();
  if (hint) form.append("prompt", hint.slice(0, 300));

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    cache: "no-store",
  });

  const text = await res.text();
  let json: TranscriptionResponse;
  try {
    json = JSON.parse(text) as TranscriptionResponse;
  } catch {
    throw new OpenAiError(`Réponse OpenAI illisible (HTTP ${res.status}) : ${text.slice(0, 250)}`, res.status);
  }

  if (!res.ok || json.error) {
    const msg = json.error?.message ?? text.slice(0, 250);
    throw new OpenAiError(
      res.status === 401
        ? "Clé OpenAI refusée. Vérifie OPENAI_API_KEY."
        : `Erreur OpenAI (HTTP ${res.status}) : ${msg}`,
      res.status,
    );
  }

  if (!json.text?.trim()) {
    throw new OpenAiError("OpenAI n'a renvoyé aucun texte : la vidéo n'a peut-être pas de parole.", 422);
  }

  // Garde-fou : sur un audio sans parole, le modèle renvoie le lexique au lieu
  // d'une transcription. On refuse plutôt que d'enregistrer un faux script.
  if (hint && echoesPrompt(json.text, hint)) {
    throw new OpenAiError(
      "Aucune parole détectée : la vidéo est muette ou ne contient que de la musique.",
      422,
    );
  }

  // Mise en forme immediate : OpenAI renvoie un pave sans aucun retour ligne.
  return { text: formatTranscript(json.text), language: json.languages?.[0]?.code ?? "" };
}
