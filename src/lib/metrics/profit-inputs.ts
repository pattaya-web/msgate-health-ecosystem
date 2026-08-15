import { buildOverview } from "@/lib/phoenix/analytics";
import { getPhoenixConfig } from "@/lib/phoenix/client";
import { peekSnapshot } from "@/lib/phoenix/snapshot";
import { buildRetention } from "@/lib/phoenix/retention";
import { buildRoasDaily } from "@/lib/metrics/roas-daily";

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
  currency: string;
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

  const config = getPhoenixConfig();
  const snapshot = config ? await peekSnapshot() : null;

  if (snapshot && config) {
    const overview = buildOverview(snapshot, {
      start,
      end,
      stores: [],
      processors: [],
      client: config.clientLabel,
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

  return {
    range: { start, end, days },
    currency: roas.currency,
    revenue: round(shopifyProcessed + totals.rebillRevenue),
    refunds: round(totals.shopifyReturns + phoenixRefunds),
    transactions: totals.shopifyOrders + subscriptionPayments,
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
