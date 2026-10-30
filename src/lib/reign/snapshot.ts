import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  getReignConfig,
  listCustomers,
  listDisputes,
  listOrders,
  listStores,
  listSubscriptions,
  listTransactions,
  moneyToNumber,
  type ReignCustomer,
  type ReignDispute,
  type ReignOrder,
  type ReignStore,
  type ReignSubscription,
  type ReignTransaction,
} from "@/lib/reign/client";
import { focusIncludesToday, type PhoenixSnapshot, type SnapshotCustomer, type SnapshotTransaction } from "@/lib/phoenix/snapshot";
import type { SnapshotProgress } from "@/lib/phoenix/types";

/**
 * L'instantané Reign, dans la forme exacte de celui de Phoenix.
 *
 * L'écran Stats, ses calculs (analytics.ts, retention.ts) et ses onglets ne
 * connaissent qu'un instantané : des abonnés et des transactions, avec le
 * vocabulaire Phoenix (type « Direct », « Vip Initial », « Month 2 »,
 * « Month 2 Salvage », « Upsell » ; leg « Pre-Auth », « Capture », « Refund »…).
 * Ce module traduit Reign dans ce vocabulaire : ainsi un compte Reign se lit
 * sur le même tableau de bord, chiffre pour chiffre, sans toucher à l'écran.
 *
 * Reign expose des listes par plage de dates (92 jours au plus), donc la
 * synchronisation découpe l'historique en fenêtres : les fenêtres closes
 * depuis longtemps sont gardées 7 jours, la fenêtre courante est relue toutes
 * les 20 minutes quand l'écran regarde aujourd'hui, 2 heures sinon.
 */

const CACHE_DIR = path.join(process.cwd(), ".phoenix-cache");
const CACHE_FILE = path.join(CACHE_DIR, "reign-snapshot.json");
const STORE_VERSION = 1;
const WINDOW_DAYS = 92;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Window = {
  from: string;
  to: string;
  fetchedAt: string;
  transactions: SnapshotTransaction[];
  /** Les commandes de la fenêtre, résumées : elles servent à classer les transactions et à dater les annulations. */
  orders: OrderSummary[];
};

type OrderSummary = {
  id: string;
  customerId: string;
  cycle: number;
  subscription: boolean;
  upsell: boolean;
  recurringCanceledAt: string | null;
  createdAt: string;
};

type ReignStoreFile = {
  version: number;
  updatedAt: string;
  customersFetchedAt: string | null;
  stores: Record<string, string>;
  customers: SnapshotCustomer[];
  windows: Record<string, Window>;
};

type SyncState = { store: ReignStoreFile | null; inflight: Promise<void> | null; progress: SnapshotProgress };

const state: SyncState = ((globalThis as typeof globalThis & { __msgateReignSync?: SyncState }).__msgateReignSync ??= {
  store: null,
  inflight: null,
  progress: { running: false, phase: "idle", done: 0, total: 0, fetched: 0, cached: 0, etaMs: null },
});

function setProgress(patch: Partial<SnapshotProgress>) {
  state.progress = { ...state.progress, ...patch };
}

export function getProgress(): SnapshotProgress {
  return state.progress;
}

function todayNy() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Les fenêtres de 92 jours qui couvrent l'historique, de REIGN_HISTORY_FROM à aujourd'hui (New York). */
function windowsFor(historyFrom: string) {
  const today = todayNy();
  const result: Array<{ from: string; to: string }> = [];
  let from = historyFrom;
  while (from <= today) {
    const to = addDays(from, WINDOW_DAYS - 1) < today ? addDays(from, WINDOW_DAYS - 1) : today;
    result.push({ from, to });
    from = addDays(to, 1);
  }
  return result;
}

function emptyStore(): ReignStoreFile {
  return { version: STORE_VERSION, updatedAt: new Date().toISOString(), customersFetchedAt: null, stores: {}, customers: [], windows: {} };
}

async function persist(next: ReignStoreFile) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(next), "utf8");
    await rename(tmp, CACHE_FILE);
  } catch {
    // Le cache est un confort : la copie en mémoire sert quand même.
  }
}

