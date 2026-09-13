import { z } from "zod";
import { listProducts } from "@/lib/creative-engine/store";
import { fetchAlerts, fetchMerchants, disputifierKeys } from "@/lib/disputifier/client";
import { ALERT_TYPES, sumTotals } from "@/lib/disputifier/types";
import { checklistScore, evaluateSite } from "@/lib/ecom-sites/checklist";
import { listEcomSites } from "@/lib/ecom-sites/store";
import { buildProfitInputs } from "@/lib/metrics/profit-inputs";
import { buildOverview } from "@/lib/phoenix/analytics";
import { getPhoenixConfig } from "@/lib/phoenix/client";
import { peekSnapshot } from "@/lib/phoenix/snapshot";
import type { ReadonlyTool } from "@/hermes/types";

/**
 * get_business_overview — « comment va le business ? » en un appel.
 *
 * Tout vient de fonctions que le CRM utilise déjà pour ses propres écrans :
 * le calcul de profit (Phoenix + Shopify + dépenses Meta/manuelles), la vue
 * Phoenix (abonnements, processeurs, approbation), les alertes Disputifier, les
 * boutiques construites et les produits analysés. Chaque champ absent est null
 * avec la raison dans `dataSources` ou `warnings` : rien n'est inventé.
 */

const round = (value: number) => Number(value.toFixed(2));
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Les N derniers jours complets, aujourd'hui exclu : le même préréglage que l'écran Profit. */
function presetRange(days: number) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export const businessOverviewInput = z
  .object({
    start: z.string().refine(isDate, "YYYY-MM-DD").optional(),
    end: z.string().refine(isDate, "YYYY-MM-DD").optional(),
    days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional().describe("Last N complete days when start/end are omitted (default 30)"),
    includeStores: z.boolean().optional().default(true),
    includeRisk: z.boolean().optional().default(true).describe("Query Disputifier alerts for the window (one external call per merchant and alert type)"),
  })
  .strict();

export type BusinessOverviewInput = z.infer<typeof businessOverviewInput>;

export type BusinessOverview = {
  range: { start: string; end: string; days: number };
  currency: string;
  revenue: {
    total: number;
    initial: number;
    recurring: number;
    salvage: number;
    upsell: number;
    direct: number;
    shopifyOrders: number;
  };
  adSpend: { total: number; meta: number; manual: number; source: string };
  roas: number | null;
  refunds: { total: number; phoenix: number; shopifyReturns: number; rate: number | null };
  chargebacks: { count: number; amount: number; rate: number | null };
  transactions: number;
  subscriptions: {
    active: number;
    paused: number | null;
    inSalvage: number;
    cancelledLifetime: number;
    createdInRange: number;
    cancelledInRange: number;
    netInRange: number;
  } | null;
  retention: { avgLifetimeDays: number; medianLifetimeDays: number; churned: number; windowDays: number };
  processing: {
    approvalRate: number | null;
    initialApprovalRate: number | null;
    recurringApprovalRate: number | null;
    processors: Array<{ name: string; attempts: number; approved: number; approvalRate: number; revenue: number; refunds: number }>;
  };
  risk: {
    alerts: { count: number; amount: number; byType: Record<string, { count: number; amount: number }> } | null;
    chargebackRate: number | null;
    refundRate: number | null;
  };
  stores: {
    count: number;
    list: Array<{ slug: string; brandName: string; domain: string | null; productCount: number; pageCount: number; checklist: { ok: number; warns: number; fails: number; ready: boolean } }>;
  } | null;
  products: { analysed: number; inStores: number };
  dataSources: {
    phoenix: string;
    phoenixSnapshotAt: string | null;
    phoenixComplete: boolean | null;
    shopify: string;
    spend: string;
    disputifier: "ok" | "not-configured" | "skipped" | "error";
  };
  warnings: string[];
};

async function riskSummary(range: { start: string; end: string }): Promise<{ status: BusinessOverview["dataSources"]["disputifier"]; alerts: BusinessOverview["risk"]["alerts"]; warnings: string[] }> {
  if (!disputifierKeys().length) return { status: "not-configured", alerts: null, warnings: [] };
  try {
    const { merchants, errors } = await fetchMerchants();
    const result = await fetchAlerts({ merchants, types: [...ALERT_TYPES], startdate: range.start, enddate: range.end, inferMids: false });
    const totals = sumTotals(result.alerts);
    const warnings = [...errors, ...result.errors].map((message) => `disputifier: ${message.slice(0, 120)}`);
    if (result.truncated) warnings.push("disputifier: alert list truncated, totals are a lower bound");
    return { status: "ok", alerts: { count: totals.count, amount: round(totals.amount), byType: totals.byType }, warnings };
  } catch (error) {
    return { status: "error", alerts: null, warnings: [`disputifier: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`] };
  }
}

