import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";


const run = promisify(execFile);

const COOKIES_PATH = path.join(process.cwd(), "data", "ig-cookies.txt");

/**
 * Cookies Instagram (format Netscape), déposés à la main dans data/ig-cookies.txt.
 *
 * Instagram répond « 429 » à tout serveur sans session : yt-dlp n'obtient
 * rien depuis un VPS. Avec les cookies d'un compte connecté, il passe. Dans
 * princexd, le texte venait des Réglages ; ici il n'y a pas d'écran de
 * réglages Instagram, le fichier suffit (yt-dlp le met à jour de son côté).
 */
async function cookieArgs(): Promise<string[]> {
  try {
    await fs.access(COOKIES_PATH);
    return ["--cookies", COOKIES_PATH];
  } catch {
    return [];
  }
}

/**
 * Lance yt-dlp, quel que soit son mode d'installation.
 *
 * Dans l'image Docker c'est le binaire `yt-dlp`. Sur un PC, `python` peut
 * pointer vers un environnement virtuel sans le module : on essaie donc le
 * binaire d'abord, puis `python -m yt_dlp`, puis `python3`.
 */
async function ytdlp(args: string[], opts: { timeout: number; maxBuffer: number }) {
  const full = [...(await cookieArgs()), ...args];
  const candidates: [string, string[]][] = [
    ["yt-dlp", full],
    ["python", ["-m", "yt_dlp", ...full]],
    ["python3", ["-m", "yt_dlp", ...full]],
  ];
  let lastErr: unknown = null;
  for (const [cmd, cmdArgs] of candidates) {
    try {
      return await run(cmd, cmdArgs, opts);
    } catch (e) {
      const err = e as { code?: unknown; stderr?: string };
      const missing = err.code === "ENOENT" || /No module named yt_dlp|introuvable|not found/i.test(err.stderr ?? "");
      lastErr = e;
      if (!missing) throw e;
    }
  }
  throw lastErr;
}

/** Hôtes acceptés. Tout le reste est refusé avant d'atteindre le téléchargeur. */
export const ALLOWED_HOST =
  /^(www\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|vm\.tiktok\.com)$/i;

export class DownloadError extends Error {
  code: number;
  constructor(message: string, code = 502) {
    super(message);
    this.code = code;
  }
}

export function isSupportedUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || !ALLOWED_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Récupère la piste audio d'une vidéo publique.
 *
 * `ba` demande l'audio seul quand il existe : une vingtaine de fois plus léger
 * que la vidéo, ce qui garde les fichiers sous la limite de 25 Mo d'OpenAI même
 * sur des formats longs. L'URL n'est jamais interprétée par un shell — execFile
 * reçoit un tableau d'arguments et l'hôte est validé en amont.
 *
 * Le fichier temporaire est supprimé avant le retour : rien ne reste sur disque.
 */