async function loadStore(): Promise<ReignStoreFile> {
  if (state.store) return state.store;
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as ReignStoreFile;
    state.store = parsed?.version === STORE_VERSION && Array.isArray(parsed.customers) ? parsed : emptyStore();
  } catch {
    state.store = emptyStore();
  }
  return state.store;
}

/* ---------------------------------------------------------------- *
 * Traduction Reign → vocabulaire Phoenix
 * ---------------------------------------------------------------- */

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  salvage: "Active",
  paused: "Paused",
  canceled: "Canceled",
  never_approved: "Never Approved",
  never_enrolled: "Never Enrolled",
};

const LEG_LABEL: Record<string, string> = {
  direct_sale: "Direct Sale",
  direct_sale_no_vault: "Direct Sale",
  manual_decline: "Pre-Auth",
  pre_auth: "Pre-Auth",
  capture: "Capture",
  void: "Void",
  refund: "Refund",
  pre_auth_cancellation: "Pre-Auth Cancellation",
};

const ATTEMPT_TYPES = new Set(["direct_sale", "direct_sale_no_vault", "manual_decline", "pre_auth"]);

function summarizeOrder(order: ReignOrder): OrderSummary | null {
  if (!order.id || !order.customerId) return null;
  return {
    id: order.id,
    customerId: order.customerId,
    cycle: order.billingCycle ?? 0,
    subscription: Boolean(order.billingType),
    upsell: order.isUpsell === true,
    recurringCanceledAt: order.recurringCanceledAt,
    createdAt: order.createdAt ?? "",
  };
}

/**
 * Le « Type » Phoenix d'une tentative : Direct, Vip Initial, Month N, Month N
 * Salvage, Upsell. Reign ne le dit pas sur la transaction mais sur la
 * commande (cycle de facturation, upsell, type de facturation). Une relance
 * après un refus sur la même commande de renouvellement est un salvage.
 */
function phoenixType(tx: ReignTransaction, order: OrderSummary | undefined, retried: boolean) {
  if (!order) return tx.type.startsWith("direct_sale") ? "Direct" : "Month ?";
  if (order.upsell) return "Upsell";
  if (order.cycle >= 1) return retried ? `Month ${order.cycle + 1} Salvage` : `Month ${order.cycle + 1}`;
  return order.subscription ? "Vip Initial" : "Direct";
}

function translateTransactions(rows: ReignTransaction[], orders: Map<string, OrderSummary>, stores: Record<string, string>) {
  // Par commande, les tentatives dans l'ordre : une tentative qui suit un refus est une relance.
  const sorted = [...rows].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const failedBefore = new Set<string>();
  const result: SnapshotTransaction[] = [];
  for (const tx of sorted) {
    const order = tx.orderId ? orders.get(tx.orderId) : undefined;
    const customerId = tx.customerId ?? order?.customerId ?? "";
    if (!customerId) continue;
    const attempt = ATTEMPT_TYPES.has(tx.type);
    const retried = Boolean(attempt && tx.orderId && failedBefore.has(tx.orderId));
    const succeeded = tx.outcome === "succeeded";
    if (attempt && tx.orderId && !succeeded) failedBefore.add(tx.orderId);
    result.push({
      customerId,
      date: tx.createdAt ?? "",
      amount: moneyToNumber(tx.amount),
      type: attempt ? phoenixType(tx, order, retried) : "",
      leg: LEG_LABEL[tx.type] ?? tx.type,
      code: succeeded ? "100" : tx.outcome === "pending" ? "pending" : tx.responseCode || "declined",
      message: tx.responseMessage ?? (succeeded ? "SUCCESS" : tx.outcome ?? ""),
      orderId: tx.orderId,
      domain: (tx.storeId && stores[tx.storeId]) || tx.storeId || "",
      processor: "",
      processorId: "",
      merchant: tx.cardBrand ?? "",
      source: tx.cardFunding ?? "",
    });
  }
  return result;
}

