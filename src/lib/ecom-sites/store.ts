import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { defaultEcomSite, type EcomSite } from "@/lib/ecom-sites/types";

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ecom-sites.json");

type Store = { sites: EcomSite[] };

const mem = ((globalThis as typeof globalThis & {
  __msgateEcomSites?: Store;
}).__msgateEcomSites ??= { sites: [] });

let loaded = false;

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "site"
  );
}

function uid() {
  return `es-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function load(): Promise<Store> {
  if (loaded) return mem;
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    mem.sites = Array.isArray(parsed.sites) ? parsed.sites : [];
  } catch {
    mem.sites = [];
  }
  loaded = true;
  return mem;
}

async function persist() {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify({ sites: mem.sites }, null, 2));
  await rename(tmp, CACHE_FILE);
}

export async function listEcomSites() {
  const store = await load();
  return [...store.sites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getEcomSite(id: string) {
  const store = await load();
  return store.sites.find((site) => site.id === id) || null;
}

export async function getEcomSiteBySlug(slug: string) {
  const store = await load();
  return store.sites.find((site) => site.slug === slug) || null;
}

/** Une requête arrivant sur un domaine client est routée vers le bon site. */
export async function getEcomSiteByDomain(host: string) {
  const store = await load();
  const clean = host.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  return store.sites.find((site) => site.domain.toLowerCase().replace(/^www\./, "") === clean) || null;
}

export async function createEcomSite(input: Partial<EcomSite> & { brandName: string }) {
  const store = await load();
  const now = new Date().toISOString();
  let slug = slugify(input.slug || input.brandName);
  const taken = new Set(store.sites.map((site) => site.slug));
  if (taken.has(slug)) slug = `${slug}-${uid().slice(-4)}`;

  const site: EcomSite = {
    ...defaultEcomSite(),
    ...input,
    id: uid(),
    slug,
    createdAt: now,
    updatedAt: now,
    brandName: input.brandName.trim(),
  };
  store.sites.unshift(site);
  await persist();
  return site;
}

export async function updateEcomSite(id: string, patch: Partial<EcomSite>) {
  const store = await load();
  const site = store.sites.find((item) => item.id === id);
  if (!site) return null;
  Object.assign(site, patch, { updatedAt: new Date().toISOString(), id: site.id, slug: site.slug });
  await persist();
  return site;
}

/** Duplique un site pour en ouvrir un nouveau sans ressaisir la structure. */
export async function cloneEcomSite(id: string, brandName: string) {
  const source = await getEcomSite(id);
  if (!source) return null;
  const copy: Partial<EcomSite> = { ...source };
  // Le nouveau site prend sa propre identité : domaine et descripteur sont
  // repartis à vide plutôt que de dupliquer ceux d'une autre LLC.
  delete copy.id;
  delete copy.slug;
  delete copy.createdAt;
  delete copy.updatedAt;
  return createEcomSite({ ...copy, brandName, domain: "", billingDescriptor: "" });
}

export async function deleteEcomSite(id: string) {
  const store = await load();
  const next = store.sites.filter((site) => site.id !== id);
  if (next.length === store.sites.length) return false;
  store.sites = next;
  await persist();
  return true;
}
