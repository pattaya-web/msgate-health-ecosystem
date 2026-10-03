import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { newId } from "@/lib/db";
import { uploadToKie } from "@/lib/kie";
import { REMOTE_MEDIA_HOSTS } from "./config";

/**
 * Manipulation des médias du Swap vidéo : sondage, extraction audio, mux,
 * première image, rapatriement des résultats. Tout passe par ffmpeg, présent
 * en local et dans l'image Docker.
 */

const run = promisify(execFile);
const MEDIA_DIR = path.join(process.cwd(), "data", "media");

export class MediaError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

export interface Probe {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  bytes: number;
}

const MIME_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
};

export const publicUrl = (stored: string) => `/api/media/${stored}`;

/** /api/media/xxx.ext → chemin disque, ou null si ce n'est pas un média local. */
export function localMediaPath(url: string): string | null {
  const m = url.match(/^\/api\/media\/([A-Za-z0-9]+\.[A-Za-z0-9]+)(?:\?.*)?$/);
  if (!m) return null;
  const full = path.join(MEDIA_DIR, m[1]);
  return full.startsWith(MEDIA_DIR) ? full : null;
}

export function isAllowedRemote(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && REMOTE_MEDIA_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export async function runFf(bin: "ffmpeg" | "ffprobe", args: string[], timeout = 240_000) {
  try {
    return await run(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { code?: unknown; stderr?: string; message?: string };
    if (err.code === "ENOENT") throw new MediaError(`${bin} introuvable sur le serveur.`, 500);
    throw new MediaError(`${bin} a échoué : ${(err.stderr ?? err.message ?? "").toString().trim().split("\n").pop()?.slice(0, 200)}`, 500);
  }
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await runFf("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json",
    file,
  ], 60_000);
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };
  const video = j.streams?.find((s) => s.codec_type === "video");
  const bytes = (await fs.stat(file)).size;
  return {
    durationSec: Number(j.format?.duration ?? 0) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: Boolean(j.streams?.some((s) => s.codec_type === "audio")),
    bytes,
  };
}

/** Ratio de sortie le plus proche des dimensions d'une vidéo. */
export function nearestAspect(width: number, height: number): "9:16" | "16:9" | "1:1" {
  if (!width || !height) return "9:16";
  const r = width / height;
  if (r < 0.8) return "9:16";
  if (r > 1.25) return "16:9";
  return "1:1";
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "princexd-studio-"));
}

/** Enregistre des octets dans data/media et renvoie l'URL servie. */
export async function storeBuffer(buf: Buffer, ext: string): Promise<{ url: string; path: string }> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const stored = `${newId()}${ext.startsWith(".") ? ext : `.${ext}`}`;
  const full = path.join(MEDIA_DIR, stored);
  await fs.writeFile(full, buf);
  return { url: publicUrl(stored), path: full };
}

/** Déplace un fichier temporaire dans data/media. */
async function storeFile(tmp: string, ext: string): Promise<{ url: string; path: string }> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const stored = `${newId()}${ext}`;
  const full = path.join(MEDIA_DIR, stored);
  await fs.copyFile(tmp, full);
  return { url: publicUrl(stored), path: full };
}

/**
 * Rapatrie un résultat distant dans data/media.
 *
 * `trusted` : l'URL vient d'une réponse d'API du fournisseur (jamais d'un
 * utilisateur), on ne la filtre pas sur la liste d'hôtes KIE.
 */
export async function downloadToMedia(url: string, opts: { trusted?: boolean } = {}): Promise<{ url: string; path: string }> {
  const okHost = opts.trusted ? /^https:\/\//.test(url) : isAllowedRemote(url);
  if (!okHost) throw new MediaError("Domaine du résultat non autorisé.", 400);
  // Le CDN du fournisseur (ou le DNS local) rate parfois un appel : trois essais espacés.
  let res: Response | null = null;
  let lastErr = "";
  // Six essais sur une minute : le DNS du poste de dev lache par rafales.
  for (let attempt = 0; attempt < 6 && !res; attempt++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok && r.body) res = r;
      else lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    if (!res) await new Promise((ok) => setTimeout(ok, 3000 * (attempt + 1)));
  }
  if (!res || !res.body) {
    // Dernier recours : passer par une machine qui, elle, joint le CDN (voir relayDownload).
    const relayed = await relayDownload(url, Boolean(opts.trusted)).catch(() => null);
    if (relayed) return relayed;
    throw new MediaError(`Téléchargement du résultat impossible (${lastErr || "réseau"}). Le fichier existe chez le fournisseur : clique sur Réessayer.`, 502);
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  const ext = MIME_EXT[type] ?? `.${(new URL(url).pathname.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4"}`;
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const stored = `${newId()}${ext}`;
  const full = path.join(MEDIA_DIR, stored);
  try {
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(full));
  } catch (e) {
    await fs.rm(full, { force: true });
    throw new MediaError(`Téléchargement du résultat interrompu : ${(e as Error).message}`, 502);
  }
  return { url: publicUrl(stored), path: full };
}