/** Un litige de type chargeback devient une ligne « Chargeback », comme Phoenix les présente. */
function translateDisputes(rows: ReignDispute[], stores: Record<string, string>): SnapshotTransaction[] {
  return rows
    .filter((dispute) => /charge ?back/i.test(dispute.type ?? "") && dispute.customerId)
    .map((dispute) => ({
      customerId: dispute.customerId as string,
      date: dispute.receivedDate ?? dispute.orderedAt ?? "",
      amount: moneyToNumber(dispute.disputedAmount ?? dispute.orderTotal),
      type: "",
      leg: "Chargeback",
      code: "100",
      message: dispute.reason ?? dispute.status ?? "Chargeback",
      orderId: dispute.orderId,
      domain: (dispute.storeId && stores[dispute.storeId]) || dispute.storeId || "",
      processor: "",
      processorId: "",
      merchant: dispute.cardBrand ?? "",
      source: dispute.source ?? "",
    }));
}

function buildCustomers(customers: ReignCustomer[], subscriptions: ReignSubscription[], cancelledAt: Map<string, string>): SnapshotCustomer[] {
  const byCustomer = new Map<string, ReignSubscription>();
  for (const sub of subscriptions) {
    if (!sub.customerId) continue;
    const known = byCustomer.get(sub.customerId);
    // Plusieurs abonnements : le plus vivant l'emporte.
    const rank = (status: string | null) => (status === "active" || status === "salvage" ? 0 : status === "paused" ? 1 : 2);
    if (!known || rank(sub.status) < rank(known.status)) byCustomer.set(sub.customerId, sub);
  }
  return customers.map((customer) => {
    const sub = byCustomer.get(customer.id);
    const status = sub?.status ?? customer.subscriptionStatus ?? null;
    return {
      id: customer.id,
      status: (status && STATUS_LABEL[status]) || "Unknown",
      price: sub?.price ? moneyToNumber(sub.price) : null,
      enrolledAt: customer.enrolledAt,
      cancelledAt: cancelledAt.get(customer.id) ?? null,
      cancelledReason: customer.canceledReason,
      nextBillingAt: sub?.nextBillingAt ?? null,
      firstTxAt: customer.firstTransactionAt,
    };
  });
}

/* ---------------------------------------------------------------- *
 * Synchronisation
 * ---------------------------------------------------------------- */

function windowTtl(window: { to: string }, focus?: { start: string; end: string }) {
  const today = todayNy();
  if (window.to < addDays(today, -7)) return 7 * DAY;
  return focusIncludesToday(focus) ? 20 * MINUTE : 2 * HOUR;
}

function windowNeedsFetch(current: ReignStoreFile, window: { from: string; to: string }, focus?: { start: string; end: string }, force?: boolean) {
  const key = `${window.from}_${window.to}`;
  const known = current.windows[key];
  if (force || !known) return true;
  // Une fenêtre qui s'est allongée depuis (elle finissait « aujourd'hui ») doit être relue.
  if (known.to !== window.to) return true;
  return Date.now() - Date.parse(known.fetchedAt) > windowTtl(window, focus);
}

async function syncStoresAndCustomers(current: ReignStoreFile) {
  setProgress({ phase: "customers", done: 0, total: 0 });
  const stores = await listStores();
  current.stores = Object.fromEntries(stores.map((store: ReignStore) => [store.id, store.domain || store.name || store.id]));
  const customers = await listCustomers((rows) => setProgress({ done: state.progress.done + rows.length }));
  const subscriptions = await listSubscriptions();
  current.customers = buildCustomers(customers, subscriptions, cancellationDates(current));
  current.customersFetchedAt = new Date().toISOString();
}

/** La date d'annulation d'un abonné : celle de la commande initiale dont le renouvellement a été arrêté. */
function cancellationDates(current: ReignStoreFile) {
  const result = new Map<string, string>();
  for (const window of Object.values(current.windows)) {
    for (const order of window.orders) {
      if (!order.recurringCanceledAt) continue;
      const known = result.get(order.customerId);
      if (!known || order.recurringCanceledAt > known) result.set(order.customerId, order.recurringCanceledAt);
    }
  }
  return result;
}

