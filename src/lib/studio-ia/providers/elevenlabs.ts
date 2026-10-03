import { getSettings } from "@/lib/db";
import { ELEVENLABS } from "../config";
import type { VoiceInfo } from "../types";

export class ElevenLabsError extends Error {
  code: number;
  constructor(message: string, code = 502) {
    super(message);
    this.code = code;
  }
}

/** La variable d'environnement l'emporte sur la clé saisie dans Réglages. */
export function getElevenLabsKey(): string {
  return process.env[ELEVENLABS.envKey]?.trim() || (getSettings().elevenLabsApiKey ?? "").trim();
}

function headers(): Record<string, string> {
  const key = getElevenLabsKey();
  if (!key) {
    throw new ElevenLabsError(
      `Aucune clé ElevenLabs configurée (Réglages, ou ${ELEVENLABS.envKey} dans .env.local).`,
      401,
    );
  }
  return { "xi-api-key": key };
}

async function readError(res: Response, fallback: string): Promise<never> {
  const text = await res.text().catch(() => "");
  let detail = "";
  try {
    const j = JSON.parse(text) as { detail?: { message?: string; status?: string } | string };
    detail = typeof j.detail === "string" ? j.detail : j.detail?.message ?? j.detail?.status ?? "";
  } catch {
    detail = text.slice(0, 200);
  }
  if (res.status === 401) throw new ElevenLabsError("Clé ElevenLabs refusée. Vérifie ELEVENLABS_API_KEY.", 401);
  // Les refus de plan sont frequents et opaques en anglais : on les traduit.
  const d = detail.toLowerCase();
  if (d.includes("free users cannot use library voices")) {
    throw new ElevenLabsError(
      "Plan ElevenLabs gratuit : les voix ajoutées depuis la Voice Library ne sont pas utilisables par l'API. Choisis une voix « premade » (Sarah, Jessica, Laura…) ou passe au plan Starter.",
      403,
    );
  }
  if (d.includes("paid") || d.includes("subscription") || d.includes("upgrade") || d.includes("quota") || d.includes("character")) {
    throw new ElevenLabsError(`ElevenLabs refuse : ${detail}. Vérifie ton plan et ton quota sur elevenlabs.io.`, 403);
  }
  throw new ElevenLabsError(`${fallback}${detail ? ` (${detail})` : ""}`, res.status);
}

interface RawVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string;
  preview_url?: string;
}

/* Cache mémoire partagé entre les rechargements de modules (dev). */
const g = globalThis as unknown as { __elevenVoices?: { at: number; voices: VoiceInfo[] } };

/** Toutes les voix du compte (prédéfinies, clonées, bibliothèque ajoutée). */
export async function listVoices(force = false): Promise<VoiceInfo[]> {
  const cached = g.__elevenVoices;
  if (!force && cached && Date.now() - cached.at < ELEVENLABS.voicesCacheMs) return cached.voices;

  // Le reseau local rate parfois un appel : trois essais, puis l'ancienne liste si on en a une.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(`${ELEVENLABS.baseUrl}/voices?show_legacy=true`, { headers: headers(), cache: "no-store" });
    } catch {
      if (attempt < 2) await new Promise((ok) => setTimeout(ok, 1200 * (attempt + 1)));
    }
  }
  if (!res) {
    if (cached) return cached.voices;
    throw new ElevenLabsError("ElevenLabs est injoignable pour l'instant (réseau). Réessaie dans quelques secondes.", 503);
  }
  if (!res.ok) await readError(res, "ElevenLabs n'a pas renvoyé la liste des voix");
  const body = (await res.json()) as { voices?: RawVoice[] };
  const voices: VoiceInfo[] = (body.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category ?? "",
    gender: v.labels?.gender ?? "",
    age: v.labels?.age ?? "",
    accent: v.labels?.accent ?? "",
    description: v.labels?.description ?? v.description ?? "",
    previewUrl: v.preview_url ?? "",
  }));
  g.__elevenVoices = { at: Date.now(), voices };
  return voices;
}

/**
 * Speech-to-speech : remplace le timbre en gardant mots, rythme, pauses et
 * intonation. C'est un Voice Changer, pas un TTS : l'audio d'entrée EST la
 * performance.
 */
