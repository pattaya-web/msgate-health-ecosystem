import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { mirror } from "@/lib/storage";

/**
 * Le Drive : des dossiers et des fichiers, rien d'autre.
 *
 * Les créas générées vivent chacune dans leur module (studio, UGC, images
 * produit). Ce qui manquait, c'est l'endroit où l'on range ce qu'on garde —
 * les créas retenues, les médias reçus, les pubs qui tournent — pour le
 * retrouver sans se demander quel outil l'a produit. Un arbre de dossiers sur
 * le disque, servi par l'app : pas de base, pas d'index à corrompre, et un
 * explorateur de fichiers suffit à le lire en cas de doute.
 */

const ROOT = path.join(process.cwd(), ".msgate-cache", "drive");

export type DriveFolder = { name: string; path: string; count: number };
export type DriveFile = { name: string; path: string; size: number; mtime: string; kind: "image" | "video" | "audio" | "file" };
export type DriveListing = { path: string; folders: DriveFolder[]; files: DriveFile[] };

const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg)$/i;

export function kindOf(name: string): DriveFile["kind"] {
  if (IMAGE.test(name)) return "image";
  if (VIDEO.test(name)) return "video";
  if (AUDIO.test(name)) return "audio";
  return "file";
}

export function contentTypeOf(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg",
    pdf: "application/pdf", csv: "text/csv", txt: "text/plain", json: "application/json", zip: "application/zip",
  };
  return types[ext] ?? "application/octet-stream";
}

/**
 * Chemin relatif propre : des segments sans « .. », sans séparateur exotique.
 * Tout ce qui sort de la racine est refusé — c'est la seule ligne de défense
 * entre un paramètre d'URL et le disque.
 */
export function cleanPath(input: string | null | undefined) {
  const segments = (input ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.join("/");
}

function abs(rel: string) {
  const target = path.join(ROOT, ...rel.split("/").filter(Boolean));
  if (!target.startsWith(ROOT)) throw new Error("Chemin refusé");
  return target;
}

/** Un nom de fichier ou de dossier : pas de séparateur, pas de caractères interdits. */
export function cleanName(input: string) {
  const name = input.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name === "." || name === "..") throw new Error("Nom invalide");
  return name.slice(0, 120);
}

/**
 * Un « fichier compagnon » : le `.json` posé à côté d'une créa ou d'une pub
 * (son prompt, son angle, sa source). Il suit son média partout et ne se
 * montre jamais comme une tuile.
 */
function stemOf(name: string) {
  return name.slice(0, name.length - path.extname(name).length);
}

function sidecarName(name: string) {
  return `${stemOf(name)}.json`;
}

/** Les noms à afficher : sans les compagnons dont le média est présent. */
function visibleNames(names: string[]) {
  const stems = new Set(names.filter((name) => !name.toLowerCase().endsWith(".json")).map(stemOf));
  return names.filter((name) => !name.startsWith(".") && !(name.toLowerCase().endsWith(".json") && stems.has(stemOf(name))));
}

export async function listFolder(rel: string): Promise<DriveListing> {
  const dir = abs(rel);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  const shown = new Set(visibleNames(entries.filter((entry) => entry.isFile()).map((entry) => entry.name)));
  const folders: DriveFolder[] = [];
  const files: DriveFile[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const inside = await readdir(path.join(dir, entry.name)).catch(() => [] as string[]);
      folders.push({ name: entry.name, path: childRel, count: visibleNames(inside).length });
    } else if (entry.isFile() && shown.has(entry.name)) {
      const info = await stat(path.join(dir, entry.name));
      files.push({ name: entry.name, path: childRel, size: info.size, mtime: info.mtime.toISOString(), kind: kindOf(entry.name) });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { path: rel, folders, files };
}

/** Recherche par nom dans tout l'arbre : c'est « je sais où c'est » quand on ne sait plus. */
export async function searchFiles(query: string, limit = 200): Promise<DriveFile[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const found: DriveFile[] = [];
  const walk = async (rel: string) => {
    if (found.length >= limit) return;
    const dir = abs(rel);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const shown = new Set(visibleNames(entries.filter((entry) => entry.isFile()).map((entry) => entry.name)));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else if (entry.isFile() && shown.has(entry.name) && childRel.toLowerCase().includes(needle)) {
        const info = await stat(path.join(dir, entry.name));
        found.push({ name: entry.name, path: childRel, size: info.size, mtime: info.mtime.toISOString(), kind: kindOf(entry.name) });
        if (found.length >= limit) return;
      }
    }
  };
  await mkdir(ROOT, { recursive: true });
  await walk("");
  return found.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export async function createFolder(rel: string, name: string) {
  const clean = cleanName(name);
  await mkdir(abs(rel ? `${rel}/${clean}` : clean), { recursive: true });
  return rel ? `${rel}/${clean}` : clean;
}

/** Un fichier qui existe déjà n'est pas écrasé : on numérote. */
async function freeName(dir: string, name: string) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let index = 2; index < 1000; index += 1) {
    try {
      await stat(path.join(dir, candidate));
      candidate = `${base} (${index})${ext}`;
    } catch {
      return candidate;
    }
  }
  return `${base}-${Date.now()}${ext}`;
}

