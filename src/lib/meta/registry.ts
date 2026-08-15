import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";

/**
 * Remembers every ad account the cockpit has already seen, and optional tokens
 * pasted from the UI when the agency delivers a new Business Manager.
 *
 * Env tokens stay in `.env.local`; UI tokens live here so a restart does not
 * forget them and we never have to rewrite the env file from the browser.
 */

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "meta-registry.json");

export type KnownAccount = {
  accountId: string;
  name: string;
  business: string;
  firstSeenAt: string;
  /** Cleared once the operator clicks "vu" so the Nouveaux lane empties. */
  acknowledged: boolean;
};

export type StoredToken = {
  id: string;
  label: string;
  token: string;
  addedAt: string;
};

type Registry = {
  version: 1;
  accounts: Record<string, KnownAccount>;
  tokens: StoredToken[];
  /** When true, newly discovered accounts stay highlighted until acknowledged. */
  autoDetect: boolean;
};

const state = ((globalThis as typeof globalThis & {
  __msgateMetaRegistry?: { store: Registry | null };
}).__msgateMetaRegistry ??= { store: null });

function empty(): Registry {
  return { version: 1, accounts: {}, tokens: [], autoDetect: true };
}

async function load(): Promise<Registry> {
  if (state.store) return state.store;
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Registry;
    state.store = {
      version: 1,
      accounts: parsed?.accounts || {},
      tokens: Array.isArray(parsed?.tokens) ? parsed.tokens : [],
      autoDetect: parsed?.autoDetect !== false,
    };
  } catch {
    state.store = empty();
  }
  return state.store;
}

async function persist(store: Registry) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await rename(tmp, CACHE_FILE);
  } catch {
    // In-memory copy still serves this process.
  }
}

function tokenId(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export async function getExtraTokens() {
  const store = await load();
  return store.tokens.map((row) => row.token);
}

export async function listStoredTokens() {
  const store = await load();
  return store.tokens.map(({ id, label, addedAt, token }) => ({
    id,
    label,
    addedAt,
    /** Last 6 chars only — enough to recognise, never the full secret. */
    hint: token.slice(-6),
  }));
}

export async function addStoredToken(label: string, token: string) {
  const cleaned = token.trim();
  if (!cleaned || cleaned.length < 20) throw new Error("Token Meta invalide.");

  const store = await load();
  const id = tokenId(cleaned);
  if (store.tokens.some((row) => row.id === id)) {
    return { id, created: false };
  }

  store.tokens.push({
    id,
    label: label.trim() || `Agence ${store.tokens.length + 1}`,
    token: cleaned,
    addedAt: new Date().toISOString(),
  });
  await persist(store);
  return { id, created: true };
}

export async function removeStoredToken(id: string) {
  const store = await load();
  store.tokens = store.tokens.filter((row) => row.id !== id);
  await persist(store);
}

export async function getAutoDetect() {
  return (await load()).autoDetect;
}

export async function setAutoDetect(enabled: boolean) {
  const store = await load();
  store.autoDetect = enabled;
  await persist(store);
  return store.autoDetect;
}

/**
 * Diff the live discovery against the registry. First sync ever just seeds the
 * book — nothing is "new" yet. Later syncs flag anything that wasn't there.
 */
export async function rememberAccounts(
  accounts: Array<{ accountId: string; name: string; business: string }>
) {
  const store = await load();
  const wasEmpty = Object.keys(store.accounts).length === 0;
  const now = new Date().toISOString();
  const fresh: string[] = [];

  for (const account of accounts) {
    const known = store.accounts[account.accountId];
    if (!known) {
      store.accounts[account.accountId] = {
        accountId: account.accountId,
        name: account.name,
        business: account.business,
        firstSeenAt: now,
        acknowledged: wasEmpty || !store.autoDetect,
      };
      if (!wasEmpty && store.autoDetect) fresh.push(account.accountId);
    } else {
      known.name = account.name;
      known.business = account.business;
    }
  }

  await persist(store);
  return {
    fresh,
    unacknowledged: Object.values(store.accounts)
      .filter((row) => !row.acknowledged)
      .map((row) => row.accountId),
  };
}

export async function acknowledgeAccounts(ids?: string[]) {
  const store = await load();
  const targets = ids?.length ? new Set(ids) : null;
  for (const row of Object.values(store.accounts)) {
    if (!targets || targets.has(row.accountId)) row.acknowledged = true;
  }
  await persist(store);
}

export async function getUnacknowledgedIds() {
  const store = await load();
  return Object.values(store.accounts)
    .filter((row) => !row.acknowledged)
    .map((row) => row.accountId);
}
