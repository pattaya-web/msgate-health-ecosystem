import { buildOverview } from "@/lib/phoenix/analytics";
import { resolveSource } from "@/lib/phoenix/sources";
import { buildRetention } from "@/lib/phoenix/retention";
import { buildRoasDaily } from "@/lib/metrics/roas-daily";
import { buildSalesBreakdown, type SalesBreakdown } from "@/lib/metrics/sales-breakdown";

/**
 * Feeds the profit calculator with the figures we already collect, so only the
 * rates the operator knows (processing %, CRM %, alert fees, COGS…) stay manual.
 *
 * Revenue is deliberately assembled the same way as the ROAS model: Shopify is
 * the source of truth for one-off sales and Phoenix only contributes the
 * subscription legs. Counting Phoenix's own "direct" category on top would bill
 * the same order twice.
 *
 * The calculator expects processed revenue *before* refunds, with refunds
 * deducted separately, so Shopify returns are added back into revenue and
 * reported as refunds — never netted twice.
 */

export type ProfitInputs = {
  range: { start: string; end: string; days: number };
  /** « all » : tout le compte (admin) ; « straight » : le Straight sale seul (accès Associé). */
  scope: "all" | "straight";
  /** Le nom affiché du compte de facturation. */
  label: string;
  currency: string;
  /** COGS calculé (unités vendues × coût de base) ; null quand la source ne donne pas les articles. */
  cogs: number | null;
  cogsDetail: SalesBreakdown["cogs"];
  /** Chiffre d'affaires par catégorie, pour le bandeau du calculateur. */
  categories: { direct: number; initial: number; recurring: number; salvage: number; upsell: number; directSales: number };
  /** (Straight sale + abonnements) / dépense, le même ratio que l'écran Stats. */
  roasCombined: number | null;
  /** Pre-filled fields, all editable client-side. */
  revenue: number;
  refunds: number;
  transactions: number;
  chargebacks: number;
  chargebackValue: number;
  ads: number;
  breakdown: {
    shopifyProcessed: number;
    shopifyReturns: number;
    shopifyOrders: number;
    phoenixInitial: number;
    phoenixRecurring: number;
    phoenixSalvage: number;
    phoenixRebill: number;
    phoenixRefunds: number;
    phoenixSubscriptionPayments: number;
    metaSpend: number;
  };
  /**
   * Front-end break-even model: what the funnel earns before any rebill, and
   * what we observe on first rebills. "vip" keeps the subscription funnel
   * alone, since the model assumes every sale is eligible for a rebill;
   * "all" adds Shopify one-off orders for a whole-account view.
   */
  breakEven: {
    adSpend: number;
    frontRevenueVip: number;
    frontRevenueAll: number;
    salesVip: number;
    salesAll: number;
    /** Average rebill actually processed over the window. */
    membershipPrice: number;
    /** Our real first-rebill approval rate, used as the simulator default. */
    observedApprovalRate: number;
    recurringApproved: number;
    recurringAttempts: number;
  };
  /**
   * How long a subscriber lasts, read over a wide window rather than the
   * selected one: a 7-day slice churns far too few customers to average.
   */
  retention: {
    avgLifetimeDays: number;
    medianLifetimeDays: number;
    churned: number;
    windowDays: number;
  };
  sources: { shopify: string; phoenix: string; spend: string };
  warnings: string[];
};

const round = (value: number) => Number(value.toFixed(2));

/** Wide enough that the lifetime average rests on a real sample of churns. */
const RETENTION_WINDOW_DAYS = 180;