export async function saveFile(rel: string, name: string, data: Buffer) {
  const dir = abs(rel);
  await mkdir(dir, { recursive: true });
  const finalName = await freeName(dir, cleanName(name));
  const target = path.join(dir, finalName);
  await writeFile(target, data);
  mirror(target, data);
  return rel ? `${rel}/${finalName}` : finalName;
}

export async function readDriveFile(rel: string) {
  const target = abs(rel);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Pas un fichier");
  return { data: await readFile(target), name: path.basename(target), size: info.size };
}

/** Le compagnon d'un fichier, s'il existe : `rel` sans extension + `.json`. */
async function sidecarOf(rel: string) {
  if (rel.toLowerCase().endsWith(".json")) return null;
  const target = abs(rel);
  const info = await stat(target).catch(() => null);
  if (!info || !info.isFile()) return null;
  const parent = rel.split("/").slice(0, -1).join("/");
  const name = sidecarName(rel.split("/").pop() as string);
  const side = parent ? `${parent}/${name}` : name;
  const sideInfo = await stat(abs(side)).catch(() => null);
  return sideInfo?.isFile() ? side : null;
}

export async function removeEntry(rel: string) {
  if (!rel) throw new Error("La racine ne se supprime pas");
  const side = await sidecarOf(rel);
  await rm(abs(rel), { recursive: true, force: true });
  if (side) await rm(abs(side), { force: true });
}

export async function renameEntry(rel: string, name: string) {
  if (!rel) throw new Error("La racine ne se renomme pas");
  const clean = cleanName(name);
  const parent = rel.split("/").slice(0, -1).join("/");
  const next = parent ? `${parent}/${clean}` : clean;
  const side = await sidecarOf(rel);
  await rename(abs(rel), abs(next));
  if (side) {
    const sideNext = parent ? `${parent}/${sidecarName(clean)}` : sidecarName(clean);
    await rename(abs(side), abs(sideNext)).catch(() => undefined);
  }
  return next;
}

/** Déplace un fichier ou un dossier dans un autre dossier, sans écraser. */
export async function moveEntry(rel: string, intoRel: string) {
  if (!rel) throw new Error("La racine ne se déplace pas");
  const name = rel.split("/").pop() as string;
  if (intoRel === rel || intoRel.startsWith(`${rel}/`)) throw new Error("Un dossier ne rentre pas dans lui-même");
  const dir = abs(intoRel);
  await mkdir(dir, { recursive: true });
  const finalName = await freeName(dir, name);
  const next = intoRel ? `${intoRel}/${finalName}` : finalName;
  const side = await sidecarOf(rel);
  await rename(abs(rel), abs(next));
  if (side) {
    const sideName = sidecarName(finalName);
    await rename(abs(side), path.join(dir, sideName)).catch(() => undefined);
  }
  return next;
}

/** Tous les dossiers, à plat, pour un sélecteur : « Boutique / Campagne / Ads ». */
export async function listAllFolders(limit = 500): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    if (out.length >= limit) return;
    const entries = await readdir(abs(rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(childRel);
      await walk(childRel);
    }
  };
  await mkdir(ROOT, { recursive: true });
  await walk("");
  return out.sort((a, b) => a.localeCompare(b, "fr"));
}

/** Extension déduite du type MIME quand l'URL n'en donne pas (fichiers Kie sans nom). */
export function extensionFor(contentType: string | null) {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a",
    "application/pdf": "pdf",
  };
  return map[type] ?? "";
}

