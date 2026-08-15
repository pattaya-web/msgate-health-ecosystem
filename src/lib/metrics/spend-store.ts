import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

/**
 * Daily ad spend, entered by hand until the Meta Marketing API is wired.
 * Kept on disk so the numbers survive a dev-server restart, and shaped so an
 * API sync can later write into the same store.
 */

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ad-spend.json");

export type SpendSource = "manual" | "meta-api";

export type SpendEntry = {
  date: string;
  amount: number;
  source: SpendSource;
  updatedAt: string;
};

type SpendStore = { version: 1; entries: Record<string, SpendEntry> };

const state = ((globalThis as typeof globalThis & {
  __msgateSpend?: { store: SpendStore | null };
}).__msgateSpend ??= { store: null });

function empty(): SpendStore {
  return { version: 1, entries: {} };
}

async function load(): Promise<SpendStore> {
  if (state.store) return state.store;
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as SpendStore;
    state.store = parsed?.entries ? parsed : empty();
  } catch {
    state.store = empty();
  }
  return state.store;
}

async function persist(store: SpendStore) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await rename(tmp, CACHE_FILE);
  } catch {
    // Best-effort: the in-memory copy still serves the current process.
  }
}

export async function getSpendRange(start: string, end: string) {
  const store = await load();
  const out = new Map<string, SpendEntry>();
  for (const entry of Object.values(store.entries)) {
    if (entry.date >= start && entry.date <= end) out.set(entry.date, entry);
  }
  return out;
}

export async function setSpend(input: {
  date: string;
  amount: number;
  source?: SpendSource;
}): Promise<SpendEntry> {
  const store = await load();
  const entry: SpendEntry = {
    date: input.date,
    amount: Math.max(0, Number(input.amount) || 0),
    source: input.source || "manual",
    updatedAt: new Date().toISOString(),
  };
  store.entries[input.date] = entry;
  await persist(store);
  return entry;
}

export async function setSpendBulk(entries: Array<{ date: string; amount: number }>) {
  const store = await load();
  const now = new Date().toISOString();
  for (const item of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
    store.entries[item.date] = {
      date: item.date,
      amount: Math.max(0, Number(item.amount) || 0),
      source: "manual",
      updatedAt: now,
    };
  }
  await persist(store);
  return Object.keys(store.entries).length;
}
