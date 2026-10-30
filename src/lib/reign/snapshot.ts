import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  getOrder,
  getReignConfig,
  listBillingTypes,
  listCustomerOrders,
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
import { toReportLocal } from "@/lib/report-tz";
import { fetchShopifySales, isShopifySalesConfigured, type ShopifySaleOrder } from "@/lib/shopify/sales-orders";
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
 *
 * La liste globale des commandes omet celles datées dans le futur — la
 * commande « VIP Initial » d'un abonnement est datée de son premier
 * prélèvement (J+14), et c'est elle qui porte la date d'annulation. On lit
 * donc en plus les commandes de chaque abonné (une liste par client, avec la
 * même durée de validité que Phoenix donnait à ses historiques).
 */

const CACHE_DIR = path.join(process.cwd(), ".phoenix-cache");
const CACHE_FILE = path.join(CACHE_DIR, "reign-snapshot.json");
const STORE_VERSION = 3;
const WINDOW_DAYS = 92;
/**
 * Reign date la première commande d'abonnement au jour où elle sera facturée
 * (14 jours après la vente, par exemple) : on lit donc les commandes un peu
 * au-delà d'aujourd'hui pour les connaître avant leur transaction.
 */
const LOOKAHEAD_DAYS = 45;

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
  /** Le reportingType du gabarit de facturation (Direct Sale, VIP Initial, Monthly Rebill…), ou le nom du gabarit. */
  billing: string;
  upsell: boolean;
  recurringCanceledAt: string | null;
  createdAt: string;
  /** Les articles de la commande (connus seulement par la lecture par client) : ils font le COGS. */
  lines?: Array<{ productId: string | null; name: string; quantity: number }>;
  /** Le numéro de la commande dans Shopify (« #V1298 ») : il relie la commande Reign à celle de la boutique. */
  shopifyName?: string | null;
};

