import { randomUUID } from "crypto";
import type {
  PhoenixCustomersResponse,
  PhoenixRefundRequest,
  PhoenixRefundResponse,
  PhoenixStoresResponse,
  PhoenixSubscriptionStatus,
  PhoenixTransaction,
  PhoenixTransactionHistoryResponse,
  TxAggregates,
} from "@/lib/phoenix/types";

export type PhoenixConfig = {
  baseUrl: string;
  partnerId: string;
  partnerToken: string;
  bearerToken: string;
  clientLabel: string;
};

export function getPhoenixConfig(): PhoenixConfig | null {
  const baseUrl = process.env.PHOENIX_BASE_URL?.replace(/\/$/, "");
  const partnerId = process.env.PHOENIX_PARTNER_ID;
  const partnerToken = process.env.PHOENIX_PARTNER_TOKEN;
  const bearerToken = process.env.PHOENIX_BEARER_TOKEN;
  if (!baseUrl || !partnerId || !partnerToken || !bearerToken) return null;
  return {
    baseUrl,
    partnerId,
    partnerToken,
    bearerToken,
    clientLabel: process.env.PHOENIX_CLIENT_LABEL || "Phoenix",
  };
}

export function isPhoenixConfigured() {
  return Boolean(getPhoenixConfig());
}

/* ---------------------------------------------------------------- *
 * Rate limiting
 *
 * Measured against the partner API: 100 requests per rolling 60s window,
 * after which everything returns 429 until the window slides. A share of the
 * budget is held back so an interactive request never queues behind a bulk
 * sync.
 * ---------------------------------------------------------------- */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 92;
const BULK_RESERVE = 16;

/**
 * Requests are paced rather than burst: firing the whole budget at once trips
 * the limiter, and a single 429 then stalls every worker for a full window.
 * ~800ms between bulk calls sustains 75/min and leaves the rest for the UI.
 */
const BULK_INTERVAL_MS = 800;
const INTERACTIVE_INTERVAL_MS = 60;
const THROTTLE_BACKOFF_MS = 15_000;

// Held on globalThis so the budget survives dev hot-reloads and is shared by
// every route handler in the process.
const rateState = ((globalThis as typeof globalThis & {
  __msgatePhoenixRate?: { calls: number[]; nextSlotAt: number; throttled: number };
}).__msgatePhoenixRate ??= { calls: [], nextSlotAt: 0, throttled: 0 });
rateState.calls ??= [];
rateState.nextSlotAt ??= 0;
rateState.throttled ??= 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireSlot(rateClass: "interactive" | "bulk") {
  const interval = rateClass === "bulk" ? BULK_INTERVAL_MS : INTERACTIVE_INTERVAL_MS;
  const cap = rateClass === "bulk" ? RATE_MAX - BULK_RESERVE : RATE_MAX;

  for (;;) {
    const now = Date.now();
    rateState.calls = rateState.calls.filter((t) => now - t < RATE_WINDOW_MS);

    if (rateState.calls.length >= cap) {
      const oldest = rateState.calls[0];
      await sleep(Math.min(Math.max(RATE_WINDOW_MS - (now - oldest) + 50, 100), 5_000));
      continue;
    }

    // Reserve an evenly spaced slot in the shared schedule.
    const slot = Math.max(now, rateState.nextSlotAt);
    rateState.nextSlotAt = slot + interval;
    rateState.calls.push(slot);
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
    return;
  }
}

function backOff() {
  rateState.throttled += 1;
  rateState.nextSlotAt = Math.max(rateState.nextSlotAt, Date.now() + THROTTLE_BACKOFF_MS);
}

export function getRateBudget() {
  const now = Date.now();
  rateState.calls = rateState.calls.filter((t) => now - t < RATE_WINDOW_MS);
  return {
    used: rateState.calls.length,
    max: RATE_MAX,
    windowMs: RATE_WINDOW_MS,
    throttled: rateState.throttled,
  };
}

type FetchOptions = RequestInit & {
  query?: Record<string, string | number | undefined>;
  rateClass?: "interactive" | "bulk";
};

