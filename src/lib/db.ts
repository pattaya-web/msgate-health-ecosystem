import fs from "node:fs";
import path from "node:path";
import type { CollectionName, DB, Settings } from "./types";

/*
 * Persistance du Studio IA : un fichier JSON, data/db.json, avec la même
 * API que celle de princexd (getSettings, getApiKey, list / insert / update /
 * remove…) pour que le code du Studio soit repris tel quel. Seuls les
 * réglages et les collections du Studio existent ici.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

export const DEFAULT_SETTINGS: Settings = {
  kieApiKey: "",
  kieTextModel: "gemini-3-pro",
  creditUsdRate: 0.005,
  usdToEur: 0.92,
  openaiApiKey: "",
  transcribeModel: "gpt-4o-mini-transcribe",
  elevenLabsApiKey: "",
  higgsfieldKeyId: "",
  higgsfieldKeySecret: "",
  brandContext: "",
};

const EMPTY_DB: DB = {
  settings: DEFAULT_SETTINGS,
  generations: [],
  studioJobs: [],
  studioCharacters: [],
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), "utf8");
}

/*
 * Cache mémoire de la base, partagé entre les modules via globalThis (Next
 * recharge les modules à chaud en dev). Le fichier n'est relu que si
 * quelqu'un d'autre l'a modifié (mtime) ; les écritures sont regroupées et
 * atomiques. Repris de princexd.
 */
interface Cache {
  db: DB | null;
  mtimeMs: number;
  flush: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
  hooked: boolean;
}
const g = globalThis as unknown as { __msgateStudioIaDb?: Cache };
const cache: Cache = (g.__msgateStudioIaDb ??= { db: null, mtimeMs: 0, flush: null, dirty: false, hooked: false });

function parseFile(): DB {
  let parsed: Partial<DB> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Partial<DB>;
  } catch {
    // Fichier corrompu : on repart d'une base vide plutôt que de planter.
    parsed = {};
  }
  // Fusion avec la structure par défaut : une collection ajoutée au code ne casse pas une base existante.
  return {
    ...EMPTY_DB,
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
  };
}

export function readDB(): DB {
  ensureFile();
  // Tant qu'une écriture est en attente, la mémoire fait foi.
  if (cache.db && cache.dirty) return cache.db;
  const mtimeMs = fs.statSync(DB_PATH).mtimeMs;
  if (!cache.db || mtimeMs !== cache.mtimeMs) {
    cache.db = parseFile();
    cache.mtimeMs = mtimeMs;
  }
  const db = cache.db as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(EMPTY_DB)) {
    if (db[k] === undefined) db[k] = Array.isArray(v) ? [] : v;
  }
  return cache.db;
}

function flushNow() {
  if (cache.flush) {
    clearTimeout(cache.flush);
    cache.flush = null;
  }
  if (!cache.dirty || !cache.db) return;
  ensureFile();
  // Écriture atomique : fichier temporaire puis rename, pour ne jamais laisser un db.json tronqué.
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache.db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
  cache.dirty = false;
  cache.mtimeMs = fs.statSync(DB_PATH).mtimeMs;
}

export function writeDB(db: DB) {
  cache.db = db;
  cache.dirty = true;
  if (!cache.flush) cache.flush = setTimeout(flushNow, 40);
}

// Rien ne doit rester en mémoire si le process s'arrête entre deux flushs.
if (!cache.hooked) {
  cache.hooked = true;
  process.on("exit", flushNow);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      flushNow();
      process.exit(0);
    });
  }
}

export function getSettings(): Settings {
  return readDB().settings;
}

/** Clé KIE effective : la variable d'env gagne sur celle saisie dans la base. */
export function getApiKey(): string {
  return process.env.KIE_API_KEY?.trim() || getSettings().kieApiKey.trim();
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function list<K extends CollectionName>(name: K): DB[K] {
  return readDB()[name];
}

export function insert<K extends CollectionName>(name: K, item: Record<string, unknown>) {
  const db = readDB();
  const row = { ...item, id: newId(), createdAt: new Date().toISOString() };
  (db[name] as unknown[]).unshift(row);
  writeDB(db);
  return row;
}

export function update<K extends CollectionName>(name: K, id: string, patch: Record<string, unknown>) {
  const db = readDB();
  const arr = db[name] as unknown as Record<string, unknown>[];
  const i = arr.findIndex((r) => r.id === id);
  if (i === -1) return null;
  arr[i] = { ...arr[i], ...patch, id };
  writeDB(db);
  return arr[i];
}

export function remove<K extends CollectionName>(name: K, id: string) {
  return removeMany(name, [id]);
}

/** Suppression groupée, en une seule écriture. */
export function removeMany<K extends CollectionName>(name: K, ids: string[]) {
  const doomed = new Set(ids);
  if (!doomed.size) return { ok: true, removed: 0 };
  const db = readDB();
  const arr = db[name] as unknown as Record<string, unknown>[];
  const next = arr.filter((r) => !doomed.has(String(r.id)));
  const removed = arr.length - next.length;
  (db[name] as unknown) = next;
  writeDB(db);
  return { ok: true, removed };
}

export function saveSettings(patch: Partial<Settings>) {
  const db = readDB();
  db.settings = { ...db.settings, ...patch };
  writeDB(db);
  return db.settings;
}
