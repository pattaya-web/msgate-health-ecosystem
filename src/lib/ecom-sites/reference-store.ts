import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { normalizeDomain } from "@/lib/ecom-sites/reference";

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ecom-references.json");

export type ReferenceSite = {
  domain: string;
  label: string;
  addedAt: string;
  /** Renseigné après la première lecture, pour afficher la taille du catalogue. */
  productCount: number | null;
  lastReadAt: string | null;
};

/** Les modèles de départ : les boutiques déjà en ligne. */
const SEED = [
  "upskinrenew.com",
  "skin-glowcollagen.com",
  "aihaloskin.com",
  "glow-va.com",
  "blast-glow.com",
  "blast-skin.com",
  "collagenblast.com",
  "shopopalite.com",
];

type Store = { references: ReferenceSite[] };

const mem = ((globalThis as typeof globalThis & {
  __msgateEcomRefs?: Store;
}).__msgateEcomRefs ??= { references: [] });

let loaded = false;

function labelOf(domain: string) {
  const name = domain.replace(/\.[a-z.]+$/, "").replace(/[-_]/g, " ");
  return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function make(domain: string): ReferenceSite {
  return { domain, label: labelOf(domain), addedAt: new Date().toISOString(), productCount: null, lastReadAt: null };
}

async function load(): Promise<Store> {
  if (loaded) return mem;
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Store;
    mem.references = Array.isArray(parsed.references) ? parsed.references : [];
  } catch {
    // Premier démarrage : on part des boutiques déjà en ligne.
    mem.references = SEED.map(make);
  }
  loaded = true;
  return mem;
}

async function persist() {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify({ references: mem.references }, null, 2));
  await rename(tmp, CACHE_FILE);
}

export async function listReferences() {
  const store = await load();
  return [...store.references].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export async function addReference(input: string) {
  const domain = normalizeDomain(input);
  if (!domain) throw new Error("Domaine invalide");
  const store = await load();
  if (store.references.some((reference) => reference.domain === domain)) {
    throw new Error("Ce modèle est déjà dans la liste");
  }
  const reference = make(domain);
  store.references.push(reference);
  await persist();
  return reference;
}

export async function removeReference(domain: string) {
  const store = await load();
  const next = store.references.filter((reference) => reference.domain !== domain);
  if (next.length === store.references.length) return false;
  store.references = next;
  await persist();
  return true;
}

export async function noteReferenceRead(domain: string, productCount: number) {
  const store = await load();
  const reference = store.references.find((item) => item.domain === domain);
  if (!reference) return;
  reference.productCount = productCount;
  reference.lastReadAt = new Date().toISOString();
  await persist();
}