async function phoenixFetch<T>(path: string, init?: FetchOptions): Promise<T> {
  const config = getPhoenixConfig();
  if (!config) {
    throw new Error("Phoenix is not configured (missing PHOENIX_* env vars)");
  }

  const url = new URL(path.startsWith("http") ? path : `${config.baseUrl}${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const { query, rateClass = "interactive", ...rest } = init || {};
  void query;

  for (let attempt = 0; ; attempt++) {
    await acquireSlot(rateClass);

    const res = await fetch(url.toString(), {
      ...rest,
      headers: {
        partnerId: config.partnerId,
        partnerToken: config.partnerToken,
        "request-id": randomUUID(),
        Authorization: `Bearer ${config.bearerToken}`,
        Accept: "application/json",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(rest.headers || {}),
      },
      cache: "no-store",
    });

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    if (res.status === 429 && attempt < 5) {
      // Push the shared schedule back rather than draining the budget, so one
      // throttled call does not stall every other worker for a full window.
      backOff();
      continue;
    }

    if (!res.ok) {
      const msg =
        typeof body === "object" && body && "message" in body
          ? String((body as { message: unknown }).message)
          : text.slice(0, 200) || res.statusText;
      throw new Error(`Phoenix ${res.status}: ${msg}`);
    }

    return body as T;
  }
}

export async function getStores(params?: { page?: number; limit?: number }) {
  return phoenixFetch<PhoenixStoresResponse>("/phxcrm/stores", {
    method: "GET",
    query: {
      Page: params?.page ?? 1,
      Limit: params?.limit ?? 25,
    },
  });
}

export async function getTransactionHistory(params: {
  customerId: number | string;
  startDateTime?: string;
  rateClass?: "interactive" | "bulk";
}) {
  return phoenixFetch<PhoenixTransactionHistoryResponse>("/phxcrm/transaction-history", {
    method: "GET",
    rateClass: params.rateClass,
    query: {
      CustomerId: params.customerId,
      StartDateTime: params.startDateTime,
    },
  });
}

/**
 * Subscribers list. The API rejects any date filter, so callers must page
 * through the whole base (rows come back newest enrollment first).
 */
export async function getCustomers(params?: {
  page?: number;
  limit?: number;
  subscriptionStatus?: PhoenixSubscriptionStatus;
  customerId?: number | string;
  email?: string;
  rateClass?: "interactive" | "bulk";
}) {
  return phoenixFetch<PhoenixCustomersResponse>("/phxcrm/customers", {
    method: "GET",
    rateClass: params?.rateClass,
    query: {
      Page: params?.page ?? 1,
      Limit: params?.limit ?? 100,
      SubscriptionStatus: params?.subscriptionStatus,
      CustomerId: params?.customerId,
      Email: params?.email,
    },
  });
}

export async function createRefund(body: PhoenixRefundRequest) {
  return phoenixFetch<PhoenixRefundResponse>("/phxcrm/refund", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function isVoidTx(tx: PhoenixTransaction) {
  const type = (tx.TransactionType || "").toLowerCase();
  const msg = (tx.ResponseMessage || "").toLowerCase();
  return type.includes("void") || msg.includes("void");
}

function isSuccessfulSale(tx: PhoenixTransaction) {
  if (isVoidTx(tx)) return false;
  return tx.ResponseCode === "100" || (tx.ResponseMessage || "").toUpperCase() === "SUCCESS";
}

/** Aggregate transactions for KPIs + calendar */
export function aggregateTransactions(txs: PhoenixTransaction[]): TxAggregates {
  const byDayMap = new Map<
    string,
    { revenue: number; voids: number; salesCount: number; voidCount: number }
  >();

  let revenue = 0;
  let voids = 0;
  let salesCount = 0;
  let voidCount = 0;

  for (const tx of txs) {
    const amount = Number(tx.Amount) || 0;
    const key = dayKey(tx.Date || tx.TimeStart || "");
    if (!byDayMap.has(key)) {
      byDayMap.set(key, { revenue: 0, voids: 0, salesCount: 0, voidCount: 0 });
    }
    const bucket = byDayMap.get(key)!;

    if (isVoidTx(tx)) {
      voids += amount;
      voidCount += 1;
      bucket.voids += amount;
      bucket.voidCount += 1;
    } else if (isSuccessfulSale(tx)) {
      revenue += amount;
      salesCount += 1;
      bucket.revenue += amount;
      bucket.salesCount += 1;
    }
  }

  const byDay = [...byDayMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { revenue, voids, salesCount, voidCount, byDay };
}