export async function downloadAudio(rawUrl: string): Promise<{ data: Buffer; filename: string }> {
  const url = isSupportedUrl(rawUrl);
  if (!url) {
    throw new DownloadError("Seules les URL Instagram, TikTok et YouTube sont acceptées.", 400);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-"));

  try {
    await ytdlp(
      [
        "--no-warnings", "--no-playlist", "--no-progress",
        "--max-filesize", "120M",
        "-f", "ba/mp4/best",
        "-o", path.join(dir, "media.%(ext)s"),
        url.toString(),
      ],
      { timeout: 150_000, maxBuffer: 8 * 1024 * 1024 },
    );

    const files = await fs.readdir(dir);
    if (!files.length) {
      throw new DownloadError("Téléchargement vide : vidéo privée, supprimée ou trop lourde.");
    }

    const filename = files[0];
    const data = await fs.readFile(path.join(dir, filename));
    return { data, filename };
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    const err = e as { code?: unknown; message?: string; stderr?: string };
    if (err.code === "ENOENT") {
      throw new DownloadError("yt-dlp introuvable. Installe-le : python -m pip install yt-dlp", 500);
    }
    throw new DownloadError(
      (err.stderr ?? err.message ?? "Téléchargement impossible.").toString().slice(0, 220),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface MediaMeta {
  author: string;
  title: string;
  thumbnail: string;
  likes: number;
  comments: number;
}

/**
 * Metadonnees d'une video publique, sans la telecharger.
 *
 * Business Discovery ne sait interroger qu'un compte entier, jamais un reel
 * precis : pour un lien colle a la volee, c'est la seule voie.
 */
export async function fetchMeta(rawUrl: string): Promise<MediaMeta> {
  const url = isSupportedUrl(rawUrl);
  if (!url) throw new DownloadError("Lien non reconnu.", 400);

  try {
    const { stdout } = await ytdlp(
      ["--no-warnings", "--no-playlist", "--skip-download", "--dump-json", url.toString()],
      { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const j = JSON.parse(stdout) as Record<string, unknown>;
    return {
      // Le pseudo (channel) avant le nom affiche : c'est lui qu'on montre partout.
      author: String(j.channel ?? j.uploader ?? j.uploader_id ?? ""),
      title: String(j.description ?? j.title ?? "").slice(0, 400),
      thumbnail: String(j.thumbnail ?? ""),
      likes: Number(j.like_count ?? 0),
      comments: Number(j.comment_count ?? 0),
    };
  } catch (e) {
    const err = e as { code?: unknown; message?: string; stderr?: string };
    if (err.code === "ENOENT") {
      throw new DownloadError("yt-dlp introuvable. Installe-le : python -m pip install yt-dlp", 500);
    }
    throw new DownloadError(
      (err.stderr ?? err.message ?? "Lecture impossible.").toString().slice(0, 200),
    );
  }
}

/**
 * URL directe du fichier video, sans le telecharger.
 *
 * Sert a la lecture : le navigateur streame depuis le CDN, on ne relaie rien.
 * Le lien expire vite, il est donc resolu a chaque demande.
 */
export async function resolveDirectUrl(rawUrl: string): Promise<string> {
  const url = isSupportedUrl(rawUrl);
  if (!url) throw new DownloadError("Lien non reconnu.", 400);

  try {
    const { stdout } = await ytdlp(
      ["--no-warnings", "--no-playlist", "-f", "mp4/best", "-g", url.toString()],
      { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const direct = stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("http"));
    if (!direct) throw new DownloadError("Aucun flux vidéo trouvé.");
    return direct;
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    const err = e as { code?: unknown; message?: string; stderr?: string };
    if (err.code === "ENOENT") {
      throw new DownloadError("yt-dlp introuvable. Installe-le : python -m pip install yt-dlp", 500);
    }
    throw new DownloadError((err.stderr ?? err.message ?? "Lecture impossible.").toString().slice(0, 200));
  }
}

/** Buffer Node vers ArrayBuffer, pour l'envoi multipart. */
/**
 * Telecharge la video complete dans `target` (mp4).
 *
 * Sert au cache local des videos de createurs : une fois le fichier chez
 * nous, la lecture se fait par plages (on peut avancer dans la video) et ne
 * depend plus d'Instagram. Plafond a 500 Mo : au-dela ce n'est pas un reel.
 */
export async function downloadVideo(rawUrl: string, target: string): Promise<void> {
  const url = isSupportedUrl(rawUrl);
  if (!url) throw new DownloadError("Lien non reconnu.", 400);
  const tmp = `${target}.part.mp4`;
  try {
    await ytdlp(
      [
        "--no-warnings", "--no-playlist", "--no-progress",
        "--max-filesize", "500M",
        "-f", "mp4/bv*[ext=mp4]+ba[ext=m4a]/best",
        "--merge-output-format", "mp4",
        "-o", tmp,
        url.toString(),
      ],
      { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const stat = await fs.stat(tmp).catch(() => null);
    if (!stat || !stat.size) throw new DownloadError("Téléchargement vide : vidéo privée, supprimée ou trop lourde.");
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    if (e instanceof DownloadError) throw e;
    const err = e as { code?: unknown; message?: string; stderr?: string };
    if (err.code === "ENOENT") {
      throw new DownloadError("yt-dlp introuvable. Installe-le : python -m pip install yt-dlp", 500);
    }
    throw new DownloadError((err.stderr ?? err.message ?? "Téléchargement impossible.").toString().slice(0, 220));
  }
}

export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
