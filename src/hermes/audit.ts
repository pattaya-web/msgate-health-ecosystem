import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { persistJson, readMirror } from "@/lib/storage";

/**
 * Le journal des appels Hermes.
 *
 * Une ligne par appel : quand, quel outil, réussi ou non, combien de temps,
 * et la taille de la réponse. Jamais la clé, jamais la charge utile : on veut
 * savoir ce que l'agent a demandé et si ça a marché, pas relire ses données.
 * Même mécanique que les autres stores : fichier local, copie Supabase.
 */
const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "hermes-audit.json");
const MAX_ENTRIES = 1000;

export type AuditEntry = {
  at: string;
  requestId: string;
  tool: string;
  ok: boolean;
  durationMs: number;
  /** Taille du JSON rendu, en octets ; 0 en cas d'échec. */
  bytes: number;
  /** Code d'erreur court, jamais un message contenant des données. */
  error?: string;
};

type Store = { entries: AuditEntry[] };

const mem = ((globalThis as typeof globalThis & { __msgateHermesAudit?: Store & { loaded: boolean } }).__msgateHermesAudit ??= { entries: [], loaded: false });

async function load() {
  if (mem.loaded) return mem;
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Store;
    mem.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      const remote = await readMirror(CACHE_FILE);
      try {
        const parsed = remote ? (JSON.parse(remote) as Store) : null;
        mem.entries = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
      } catch {
        mem.entries = [];
      }
    }
  }
  mem.loaded = true;
  return mem;
}

export async function appendAudit(entry: AuditEntry) {
  const store = await load();
  store.entries.unshift(entry);
  if (store.entries.length > MAX_ENTRIES) store.entries.length = MAX_ENTRIES;
  const payload = JSON.stringify({ entries: store.entries }, null, 2);
  try {
    await persistJson(CACHE_FILE, payload, async () => {
      await mkdir(CACHE_DIR, { recursive: true });
      const tmp = `${CACHE_FILE}.${process.pid}.${Date.now().toString(36)}.tmp`;
      await writeFile(tmp, payload);
      await rename(tmp, CACHE_FILE);
    });
  } catch {
    // Un journal qui n'a pas pu s'écrire ne doit pas faire échouer l'appel.
  }
}

export async function listAudit(limit = 100) {
  const store = await load();
  return store.entries.slice(0, limit);
}