type ReignStoreFile = {
  version: number;
  updatedAt: string;
  customersFetchedAt: string | null;
  stores: Record<string, string>;
  /** Nom de gabarit de facturation → reportingType. */
  billingTypes: Record<string, string>;
  customers: SnapshotCustomer[];
  /** Les commandes de chaque abonné, lues par client. */
  customerOrders: Record<string, { fetchedAt: string; orders: OrderSummary[] }>;
  /**
   * Les articles des commandes lues une à une : celles d'un client que Reign ne
   * renvoie pas encore (fiche client en cours de création). Une commande passée
   * ne change plus d'articles, on ne la relit donc jamais.
   */
  orderLines?: Record<string, NonNullable<OrderSummary["lines"]>>;
  /** Les commandes de la boutique Shopify (toutes passerelles), relues avec Reign. */
  shopify?: { fetchedAt: string; domain: string; orders: ShopifySaleOrder[]; error: string | null };
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

/** Les fenêtres de 92 jours qui couvrent l'historique, de REIGN_HISTORY_FROM à aujourd'hui (New York) plus l'avance. */
function windowsFor(historyFrom: string) {
  const last = addDays(todayNy(), LOOKAHEAD_DAYS);
  const result: Array<{ from: string; to: string }> = [];
  let from = historyFrom;
  while (from <= last) {
    const to = addDays(from, WINDOW_DAYS - 1) < last ? addDays(from, WINDOW_DAYS - 1) : last;
    result.push({ from, to });
    from = addDays(to, 1);
  }
  return result;
}

function emptyStore(): ReignStoreFile {
  return { version: STORE_VERSION, updatedAt: new Date().toISOString(), customersFetchedAt: null, stores: {}, billingTypes: {}, customers: [], customerOrders: {}, windows: {} };
}

async function persist(next: ReignStoreFile) {
  next.version = STORE_VERSION;
  next.customerOrders ??= {};
  next.orderLines ??= {};
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

function summarizeOrder(order: ReignOrder, billingTypes: Record<string, string>): OrderSummary | null {
  if (!order.id || !order.customerId) return null;
  const name = order.billingType ?? "";
  return {
    id: order.id,
    customerId: order.customerId,
    cycle: order.billingCycle ?? 0,
    billing: (name && billingTypes[name]) || name,
    upsell: order.isUpsell === true,
    recurringCanceledAt: order.recurringCanceledAt,
    createdAt: order.createdAt ?? "",
    shopifyName: order.shopifyOrderNumber,
    ...(order.lineItems
      ? { lines: order.lineItems.map((line) => ({ productId: line.productId, name: line.name ?? "", quantity: line.quantity || 0 })) }
      : {}),
  };
}

/**
 * Le « Type » Phoenix d'une tentative : Direct, Vip Initial, Month N, Month N
 * Salvage, Upsell. Reign ne le dit pas sur la transaction mais sur la
 * commande : son gabarit de facturation (reportingType « Direct Sale »,
 * « VIP Initial », « Monthly Rebill »), son cycle et son drapeau upsell. Chez
 * Reign une vente d'abonnement fait deux commandes : la vente directe du
 * jour, puis une commande « VIP Initial » datée du premier prélèvement. Une
 * relance après un refus sur la même commande de renouvellement est un salvage.
 */
function phoenixType(tx: ReignTransaction, order: OrderSummary | undefined, retried: boolean) {
  if (!order) return tx.type.startsWith("direct_sale") ? "Direct" : "Month ?";
  if (order.upsell) return "Upsell";
  const billing = order.billing.toLowerCase();
  const rebill = order.cycle >= 1 || /rebill|recurring/.test(billing);
  if (rebill) {
    const cycle = Math.max(order.cycle, 1) + 1;
    return retried ? `Month ${cycle} Salvage` : `Month ${cycle}`;
  }
  if (/initial|vip/.test(billing)) return "Vip Initial";
  return "Direct";
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

function buildCustomers(customers: ReignCustomer[], subscriptions: ReignSubscription[], cancelledAt: Map<string, string>, stores: Record<string, string> = {}): SnapshotCustomer[] {
  const domainOf = (sub?: ReignSubscription) => (sub?.storeId ? stores[sub.storeId] || sub.storeId : undefined);
  const byCustomer = new Map<string, ReignSubscription>();
  for (const sub of subscriptions) {
    if (!sub.customerId) continue;
    const known = byCustomer.get(sub.customerId);
    // Plusieurs abonnements : le plus vivant l'emporte.
    const rank = (status: string | null) => (status === "active" || status === "salvage" ? 0 : status === "paused" ? 1 : 2);
    if (!known || rank(sub.status) < rank(known.status)) byCustomer.set(sub.customerId, sub);
  }
  const result: SnapshotCustomer[] = customers.map((customer) => {
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
      domain: domainOf(sub),
    };
  });
  // Un abonné tout neuf apparaît d'abord dans /v1/subscriptions, sa fiche client arrive plus tard :
  // sans lui, l'outil affichait 2 abonnés quand Reign en comptait 4. Sa date d'entrée vient de ses
  // transactions (toSnapshot).
  const known = new Set(customers.map((customer) => customer.id));
  for (const [customerId, sub] of byCustomer) {
    if (known.has(customerId)) continue;
    result.push({
      id: customerId,
      status: (sub.status && STATUS_LABEL[sub.status]) || "Unknown",
      price: sub.price ? moneyToNumber(sub.price) : null,
      enrolledAt: null,
      cancelledAt: cancelledAt.get(customerId) ?? null,
      cancelledReason: null,
      nextBillingAt: sub.nextBillingAt ?? null,
      firstTxAt: null,
      domain: domainOf(sub),
    });
  }
  return result;
}

/** Les dates de l'instantané sont en heure de Paris, comme Shopify et Meta (src/lib/report-tz.ts). */
const nyLocal = toReportLocal;

/* ---------------------------------------------------------------- *
 * Synchronisation
 * ---------------------------------------------------------------- */

function windowTtl(window: { to: string }, focus?: { start: string; end: string }) {
  const today = todayNy();
  if (window.to < addDays(today, -7)) return 7 * DAY;
  // La fenêtre du jour est relue toutes les 2 minutes quand l'écran regarde aujourd'hui.
  return focusIncludesToday(focus) ? 2 * MINUTE : 30 * MINUTE;
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
  const billingTypes = await listBillingTypes();
  current.billingTypes = Object.fromEntries(billingTypes.map((type) => [type.name, (type.reportingType || type.type || type.name).trim()]));
  const customers = await listCustomers((rows) => setProgress({ done: state.progress.done + rows.length }));
  const subscriptions = await listSubscriptions();
  current.customers = buildCustomers(customers, subscriptions, cancellationDates(current), current.stores);
  current.customersFetchedAt = new Date().toISOString();
}

/** Toutes les commandes connues, des fenêtres et des abonnés, par identifiant. */
function allOrders(current: ReignStoreFile) {
  const map = new Map<string, OrderSummary>();
  for (const window of Object.values(current.windows)) for (const order of window.orders) map.set(order.id, order);
  for (const entry of Object.values(current.customerOrders ?? {})) for (const order of entry.orders) map.set(order.id, order);
  for (const [orderId, lines] of Object.entries(current.orderLines ?? {})) {
    const order = map.get(orderId);
    if (order && !order.lines?.length) map.set(orderId, { ...order, lines });
  }
  return map;
}

/**
 * Relit les commandes de la boutique Shopify : 2 minutes quand l'écran regarde
 * aujourd'hui, 30 sinon. Une panne Shopify n'arrête pas la synchro Reign.
 */
async function syncShopify(current: ReignStoreFile, focus?: { start: string; end: string }, force?: boolean) {
  if (!isShopifySalesConfigured()) {
    current.shopify = undefined;
    return;
  }
  const ttl = focusIncludesToday(focus) ? 2 * MINUTE : 30 * MINUTE;
  const fresh = current.shopify && !current.shopify.error && Date.now() - Date.parse(current.shopify.fetchedAt) < ttl;
  if (fresh && !force) return;
  const config = getReignConfig()!;
  try {
    const feed = await fetchShopifySales(config.historyFrom);
    current.shopify = { fetchedAt: new Date().toISOString(), domain: feed.domain, orders: feed.orders, error: null };
  } catch (error) {
    current.shopify = {
      fetchedAt: new Date().toISOString(),
      domain: current.shopify?.domain ?? "",
      orders: current.shopify?.orders ?? [],
      // Un message GraphQL se répète une fois par commande : on n'en garde que la première occurrence.
      error: (error instanceof Error ? error.message : "Shopify indisponible").split(" | ")[0].slice(0, 300),
    };
  }
}

const GATEWAY_LABEL: Record<string, string> = { shopify_payments: "Shopify Payments", paypal: "PayPal" };

/**
 * Les ventes de la boutique que Reign n'a pas facturées (Shopify Payments,
 * PayPal…), en transactions de vente directe, plus leurs remboursements. Une
 * commande déjà connue de Reign par son numéro, ou sans passerelle (payée par
 * le checkout Reign), n'est jamais ajoutée : pas de double compte.
 */
function shopifyOnlySales(current: ReignStoreFile, orders: Map<string, OrderSummary>) {
  const feed = current.shopify;
  if (!feed?.orders.length) return { transactions: [] as SnapshotTransaction[], summaries: [] as OrderSummary[] };
  const billedByReign = new Set<string>();
  for (const order of orders.values()) if (order.shopifyName) billedByReign.add(order.shopifyName);
  const transactions: SnapshotTransaction[] = [];
  const summaries: OrderSummary[] = [];
  for (const order of feed.orders) {
    if (billedByReign.has(order.name) || !order.gateways.length) continue;
    const orderId = `shopify:${order.name}`;
    const customerId = orderId;
    const processor = GATEWAY_LABEL[order.gateways[0]] ?? order.gateways[0];
    transactions.push({
      customerId,
      date: order.createdAt,
      amount: order.total,
      type: "Direct",
      leg: "Direct Sale",
      code: "100",
      message: "SUCCESS",
      orderId,
      domain: feed.domain,
      processor,
      processorId: "",
      merchant: "",
      source: "shopify",
    });
    for (const refund of order.refunds) {
      transactions.push({ customerId, date: refund.createdAt, amount: refund.amount, type: "", leg: "Refund", code: "100", message: "Refunded", orderId, domain: feed.domain, processor, processorId: "", merchant: "", source: "shopify" });
    }
    summaries.push({
      id: orderId,
      customerId,
      cycle: 0,
      billing: "Direct Sale",
      upsell: false,
      recurringCanceledAt: null,
      createdAt: order.createdAt,
      shopifyName: order.name,
      lines: order.lines.map((line) => ({ productId: null, name: line.title, quantity: line.quantity })),
    });
  }
  return { transactions, summaries };
}

/** Lit une à une les commandes qui n'ont toujours pas leurs articles (au plus 60 par synchro). */
async function syncMissingLines(current: ReignStoreFile) {
  current.orderLines ??= {};
  const missing = [...allOrders(current).values()].filter((order) => !order.lines?.length).slice(0, 60);
  for (const order of missing) {
    try {
      const full = await getOrder(order.id);
      const lines = (full.lineItems ?? []).map((line) => ({ productId: line.productId, name: line.name ?? "", quantity: line.quantity || 0 }));
      // Même vide, on la note : une commande sans article (frais d'abonnement) n'a pas à être relue.
      current.orderLines[order.id] = lines;
    } catch {
      // On réessaiera à la prochaine synchro.
    }
  }
}

/** La date d'annulation d'un abonné : celle de la commande initiale dont le renouvellement a été arrêté. */
function cancellationDates(current: ReignStoreFile) {
  const result = new Map<string, string>();
  for (const order of allOrders(current).values()) {
    if (!order.recurringCanceledAt) continue;
    const known = result.get(order.customerId);
    if (!known || order.recurringCanceledAt > known) result.set(order.customerId, order.recurringCanceledAt);
  }
  return result;
}

/** Combien de temps les commandes d'un abonné restent valables : un actif bouge chaque jour, un annulé plus guère. */
function customerOrdersTtl(customer: SnapshotCustomer, focus?: { start: string; end: string }) {
  const status = customer.status.toLowerCase();
  if (status === "active" || status === "paused") return focusIncludesToday(focus) ? HOUR : 6 * HOUR;
  if (status === "canceled") return 3 * DAY;
  return 7 * DAY;
}

/** Lit les commandes des abonnés dont la copie a expiré (une liste par client, 30 par minute au plus). */
async function syncCustomerOrders(current: ReignStoreFile, focus?: { start: string; end: string }, force?: boolean) {
  current.customerOrders ??= {};
  const now = Date.now();
  const queue = current.customers.filter((customer) => {
    if (!customer.enrolledAt && !customer.firstTxAt) return false;
    const entry = current.customerOrders[String(customer.id)];
    if (force || !entry) return true;
    return now - Date.parse(entry.fetchedAt) > customerOrdersTtl(customer, focus);
  });
  setProgress({ phase: "customers", done: 0, total: queue.length, cached: current.customers.length - queue.length });
  const startedAt = Date.now();
  let done = 0;
  for (const customer of queue) {
    try {
      const orders = await listCustomerOrders(String(customer.id));
      current.customerOrders[String(customer.id)] = {
        fetchedAt: new Date().toISOString(),
        orders: orders.map((order) => summarizeOrder(order, current.billingTypes ?? {})).filter((order): order is OrderSummary => order !== null),
      };
    } catch {
      // Fiche client pas encore créée chez Reign (404) : on note la tentative pour ne pas la rejouer à
      // chaque synchro ; ses articles viennent de la lecture commande par commande.
      current.customerOrders[String(customer.id)] ??= { fetchedAt: new Date().toISOString(), orders: [] };
    }
    done += 1;
    setProgress({ done, fetched: done, etaMs: Math.round(((Date.now() - startedAt) / done) * (queue.length - done)) });
    if (done % 20 === 0) await persist(current);
  }
  for (const key of Object.keys(current.customerOrders)) {
    if (!current.customers.some((customer) => String(customer.id) === key)) delete current.customerOrders[key];
  }
}

async function syncWindows(current: ReignStoreFile, focus?: { start: string; end: string }, force?: boolean) {
  const config = getReignConfig()!;
  const all = windowsFor(config.historyFrom);
  // Les fenêtres qui ne font plus partie de l'historique attendu (REIGN_HISTORY_FROM a changé) sont oubliées.
  const expectedKeys = new Set(all.map((window) => `${window.from}_${window.to}`));
  for (const key of Object.keys(current.windows)) {
    const known = current.windows[key];
    const stillExpected = expectedKeys.has(key) || all.some((window) => window.from === known.from);
    if (!stillExpected) delete current.windows[key];
  }
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
    const summaries = orders.map((order) => summarizeOrder(order, current.billingTypes ?? {})).filter((order): order is OrderSummary => order !== null);
    // Les commandes d'autres fenêtres et celles lues par abonné aussi : un renouvellement peut payer une commande plus ancienne.
    const orderMap = allOrders(current);
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
      // Abonnés et statuts : relus toutes les 2 minutes quand l'écran regarde aujourd'hui, 30 sinon.
      const customersTtl = focusIncludesToday(options?.focus) ? 2 * MINUTE : 30 * MINUTE;
      if (options?.force || customersAge > customersTtl || current.customers.length === 0) {
        await syncStoresAndCustomers(current);
        await persist(current);
      }
      await syncCustomerOrders(current, options?.focus, options?.force);
      await persist(current);
      await syncWindows(current, options?.focus, options?.force);
      await syncMissingLines(current);
      await syncShopify(current, options?.focus, options?.force);
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
  const shopifyOnly = shopifyOnlySales(current, allOrders(current));
  const transactions = [...windows.flatMap((window) => window.transactions), ...shopifyOnly.transactions].map((tx) => ({
    ...tx,
    date: nyLocal(tx.date) ?? tx.date,
    processor: tx.processor || "Reign",
  }));
  const covered = expected.filter((window) => current.windows[`${window.from}_${window.to}`]).length;
  const firstApproved = new Map<string, string>();
  for (const tx of transactions) {
    if (tx.code !== "100" || !tx.type) continue;
    const key = String(tx.customerId);
    const known = firstApproved.get(key);
    if (!known || tx.date < known) firstApproved.set(key, tx.date);
  }
  const customers = current.customers.map((customer) => {
    const subscribed = !/^never/i.test(customer.status) && customer.status !== "Unknown";
    const first = firstApproved.get(String(customer.id)) ?? null;
    return {
      ...customer,
      enrolledAt: nyLocal(customer.enrolledAt) ?? (subscribed ? first : null),
      firstTxAt: nyLocal(customer.firstTxAt) ?? first,
      cancelledAt: nyLocal(customer.cancelledAt),
      nextBillingAt: nyLocal(customer.nextBillingAt),
    };
  });
  return {
    builtAt: current.updatedAt,
    durationMs: 0,
    customers,
    transactions,
    coverage: expected.length ? covered / expected.length : 0,
    complete: expected.length > 0 && covered === expected.length && current.customers.length > 0,
  };
}

export type ReignOrderSummary = OrderSummary;

/** Toutes les commandes connues (avec leurs articles quand on les a), par identifiant, sans appeler Reign. */
export async function peekOrders(): Promise<Map<string, OrderSummary>> {
  const current = await loadStore();
  const orders = allOrders(current);
  for (const summary of shopifyOnlySales(current, orders).summaries) orders.set(summary.id, summary);
  return orders;
}

/** L'état du flux Shopify, pour l'afficher (boutique, fraîcheur, erreur). */
export async function peekShopifyFeed() {
  const current = await loadStore();
  if (!current.shopify) return null;
  return { domain: current.shopify.domain, fetchedAt: current.shopify.fetchedAt, orders: current.shopify.orders.length, error: current.shopify.error };
}

/** Ce que le cache contient (mémoire puis disque), sans appeler Reign. */
export async function peekSnapshot(): Promise<PhoenixSnapshot | null> {
  const current = await loadStore();
  if (!current.customersFetchedAt && !Object.keys(current.windows).length) return null;
  return toSnapshot(current);
}
