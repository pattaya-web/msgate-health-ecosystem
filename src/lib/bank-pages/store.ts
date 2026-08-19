import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { defaultBankPage, type BankPage } from "@/lib/bank-pages/types";

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "bank-pages.json");

type Store = { pages: BankPage[] };

const mem = ((globalThis as typeof globalThis & {
  __msgateBankPages?: Store;
}).__msgateBankPages ??= { pages: [] });

let loaded = false;

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "page"
  );
}

function uid() {
  return `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function load(): Promise<Store> {
  if (loaded) return mem;
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    mem.pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  } catch {
    mem.pages = [];
  }
  loaded = true;
  return mem;
}

async function persist() {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify({ pages: mem.pages }, null, 2));
  await rename(tmp, CACHE_FILE);
}

export async function listBankPages() {
  const store = await load();
  return [...store.pages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBankPageBySlug(slug: string) {
  const store = await load();
  return store.pages.find((page) => page.slug === slug) || null;
}

export async function createBankPage(input: Partial<BankPage> & { brandName: string }) {
  const store = await load();
  const now = new Date().toISOString();
  const base = defaultBankPage();
  let slug = slugify(input.slug || input.brandName);
  const taken = new Set(store.pages.map((page) => page.slug));
  if (taken.has(slug)) slug = `${slug}-${uid().slice(-4)}`;
  const page: BankPage = {
    ...base,
    ...input,
    id: uid(),
    slug,
    createdAt: now,
    updatedAt: now,
    brandName: input.brandName.trim(),
  };
  store.pages.unshift(page);
  await persist();
  return page;
}

export async function updateBankPage(id: string, patch: Partial<BankPage>) {
  const store = await load();
  const page = store.pages.find((item) => item.id === id);
  if (!page) return null;
  Object.assign(page, patch, { updatedAt: new Date().toISOString(), id: page.id, slug: page.slug });
  await persist();
  return page;
}

export async function deleteBankPage(id: string) {
  const store = await load();
  const next = store.pages.filter((page) => page.id !== id);
  if (next.length === store.pages.length) return false;
  store.pages = next;
  await persist();
  return true;
}
