import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { getCustomers, getTransactionHistory } from "@/lib/phoenix/client";
import type {
  PhoenixCustomer,
  PhoenixTransaction,
  SnapshotProgress,
} from "@/lib/phoenix/types";

/**
 * Phoenix exposes no reporting endpoint, so the dashboard is rebuilt from
 * `/phxcrm/customers` plus one `/phxcrm/transaction-history` call per
 * subscriber. The partner API allows 100 requests per rolling minute, which
 * puts a full scan of the ~3.6k subscriber base at roughly 40 minutes.
 *
 * To stay usable the sync is therefore:
 *  - incremental — a subscriber's history is only re-fetched once its
 *    status-dependent TTL has expired;
 *  - resumable — partial results are flushed to disk as they arrive, so a
 *    restart never loses work and the dashboard can render partial data;
 *  - prioritised — subscribers likely to have activity in the focused date
 *    range are fetched first.
 */

const CACHE_DIR = path.join(process.cwd(), ".phoenix-cache");
const CACHE_FILE = path.join(CACHE_DIR, "snapshot.json");
const STORE_VERSION = 2;

const CUSTOMER_PAGE_SIZE = 500;
const TX_CONCURRENCY = 6;
const HISTORY_FROM = "2020-01-01T00:00:00.000Z";
const FLUSH_EVERY = 40;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

function todayNy() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** True when the focused window includes the current US calendar day. */
export function focusIncludesToday(focus?: { start: string; end: string }) {
  if (!focus?.start || !focus?.end) return false;
  const today = todayNy();
  return focus.start <= today && focus.end >= today;
}

export type SnapshotCustomer = {
  id: number;
  status: string;
  price: number | null;
  enrolledAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  nextBillingAt: string | null;
  firstTxAt: string | null;
};

export type SnapshotTransaction = {
  customerId: number;
  date: string;
  amount: number;
  type: string;
  leg: string;
  code: string;
  message: string;
  orderId: number | null;
  domain: string;
  processor: string;
  processorId: string;
  merchant: string;
  source: string;
};

type HistoryEntry = { fetchedAt: string; tx: SnapshotTransaction[] };

type SnapshotStore = {
  version: number;
  updatedAt: string;
  customersFetchedAt: string | null;
  customers: SnapshotCustomer[];
  history: Record<string, HistoryEntry>;
};

export type PhoenixSnapshot = {
  builtAt: string;
  durationMs: number;
  customers: SnapshotCustomer[];
  transactions: SnapshotTransaction[];
  coverage: number;
  complete: boolean;
};

type SyncState = {
  store: SnapshotStore | null;
  inflight: Promise<void> | null;
  progress: SnapshotProgress;
};

// Held on globalThis: dev hot-reloads re-evaluate this module, and a running
// sync must not be forgotten (or restarted) when that happens.
const state: SyncState = ((globalThis as typeof globalThis & {
  __msgatePhoenixSync?: SyncState;
}).__msgatePhoenixSync ??= {
  store: null,
  inflight: null,
  progress: {
    running: false,
    phase: "idle",
    done: 0,
    total: 0,
    fetched: 0,
    cached: 0,
    etaMs: null,
  },
});

function setProgress(patch: Partial<SnapshotProgress>) {
  state.progress = { ...state.progress, ...patch };
}

export function getProgress(): SnapshotProgress {
  return state.progress;
}

function emptyStore(): SnapshotStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    customersFetchedAt: null,
    customers: [],
    history: {},
  };
}

function trimCustomer(c: PhoenixCustomer): SnapshotCustomer {
  return {
    id: c.CustomerId,
    status: c.SubscriptionStatus || "Unknown",
    price: typeof c.SubscriptionPrice === "number" ? c.SubscriptionPrice : null,
    enrolledAt: c.EnrollmentDate || null,
    cancelledAt: c.CancelledSubscriptionDate || null,
    cancelledReason: c.CancelledReason || null,
    nextBillingAt: c.NextBillingDate || null,
    firstTxAt: c.OriginalTransactionDate || null,
  };
}

