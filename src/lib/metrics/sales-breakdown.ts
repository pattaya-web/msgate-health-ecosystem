import { classifyCategory, isApproved, isAttempt, isChargeback, isRefund } from "@/lib/phoenix/analytics";
import { resolveSource } from "@/lib/phoenix/sources";
import type { OrderCategory } from "@/lib/phoenix/types";
import { getProductCosts, unitCostFor } from "@/lib/metrics/product-costs";
import { getSupplierGrids, gridPicker, orderNumber, parcelCost, type SupplierGrid } from "@/lib/metrics/supplier-grid";
import { peekOrders } from "@/lib/reign/snapshot";
import { getLiveShopifySales, reportDay, shopifyDirectMode } from "@/lib/shopify/live-sales";

/**
 * Les ventes d'une période par catégorie, avec leur coût de revient.
 *
 * Calculé sur l'instantané de la source active (Reign) : chiffre d'affaires et
 * ventes approuvées par catégorie (Straight sale = « direct », VIP Initial,
 * Recurring, Salvage, Upsell), remboursements et chargebacks rattachés aux
 * commandes de ces catégories, et COGS : les articles réellement expédiés
 * (ventes directes et upsells). Pour les boutiques de la grille fournisseur
 * (Venom), le coût est celui du colis selon le nombre de colliers de la
 * commande (0 si elle est remboursée en entier) ; ailleurs, unités × coût de
 * base. Les prélèvements d'abonnement n'expédient rien et ne portent pas de COGS.
 */

export type CogsProductRow = { key: string; name: string; units: number; unitCost: number; cogs: number; fallback: boolean };

/** Une ligne du coût à la grille : les commandes de N colliers chiffrées par une même grille. */
export type CogsGridRow = { grid: string; quantity: number; orders: number; unitCost: number; cogs: number };

export type CogsGrid = {
  /** Commandes chiffrées à la grille (remboursées en entier comprises, à 0). */
  orders: number;
  refundedOrders: number;
  total: number;
  rows: CogsGridRow[];
  /** Le coût par jour de vente (AAAA-MM-JJ), pour le tableau jour par jour de la page Profit. */
  byDay: Record<string, number>;
};

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
    /** Le coût à la grille fournisseur (par colis), ou null si aucune commande n'y est chiffrée. */
    grid: CogsGrid | null;
  } | null;
};

const PHYSICAL: OrderCategory[] = ["direct", "upsell"];

