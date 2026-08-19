import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";
import type { StaticCreative } from "@/lib/studio/library-types";

export type { StaticCreative } from "@/lib/studio/library-types";

const ROOT = path.join(process.cwd(), ".msgate-cache", "studio-static");
const INDEX = path.join(ROOT, "index.json");

type Store = { items: StaticCreative[] };

const mem = ((globalThis as typeof globalThis & {
  __msgateStaticLibrary?: Store;
}).__msgateStaticLibrary ??= { items: [] });

let loaded = false;

function uid() {
  return `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isCreativeId(id: string) {
  return /^sc-[a-z0-9-]+$/.test(id);
}

export function isLibraryFile(name: string) {
  return /^(result|ref)-\d+\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function libraryFileUrl(id: string, file: string) {
  return `/api/studio/library/file?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`;
}

async function load(): Promise<Store> {
  if (loaded) return mem;
  try {
    const raw = await readFile(INDEX, "utf8");
    const parsed = JSON.parse(raw) as Store;
    mem.items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    mem.items = [];
  }
  loaded = true;
  return mem;
}

async function persist() {
  await mkdir(ROOT, { recursive: true });
  const tmp = `${INDEX}.tmp`;
  await writeFile(tmp, JSON.stringify({ items: mem.items }, null, 2));
  await rename(tmp, INDEX);
}

function allowedSource(url: string) {
  if (url.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      /(aiquickdraw|kie\.ai|redpandaai\.co|amazonaws\.com|cloudfront\.net|aliyuncs\.com|googleapis\.com)/i.test(
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
  return fallback;
}

async function saveBinary(dir: string, name: string, source: string) {
  if (source.startsWith("data:image/")) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(source);
    if (!match) throw new Error("Image data URL illisible");
    const file = `${name}.${extFrom(match[1], "png")}`;
    await writeFile(path.join(dir, file), Buffer.from(match[2], "base64"));
    return file;
  }
  if (!allowedSource(source)) throw new Error("URL image refusée");
  const res = await fetch(source, { cache: "no-store" });
  if (!res.ok) throw new Error("Téléchargement créa impossible");
  const file = `${name}.${extFrom(res.headers.get("content-type") || "", "png")}`;
  await writeFile(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
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
  const refFiles = await Promise.all(
    (input.referenceUrls || []).slice(0, 8).map((url, i) => saveBinary(dir, `ref-${i}`, url))
  );
  const item: StaticCreative = {
    id,
    createdAt: new Date().toISOString(),
    brief: (input.brief || "").trim(),
    prompt,
    ratio: input.ratio || "3:4",
    resolution: input.resolution || "1K",
    resultFiles,
    refFiles,
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