async function syncWindows(current: ReignStoreFile, focus?: { start: string; end: string }, force?: boolean) {
  const config = getReignConfig()!;
  const all = windowsFor(config.historyFrom);
  // La fenêtre regardée d'abord, puis la plus récente, puis le reste.
  const queue = all
    .filter((window) => windowNeedsFetch(current, window, focus, force))
    .sort((a, b) => score(a) - score(b));
  function score(window: { from: string; to: string }) {
    if (focus && window.from <= focus.end && window.to >= focus.start) return 0;
    return 1 + (Date.parse(all[all.length - 1].from) - Date.parse(window.from)) / DAY;
  }
  setProgress({ phase: "transactions", done: 0, total: queue.length, fetched: 0, cached: all.length - queue.length, etaMs: null });
  const startedAt = Date.now();
  let done = 0;
  for (const window of queue) {
    const [orders, transactions, disputes] = await Promise.all([listOrders(window.from, window.to), listTransactions(window.from, window.to), listDisputes(window.from, window.to)]);
    const summaries = orders.map(summarizeOrder).filter((order): order is OrderSummary => order !== null);
    const orderMap = new Map<string, OrderSummary>();
    // Les commandes d'autres fenêtres aussi : un renouvellement peut payer une commande plus ancienne.
    for (const other of Object.values(current.windows)) for (const order of other.orders) orderMap.set(order.id, order);
    for (const order of summaries) orderMap.set(order.id, order);
    current.windows[`${window.from}_${window.to}`] = {
      from: window.from,
      to: window.to,
      fetchedAt: new Date().toISOString(),
      orders: summaries,
      transactions: [...translateTransactions(transactions, orderMap, current.stores), ...translateDisputes(disputes, current.stores)],
    };
    // Une fenêtre qui finissait « aujourd'hui » hier porte une autre clé : on la retire.
    for (const key of Object.keys(current.windows)) {
      const known = current.windows[key];
      if (known.from === window.from && known.to !== window.to) delete current.windows[key];
    }
    done += 1;
    const elapsed = Date.now() - startedAt;
    setProgress({ done, fetched: done, etaMs: Math.round((elapsed / done) * (queue.length - done)) });
    current.updatedAt = new Date().toISOString();
    await persist(current);
  }
  // Les annulations se lisent sur les commandes : on les reporte sur les abonnés une fois les fenêtres lues.
  const cancelled = cancellationDates(current);
  current.customers = current.customers.map((customer) => ({ ...customer, cancelledAt: cancelled.get(String(customer.id)) ?? customer.cancelledAt }));
}

export function startSync(options?: { focus?: { start: string; end: string }; force?: boolean }) {
  if (state.inflight) return state.inflight;
  state.progress = { running: true, phase: "customers", done: 0, total: 0, fetched: 0, cached: 0, etaMs: null, startedAt: new Date().toISOString() };
  state.inflight = (async () => {
    try {
      const current = await loadStore();
      const customersAge = current.customersFetchedAt ? Date.now() - Date.parse(current.customersFetchedAt) : Infinity;
      if (options?.force || customersAge > HOUR || current.customers.length === 0) {
        await syncStoresAndCustomers(current);
        await persist(current);
      }
      await syncWindows(current, options?.focus, options?.force);
      current.updatedAt = new Date().toISOString();
      await persist(current);
      setProgress({ running: false, phase: "done", etaMs: 0 });
    } catch (error) {
      setProgress({ running: false, phase: "error", error: error instanceof Error ? error.message : "Sync Reign échouée" });
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

function toSnapshot(current: ReignStoreFile): PhoenixSnapshot {
  const config = getReignConfig();
  const expected = config ? windowsFor(config.historyFrom) : [];
  const windows = Object.values(current.windows).sort((a, b) => a.from.localeCompare(b.from));
  const transactions = windows.flatMap((window) => window.transactions);
  const covered = expected.filter((window) => current.windows[`${window.from}_${window.to}`]).length;
  return {
    builtAt: current.updatedAt,
    durationMs: 0,
    customers: current.customers,
    transactions,
    coverage: expected.length ? covered / expected.length : 0,
    complete: expected.length > 0 && covered === expected.length && current.customers.length > 0,
  };
}

/** Ce que le cache contient (mémoire puis disque), sans appeler Reign. */
export async function peekSnapshot(): Promise<PhoenixSnapshot | null> {
  const current = await loadStore();
  if (!current.customersFetchedAt && !Object.keys(current.windows).length) return null;
  return toSnapshot(current);
}