function emptyRecord(): Record<OrderCategory, number> {
  return { direct: 0, initial: 0, recurring: 0, salvage: 0, upsell: 0 };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Le compteur des commandes chiffrées à la grille fournisseur. */
function gridTally() {
  const rows = new Map<string, CogsGridRow>();
  const byDay: Record<string, number> = {};
  const tally = { orders: 0, refundedOrders: 0, total: 0 };
  return {
    add(grid: SupplierGrid, quantity: number, refunded: boolean, day: string) {
      tally.orders += 1;
      if (refunded) {
        tally.refundedOrders += 1;
        return 0;
      }
      const cost = parcelCost(grid, quantity);
      const key = `${grid.id}:${quantity}`;
      const row = rows.get(key) ?? { grid: grid.label, quantity, orders: 0, unitCost: cost, cogs: 0 };
      row.orders += 1;
      row.cogs += cost;
      rows.set(key, row);
      tally.total += cost;
      byDay[day] = (byDay[day] ?? 0) + cost;
      return cost;
    },
    result(): CogsGrid | null {
      if (!tally.orders) return null;
      return {
        orders: tally.orders,
        refundedOrders: tally.refundedOrders,
        total: round(tally.total),
        rows: [...rows.values()].map((row) => ({ ...row, cogs: round(row.cogs) })).sort((a, b) => a.grid.localeCompare(b.grid) || a.quantity - b.quantity),
        byDay: Object.fromEntries(Object.entries(byDay).map(([day, cost]) => [day, round(cost)])),
      };
    },
  };
}

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
  // Payé et remboursé par commande (toutes dates) : une commande remboursée en entier ne coûte rien.
  const paidByOrder = new Map<string, number>();
  const refundedByOrder = new Map<string, number>();
  for (const tx of snapshot.transactions) {
    if (tx.orderId == null) continue;
    const id = String(tx.orderId);
    if (isRefund(tx) && !isChargeback(tx) && isApproved(tx)) {
      refundedByOrder.set(id, (refundedByOrder.get(id) ?? 0) + tx.amount);
      continue;
    }
    if (!isAttempt(tx)) continue;
    const category = classifyCategory(tx);
    if (category) orderCategory.set(id, category);
    if (isApproved(tx)) paidByOrder.set(id, (paidByOrder.get(id) ?? 0) + tx.amount);
  }

  const revenue = emptyRecord();
  const approved = emptyRecord();
  const attempts = emptyRecord();
  const refunds = { count: 0, amount: 0 };
  const chargebacks = { count: 0, amount: 0 };
  /** Les commandes physiques approuvées sur la période, avec leur boutique et leur jour. */
  const approvedPhysicalOrders = new Map<string, { domain: string; day: string }>();
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
    if (PHYSICAL.includes(category) && tx.orderId != null && !approvedPhysicalOrders.has(String(tx.orderId))) {
      approvedPhysicalOrders.set(String(tx.orderId), { domain: tx.domain, day: (tx.date || "").slice(0, 10) });
    }
  }

  let cogs: SalesBreakdown["cogs"] = null;
  if (billing.id === "reign") {
    const [orders, costs, grids] = await Promise.all([peekOrders(), getProductCosts(), getSupplierGrids()]);
    const rows = new Map<string, CogsProductRow>();
    let units = 0;
    let unitsAtDefault = 0;
    let ordersWithoutLines = 0;
    let total = 0;
    const gridStores = new Set(grids.stores);
    const dayByNumber = new Map<number, string>();
    for (const order of orders.values()) {
      const number = orderNumber(order.shopifyName);
      if (number !== null && order.createdAt) dayByNumber.set(number, order.createdAt.slice(0, 10));
    }
    const pickGrid = gridPicker(grids, (number) => dayByNumber.get(number) ?? null);
    const gridCost = gridTally();
    for (const [orderId, { domain, day }] of approvedPhysicalOrders) {
      const order = orders.get(orderId);
      const lines = order?.lines;
      if (!lines) {
        ordersWithoutLines += 1;
        continue;
      }
      if (gridStores.has(domain)) {
        // Grille fournisseur : un coût par colis selon le nombre total de colliers de la commande.
        const quantity = lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
        const paid = paidByOrder.get(orderId) ?? 0;
        const refunded = paid > 0 && (refundedByOrder.get(orderId) ?? 0) >= paid - 0.01;
        const grid = pickGrid({ number: orderNumber(order?.shopifyName), day: (order?.createdAt || day).slice(0, 10) });
        total += gridCost.add(grid, quantity, refunded, day);
        units += quantity;
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
      grid: gridCost.result(),
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

  const [feed, costs, grids] = await Promise.all([getLiveShopifySales(params.start), getProductCosts(), getSupplierGrids()]);
  const storeSet = new Set((params.stores ?? []).filter(Boolean));
  if (storeSet.size && !storeSet.has(feed.domain)) return { revenue, approved, attempts, refunds, chargebacks: { count: 0, amount: 0 }, cogs: null };

  const rows = new Map<string, CogsProductRow>();
  let units = 0;
  let unitsAtDefault = 0;
  let total = 0;
  const inRange = (day: string) => day >= params.start && day <= params.end;
  const onGrid = grids.stores.includes(feed.domain);
  const dayByNumber = new Map<number, string>();
  for (const order of feed.orders) {
    const number = orderNumber(order.name);
    if (number !== null) dayByNumber.set(number, reportDay(order.createdAt));
  }
  const pickGrid = gridPicker(grids, (number) => dayByNumber.get(number) ?? null);
  const gridCost = gridTally();
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
    if (onGrid) {
      const quantity = order.lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
      const refundedTotal = order.refunds.reduce((sum, refund) => sum + Math.max(0, refund.amount), 0);
      const refunded = order.total > 0 && refundedTotal >= order.total - 0.01;
      const day = reportDay(order.createdAt);
      total += gridCost.add(pickGrid({ number: orderNumber(order.name), day }), quantity, refunded, day);
      units += quantity;
      continue;
    }
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
      grid: gridCost.result(),
    },
  };
}
