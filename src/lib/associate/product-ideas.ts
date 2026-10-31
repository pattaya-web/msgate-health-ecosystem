import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

/**
 * « Produits à lancer » : le tableau commun de Mady et Alison. Chaque ligne,
 * c'est un reel Instagram repéré et la page du produit à lancer. Les deux le
 * lisent et l'éditent ; l'auteur de chaque ligne est noté.
 */

export type ProductIdea = {
  id: string;
  reelUrl: string;
  productUrl: string;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
};

const FILE = path.join(process.cwd(), ".msgate-cache", "product-ideas.json");
const MAX_IDEAS = 2000;

const state = ((globalThis as typeof globalThis & { __msgateProductIdeas?: { ideas: ProductIdea[] | null; queue: Promise<unknown> } }).__msgateProductIdeas ??= {
  ideas: null,
  queue: Promise.resolve(),
});

/** Un lien http(s) propre, ou une chaîne vide ; « instagram.com/… » sans schéma est accepté. */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

export async function listIdeas(): Promise<ProductIdea[]> {
  if (state.ideas) return state.ideas;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as { ideas?: ProductIdea[] };
    state.ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  } catch {
    state.ideas = [];
  }
  return state.ideas;
}

async function persist(ideas: ProductIdea[]) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ ideas }, null, 2));
  await rename(tmp, FILE);
  state.ideas = ideas;
}

/** Les écritures passent une par une : deux personnes qui ajoutent en même temps ne s'écrasent pas. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = state.queue.then(task, task);
  state.queue = run.catch(() => undefined);
  return run;
}

export function addIdea(input: { reelUrl: string; productUrl: string }, author: string) {
  return serial(async () => {
    const now = new Date().toISOString();
    const idea: ProductIdea = { id: randomUUID(), reelUrl: input.reelUrl, productUrl: input.productUrl, addedBy: author, createdAt: now, updatedAt: now };
    await persist([idea, ...(await listIdeas())].slice(0, MAX_IDEAS));
    return idea;
  });
}

export function updateIdea(id: string, patch: { reelUrl?: string; productUrl?: string }) {
  return serial(async () => {
    const ideas = await listIdeas();
    if (!ideas.some((idea) => idea.id === id)) return false;
    await persist(ideas.map((idea) => (idea.id === id ? { ...idea, ...patch, updatedAt: new Date().toISOString() } : idea)));
    return true;
  });
}

export function deleteIdea(id: string) {
  return serial(async () => {
    const ideas = await listIdeas();
    const next = ideas.filter((idea) => idea.id !== id);
    if (next.length === ideas.length) return false;
    await persist(next);
    return true;
  });
}
