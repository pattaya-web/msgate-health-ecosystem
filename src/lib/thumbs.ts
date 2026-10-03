import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { isAllowedRemote } from "@/lib/studio-ia/media";

/**
 * Vignettes des medias locaux.
 *
 * Une galerie de 40 videos avec `preload="metadata"` ouvrait 40 lectures
 * partielles de mp4 au chargement : avec 300 ms d'aller-retour, la page
 * restait vide plusieurs secondes et les scripts attendaient derriere. On
 * sert a la place une image fixe (480 px de large, JPEG) generee une fois
 * par ffmpeg et gardee sur le disque a cote des medias. Le nom d'un media ne
 * change jamais, la vignette est donc immuable elle aussi.
 *
 * Generation paresseuse a la premiere demande, deux a la fois pour ne pas
 * saturer le serveur quand une galerie entiere s'affiche d'un coup, et une
 * seule generation par fichier meme si dix requetes arrivent ensemble.
 */

const run = promisify(execFile);

export const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const THUMB_DIR = path.join(MEDIA_DIR, ".thumbs");
/* Largeur des vignettes : les tuiles font 150-260 px, 360 px couvre les ecrans retina. */
const WIDTH = 360;
/* Suffixe de version : le changer regenere tout sans toucher aux anciennes. */
const SUFFIX = ".v2.jpg";
/* Echecs recents (URL expiree, ffmpeg en erreur) : on ne retente pas avant une heure. */
const failed = new Map<string, number>();
const FAIL_TTL = 60 * 60_000;

const VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".jfif", ".jpe", ".webp", ".gif"]);

const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<string | null>>();

function acquire(): Promise<void> {
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => { running++; resolve(); }));
}

function release() {
  running--;
  const next = waiting.shift();
  if (next) next();
}

export function thumbKind(file: string): "video" | "image" | null {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO.has(ext)) return "video";
  if (IMAGE.has(ext)) return "image";
  return null;
}

const ALLOWED_WIDTHS = new Set([240, 360, 480]);
export function thumbWidth(raw: string | null): number {
  const n = Number(raw);
  return ALLOWED_WIDTHS.has(n) ? n : WIDTH;
}
const suffixFor = (width: number) => `${width === WIDTH ? "" : `.w${width}`}${SUFFIX}`;

async function generate(src: string, out: string, kind: "video" | "image", width = WIDTH): Promise<boolean> {
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.jpg`;
  const remote = /^https?:\/\//.test(src);
  // Lecture reseau bornee a 10 s : une URL de CDN expiree ne doit pas bloquer la file.
  const base = ["-hide_banner", "-loglevel", "error", "-y", ...(remote ? ["-rw_timeout", "10000000"] : [])];
  const scale = `scale='min(${width},iw)':-2`;
  const attempts: string[][] =
    kind === "video"
      ? [
          // Une demi-seconde apres le debut : evite l'image noire des fondus d'ouverture.
          [...base, "-ss", "0.5", "-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "6", tmp],
          // Clip plus court que 0,5 s : premiere image.
          [...base, "-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "6", tmp],
        ]
      : [[...base, "-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "6", tmp]];
  for (const args of attempts) {
    try {
      await run("ffmpeg", args, { timeout: remote ? 15_000 : 30_000, maxBuffer: 4 * 1024 * 1024 });
      if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
        fs.renameSync(tmp, out);
        return true;
      }
    } catch {
      // On tente la variante suivante.
    }
    try { fs.unlinkSync(tmp); } catch { /* deja absent */ }
  }
  return false;
}

/**
 * Chemin de la vignette JPEG d'un media local, generee si besoin.
 * `null` quand le fichier n'est ni image ni video, ou que ffmpeg n'y arrive pas.
 */
export async function ensureThumb(file: string, width = WIDTH): Promise<string | null> {
  const kind = thumbKind(file);
  if (!kind) return null;
  const src = path.join(MEDIA_DIR, file);
  if (!src.startsWith(MEDIA_DIR) || !fs.existsSync(src)) return null;
  const out = path.join(THUMB_DIR, `${file}${suffixFor(width)}`);
  if (fs.existsSync(out)) return out;
  const lastFail = failed.get(file);
  if (lastFail && Date.now() - lastFail < FAIL_TTL) return null;

  const flightKey = `${file}@${width}`;
  const pending = inflight.get(flightKey);
  if (pending) return pending;

  const job = (async () => {
    await acquire();
    try {
      if (fs.existsSync(out)) return out;
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      const ok = await generate(src, out, kind, width);
      if (!ok) failed.set(file, Date.now());
      return ok ? out : null;
    } finally {
      release();
      inflight.delete(flightKey);
    }
  })();
  inflight.set(flightKey, job);
  return job;
}

/**
 * Vignette d'un media distant (CDN d'un fournisseur, hote de confiance
 * seulement). ffmpeg lit l'URL directement et ne rapatrie que les octets
 * necessaires a la premiere image : un PNG de 3 Mo ou un mp4 de 40 Mo
 * deviennent un JPEG de 30 Ko, garde sur disque sous le hachage de l'URL.
 */
export async function ensureRemoteThumb(url: string, width = WIDTH): Promise<string | null> {
  if (!isAllowedRemote(url)) return null;
  let pathname = "";
  try { pathname = new URL(url).pathname; } catch { return null; }
  const kind = thumbKind(pathname) ?? "image";
  const key = `remote-${createHash("sha1").update(url).digest("hex")}${width === WIDTH ? "" : `@${width}`}`;
  const out = path.join(THUMB_DIR, `${key.split("@")[0]}${suffixFor(width)}`);
  if (fs.existsSync(out)) return out;
  const lastFail = failed.get(key);
  if (lastFail && Date.now() - lastFail < FAIL_TTL) return null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    // Un resultat de CDN expire (KIE garde ses fichiers quelques jours) : on
    // le detecte en 5 s sans occuper un des deux slots ffmpeg.
    if (!(await stillThere(url))) {
      failed.set(key, Date.now());
      inflight.delete(key);
      return null;
    }
    await acquire();
    try {
      if (fs.existsSync(out)) return out;
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      const ok = await generate(url, out, kind, width);
      if (!ok) failed.set(key, Date.now());
      return ok ? out : null;
    } finally {
      release();
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

async function stillThere(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000), redirect: "follow" });
    if (res.ok) return true;
    // Certains CDN refusent HEAD : on tente un GET d'un seul octet.
    if (res.status === 405 || res.status === 403) {
      const r2 = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(5_000) });
      return r2.ok;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Prepare la vignette d'un media des qu'il existe (fin de rendu, resultat
 * recu) : l'utilisateur n'attend jamais ffmpeg en ouvrant la galerie.
 * Silencieux : un echec ici n'a aucune consequence, la galerie retombera
 * sur le media lui-meme.
 */
export function warmThumb(url: string | undefined | null) {
  if (!url) return;
  try {
    if (url.startsWith("/api/media/")) {
      const file = url.slice("/api/media/".length).split("?")[0];
      if (/^[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(file)) void ensureThumb(file).catch(() => null);
    } else if (/^https:\/\//.test(url)) {
      void ensureRemoteThumb(url).catch(() => null);
    }
  } catch {
    // jamais bloquant
  }
}