/**
 * Téléchargement relayé par SSH.
 *
 * Le poste de dev n'arrive parfois plus à joindre le CDN de KIE (Cloudflare)
 * alors que le VPS y accède sans problème. Si `MEDIA_FETCH_RELAY_SSH` nomme un
 * hôte SSH (alias de ~/.ssh/config), on lui demande de rapatrier le fichier et
 * on lit sa sortie. Inutile en production, où la variable n'est pas définie.
 * L'URL a déjà été validée (hôte autorisé) ; on refuse tout guillemet par prudence.
 */
async function relayDownload(url: string, trusted = false): Promise<{ url: string; path: string } | null> {
  const host = process.env.MEDIA_FETCH_RELAY_SSH?.trim();
  if (!host || !(trusted ? /^https:\/\//.test(url) : isAllowedRemote(url)) || /['"\s]/.test(url)) return null;
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const ext = `.${(new URL(url).pathname.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4"}`;
  const stored = `${newId()}${ext}`;
  const full = path.join(MEDIA_DIR, stored);
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, `curl -sfL --max-time 240 '${url}'`], { stdio: ["ignore", "pipe", "pipe"] });
    const out = createWriteStream(full);
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.stdout.pipe(out);
    child.on("error", reject);
    child.on("close", (code) => {
      out.end();
      if (code === 0) resolve();
      else reject(new Error(`relais ssh (code ${code}) ${stderr.slice(0, 120)}`));
    });
  });
  const size = (await fs.stat(full)).size;
  if (size < 1024) {
    await fs.rm(full, { force: true });
    return null;
  }
  return { url: publicUrl(stored), path: full };
}

/**
 * Chemin local d'un média, en le rapatriant d'abord s'il vient d'un hôte
 * distant autorisé (résultat d'une génération précédente, par exemple).
 */
export async function ensureLocal(url: string): Promise<{ url: string; path: string }> {
  const local = localMediaPath(url);
  if (local) {
    try {
      await fs.access(local);
    } catch {
      throw new MediaError("Fichier source introuvable sur le serveur : renvoie-le.", 404);
    }
    return { url, path: local };
  }
  if (isAllowedRemote(url)) return downloadToMedia(url);
  throw new MediaError("Source invalide : dépose le fichier dans le Studio.", 400);
}

/** Rend un fichier local lisible par les modèles KIE (stockage temporaire public). */
export async function publishToKie(localPath: string, name: string): Promise<string> {
  const buf = await fs.readFile(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const type =
    ext === ".mp4" ? "video/mp4"
    : ext === ".mov" ? "video/quicktime"
    : ext === ".webm" ? "video/webm"
    : ext === ".png" ? "image/png"
    : ext === ".webp" ? "image/webp"
    : "image/jpeg";
  const safe = (name || path.basename(localPath)).replace(/[^\w.-]+/g, "_");
  const file = new File([new Uint8Array(buf)], safe.includes(".") ? safe : `${safe}${ext}`, { type });
  // Le reseau du poste lache par rafales : trois essais avant d'abandonner l'envoi.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await uploadToKie(file, "princexd-studio");
    } catch (e) {
      lastErr = e as Error;
      if (!/fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN|socket/i.test(lastErr.message)) throw lastErr;
      await new Promise((ok) => setTimeout(ok, 2500 * (attempt + 1)));
    }
  }
  throw lastErr ?? new MediaError("Envoi vers KIE impossible.");
}

/**
 * Recompresse une vidéo pour tenir sous un poids donné (720p max, H.264).
 *
 * Wan Animate refuse au-delà de 10 Mo : un reel de 20 s en 1080p en fait 30.
 * On vise 90 % du plafond, débit vidéo calculé sur la durée, audio à 96 kbit/s.
 */
