import type {
  RefundAttribution,
  ShopifyDaily,
  ShopifyDailyPoint,
  ShopifyOrderNode,
  ShopifyOrdersResponse,
  ShopifyQlResponse,
} from "@/lib/shopify/types";

export type ShopifyConfig = {
  shop: string;
  apiVersion: string;
  /** Legacy permanent token (shpat_), only on apps created before 2026. */
  staticToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
};

export function getShopifyConfig(): ShopifyConfig | null {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!shop) return null;

  const staticToken = process.env.SHOPIFY_ADMIN_TOKEN?.trim() || null;
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim() || null;

  // A shpss_ value is a client secret, not an access token — accepting it as a
  // bearer would only produce confusing 401s.
  const usableToken = staticToken?.startsWith("shpat_") ? staticToken : null;
  if (!usableToken && !(clientId && clientSecret)) return null;

  return {
    shop,
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || "2026-07",
    staticToken: usableToken,
    clientId,
    clientSecret,
  };
}

export function isShopifyConfigured() {
  return Boolean(getShopifyConfig());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * Access token
 *
 * Shopify removed permanent tokens on 2026-01-01. Dev Dashboard apps now
 * exchange their client credentials for a token that lives 24h, so it is
 * cached in-process and renewed a little before it lapses.
 * ------------------------------------------------------------------ */

type TokenCache = { token: string; scope: string; expiresAt: number } | null;

const tokenState = ((globalThis as typeof globalThis & {
  __msgateShopifyToken?: { cache: TokenCache; inflight: Promise<string> | null };
}).__msgateShopifyToken ??= { cache: null, inflight: null });

const TOKEN_SKEW_MS = 5 * 60 * 1000;

async function requestClientCredentialsToken(config: ShopifyConfig) {
  const res = await fetch(`https://${config.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    if (text.includes("shop_not_permitted")) {
      throw new Error(
        "Shopify: l'app et la boutique ne sont pas dans la même organisation. Recrée l'app depuis l'organisation qui possède la boutique."
      );
    }
    throw new Error(`Shopify OAuth ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }

  const body = JSON.parse(text) as { access_token: string; scope?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Shopify OAuth: réponse sans access_token");

  tokenState.cache = {
    token: body.access_token,
    scope: body.scope || "",
    expiresAt: Date.now() + (body.expires_in ?? 86_399) * 1000,
  };
  return body.access_token;
}

async function getAccessToken(config: ShopifyConfig, force = false): Promise<string> {
  if (config.staticToken) return config.staticToken;

  const cached = tokenState.cache;
  if (!force && cached && cached.expiresAt - TOKEN_SKEW_MS > Date.now()) return cached.token;

  // Collapse concurrent refreshes so a burst of requests mints a single token.
  tokenState.inflight ??= requestClientCredentialsToken(config).finally(() => {
    tokenState.inflight = null;
  });
  return tokenState.inflight;
}

export async function getGrantedScopes(): Promise<string[]> {
  const config = getShopifyConfig();
  if (!config) return [];
  await getAccessToken(config);
  return (tokenState.cache?.scope || "").split(",").map((s) => s.trim()).filter(Boolean);
}

type GraphQLResult = { errors?: Array<{ message: string; extensions?: { code?: string } }> };

/**
 * The Admin API runs a cost-based leaky bucket: a query is rejected with
 * THROTTLED rather than 429, so retries key off the error code.
 */
async function shopifyGraphql<T extends GraphQLResult>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const config = getShopifyConfig();
  if (!config) {
    throw new Error(
      "Shopify is not configured (SHOPIFY_SHOP_DOMAIN + SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET)"
    );
  }

  const url = `https://${config.shop}/admin/api/${config.apiVersion}/graphql.json`;

  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(config, attempt > 0 && !config.staticToken);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    if (res.status === 429 && attempt < 5) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      // A cached token can outlive a scope change; one forced refresh settles it.
      if (attempt < 1 && !config.staticToken) continue;
      throw new Error(
        "Shopify a refusé l'authentification (401/403). Vérifie que l'app est installée sur la boutique et que les scopes read_orders / read_reports sont accordés."
      );
    }

    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch {
      throw new Error(`Shopify ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    }

    const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled && attempt < 5) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    if (body.errors?.length) {
      throw new Error(`Shopify: ${body.errors.map((e) => e.message).join(" | ")}`);
    }

    if (!res.ok) throw new Error(`Shopify ${res.status}: ${res.statusText}`);

    return body;
  }
}

export async function getShopInfo() {
  const body = await shopifyGraphql<
    GraphQLResult & { data?: { shop?: { name: string; myshopifyDomain: string; currencyCode: string } } }
  >(`query { shop { name myshopifyDomain currencyCode } }`);
  const shop = body.data?.shop;
  if (!shop) throw new Error("Shopify: réponse inattendue sur la boutique");
  return shop;
}

/* ------------------------------------------------------------------ *
 * Daily sales + returns
 * ------------------------------------------------------------------ */

function emptyPoint(date: string): ShopifyDailyPoint {
  return { date, grossSales: 0, netSales: 0, totalSales: 0, returns: 0, orders: 0 };
}

function eachDay(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const REFUND_LOOKBACK_DAYS = 90;

function shiftDays(date: string, delta: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const SHOPIFYQL_METRICS = "gross_sales, net_sales, total_sales, sales_reversals, orders";

async function dailyFromShopifyQl(start: string, end: string) {
  const body = await shopifyGraphql<ShopifyQlResponse>(
    `query Daily($q: String!) {
      shopifyqlQuery(query: $q) {
        tableData { columns { name dataType } rows }
        parseErrors
      }
    }`,
    {
      q: `FROM sales SHOW ${SHOPIFYQL_METRICS} GROUP BY day SINCE ${start} UNTIL ${end} ORDER BY day ASC`,
    }
  );

  const result = body.data?.shopifyqlQuery;
  if (result?.parseErrors?.length) {
    throw new Error(`ShopifyQL: ${result.parseErrors.join(" | ")}`);
  }
  const table = result?.tableData;
  if (!table?.columns?.length) throw new Error("ShopifyQL n'a renvoyé aucune table");

  const byDate = new Map<string, ShopifyDailyPoint>();
  for (const row of table.rows || []) {
    const date = String(row.day ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, {
      date,
      grossSales: num(row.gross_sales),
      netSales: num(row.net_sales),
      totalSales: num(row.total_sales),
      // Reversals come back negative in the sales schema.
      returns: Math.abs(num(row.sales_reversals)),
      orders: num(row.orders),
    });
  }

  if (byDate.size === 0) throw new Error("ShopifyQL n'a renvoyé aucune ligne exploitable");

  return eachDay(start, end).map((date) => byDate.get(date) ?? emptyPoint(date));
}

const ORDERS_QUERY = `query Orders($q: String!, $cursor: String) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      test
      cancelledAt
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      refunds { id createdAt totalRefundedSet { shopMoney { amount } } }
    }
  }
}`;

/**
 * Fallback when ShopifyQL is unavailable, and the only way to attribute a
 * refund back to the day of the original order.
 */
async function dailyFromOrders(start: string, end: string, attribution: RefundAttribution) {
  // A refund processed during the window often belongs to an older order, so
  // that mode reaches back before the range. Days outside [start, end] are
  // dropped afterwards, keeping only their reversals.
  const scanStart =
    attribution === "processed" ? shiftDays(start, -REFUND_LOOKBACK_DAYS) : start;
  const search = `created_at:>=${scanStart} created_at:<=${end}`;

  const nodes: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 60; page++) {
    const body: ShopifyOrdersResponse = await shopifyGraphql<ShopifyOrdersResponse>(ORDERS_QUERY, {
      q: search,
      cursor,
    });
    const conn = body.data?.orders;
    if (!conn) break;
    nodes.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  const byDate = new Map<string, ShopifyDailyPoint>();
  const bucket = (date: string) => {
    if (!byDate.has(date)) byDate.set(date, emptyPoint(date));
    return byDate.get(date)!;
  };

  for (const order of nodes) {
    // Mirror the sales dataset: test and cancelled orders are not sales.
    if (order.test || order.cancelledAt) continue;
    const day = order.createdAt.slice(0, 10);
    const target = bucket(day);

    const subtotal = num(order.subtotalPriceSet?.shopMoney.amount);
    const discounts = num(order.totalDiscountsSet?.shopMoney.amount);
    const total = num(order.totalPriceSet.shopMoney.amount);

    target.orders += 1;
    // subtotal is already net of discounts, so gross adds them back.
    target.grossSales += subtotal + discounts;
    target.netSales += subtotal;
    target.totalSales += total;

    for (const refund of order.refunds || []) {
      const amount = num(refund.totalRefundedSet?.shopMoney.amount);
      if (!amount) continue;
      const refundDay = attribution === "order" ? day : refund.createdAt.slice(0, 10);
      const refundTarget = bucket(refundDay);
      refundTarget.returns += amount;
      refundTarget.netSales -= amount;
      refundTarget.totalSales -= amount;
    }
  }

  return eachDay(start, end).map((date) => byDate.get(date) ?? emptyPoint(date));
}

export async function getShopifyDaily(params: {
  start: string;
  end: string;
  attribution?: RefundAttribution;
}): Promise<ShopifyDaily> {
  const config = getShopifyConfig();
  if (!config) throw new Error("Shopify is not configured");

  const attribution = params.attribution || "processed";
  const warnings: string[] = [];
  const shop = await getShopInfo();

  let series: ShopifyDailyPoint[];
  let source: ShopifyDaily["source"] = "shopifyql";

  if (attribution === "order") {
    // ShopifyQL always dates a reversal on the day it was processed.
    series = await dailyFromOrders(params.start, params.end, attribution);
    source = "orders";
  } else {
    try {
      series = await dailyFromShopifyQl(params.start, params.end);
    } catch (error) {
      warnings.push(
        `ShopifyQL indisponible (${error instanceof Error ? error.message : "erreur"}) — repli sur le scan des commandes.`
      );
      series = await dailyFromOrders(params.start, params.end, attribution);
      source = "orders";
    }
  }

  const totals = series.reduce(
    (acc, point) => ({
      grossSales: acc.grossSales + point.grossSales,
      netSales: acc.netSales + point.netSales,
      totalSales: acc.totalSales + point.totalSales,
      returns: acc.returns + point.returns,
      orders: acc.orders + point.orders,
    }),
    { grossSales: 0, netSales: 0, totalSales: 0, returns: 0, orders: 0 }
  );

  return {
    shop: shop.myshopifyDomain,
    currency: shop.currencyCode,
    range: { start: params.start, end: params.end },
    attribution,
    source,
    series,
    totals,
    warnings,
  };
}
