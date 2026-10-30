/**
 * Le client Reign (https://docs.reign.com), successeur de Phoenix (phxcrm).
 *
 * Une clé par marchand, envoyée en bearer ; les montants sont en centimes avec
 * leur devise ; les listes se parcourent avec nextPageToken ; les dates sont
 * des jours calendaires New York et une fenêtre de liste tient 92 jours au
 * plus. Les limites : 120 appels par minute par clé, dont 30 appels de liste.
 * On espace donc les listes à ~2,2 s et on respecte Retry-After sur un 429.
 */

export type ReignConfig = {
  baseUrl: string;
  apiKey: string;
  clientLabel: string;
  /** Boutiques à retenir (sto_…) ; vide = toutes celles que la clé voit. */
  storeIds: string[];
  /** Premier jour d'historique à charger, YYYY-MM-DD. */
  historyFrom: string;
};

export type ReignMoney = { amount: number; currency: string };

export type ReignStore = { object: "store"; id: string; name: string | null; domain: string | null };

export type ReignCustomer = {
  object: "customer";
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enrolledAt: string | null;
  firstTransactionAt: string | null;
  canceledReason: string | null;
  subscriptionStatus: "never_enrolled" | "active" | "paused" | "canceled" | "never_approved" | null;
};

export type ReignSubscription = {
  object: "subscription";
  id: string | null;
  customerId: string | null;
  storeId: string | null;
  status: "active" | "paused" | "salvage" | "canceled" | "never_enrolled" | "never_approved" | null;
  price: ReignMoney | null;
  nextBillingAt: string | null;
  billingCycle: number | null;
  productNames: string | null;
};

export type ReignOrder = {
  object: "order";
  id: string;
  customerId: string | null;
  storeId: string | null;
  createdAt: string | null;
  billingCycle: number | null;
  billingType: string | null;
  isUpsell: boolean | null;
  recurringCanceledAt: string | null;
  chargedBack: boolean;
  shopifyOrderNumber: string | null;
  total: ReignMoney | null;
  refundedAmount: ReignMoney | null;
  voidedAmount: ReignMoney | null;
};

export type ReignTransactionType =
  | "direct_sale"
  | "direct_sale_no_vault"
  | "manual_decline"
  | "pre_auth"
  | "capture"
  | "void"
  | "refund"
  | "pre_auth_cancellation";

export type ReignTransaction = {
  object: "transaction";
  id: string;
  customerId: string | null;
  orderId: string | null;
  parentOrderId: string | null;
  storeId: string | null;
  createdAt: string | null;
  type: ReignTransactionType;
  outcome: "succeeded" | "failed" | "pending" | null;
  responseCode: string | null;
  responseMessage: string | null;
  amount: ReignMoney | null;
  cardBrand: string | null;
  cardFunding: string | null;
};

export type ReignDispute = {
  object: "dispute";
  id: string;
  customerId: string | null;
  orderId: string | null;
  storeId: string | null;
  type: string | null;
  status: string | null;
  source: string | null;
  receivedDate: string | null;
  orderedAt: string | null;
  disputedAmount: ReignMoney | null;
  orderTotal: ReignMoney | null;
  reason: string | null;
  cardBrand: string | null;
};

export type ReignDashboardSales = {
  from: string;
  to: string;
  total: ReignMoney;
  directSale: ReignMoney;
  initialSubscription: ReignMoney;
  recurringSubscription: ReignMoney;
  salvage: ReignMoney;
  upsell: ReignMoney;
};

export type ReignMe = { id: string; name: string; scopes: string[]; rateTier: string; mode: "live" | "test" };

type ListResponse<T> = { object: "list"; data: T[]; nextPageToken?: string; totalCount?: number };

export function getReignConfig(): ReignConfig | null {
  const apiKey = process.env.REIGN_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.REIGN_BASE_URL?.trim() || (apiKey.startsWith("reign_test_") ? "https://api.reign-sandbox.com" : "https://api.reign.com")).replace(/\/$/, "");
  const historyFrom = /^\d{4}-\d{2}-\d{2}$/.test(process.env.REIGN_HISTORY_FROM ?? "") ? (process.env.REIGN_HISTORY_FROM as string) : "2026-01-01";
  return {
    baseUrl,
    apiKey,
    clientLabel: process.env.REIGN_CLIENT_LABEL?.trim() || "Reign",
    storeIds: (process.env.REIGN_STORE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    historyFrom,
  };
}

export function isReignConfigured() {
  return Boolean(getReignConfig());
}

/* ---------------------------------------------------------------- *
 * Cadence
 * ---------------------------------------------------------------- */

const LIST_INTERVAL_MS = 2_200;
const OTHER_INTERVAL_MS = 600;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 110;