export async function buildProfitInputs(params: {
  start: string;
  end: string;
}): Promise<ProfitInputs> {
  const { start, end } = params;
  const warnings: string[] = [];

  const roas = await buildRoasDaily({ start, end });
  const sales = await buildSalesBreakdown({ start, end });
  const fromReign = roas.directSource === "reign";

  // Refunds, chargebacks and payment counts only exist on the Phoenix side.
  let phoenixRefunds = 0;
  let chargebacks = 0;
  let chargebackValue = 0;
  let subscriptionPayments = 0;
  let initialApproved = 0;
  let initialRevenue = 0;
  let recurringApproved = 0;
  let recurringAttempts = 0;
  let recurringRevenue = 0;
  let observedApprovalRate = 0;
  let avgLifetimeDays = 0;
  let medianLifetimeDays = 0;
  let churned = 0;

  const billing = resolveSource(null);
  const snapshot = billing.configured ? await billing.peekSnapshot() : null;

  if (snapshot) {
    const overview = buildOverview(snapshot, {
      start,
      end,
      stores: [],
      processors: [],
      client: billing.label,
      targetCac: null,
    });

    phoenixRefunds = overview.period.refunds.amount;
    chargebacks = overview.period.chargebacks.count;
    chargebackValue = overview.period.chargebacks.amount;
    subscriptionPayments =
      overview.orderSummary.initial.approved +
      overview.orderSummary.recurring.approved +
      overview.orderSummary.salvage.approved;

    initialApproved = overview.orderSummary.initial.approved;
    initialRevenue = overview.orderSummary.initial.revenue;
    recurringApproved = overview.orderSummary.recurring.approved;
    recurringAttempts = overview.orderSummary.recurring.attempts;
    recurringRevenue = overview.orderSummary.recurring.revenue;
    observedApprovalRate = overview.orderSummary.recurring.approvalRate;

    const retentionEnd = new Date(`${end}T00:00:00Z`);
    const retentionStart = new Date(retentionEnd);
    retentionStart.setUTCDate(retentionStart.getUTCDate() - (RETENTION_WINDOW_DAYS - 1));
    const retention = buildRetention(snapshot, {
      start: retentionStart.toISOString().slice(0, 10),
      end,
    });

    avgLifetimeDays = retention.totals.avgDays;
    medianLifetimeDays = retention.totals.medianDays;
    churned = retention.totals.churned;
  } else {
    warnings.push("Snapshot Phoenix indisponible — remboursements et chargebacks à zéro.");
  }

  const totals = roas.totals;
  const shopifyProcessed = totals.directRevenue + totals.shopifyReturns;
  const days =
    Math.round(
      (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000
    ) + 1;

  // Avec Reign, les upsells sont des ventes à part entière (Shopify les comptait dans ses commandes).
  const upsell = fromReign ? (sales?.revenue.upsell ?? 0) : 0;
  const upsellSales = fromReign ? (sales?.approved.upsell ?? 0) : 0;
  if (fromReign && sales?.cogs) {
    if (sales.cogs.unitsAtDefault > 0 && sales.cogs.defaultUnitCost === 0) {
      warnings.push(`${sales.cogs.unitsAtDefault} unité(s) vendue(s) sans coût de revient : renseigne les COGS produits plus bas.`);
    }
    if (sales.cogs.ordersWithoutLines > 0) {
      warnings.push(`${sales.cogs.ordersWithoutLines} commande(s) dont les articles ne sont pas encore synchronisés : COGS incomplet.`);
    }
  }

  return {
    range: { start, end, days },
    scope: "all",
    label: resolveSource(null).label,
    currency: roas.currency,
    cogs: sales?.cogs ? sales.cogs.total : null,
    cogsDetail: sales?.cogs ?? null,
    categories: {
      direct: round(totals.directRevenue),
      initial: round(totals.initialRevenue),
      recurring: round(totals.recurringRevenue),
      salvage: round(totals.salvageRevenue),
      upsell: round(upsell),
      directSales: totals.shopifyOrders,
    },
    roasCombined: totals.roasGlobal,
    revenue: round(shopifyProcessed + totals.rebillRevenue + upsell),
    refunds: round(totals.shopifyReturns + phoenixRefunds),
    transactions: totals.shopifyOrders + upsellSales + subscriptionPayments,
    chargebacks,
    chargebackValue: round(chargebackValue),
    ads: round(totals.spend),
    breakdown: {
      shopifyProcessed: round(shopifyProcessed),
      shopifyReturns: round(totals.shopifyReturns),
      shopifyOrders: totals.shopifyOrders,
      phoenixInitial: round(totals.initialRevenue),
      phoenixRecurring: round(totals.recurringRevenue),
      phoenixSalvage: round(totals.salvageRevenue),
      phoenixRebill: round(totals.rebillRevenue),
      phoenixRefunds: round(phoenixRefunds),
      phoenixSubscriptionPayments: subscriptionPayments,
      metaSpend: round(totals.spend),
    },
    breakEven: {
      adSpend: round(totals.spend),
      frontRevenueVip: round(initialRevenue),
      frontRevenueAll: round(initialRevenue + shopifyProcessed),
      salesVip: initialApproved,
      salesAll: initialApproved + totals.shopifyOrders,
      membershipPrice: recurringApproved > 0 ? round(recurringRevenue / recurringApproved) : 0,
      observedApprovalRate: round(observedApprovalRate),
      recurringApproved,
      recurringAttempts,
    },
    retention: {
      avgLifetimeDays,
      medianLifetimeDays,
      churned,
      windowDays: RETENTION_WINDOW_DAYS,
    },
    sources: roas.sources,
    warnings: [...warnings, ...roas.warnings],
  };
}
