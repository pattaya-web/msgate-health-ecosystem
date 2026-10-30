import { getShopifyConfig, shopifyGraphql } from "@/lib/shopify/client";

/**
 * Les commandes de la boutique Shopify, résumées pour les stats.
 *
 * Aucun champ client : l'app n'a pas (et n'a pas besoin) du droit
 * read_customers ; une vente sans checkout Reign est rattachée à son numéro.
 *
 * Sert à compter les ventes que Reign ne voit pas : celles payées par Shopify
 * Payments (ou PayPal…) avant ou à côté du checkout Reign. Chaque commande
 * garde son numéro (#V1290), qui permet de reconnaître celles déjà facturées
 * par Reign et de ne jamais les compter deux fois.
 */

export type ShopifySaleOrder = {
  /** Le numéro de commande Shopify, « #V1290 ». */
  name: string;
  createdAt: string;
  /** Passerelles de paiement (« shopify_payments »…) ; vide pour une commande payée par Reign. */
  gateways: string[];
  /** Ce que le client a payé (taxes et port compris), en devise de la boutique. */
  total: number;
  lines: Array<{ title: string; quantity: number }>;
  refunds: Array<{ createdAt: string; amount: number }>;
};

export type ShopifySalesFeed = {
  /** Le nom de la boutique (« Venom »). */
  name: string;
  domain: string;
  currency: string;
  orders: ShopifySaleOrder[];
};

type Money = { shopMoney: { amount: string; currencyCode: string } };

type OrdersPage = {
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  data?: {
    shop?: { name: string; primaryDomain: { host: string }; currencyCode: string };
    orders?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        name: string;
        createdAt: string;
        test: boolean;
        cancelledAt: string | null;
        paymentGatewayNames: string[];
        totalPriceSet: Money;
        lineItems: { nodes: Array<{ title: string; quantity: number }> };
        refunds: Array<{ createdAt: string; totalRefundedSet: Money }>;
      }>;
    };
  };
};

const QUERY = `query Sales($q: String!, $cursor: String) {
  shop { name primaryDomain { host } currencyCode }
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name
      createdAt
      test
      cancelledAt
      paymentGatewayNames
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 50) { nodes { title quantity } }
      refunds { createdAt totalRefundedSet { shopMoney { amount currencyCode } } }
    }
  }
}`;

export function isShopifySalesConfigured() {
  return Boolean(getShopifyConfig());
}

/** Les commandes créées depuis `since` (YYYY-MM-DD, jour de la boutique), hors tests et annulations. */
export async function fetchShopifySales(since: string): Promise<ShopifySalesFeed> {
  const orders: ShopifySaleOrder[] = [];
  let domain = "";
  let name = "";
  let currency = "USD";
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const body: OrdersPage = await shopifyGraphql<OrdersPage>(QUERY, { q: `created_at:>=${since}`, cursor });
    domain = body.data?.shop?.primaryDomain.host.replace(/^www\./, "") ?? domain;
    currency = body.data?.shop?.currencyCode ?? currency;
    name = body.data?.shop?.name ?? name;
    const connection = body.data?.orders;
    if (!connection) break;
    for (const node of connection.nodes) {
      // Ni tests, ni annulations, ni commandes à 0 $ (échantillons, remplacements) : ce ne sont pas des ventes.
      if (node.test || node.cancelledAt) continue;
      const total = Number(node.totalPriceSet.shopMoney.amount) || 0;
      if (total <= 0) continue;
      orders.push({
        name: node.name,
        createdAt: node.createdAt,
        gateways: node.paymentGatewayNames ?? [],
        total,
        lines: node.lineItems.nodes.map((line) => ({ title: line.title, quantity: line.quantity || 0 })),
        refunds: node.refunds
          .map((refund) => ({ createdAt: refund.createdAt, amount: Number(refund.totalRefundedSet.shopMoney.amount) || 0 }))
          .filter((refund) => refund.amount > 0),
      });
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return { name, domain, currency, orders };
}

export type ShopifyTraffic = {
  sessions: number;
  /** Visites ayant ajouté au panier, atteint le checkout, terminé le checkout. */
  cart: number;
  checkout: number;
  completed: number;
  /** Visites terminées en commande / visites, entre 0 et 1. */
  conversionRate: number;
  byDay: Array<{ date: string; sessions: number; conversionRate: number }>;
};

type ShopifyQlPage = {
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  data?: { shopifyqlQuery?: { tableData?: { rows: Array<Record<string, string>> } | null; parseErrors?: string[] } };
};

const trafficCache = ((globalThis as typeof globalThis & { __msgateShopifyTraffic?: Map<string, { at: number; value: ShopifyTraffic }> }).__msgateShopifyTraffic ??= new Map());

/**
 * Les visites de la boutique et leur conversion, par jour (jours de la boutique,
 * Paris). Relues au plus toutes les 2 minutes.
 */
export async function fetchShopifyTraffic(start: string, end: string): Promise<ShopifyTraffic> {
  const key = `${start}:${end}`;
  const hit = trafficCache.get(key);
  if (hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.value;
  const body = await shopifyGraphql<ShopifyQlPage>(
    `query Traffic($q: String!) { shopifyqlQuery(query: $q) { tableData { rows } parseErrors } }`,
    {
      q: `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout GROUP BY day SINCE ${start} UNTIL ${end} ORDER BY day ASC`,
    }
  );
  const result = body.data?.shopifyqlQuery;
  if (result?.parseErrors?.length) throw new Error(`ShopifyQL : ${result.parseErrors.join(" | ")}`);
  const rows = result?.tableData?.rows ?? [];
  const n = (value: string | undefined) => Number(value) || 0;
  const value: ShopifyTraffic = { sessions: 0, cart: 0, checkout: 0, completed: 0, conversionRate: 0, byDay: [] };
  for (const row of rows) {
    const sessions = n(row.sessions);
    const completed = n(row.sessions_that_completed_checkout);
    value.sessions += sessions;
    value.cart += n(row.sessions_with_cart_additions);
    value.checkout += n(row.sessions_that_reached_checkout);
    value.completed += completed;
    value.byDay.push({ date: String(row.day ?? "").slice(0, 10), sessions, conversionRate: sessions ? completed / sessions : 0 });
  }
  value.conversionRate = value.sessions ? value.completed / value.sessions : 0;
  trafficCache.set(key, { at: Date.now(), value });
  return value;
}
