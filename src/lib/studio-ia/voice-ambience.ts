import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFf, withTempFile } from "./media";
import type { VoiceAmbience } from "./types";

/**
 * Mise en place de la voix transformée dans la scène.
 *
 * Un speech-to-speech rend une voix « de studio » : sèche, proche du micro,
 * parfois décalée de quelques dizaines de millisecondes. Ta vidéo, elle, est
 * filmée à deux mètres dans une pièce. On recale donc la nouvelle voix sur
 * l'attaque de l'originale, on la met à la bonne distance (égalisation +
 * réflexions courtes), on cale son niveau sur le tien, et on remet dessous le
 * vrai bruit de fond de ta pièce, prélevé dans un silence de la prise.
 */

interface Silence {
  start: number;
  end: number;
}

/** Silences détectés (seuil -32 dB, 0,25 s minimum). */
export async function detectSilences(file: string): Promise<Silence[]> {
  const { stderr } = await runFf("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-32dB:d=0.25", "-f", "null", "-"], 120_000);
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) open = Number(s[1]);
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (e && open !== null) {
      out.push({ start: Math.max(0, open), end: Number(e[1]) });
      open = null;
    }
  }
  return out;
}

/** Première attaque de voix : fin du silence initial, ou 0. */
export function firstOnset(silences: Silence[]): number {
  const lead = silences.find((s) => s.start <= 0.05);
  return lead ? lead.end : 0;
}

/** Intensité intégrée (LUFS) d'un fichier, mesurée par ebur128. */
export async function loudness(file: string): Promise<number | null> {
  const { stderr } = await runFf("ffmpeg", ["-hide_banner", "-i", file, "-af", "ebur128=peak=none", "-f", "null", "-"], 120_000);
  const all = [...stderr.matchAll(/I:\s+(-?[\d.]+)\s+LUFS/g)];
  if (!all.length) return null;
  const v = Number(all[all.length - 1][1]);
  return Number.isFinite(v) && v > -70 ? v : null;
}

/** Chaînes de distance : de la voix brute au fond de pièce. */
const DISTANCE: Record<Exclude<VoiceAmbience, "raw">, string> = {
  close: "highpass=f=80,lowpass=f=12000",
  room:
    "highpass=f=110,lowpass=f=8500,equalizer=f=3500:width_type=o:width=1:g=-2.5,equalizer=f=250:width_type=o:width=1:g=1.5," +
    "aecho=0.8:0.55:13|27|41|58:0.22|0.16|0.11|0.07",
  far:
    "highpass=f=140,lowpass=f=6500,equalizer=f=4000:width_type=o:width=1:g=-4,equalizer=f=300:width_type=o:width=1:g=2," +
    "aecho=0.8:0.7:25|48|77|110:0.32|0.24|0.16|0.1",
};

export async function placeVoiceInScene(args: {
  /** Piste d'origine complète (ta voix + ta pièce), mp3 44,1 kHz mono. */
  originalPath: string;
  /** Nouvelle voix (speech-to-speech ou TTS). */
  voice: Buffer;
  ambience: VoiceAmbience;
  targetDurationSec: number;
}): Promise<Buffer> {
  const { originalPath, voice, ambience, targetDurationSec } = args;
  if (ambience === "raw") return voice;

  return withTempFile(voice, ".mp3", async (voicePath) => {
    const [origSil, voiceSil, origI, voiceI, voiceDurRaw] = await Promise.all([
      detectSilences(originalPath),
      detectSilences(voicePath),
      loudness(originalPath),
      loudness(voicePath),
      runFf("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", voicePath], 30_000).then((r) => Number(r.stdout.trim()) || 0),
    ]);

    /* 1. Recalage : la nouvelle voix démarre exactement où la tienne démarre. */
    const delta = firstOnset(origSil) - firstOnset(voiceSil);
    const chain: string[] = [];
    if (delta > 0.02) chain.push(`adelay=${Math.round(delta * 1000)}:all=1`);
    else if (delta < -0.02) chain.push(`atrim=start=${(-delta).toFixed(3)},asetpts=PTS-STARTPTS`);

    /* 2. Durée : léger atempo pour retomber sur la durée de la vidéo (±15 % max). */
    const shifted = voiceDurRaw + delta;
    if (targetDurationSec > 0 && shifted > 0) {
      const tempo = shifted / targetDurationSec;
      if (tempo < 0.98 || tempo > 1.02) chain.push(`atempo=${Math.min(1.15, Math.max(0.85, tempo)).toFixed(4)}`);
    }

    /* 3. Distance et pièce. */
    chain.push(DISTANCE[ambience]);
    chain.push("apad", `atrim=0:${targetDurationSec.toFixed(3)}`, "asetpts=PTS-STARTPTS");

    /*
     * 4. Niveau : même intensité que ta voix d'origine, mesurée APRÈS la
     * chaîne de distance (l'écho et les filtres font perdre plusieurs dB ;
     * corriger avant les appliquer laissait la voix trop basse).
     */
    const dir0 = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-amb0-"));
    const staged = path.join(dir0, "staged.wav");
    let gainDb = 0;
    try {
      await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", voicePath, "-af", chain.join(","), "-ac", "1", "-ar", "44100", staged]);
      const stagedI = await loudness(staged);
      if (origI !== null && stagedI !== null) gainDb = Math.max(-18, Math.min(18, origI - stagedI));
    } finally {
      await fs.rm(dir0, { recursive: true, force: true }).catch(() => {});
    }
    void voiceI;
    if (Math.abs(gainDb) > 0.3) chain.push(`volume=${gainDb.toFixed(1)}dB`);

    /* 5. Fond de pièce : le plus long silence de ta prise, bouclé sur toute la durée. */
    const gaps = origSil
      .map((s) => ({ ...s, len: s.end - s.start }))
      .filter((s) => s.len >= 0.35)
      .sort((a, b) => b.len - a.len);
    const gap = gaps[0];

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-amb-"));
    const out = path.join(dir, "voice-in-scene.mp3");
    try {
      if (gap) {
        // Une marge de 60 ms de chaque côté évite d'attraper une queue de mot.
        const gs = (gap.start + 0.06).toFixed(3);
        const ge = (gap.end - 0.06).toFixed(3);
        const samples = Math.max(4410, Math.round((gap.len - 0.12) * 44100));
        const filter =
          `[0:a]${chain.join(",")}[v];` +
          `[1:a]atrim=${gs}:${ge},asetpts=PTS-STARTPTS,aloop=loop=-1:size=${samples},atrim=0:${targetDurationSec.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.2[bed];` +
          `[v][bed]amix=inputs=2:duration=first:normalize=0[mix]`;
        await runFf("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", voicePath, "-i", originalPath,
          "-filter_complex", filter, "-map", "[mix]",
          "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "160k", out,
        ]);
      } else {
        await runFf("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", voicePath, "-af", chain.join(","),
          "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "160k", out,
        ]);
      }
      return await fs.readFile(out);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