export async function speechToSpeech(audio: Buffer, filename: string, voiceId: string): Promise<Buffer> {
  if (!voiceId) throw new ElevenLabsError("Aucune voix ElevenLabs sélectionnée.", 400);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
  form.append("model_id", ELEVENLABS.stsModel);
  /*
   * Fond nettoye avant conversion : la musique ou le bruit de piece de la
   * prise brouillent le timbre cible et laissent transparaitre la voix
   * d'origine. L'ambiance est remise ensuite par voice-ambience.
   */
  form.append("remove_background_noise", "true");
  // Ressemblance poussee vers la voix choisie : sans ca, le rendu reste a mi-chemin.
  // Similarite trop poussee = artefacts sur une voix clonee imparfaite ; on
  // reste sur les valeurs recommandees pour le speech-to-speech.
  form.append(
    "voice_settings",
    JSON.stringify({ stability: 0.45, similarity_boost: 0.8, style: 0, use_speaker_boost: true }),
  );

  const url = `${ELEVENLABS.baseUrl}/speech-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS.outputFormat}`;
  // Hors du try : une clé absente doit remonter comme telle, pas comme une panne réseau.
  const auth = headers();
  // Le reseau local rate parfois un appel : trois essais avant d'abandonner.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(url, { method: "POST", headers: auth, body: form, cache: "no-store" });
    } catch {
      if (attempt < 2) await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
  }
  if (!res) throw new ElevenLabsError("ElevenLabs n'a pas répondu.", 504);
  if (!res.ok) await readError(res, "Impossible de transformer la voix");
  const out = Buffer.from(await res.arrayBuffer());
  if (!out.byteLength) throw new ElevenLabsError("ElevenLabs a renvoyé un audio vide.");
  return out;
}

/**
 * Instant Voice Clone : une voix créée à partir de 10 s à 2 min d'audio.
 * Elle rejoint « My Voices » et remonte ensuite dans listVoices().
 */
export async function cloneVoice(args: {
  name: string;
  audio: Buffer;
  filename: string;
  description?: string;
}): Promise<VoiceInfo> {
  const name = args.name.trim();
  if (!name) throw new ElevenLabsError("Donne un nom à la voix.", 400);
  const form = new FormData();
  form.append("name", name.slice(0, 60));
  if (args.description?.trim()) form.append("description", args.description.trim().slice(0, 500));
  form.append("remove_background_noise", "true");
  form.append("files", new Blob([new Uint8Array(args.audio)], { type: "audio/mpeg" }), args.filename);

  let res: Response | null = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(`${ELEVENLABS.baseUrl}/voices/add`, { method: "POST", headers: headers(), body: form, cache: "no-store" });
    } catch {
      if (attempt < 2) await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
  }
  if (!res) throw new ElevenLabsError("ElevenLabs n'a pas répondu.", 504);
  if (!res.ok) await readError(res, "Clonage de voix refusé");
  const body = (await res.json()) as { voice_id?: string };
  if (!body.voice_id) throw new ElevenLabsError("ElevenLabs n'a pas renvoyé d'identifiant de voix.");

  const voices = await listVoices(true).catch(() => [] as VoiceInfo[]);
  return (
    voices.find((v) => v.id === body.voice_id) ?? {
      id: body.voice_id,
      name,
      category: "cloned",
      gender: "",
      age: "",
      accent: "",
      description: args.description ?? "",
      previewUrl: "",
    }
  );
}

/**
 * Voice Isolator : garde la voix, retire musique et bruit.
 *
 * Indispensable avant un clonage depuis un TikTok ou un reel : sans ca,
 * ElevenLabs clone aussi la musique de fond et la voix ressort brouillee.
 */
export async function isolateVoice(audio: Buffer, filename: string): Promise<Buffer> {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(`${ELEVENLABS.baseUrl}/audio-isolation`, { method: "POST", headers: headers(), body: form, cache: "no-store" });
    } catch {
      if (attempt < 2) await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
  }
  if (!res) throw new ElevenLabsError("ElevenLabs n'a pas répondu.", 504);
  if (!res.ok) await readError(res, "Isolation de la voix refusée");
  const out = Buffer.from(await res.arrayBuffer());
  if (!out.byteLength) throw new ElevenLabsError("Isolation vide.");
  return out;
}

/**
 * Text-to-speech : un texte lu par une voix du compte (photo qui parle).
 * multilingual v2 : francais naturel, pauses sur la ponctuation.
 */
export async function textToSpeech(text: string, voiceId: string): Promise<Buffer> {
  const clean = text.trim();
  if (!clean) throw new ElevenLabsError("Texte vide.", 400);
  if (!voiceId) throw new ElevenLabsError("Aucune voix sélectionnée.", 400);
  const body = JSON.stringify({
    text: clean.slice(0, 5000),
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
  });
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(`${ELEVENLABS.baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS.outputFormat}`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body,
        cache: "no-store",
      });
    } catch {
      if (attempt < 2) await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
  }
  if (!res) throw new ElevenLabsError("ElevenLabs n'a pas répondu.", 504);
  if (!res.ok) await readError(res, "Lecture du texte refusée");
  const out = Buffer.from(await res.arrayBuffer());
  if (!out.byteLength) throw new ElevenLabsError("ElevenLabs a renvoyé un audio vide.");
  return out;
}