export async function compressVideo(
  src: string,
  maxBytes: number,
  durationSec: number,
  opts: { maxPixels?: number; width?: number; height?: number } = {},
): Promise<{ url: string; path: string; bytes: number }> {
  const dir = await tmpDir();
  const out = path.join(dir, "small.mp4");
  try {
    const budgetBits = maxBytes * 8 * 0.9;
    const audioKbps = 96;
    const videoKbps = Math.max(350, Math.floor(budgetBits / Math.max(1, durationSec) / 1000 - audioKbps));
    // Largeur cible : 720 max, et moins si un plafond de pixels l'impose (Seedance).
    let targetW = Math.min(720, opts.width || 720);
    if (opts.maxPixels && opts.width && opts.height) {
      const f = Math.sqrt((opts.maxPixels * 0.97) / (opts.width * opts.height));
      if (f < 1) targetW = Math.min(targetW, Math.floor((opts.width * f) / 2) * 2);
    }
    await runFf("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", src,
      "-vf", `scale='min(${targetW},iw)':-2`,
      "-c:v", "libx264", "-preset", "medium", "-b:v", `${videoKbps}k`, "-maxrate", `${Math.floor(videoKbps * 1.15)}k`, "-bufsize", `${videoKbps * 2}k`,
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", `${audioKbps}k`, "-movflags", "+faststart",
      out,
    ], 600_000);
    const stored = await storeFile(out, ".mp4");
    const bytes = (await fs.stat(stored.path)).size;
    return { ...stored, bytes };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Planche multi-vues : 2 ou 3 photos du même personnage côte à côte, même
 * hauteur. Les modèles à image unique (Wan, Motion Control…) voient ainsi le
 * visage, le dos et la tenue en une seule référence, comme dans l'interface
 * Higgsfield.
 */
export async function makeReferenceSheet(paths: string[]): Promise<{ url: string; path: string }> {
  const list = paths.slice(0, 3);
  if (list.length < 2) throw new MediaError("Une planche demande au moins deux photos.");
  const dir = await tmpDir();
  const out = path.join(dir, "sheet.jpg");
  try {
    const inputs = list.flatMap((p) => ["-i", p]);
    const scaled = list.map((_, k) => `[${k}:v]scale=-2:1280,setsar=1[v${k}]`).join(";");
    const stack = list.map((_, k) => `[v${k}]`).join("") + `hstack=inputs=${list.length}[out]`;
    await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", `${scaled};${stack}`, "-map", "[out]", "-frames:v", "1", "-q:v", "2", out], 120_000);
    return await storeFile(out, ".jpg");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Affine des bornes de panneaux approximatives.
 *
 * Le modèle vision place les séparations à peu près (souvent en tiers égaux) ;
 * la vraie gouttière est la colonne la plus claire à proximité. On lit la
 * luminosité moyenne de chaque colonne (ffmpeg réduit l'image à une ligne) et
 * on déplace chaque borne vers la colonne la plus claire dans une fenêtre de
 * ±12 % de la largeur. Sans gouttière nette, la borne reste où elle est.
 */
export async function refinePanelBounds<T extends { x0: number; x1: number }>(imagePath: string, panels: T[]): Promise<T[]> {
  if (panels.length < 2) return panels;
  const dir = await tmpDir();
  try {
    const raw = path.join(dir, "cols.raw");
    await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", imagePath, "-vf", "scale=iw:1:flags=area,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", raw], 60_000);
    const cols = await fs.readFile(raw);
    const w = cols.length;
    if (w < 50) return panels;
    const refine = (frac: number) => {
      const lo = Math.max(1, Math.floor(w * (frac - 0.12)));
      const hi = Math.min(w - 1, Math.ceil(w * (frac + 0.12)));
      let best = Math.round(w * frac);
      for (let x = lo; x < hi; x++) if (cols[x] > cols[best]) best = x;
      // Une gouttière se distingue nettement (proche du blanc) ; sinon on ne bouge pas.
      return cols[best] >= 225 ? best / w : frac;
    };
    // Bornes internes partagées entre panneaux voisins : on les affine une fois chacune.
    const out = panels.map((p) => ({ ...p }));
    for (let k = 0; k < out.length - 1; k++) {
      const cut = refine((out[k].x1 + out[k + 1].x0) / 2);
      out[k].x1 = cut;
      out[k + 1].x0 = cut;
    }
    out[0].x0 = 0;
    out[out.length - 1].x1 = 1;
    return out;
  } catch {
    return panels;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Découpe une planche (plusieurs photos côte à côte) en panneaux séparés,
 * selon des bornes horizontales en fraction de la largeur. Chaque panneau
 * devient une image de référence à part entière : un modèle qui reçoit le
 * portrait serré seul reproduit le visage bien mieux que sur une vignette
 * perdue dans une planche large.
 */
export async function cropPanels(imagePath: string, panels: { x0: number; x1: number }[]): Promise<{ url: string; path: string }[]> {
  const dir = await tmpDir();
  const out: { url: string; path: string }[] = [];
  try {
    for (const [k, p] of panels.entries()) {
      const x0 = Math.max(0, Math.min(0.98, p.x0));
      const x1 = Math.max(x0 + 0.02, Math.min(1, p.x1));
      const tmp = path.join(dir, `panel-${k}.jpg`);
      await runFf("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", imagePath,
        "-vf", `crop=floor(iw*${(x1 - x0).toFixed(4)}/2)*2:ih:floor(iw*${x0.toFixed(4)}):0`,
        "-frames:v", "1", "-q:v", "2", tmp,
      ], 60_000);
      out.push(await storeFile(tmp, ".jpg"));
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Piste audio d'une vidéo, en mp3 44,1 kHz : ce qu'ElevenLabs lit le mieux. */
export async function extractAudioMp3(videoPath: string): Promise<Buffer> {
  const dir = await tmpDir();
  const out = path.join(dir, "audio.mp3");
  try {
    await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", out]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Remplace la piste audio d'une vidéo, sans réencoder l'image.
 *
 * `apad` + `-shortest` : l'audio est complété par du silence jusqu'à la fin
 * de la vidéo, et jamais l'inverse. La durée de la vidéo est donc conservée.
 */
export async function muxAudio(videoPath: string, audioPath: string): Promise<{ url: string; path: string }> {
  const dir = await tmpDir();
  const out = path.join(dir, "final.mp4");
  try {
    await runFf("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", videoPath, "-i", audioPath,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-af", "apad", "-shortest",
      "-movflags", "+faststart",
      out,
    ]);
    return await storeFile(out, ".mp4");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Recale une vidéo générée sur la durée exacte de la source.
 *
 * Seedance et Kling rendent souvent 3 ou 4 s pour une source de 3,4 s : le
 * mouvement est étiré ou compressé, et la voix d'origine posée dessus dérive
 * par rapport aux lèvres. On ramène la vidéo à la durée source par un
 * changement de vitesse constant (setpts), ce qui réaligne l'ensemble.
 */
export async function retimeVideo(videoPath: string, targetSec: number): Promise<{ url: string; path: string }> {
  const info = await probe(videoPath);
  const ratio = targetSec / (info.durationSec || targetSec);
  const dir = await tmpDir();
  const out = path.join(dir, "retimed.mp4");
  try {
    await runFf("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath,
      "-filter:v", `setpts=${ratio.toFixed(6)}*PTS`,
      "-an", "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
      "-t", targetSec.toFixed(3), "-movflags", "+faststart",
      out,
    ], 600_000);
    return await storeFile(out, ".mp4");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Vidéo sans piste audio. */
export async function stripAudio(videoPath: string): Promise<{ url: string; path: string }> {
  const dir = await tmpDir();
  const out = path.join(dir, "muted.mp4");
  try {
    await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-an", "-c:v", "copy", "-movflags", "+faststart", out]);
    return await storeFile(out, ".mp4");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Durée d'un fichier audio, en secondes. */
export async function audioDuration(file: string): Promise<number> {
  const { stdout } = await runFf("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], 30_000);
  return Number(stdout.trim()) || 0;
}

/**
 * Ajuste le tempo d'un audio pour qu'il dure comme la vidéo.
 *
 * Utile au TTS de repli : la voix relue ne tombe jamais pile sur la durée de
 * la performance d'origine. On étire ou on compresse jusqu'à ±30 % ; au-delà,
 * la voix deviendrait artificielle et on préfère laisser le mux compléter au
 * silence ou couper.
 */
export async function fitAudioDuration(audio: Buffer, targetSec: number): Promise<Buffer> {
  if (!targetSec) return audio;
  return withTempFile(audio, ".mp3", async (src) => {
    const dur = await audioDuration(src);
    if (!dur) return audio;
    const tempo = dur / targetSec;
    if (tempo > 0.98 && tempo < 1.02) return audio;
    const clamped = Math.min(1.3, Math.max(0.7, tempo));
    const dir = await tmpDir();
    const out = path.join(dir, "fit.mp3");
    try {
      await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter:a", `atempo=${clamped.toFixed(4)}`, "-c:a", "libmp3lame", "-b:a", "128k", out]);
      return await fs.readFile(out);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

/** Écrit un buffer audio dans un fichier temporaire (pour le mux). */
export async function withTempFile<T>(buf: Buffer, ext: string, fn: (p: string) => Promise<T>): Promise<T> {
  const dir = await tmpDir();
  const p = path.join(dir, `file${ext}`);
  try {
    await fs.writeFile(p, buf);
    return await fn(p);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Première image nette d'une vidéo, en JPEG : sert de nouvelle référence. */
export async function firstFrame(videoPath: string, atSec = 0.4): Promise<{ url: string; path: string }> {
  const dir = await tmpDir();
  const out = path.join(dir, "frame.jpg");
  try {
    await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(atSec), "-i", videoPath, "-frames:v", "1", "-q:v", "2", out], 60_000);
    return await storeFile(out, ".jpg");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