export const businessOverviewTool: ReadonlyTool<BusinessOverviewInput, BusinessOverview> = {
  name: "get_business_overview",
  description:
    "Revenue by category, ad spend, ROAS, refunds, chargebacks, subscriptions, processing approval and dispute alerts over a date window, plus the built stores and analysed products. Read-only; every figure comes from the CRM's own calculations.",
  input: businessOverviewInput,
  async run(input) {
    const range = input.start && input.end ? { start: input.start, end: input.end } : presetRange(input.days ?? 30);
    const warnings: string[] = [];

    /* 1. Argent : le même calcul que l'écran Profit (Phoenix + Shopify + dépenses). */
    const profit = await buildProfitInputs(range);
    warnings.push(...profit.warnings);

    /* 2. Abonnements et processeurs : la vue Phoenix, sur le même cache. */
    const config = getPhoenixConfig();
    const snapshot = config ? await peekSnapshot() : null;
    const overview = snapshot && config ? buildOverview(snapshot, { start: range.start, end: range.end, stores: [], processors: [], client: config.clientLabel, targetCac: null }) : null;

    /* 3. Litiges. */
    const risk = input.includeRisk ? await riskSummary(range) : { status: "skipped" as const, alerts: null, warnings: [] };
    warnings.push(...risk.warnings);

    /* 4. Boutiques et produits : ce que l'outil a construit et analysé. */
    const sites = await listEcomSites();
    const analysed = await listProducts();
    const stores = input.includeStores
      ? {
          count: sites.length,
          list: sites.map((site) => {
            const score = checklistScore(evaluateSite(site));
            return {
              slug: site.slug,
              brandName: site.brandName,
              domain: site.domain || null,
              productCount: site.products.length,
              pageCount: site.pages?.length ?? 0,
              checklist: { ok: score.ok, warns: score.warns, fails: score.fails, ready: score.ready },
            };
          }),
        }
      : null;

    const refundsTotal = round(profit.refunds);
    const data: BusinessOverview = {
      range: { start: profit.range.start, end: profit.range.end, days: profit.range.days },
      currency: profit.currency,
      revenue: {
        total: round(profit.revenue),
        initial: round(profit.breakdown.phoenixInitial),
        recurring: round(profit.breakdown.phoenixRecurring),
        salvage: round(profit.breakdown.phoenixSalvage),
        upsell: round(overview?.revenue.upsell ?? 0),
        direct: round(overview?.revenue.direct ?? 0),
        shopifyOrders: round(profit.breakdown.shopifyProcessed),
      },
      adSpend: {
        total: round(profit.ads),
        meta: round(profit.breakdown.metaSpend),
        manual: round(Math.max(0, profit.ads - profit.breakdown.metaSpend)),
        source: profit.sources.spend,
      },
      roas: profit.ads > 0 ? round(profit.revenue / profit.ads) : null,
      refunds: {
        total: refundsTotal,
        phoenix: round(profit.breakdown.phoenixRefunds),
        shopifyReturns: round(profit.breakdown.shopifyReturns),
        rate: profit.revenue > 0 ? round(refundsTotal / profit.revenue) : null,
      },
      chargebacks: {
        count: profit.chargebacks,
        amount: round(profit.chargebackValue),
        rate: profit.transactions > 0 ? round(profit.chargebacks / profit.transactions) : null,
      },
      transactions: profit.transactions,
      subscriptions: overview
        ? {
            active: overview.lifetime.activeSubscriptions,
            paused: overview.lifetime.pausedSubscriptions,
            inSalvage: overview.lifetime.subscribersInSalvage,
            cancelledLifetime: overview.lifetime.cancelledSubscriptions,
            createdInRange: overview.subscriptions.created,
            cancelledInRange: overview.subscriptions.cancelled,
            netInRange: overview.subscriptions.net,
          }
        : null,
      retention: profit.retention,
      processing: {
        approvalRate: overview ? round(overview.period.approvalRate) : null,
        initialApprovalRate: overview ? round(overview.orderSummary.initial.approvalRate) : null,
        recurringApprovalRate: overview ? round(overview.orderSummary.recurring.approvalRate) : null,
        processors: (overview?.checkout.processors ?? []).map((row) => ({
          name: row.name,
          attempts: row.attempts,
          approved: row.approved,
          approvalRate: round(row.approvalRate),
          revenue: round(row.revenue),
          refunds: row.refunds,
        })),
      },
      risk: {
        alerts: risk.alerts,
        chargebackRate: overview ? round(overview.period.chargebacks.rate) : null,
        refundRate: overview ? round(overview.period.refunds.rate) : null,
      },
      stores,
      products: { analysed: analysed.length, inStores: sites.reduce((sum, site) => sum + site.products.length, 0) },
      dataSources: {
        phoenix: profit.sources.phoenix,
        phoenixSnapshotAt: overview?.meta.builtAt ?? null,
        phoenixComplete: overview ? overview.meta.complete : null,
        shopify: profit.sources.shopify,
        spend: profit.sources.spend,
        disputifier: risk.status,
      },
      warnings,
    };
    return data;
  },
};
