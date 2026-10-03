import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureLocal, MediaError, runFf } from "@/lib/studio-ia/media";
import { cloneVoice, ElevenLabsError, getElevenLabsKey, isolateVoice } from "@/lib/studio-ia/providers/elevenlabs";
import { downloadAudio, DownloadError, isSupportedUrl } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** ElevenLabs clone bien avec 10 s à 2 min : on coupe au-delà, pour l'upload et la vitesse. */
const MAX_SAMPLE_SEC = 100;

/**
 * Cloner une voix (Instant Voice Clone) depuis un lien TikTok / Instagram /
 * YouTube, ou depuis un fichier déjà déposé dans le drive (/api/media/...).
 *
 * L'audio est extrait en mp3 mono 44,1 kHz, coupé à 100 s, nettoyé par
 * ElevenLabs. La voix apparaît ensuite dans la liste du Swap vidéo.
 */
export async function POST(req: NextRequest) {
  if (!getElevenLabsKey()) {
    return NextResponse.json({ error: "Aucune clé ElevenLabs : ajoute-la dans Réglages." }, { status: 401 });
  }
  const { name, description, url, mediaUrl } = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    url?: string;
    mediaUrl?: string;
  };
  if (!name?.trim()) return NextResponse.json({ error: "Donne un nom à la voix." }, { status: 400 });
  if (!url?.trim() && !mediaUrl?.trim()) {
    return NextResponse.json({ error: "Colle un lien (TikTok, Instagram, YouTube) ou dépose un fichier audio/vidéo." }, { status: 400 });
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-clone-"));
  try {
    let sourcePath: string;
    if (url?.trim()) {
      if (!isSupportedUrl(url.trim())) {
        return NextResponse.json({ error: "Seuls les liens Instagram, TikTok et YouTube sont acceptés." }, { status: 400 });
      }
      const dl = await downloadAudio(url.trim());
      sourcePath = path.join(dir, dl.filename.replace(/[^\w.-]+/g, "_"));
      await fs.writeFile(sourcePath, dl.data);
    } else {
      sourcePath = (await ensureLocal(mediaUrl!.trim())).path;
    }

    const sample = path.join(dir, "sample.mp3");
    await runFf("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
      "-t", String(MAX_SAMPLE_SEC), "-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "160k", sample,
    ], 180_000);
    let audio: Buffer = await fs.readFile(sample);
    if (audio.byteLength < 20_000) {
      return NextResponse.json({ error: "Audio trop court ou vide : il faut au moins 10 secondes de parole." }, { status: 422 });
    }

    // Musique et bruit retires avant le clonage ; si l'isolation echoue, on clone l'original.
    let isolated = false;
    try {
      audio = await isolateVoice(audio, "sample.mp3");
      isolated = true;
    } catch {
      isolated = false;
    }

    const voice = await cloneVoice({ name: name.trim(), description, audio, filename: "sample.mp3" });
    return NextResponse.json({ voice, isolated });
  } catch (e) {
    const err = e as ElevenLabsError | DownloadError | MediaError;
    const code = err instanceof ElevenLabsError ? err.code : (err as { code?: number }).code;
    return NextResponse.json({ error: err.message }, { status: code === 401 ? 401 : code === 400 ? 400 : 502 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
