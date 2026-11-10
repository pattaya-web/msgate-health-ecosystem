import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Les images d'une boutique gardées sur notre disque.
 *
 * Kie rend ses images sur des hôtes temporaires (tempfile.aiquickdraw.com,
 * tempfile.redpandaai.co) qui les effacent en quelques jours : une boutique
 * soumise à un processeur se retrouvait sans packs ni bannière au moment où
 * l'analyste l'ouvrait. Toute adresse temporaire enregistrée dans une boutique
 * est donc recopiée dans data/media (disque persistant du serveur) et servie
 * par /api/media, sur le domaine de la boutique comme sur l'outil.
 *
 * La correspondance adresse temporaire → fichier est elle-même gardée : un
 * onglet resté ouvert renvoie l'ancienne adresse, parfois déjà expirée, et
 * doit retomber sur le fichier gardé au lieu de remettre un lien mort.
 */

const MEDIA_DIR = path.join(STORAGE_ROOT, "data", "media");
const MAP_FILE = path.join(STORAGE_ROOT, ".msgate-cache", "ecom-kept-images.json");
const TEMP_HOST = /^https:\/\/tempfile\.[a-z0-9.-]+\//i;
const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

let kept: Map<string, string> | null = null;

async function loadMap() {
  if (kept) return kept;
  try {
    kept = new Map(Object.entries(JSON.parse(await fs.readFile(MAP_FILE, "utf8")) as Record<string, string>));
  } catch {
    kept = new Map();
  }
  return kept;
}

async function saveMap(map: Map<string, string>) {
  await fs.mkdir(path.dirname(MAP_FILE), { recursive: true });
  await fs.writeFile(MAP_FILE, JSON.stringify(Object.fromEntries(map)), "utf8");
}

/**
 * Seul un serveur joignable depuis l'extérieur garde les images : Kie relit
 * ensuite ces fichiers pour composer les scènes, et ne peut pas atteindre un
 * localhost. En dev, les adresses temporaires restent telles quelles.
 */
export function publicBase() {
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || "";
  return base && !/localhost|127\.0\.0\.1/.test(base) ? base : "";
}

async function download(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const fromPath = path.extname(new URL(url).pathname).toLowerCase().replace(".jpeg", ".jpg");
  const ext = EXT[type] || (/^\.(png|jpg|webp|gif)$/.test(fromPath) ? fromPath : "");
  if (!ext) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 100) return null;
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const file = `${randomUUID().replace(/-/g, "")}${ext}`;
  await fs.writeFile(path.join(MEDIA_DIR, file), buffer);
  return `/api/media/${file}`;
}

/** Remplace, partout dans la valeur, les images Kie temporaires par leur copie gardée. */
export async function keepImagesIn<T>(value: T): Promise<T> {
  if (!publicBase()) return value;
  const found = new Set<string>();
  const collect = (item: unknown) => {
    if (typeof item === "string") {
      if (TEMP_HOST.test(item)) found.add(item);
    } else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === "object") Object.values(item).forEach(collect);
  };
  collect(value);
  if (!found.size) return value;

  const map = await loadMap();
  const todo = [...found].filter((url) => !map.has(url));
  let changed = false;
  for (let start = 0; start < todo.length; start += 4) {
    await Promise.all(
      todo.slice(start, start + 4).map(async (url) => {
        try {
          const local = await download(url);
          if (local) {
            map.set(url, local);
            changed = true;
          }
        } catch {
          // Expirée ou injoignable : l'adresse reste, rien de mieux à mettre.
        }
      })
    );
  }
  if (changed) await saveMap(map);

  const swap = (item: unknown): unknown => {
    if (typeof item === "string") return map.get(item) ?? item;
    if (Array.isArray(item)) return item.map(swap);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, swap(inner)]));
    }
    return item;
  };
  return swap(value) as T;
}
