import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { mirror } from "@/lib/storage";
import type { StaticCreative } from "@/lib/studio/library-types";

export type { StaticCreative } from "@/lib/studio/library-types";

const ROOT = path.join(process.cwd(), ".msgate-cache", "studio-static");
const INDEX = path.join(ROOT, "index.json");

type Store = { items: StaticCreative[] };

const mem = ((globalThis as typeof globalThis & {
  __msgateStaticLibrary?: Store;
}).__msgateStaticLibrary ??= { items: [] });

/* Le drapeau vit avec la mémoire : une variable de module serait remise
   à zéro par le rechargement à chaud, et la lecture qui suit écraserait
   la mémoire avec un fichier en retard. */
const flags = ((globalThis as typeof globalThis & {
  __msgateLibraryFlags?: { loaded: boolean };
}).__msgateLibraryFlags ??= { loaded: false });

function uid() {
  return `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isCreativeId(id: string) {
  return /^sc-[a-z0-9-]+$/.test(id);
}

export function isLibraryFile(name: string) {
  return /^(result|ref)-\d+\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(name);
}

export function libraryFileUrl(id: string, file: string) {
  return `/api/studio/library/file?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`;
}

async function load(): Promise<Store> {
  if (flags.loaded) return mem;
  /*
   * Un raté de lecture ne vide plus l'index.
   *
   * Le rattrapage disque plus bas limitait déjà la casse — les images restent —
   * mais les briefs, prompts et ratios, eux, ne se retrouvent nulle part.
   */
  try {
    const raw = await readFile(INDEX, "utf8");
    const parsed = JSON.parse(raw) as Store;
    mem.items = Array.isArray(parsed.items) ? parsed.items : mem.items;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") mem.items = [];
  }

  /*
   * Rattrapage : les dossiers présents sur le disque mais absents de l'index
   * sont réintégrés. Ils viennent d'enregistrements interrompus après l'écriture
   * de l'image — l'index n'est qu'un catalogue, c'est le disque qui fait foi.
   */
  try {
    const known = new Set(mem.items.map((item) => item.id));
    for (const id of await readdir(ROOT)) {
      if (!isCreativeId(id) || known.has(id)) continue;
      const files = await readdir(path.join(ROOT, id)).catch(() => [] as string[]);
      const results = files.filter((file) => /^result-\d+\./i.test(file)).sort();
      if (!results.length) continue;
      const info = await stat(path.join(ROOT, id)).catch(() => null);
      mem.items.push({
        id,
        createdAt: (info?.mtime ?? new Date()).toISOString(),
        brief: "",
        prompt: "(récupérée depuis le disque)",
        ratio: "3:4",
        resolution: "1K",
        resultFiles: results,
        refFiles: files.filter((file) => /^ref-\d+\./i.test(file)).sort(),
      });
    }
    mem.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    // Dossier absent : rien à rattraper.
  }

  flags.loaded = true;
  return mem;
}

async function persist() {
  await mkdir(ROOT, { recursive: true });
  const tmp = `${INDEX}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const payload = JSON.stringify({ items: mem.items }, null, 2);
  await writeFile(tmp, payload);
  await rename(tmp, INDEX);
  mirror(INDEX, Buffer.from(payload));
}

function allowedSource(url: string) {
  if (url.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      /(aiquickdraw|kie\.ai|redpandaai\.co|amazonaws\.com|cloudfront\.net|aliyuncs\.com|googleapis\.com|cdn\.shopify\.com|shopifycdn\.net|myshopify\.com)/i.test(
        parsed.hostname
      )
    );
  } catch {
    return false;
  }
}

function extFrom(type: string, fallback: string) {
  if (/jpeg|jpg/i.test(type)) return "jpg";
  if (/webp/i.test(type)) return "webp";
  if (/gif/i.test(type)) return "gif";
  if (/png/i.test(type)) return "png";
  if (/mp4/i.test(type)) return "mp4";
  if (/webm/i.test(type)) return "webm";
  if (/quicktime/i.test(type)) return "mov";
  return fallback;
}

async function saveBinary(dir: string, name: string, source: string) {
  if (source.startsWith("data:image/")) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(source);
    if (!match) throw new Error("Image data URL illisible");
    const file = `${name}.${extFrom(match[1], "png")}`;
    const body = Buffer.from(match[2], "base64");
    await writeFile(path.join(dir, file), body);
    mirror(path.join(dir, file), body);
    return file;
  }
  if (!allowedSource(source)) throw new Error("URL image refusée");
  const res = await fetch(source, { cache: "no-store" });
  if (!res.ok) throw new Error("Téléchargement créa impossible");
  const file = `${name}.${extFrom(res.headers.get("content-type") || "", "png")}`;
  const body = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(dir, file), body);
  // L'image part aussi en ligne : c'est elle le travail, pas l'index.
  mirror(path.join(dir, file), body);
  return file;
}

export async function listStaticCreatives() {
  const store = await load();
  return [...store.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getStaticCreative(id: string) {
  const store = await load();
  return store.items.find((item) => item.id === id) || null;
}

export async function readCreativeFile(id: string, file: string) {
  if (!isCreativeId(id) || !isLibraryFile(file)) return null;
  const abs = path.resolve(ROOT, id, file);
  if (!abs.startsWith(path.resolve(ROOT) + path.sep) && abs !== path.resolve(ROOT)) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

export async function saveStaticCreative(input: {
  brief?: string;
  prompt: string;
  ratio?: StaticCreative["ratio"];
  resolution?: StaticCreative["resolution"];
  resultUrls: string[];
  referenceUrls?: string[];
  media?: "image" | "video";
}) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt manquant");
  if (!input.resultUrls.length) throw new Error("Aucune image à sauver");
  const store = await load();
  const id = uid();
  const dir = path.join(ROOT, id);
  await mkdir(dir, { recursive: true });
  const resultFiles = await Promise.all(
    input.resultUrls.slice(0, 8).map((url, i) => saveBinary(dir, `result-${i}`, url))
  );
  /*
   * Les références sont accessoires : elles servent à rejouer une créa, pas à
   * la définir. Une seule qui échoue faisait rejeter tout l'enregistrement, et
   * l'image — déjà écrite, déjà facturée — restait orpheline sur le disque
   * pendant que la bibliothèque paraissait vide.
   */
  const refFiles = (
    await Promise.all(
      (input.referenceUrls || [])
        .slice(0, 8)
        .map((url, i) => saveBinary(dir, `ref-${i}`, url).catch(() => null))
    )
  ).filter((file): file is string => Boolean(file));
  const item: StaticCreative = {
    id,
    createdAt: new Date().toISOString(),
    brief: (input.brief || "").trim(),
    prompt,
    ratio: input.ratio || "3:4",
    resolution: input.resolution || "1K",
    resultFiles,
    refFiles,
    media: input.media ?? (resultFiles.some((file) => /\.(mp4|webm|mov)$/i.test(file)) ? "video" : "image"),
  };
  store.items.unshift(item);
  await persist();
  return item;
}

export async function deleteStaticCreative(id: string) {
  const store = await load();
  const next = store.items.filter((item) => item.id !== id);
  if (next.length === store.items.length) return false;
  store.items = next;
  await persist();
  await rm(path.join(ROOT, id), { recursive: true, force: true });
  return true;
}