const rateState = ((globalThis as typeof globalThis & {
  __msgateReignRate?: { calls: number[]; nextListAt: number; nextOtherAt: number; throttled: number };
}).__msgateReignRate ??= { calls: [], nextListAt: 0, nextOtherAt: 0, throttled: 0 });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireSlot(kind: "list" | "other") {
  for (;;) {
    const now = Date.now();
    rateState.calls = rateState.calls.filter((t) => now - t < RATE_WINDOW_MS);
    if (rateState.calls.length >= RATE_MAX) {
      await sleep(Math.min(Math.max(RATE_WINDOW_MS - (now - rateState.calls[0]) + 50, 100), 5_000));
      continue;
    }
    const key = kind === "list" ? "nextListAt" : "nextOtherAt";
    const slot = Math.max(now, rateState[key]);
    rateState[key] = slot + (kind === "list" ? LIST_INTERVAL_MS : OTHER_INTERVAL_MS);
    rateState.calls.push(slot);
    if (slot > now) await sleep(slot - now);
    return;
  }
}

export function getReignRateBudget() {
  const now = Date.now();
  rateState.calls = rateState.calls.filter((t) => now - t < RATE_WINDOW_MS);
  return { used: rateState.calls.length, max: RATE_MAX, windowMs: RATE_WINDOW_MS, throttled: rateState.throttled };
}

type Query = Record<string, string | number | undefined>;

async function reignFetch<T>(path: string, query?: Query, kind: "list" | "other" = "other"): Promise<T> {
  const config = getReignConfig();
  if (!config) throw new Error("Reign n'est pas configuré (REIGN_API_KEY manquant)");
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; ; attempt++) {
    await acquireSlot(kind);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (res.status === 429 && attempt < 6) {
      rateState.throttled += 1;
      const retryAfter = Number(res.headers.get("retry-after")) || 10;
      await sleep(retryAfter * 1000 + Math.random() * 500);
      continue;
    }
    if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 3) {
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const problem = body as { code?: string; detail?: string; title?: string; requestId?: string } | null;
      const what = problem?.code || problem?.title || res.statusText;
      const detail = problem?.detail ? ` — ${problem.detail}` : "";
      throw new Error(`Reign ${res.status} ${what}${detail}`);
    }
    return body as T;
  }
}

/** Parcourt une liste jusqu'au bout. `onPage` reçoit chaque page au fil de l'eau. */
async function listAll<T>(path: string, query: Query, pageSize: number, onPage?: (rows: T[]) => void): Promise<T[]> {
  const rows: T[] = [];
  let pageToken: string | undefined;
  for (let guard = 0; guard < 2_000; guard++) {
    const page = await reignFetch<ListResponse<T>>(path, { ...query, pageSize, pageToken }, "list");
    const data = page.data ?? [];
    rows.push(...data);
    onPage?.(data);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return rows;
}

function storeIdsParam(config: ReignConfig) {
  return config.storeIds.length ? config.storeIds.join(",") : undefined;
}

/* ---------------------------------------------------------------- *
 * Lectures
 * ---------------------------------------------------------------- */

export function getMe() {
  return reignFetch<ReignMe>("/v1/me");
}

export function listStores() {
  return listAll<ReignStore>("/v1/stores", {}, 500);
}

export function listCustomers(onPage?: (rows: ReignCustomer[]) => void) {
  const config = getReignConfig()!;
  return listAll<ReignCustomer>("/v1/customers", { storeIds: storeIdsParam(config) }, 500, onPage);
}

export function listSubscriptions(onPage?: (rows: ReignSubscription[]) => void) {
  const config = getReignConfig()!;
  return listAll<ReignSubscription>("/v1/subscriptions", { storeIds: storeIdsParam(config) }, 200, onPage);
}

/** Une fenêtre de 92 jours au plus (contrainte de l'API). */
export function listOrders(from: string, to: string) {
  const config = getReignConfig()!;
  return listAll<ReignOrder>("/v1/orders", { from, to, storeIds: storeIdsParam(config) }, 500);
}

export function listTransactions(from: string, to: string) {
  const config = getReignConfig()!;
  return listAll<ReignTransaction>("/v1/transactions", { from, to, storeIds: storeIdsParam(config) }, 500);
}

export function listDisputes(from: string, to: string) {
  const config = getReignConfig()!;
  return listAll<ReignDispute>("/v1/disputes", { from, to, storeIds: storeIdsParam(config) }, 500);
}

/** Le chiffre officiel de Reign pour une plage (≤ 365 jours), en USD. */
export function getDashboardSales(from: string, to: string) {
  const config = getReignConfig()!;
  return reignFetch<ReignDashboardSales>("/v1/dashboard/sales", { from, to, storeIds: storeIdsParam(config) });
}

export function moneyToNumber(money: ReignMoney | null | undefined) {
  if (!money) return 0;
  const minor = money.currency === "JPY" ? 1 : money.currency === "KWD" ? 1000 : 100;
  return money.amount / minor;
}
