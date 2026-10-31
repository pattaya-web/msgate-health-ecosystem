import { classifyCategory, isApproved, isAttempt, isChargeback, isRefund } from "@/lib/phoenix/analytics";
import { resolveSource } from "@/lib/phoenix/sources";
import type { OrderCategory } from "@/lib/phoenix/types";
import { getProductCosts, unitCostFor } from "@/lib/metrics/product-costs";
import { peekOrders } from "@/lib/reign/snapshot";
import { getLiveShopifySales, reportDay, shopifyDirectMode } from "@/lib/shopify/live-sales";

/**
 * Les ventes d'une période par catégorie, avec leur coût de revient.
 *
 * Calculé sur l'instantané de la source active (Reign) : chiffre d'affaires et
 * ventes approuvées par catégorie (Straight sale = « direct », VIP Initial,
 * Recurring, Salvage, Upsell), remboursements et chargebacks rattachés aux
 * commandes de ces catégories, et COGS : les articles réellement expédiés
 * (ventes directes et upsells) multipliés par leur coût de base. Les
 * prélèvements d'abonnement n'expédient rien et ne portent pas de COGS.
 */

export type CogsProductRow = { key: string; name: string; units: number; unitCost: number; cogs: number; fallback: boolean };

export type SalesBreakdown = {
  revenue: Record<OrderCategory, number>;
  approved: Record<OrderCategory, number>;
  attempts: Record<OrderCategory, number>;
  refunds: { count: number; amount: number };
  chargebacks: { count: number; amount: number };
  /** null quand la source ne donne pas les articles des commandes (Phoenix). */
  cogs: {
    total: number;
    units: number;
    /** Unités comptées au coût par défaut, faute de coût propre au produit. */
    unitsAtDefault: number;
    /** Ventes approuvées dont on ne connaît pas encore les articles. */
    ordersWithoutLines: number;
    defaultUnitCost: number;
    products: CogsProductRow[];
  } | null;
};

const PHYSICAL: OrderCategory[] = ["direct", "upsell"];

function emptyRecord(): Record<OrderCategory, number> {
  return { direct: 0, initial: 0, recurring: 0, salvage: 0, upsell: 0 };
}

const round = (value: number) => Math.round(value * 100) / 100;

export async function buildSalesBreakdown(params: {
  start: string;
  end: string;
  /** Domaines de boutique à retenir ; vide = toutes. */
  stores?: string[];
  /** Catégories retenues ; absent = toutes. */
  categories?: OrderCategory[];
}): Promise<SalesBreakdown | null> {
  if (shopifyDirectMode()) return shopifyBreakdown(params);
  const billing = resolveSource(null);
  if (!billing.configured) return null;
  const snapshot = await billing.peekSnapshot();
  if (!snapshot) return null;

  const storeSet = new Set((params.stores ?? []).filter(Boolean));
  const keep = new Set<OrderCategory>(params.categories ?? ["direct", "initial", "recurring", "salvage", "upsell"]);
  const inStore = (domain: string) => !storeSet.size || storeSet.has(domain);
  const inRange = (date: string) => {
    const day = (date || "").slice(0, 10);
    return day >= params.start && day <= params.end;
  };

  // La catégorie de chaque commande, lue sur ses tentatives (toutes dates), pour y rattacher remboursements et litiges.
  const orderCategory = new Map<string, OrderCategory>();
  for (const tx of snapshot.transactions) {
    if (!isAttempt(tx) || tx.orderId == null) continue;
    const category = classifyCategory(tx);
    if (category) orderCategory.set(String(tx.orderId), category);
  }

  const revenue = emptyRecord();
  const approved = emptyRecord();
  const attempts = emptyRecord();
  const refunds = { count: 0, amount: 0 };
  const chargebacks = { count: 0, amount: 0 };
  const approvedPhysicalOrders = new Set<string>();
  // Une tentative refusée puis rejouée sur la même commande ne compte qu'une fois.
  const attemptedOrders = new Set<string>();

  for (const tx of snapshot.transactions) {
    if (!inStore(tx.domain) || !inRange(tx.date)) continue;
    if (isRefund(tx) || isChargeback(tx)) {
      const category = tx.orderId != null ? orderCategory.get(String(tx.orderId)) : undefined;
      if (!category || !keep.has(category)) continue;
      if (isChargeback(tx)) {
        chargebacks.count += 1;
        chargebacks.amount += tx.amount;
      } else if (isApproved(tx)) {
        refunds.count += 1;
        refunds.amount += tx.amount;
      }
      continue;
    }
    if (!isAttempt(tx)) continue;
    const category = classifyCategory(tx);
    if (!category || !keep.has(category)) continue;
    const orderKey = tx.orderId != null ? `${category}:${tx.orderId}` : null;
    if (!orderKey || !attemptedOrders.has(orderKey)) {
      attempts[category] += 1;
      if (orderKey) attemptedOrders.add(orderKey);
    }
    if (!isApproved(tx)) continue;
    approved[category] += 1;
    revenue[category] += tx.amount;
    if (PHYSICAL.includes(category) && tx.orderId != null) approvedPhysicalOrders.add(String(tx.orderId));
  }

  let cogs: SalesBreakdown["cogs"] = null;
  if (billing.id === "reign") {
    const [orders, costs] = await Promise.all([peekOrders(), getProductCosts()]);
    const rows = new Map<string, CogsProductRow>();
    let units = 0;
    let unitsAtDefault = 0;
    let ordersWithoutLines = 0;
    let total = 0;
    for (const orderId of approvedPhysicalOrders) {
      const lines = orders.get(orderId)?.lines;
      if (!lines) {
        ordersWithoutLines += 1;
        continue;
      }
      for (const line of lines) {
        const { cost, fallback } = unitCostFor(costs, line.productId, line.name);
        // Regroupé par nom : la même pièce vendue via Shopify et via Reign n'a pas le même identifiant.
        const key = line.name || line.productId || "?";
        const row = rows.get(key) ?? { key, name: line.name || key, units: 0, unitCost: cost, cogs: 0, fallback };
        row.units += line.quantity;
        row.cogs += line.quantity * cost;
        rows.set(key, row);
        units += line.quantity;
        if (fallback) unitsAtDefault += line.quantity;
        total += line.quantity * cost;
      }
    }
    cogs = {
      total: round(total),
      units,
      unitsAtDefault,
      ordersWithoutLines,
      defaultUnitCost: costs.defaultUnitCost,
      products: [...rows.values()].map((row) => ({ ...row, cogs: round(row.cogs) })).sort((a, b) => b.units - a.units),
    };
  }

  for (const category of Object.keys(revenue) as OrderCategory[]) revenue[category] = round(revenue[category]);
  return {
    revenue,
    approved,
    attempts,
    refunds: { count: refunds.count, amount: round(refunds.amount) },
    chargebacks: { count: chargebacks.count, amount: round(chargebacks.amount) },
    cogs,
  };
}