function trimTransaction(customerId: number, tx: PhoenixTransaction): SnapshotTransaction {
  return {
    customerId,
    date: tx.Date || tx.TimeStart || "",
    amount: Number(tx.Amount) || 0,
    type: tx.Type || "",
    leg: tx.TransactionType || "",
    code: tx.ResponseCode || "",
    message: tx.ResponseMessage || "",
    orderId: tx.OrderId ?? null,
    domain: tx.Domain || "",
    processor: tx.AcquiringBank || "",
    processorId: tx.ProcessorId || "",
    merchant: tx.MerchantAccount || "",
    source: tx.TransactionSource || "",
  };
}

/**
 * How long a cached history stays valid. Cancelled and never-approved accounts
 * rarely move again; active subscribers bill (or retry) daily — and when the
 * dashboard is looking at *today* (NY), we must re-pull them often or
 * recurrings that already cleared on Phoenix CRM stay invisible here.
 */
function historyTtl(customer: SnapshotCustomer, focus?: { start: string; end: string }) {
  const status = customer.status.toLowerCase();
  if (status === "active") {
    return focusIncludesToday(focus) ? 20 * MINUTE : 6 * HOUR;
  }
  if (status === "canceled" || status === "cancelled") return 3 * DAY;
  return 7 * DAY;
}

function needsFetch(
  customer: SnapshotCustomer,
  entry: HistoryEntry | undefined,
  now: number,
  focus?: { start: string; end: string },
  force?: boolean
) {
  if (force) return true;
  if (!entry) return true;
  const fetchedAt = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetchedAt)) return true;
  return now - fetchedAt > historyTtl(customer, focus);
}

function anchorDate(customer: SnapshotCustomer) {
  return (customer.enrolledAt || customer.firstTxAt || "").slice(0, 10);
}

/** Subscribers most likely to have activity in the focused range go first. */
function prioritise(customers: SnapshotCustomer[], focus?: { start: string; end: string }) {
  if (!focus) return customers;
  const score = (c: SnapshotCustomer) => {
    const anchor = anchorDate(c);
    const status = c.status.toLowerCase();
    const nextBill = (c.nextBillingAt || "").slice(0, 10);
    // Due-to-bill today → recurrings land in the dashboard before we crawl everyone else.
    if (nextBill && nextBill >= focus.start && nextBill <= focus.end) return 0;
    if (anchor && anchor >= focus.start && anchor <= focus.end) return 1;
    if (status === "active") return 2;
    const cancelled = (c.cancelledAt || "").slice(0, 10);
    if (cancelled && cancelled >= focus.start) return 3;
    if (anchor && anchor < focus.start) return 4;
    return 5;
  };
  return [...customers].sort((a, b) => score(a) - score(b));
}

async function persist(next: SnapshotStore) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(next), "utf8");
    await rename(tmp, CACHE_FILE);
  } catch {
    // Cache is best-effort; the in-memory copy still serves requests.
  }
}

async function readFromDisk(): Promise<SnapshotStore | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as SnapshotStore;
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.customers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadStore(): Promise<SnapshotStore> {
  if (!state.store) state.store = (await readFromDisk()) ?? emptyStore();
  return state.store;
}

function toSnapshot(current: SnapshotStore): PhoenixSnapshot {
  const transactions: SnapshotTransaction[] = [];
  let covered = 0;
  for (const customer of current.customers) {
    const entry = current.history[String(customer.id)];
    if (!entry) continue;
    covered += 1;
    transactions.push(...entry.tx);
  }
  const total = current.customers.length;
  return {
    builtAt: current.updatedAt,
    durationMs: 0,
    customers: current.customers,
    transactions,
    coverage: total > 0 ? covered / total : 0,
    complete: total > 0 && covered === total,
  };
}

