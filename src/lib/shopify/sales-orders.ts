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
  domain: string;
  currency: string;
  orders: ShopifySaleOrder[];
};

type Money = { shopMoney: { amount: string; currencyCode: string } };

type OrdersPage = {
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  data?: {
    shop?: { primaryDomain: { host: string }; currencyCode: string };
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
  shop { primaryDomain { host } currencyCode }
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
  let currency = "USD";
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const body: OrdersPage = await shopifyGraphql<OrdersPage>(QUERY, { q: `created_at:>=${since}`, cursor });
    domain = body.data?.shop?.primaryDomain.host.replace(/^www\./, "") ?? domain;
    currency = body.data?.shop?.currencyCode ?? currency;
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
  return { domain, currency, orders };
}