/**
 * Le même calcul, lu directement chez Shopify (site en ligne, sans Reign) :
 * chaque commande de la boutique est une vente directe (Straight sale), ses
 * articles font le COGS, ses remboursements comptent au jour du remboursement.
 */
async function shopifyBreakdown(params: { start: string; end: string; stores?: string[]; categories?: OrderCategory[] }): Promise<SalesBreakdown | null> {
  const keep = new Set<OrderCategory>(params.categories ?? ["direct", "initial", "recurring", "salvage", "upsell"]);
  const revenue = emptyRecord();
  const approved = emptyRecord();
  const attempts = emptyRecord();
  const refunds = { count: 0, amount: 0 };
  if (!keep.has("direct")) return { revenue, approved, attempts, refunds, chargebacks: { count: 0, amount: 0 }, cogs: null };

  const [feed, costs] = await Promise.all([getLiveShopifySales(params.start), getProductCosts()]);
  const storeSet = new Set((params.stores ?? []).filter(Boolean));
  if (storeSet.size && !storeSet.has(feed.domain)) return { revenue, approved, attempts, refunds, chargebacks: { count: 0, amount: 0 }, cogs: null };

  const rows = new Map<string, CogsProductRow>();
  let units = 0;
  let unitsAtDefault = 0;
  let total = 0;
  const inRange = (day: string) => day >= params.start && day <= params.end;
  for (const order of feed.orders) {
    for (const refund of order.refunds) {
      if (!inRange(reportDay(refund.createdAt)) || refund.amount <= 0) continue;
      refunds.count += 1;
      refunds.amount += refund.amount;
    }
    if (!inRange(reportDay(order.createdAt))) continue;
    attempts.direct += 1;
    approved.direct += 1;
    revenue.direct += order.total;
    for (const line of order.lines) {
      const { cost, fallback } = unitCostFor(costs, null, line.title);
      const key = line.title || "?";
      const row = rows.get(key) ?? { key, name: line.title || key, units: 0, unitCost: cost, cogs: 0, fallback };
      row.units += line.quantity;
      row.cogs += line.quantity * cost;
      rows.set(key, row);
      units += line.quantity;
      if (fallback) unitsAtDefault += line.quantity;
      total += line.quantity * cost;
    }
  }
  revenue.direct = round(revenue.direct);
  return {
    revenue,
    approved,
    attempts,
    refunds: { count: refunds.count, amount: round(refunds.amount) },
    chargebacks: { count: 0, amount: 0 },
    cogs: {
      total: round(total),
      units,
      unitsAtDefault,
      ordersWithoutLines: 0,
      defaultUnitCost: costs.defaultUnitCost,
      products: [...rows.values()].map((row) => ({ ...row, cogs: round(row.cogs) })).sort((a, b) => b.units - a.units),
    },
  };
}