async function syncCustomers(current: SnapshotStore) {
  setProgress({ phase: "customers", done: 0, total: 0 });

  const first = await getCustomers({ page: 1, limit: CUSTOMER_PAGE_SIZE, rateClass: "bulk" });
  const total = first.TotalCount || first.Result?.length || 0;
  const pages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const rows = [...(first.Result || [])];
  setProgress({ done: rows.length, total });

  for (let page = 2; page <= pages; page++) {
    const res = await getCustomers({ page, limit: CUSTOMER_PAGE_SIZE, rateClass: "bulk" });
    const batch = res.Result || [];
    if (!batch.length) break;
    rows.push(...batch);
    setProgress({ done: rows.length, total });
  }

  const seen = new Set<number>();
  const customers: SnapshotCustomer[] = [];
  for (const row of rows) {
    if (!row?.CustomerId || seen.has(row.CustomerId)) continue;
    seen.add(row.CustomerId);
    customers.push(trimCustomer(row));
  }

  current.customers = customers;
  current.customersFetchedAt = new Date().toISOString();
  current.updatedAt = new Date().toISOString();

  // Drop history for subscribers that no longer exist.
  for (const key of Object.keys(current.history)) {
    if (!seen.has(Number(key))) delete current.history[key];
  }
}

async function syncHistories(
  current: SnapshotStore,
  focus?: { start: string; end: string },
  force?: boolean
) {
  const now = Date.now();
  const queue = prioritise(current.customers, focus).filter((c) =>
    needsFetch(c, current.history[String(c.id)], now, focus, force)
  );

  const cachedCount = current.customers.length - queue.length;
  setProgress({
    phase: "transactions",
    done: 0,
    total: queue.length,
    fetched: 0,
    cached: cachedCount,
    etaMs: null,
  });

  if (!queue.length) return;

  const startedAt = Date.now();
  let cursor = 0;
  let done = 0;
  let sinceFlush = 0;

  async function worker() {
    while (cursor < queue.length) {
      const customer = queue[cursor++];
      try {
        const res = await getTransactionHistory({
          customerId: customer.id,
          startDateTime: HISTORY_FROM,
          rateClass: "bulk",
        });
        current.history[String(customer.id)] = {
          fetchedAt: new Date().toISOString(),
          tx: (res.Result || []).map((tx) => trimTransaction(customer.id, tx)),
        };
      } catch {
        // Leave any previous entry in place and retry on the next sync.
      }

      done += 1;
      sinceFlush += 1;
      const elapsed = Date.now() - startedAt;
      setProgress({
        done,
        fetched: done,
        etaMs: done > 0 ? Math.round((elapsed / done) * (queue.length - done)) : null,
      });

      if (sinceFlush >= FLUSH_EVERY) {
        sinceFlush = 0;
        current.updatedAt = new Date().toISOString();
        await persist(current);
      }
    }
  }

  await Promise.all(Array.from({ length: TX_CONCURRENCY }, worker));
  current.updatedAt = new Date().toISOString();
}

export function startSync(options?: { focus?: { start: string; end: string }; force?: boolean }) {
  if (state.inflight) return state.inflight;

  state.progress = {
    running: true,
    phase: "customers",
    done: 0,
    total: 0,
    fetched: 0,
    cached: 0,
    etaMs: null,
    startedAt: new Date().toISOString(),
  };

  state.inflight = (async () => {
    try {
      const current = await loadStore();
      const customersAge = current.customersFetchedAt
        ? Date.now() - Date.parse(current.customersFetchedAt)
        : Infinity;
      if (options?.force || customersAge > HOUR || current.customers.length === 0) {
        await syncCustomers(current);
        await persist(current);
      }
      await syncHistories(current, options?.focus, options?.force);
      await persist(current);
      setProgress({ running: false, phase: "done", etaMs: 0 });
    } catch (error) {
      setProgress({
        running: false,
        phase: "error",
        error: error instanceof Error ? error.message : "Sync failed",
      });
    } finally {
      state.inflight = null;
    }
  })();

  return state.inflight;
}

/** Returns whatever is cached (memory, then disk) without calling Phoenix. */
export async function peekSnapshot(): Promise<PhoenixSnapshot | null> {
  const current = await loadStore();
  if (!current.customers.length) return null;
  return toSnapshot(current);
}

export function isStale(snapshot: PhoenixSnapshot, maxAgeMs = 6 * HOUR) {
  return Date.now() - new Date(snapshot.builtAt).getTime() > maxAgeMs;
}
