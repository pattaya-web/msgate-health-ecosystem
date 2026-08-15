import { buildOverview } from "@/lib/phoenix/analytics";
import { getPhoenixConfig } from "@/lib/phoenix/client";
import { peekSnapshot } from "@/lib/phoenix/snapshot";
import { getShopifyDaily, isShopifyConfigured } from "@/lib/shopify/client";
import { getMetaDailySpend, isMetaConfigured } from "@/lib/meta/client";
import type { CampaignBucket } from "@/lib/meta/buckets";
import { getSpendRange } from "@/lib/metrics/spend-store";
import type { RefundAttribution } from "@/lib/shopify/types";

/**
 * ROAS model
 *
 * Direct sales are read from Shopify, never from Phoenix: the storefront is the
 * source of truth for one-time purchases. Phoenix contributes only the
 * subscription legs — initial, recurring and salvage. Upsells are deliberately
 * left out so the ratio stays comparable week over week.
 */

export type RoasDailyPoint = {
  date: string;
  /** Meta API + manual entries. */
  spend: number;
  spendMeta: number;
  spendManual: number;
  /** Shopify net sales: gross − discounts − returns. */
  directRevenue: number;
  shopifyReturns: number;
  shopifyOrders: number;
  initialRevenue: number;
  recurringRevenue: number;
  salvageRevenue: number;
  /** initial + recurring + salvage. */
  rebillRevenue: number;
  totalRevenue: number;
  roasDirect: number | null;
  roasRebill: number | null;
  roasGlobal: number | null;
};

export type RoasDaily = {
  range: { start: string; end: string };
  currency: string;
  attribution: RefundAttribution;
  series: RoasDailyPoint[];
  totals: {
    spend: number;
    spendMeta: number;
    spendManual: number;
    directRevenue: number;
    shopifyReturns: number;
    shopifyOrders: number;
    initialRevenue: number;
    recurringRevenue: number;
    salvageRevenue: number;
    rebillRevenue: number;
    totalRevenue: number;
    roasDirect: number | null;
    roasRebill: number | null;
    roasGlobal: number | null;
  };
  sources: {
    shopify: "live" | "unavailable";
    phoenix: "live" | "building" | "unavailable";
    spend: "meta" | "meta+manual" | "manual" | "missing";
  };
  meta: {
    accounts: Array<{
      id: string;
      name: string;
      status: number;
      spend: number;
      buckets: Record<CampaignBucket, number>;
    }>;
    campaigns: Array<{
      accountName: string;
      campaignName: string;
      bucket: CampaignBucket;
      spend: number;
    }>;
    byBucket: Record<CampaignBucket, number>;
    /** Buckets counted in the ROAS; empty means all of them. */
    bucketFilter: CampaignBucket[];
    tokensTotal: number;
    tokensWorking: number;
    errors: string[];
  } | null;
  /** Days inside the range with revenue but no spend recorded. */
  missingSpendDates: string[];
  warnings: string[];
};

const ratio = (revenue: number, spend: number) =>
  spend > 0 ? Number((revenue / spend).toFixed(2)) : null;

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

export async function buildRoasDaily(params: {
  start: string;
  end: string;
  attribution?: RefundAttribution;
  /** Restrict the spend side to campaign phases, e.g. only scaling. */
  buckets?: CampaignBucket[];
}): Promise<RoasDaily> {
  const { start, end } = params;
  const attribution = params.attribution || "processed";
  const warnings: string[] = [];

  const sources: RoasDaily["sources"] = {
    shopify: "unavailable",
    phoenix: "unavailable",
    spend: "missing",
  };

  // --- Shopify: direct sales -------------------------------------------
  const shopifyByDate = new Map<string, { net: number; returns: number; orders: number }>();
  let currency = "USD";

  if (isShopifyConfigured()) {
    try {
      const shopify = await getShopifyDaily({ start, end, attribution });
      currency = shopify.currency;
      for (const point of shopify.series) {
        shopifyByDate.set(point.date, {
          net: point.netSales,
          returns: point.returns,
          orders: point.orders,
        });
      }
      sources.shopify = "live";
      warnings.push(...shopify.warnings);
    } catch (error) {
      warnings.push(
        `Shopify indisponible : ${error instanceof Error ? error.message : "erreur inconnue"}`
      );
    }
  } else {
    warnings.push("Shopify non configuré — les direct sales sont à zéro.");
  }

  // --- Phoenix: subscription legs --------------------------------------
  const phoenixByDate = new Map<string, { initial: number; recurring: number; salvage: number }>();
  const phoenixConfig = getPhoenixConfig();

  if (phoenixConfig) {
    const snapshot = await peekSnapshot();
    if (snapshot) {
      const overview = buildOverview(snapshot, {
        start,
        end,
        stores: [],
        processors: [],
        client: phoenixConfig.clientLabel,
        targetCac: null,
      });
      for (const point of overview.revenue.series) {
        phoenixByDate.set(point.date, {
          initial: point.initial,
          recurring: point.recurring,
          salvage: point.salvage,
        });
      }
      sources.phoenix = "live";
      if (!overview.meta.complete) {
        warnings.push(
          `Snapshot Phoenix incomplet (${Math.round(overview.meta.coverage * 100)}% de couverture) — les revenus abonnement vont encore monter.`
        );
      }
    } else {
      sources.phoenix = "building";
      warnings.push("Snapshot Phoenix en cours de construction — revenus abonnement à zéro.");
    }
  } else {
    warnings.push("Phoenix non configuré — les revenus abonnement sont à zéro.");
  }

  // --- Ad spend ---------------------------------------------------------
  // Meta only exposes the accounts its tokens own, so manual entries top it up
  // for the Business Managers we cannot read. The two are summed, never merged.
  const manualByDate = await getSpendRange(start, end);
  const metaByDate = new Map<string, number>();
  let metaInfo: RoasDaily["meta"] = null;

  if (isMetaConfigured()) {
    try {
      const meta = await getMetaDailySpend({ start, end, buckets: params.buckets });
      for (const [date, amount] of meta.byDate) metaByDate.set(date, amount);
      metaInfo = {
        accounts: meta.accounts.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          spend: a.spend,
          buckets: a.buckets,
        })),
        campaigns: meta.campaigns.map((c) => ({
          accountName: c.accountName,
          campaignName: c.campaignName,
          bucket: c.bucket,
          spend: c.spend,
        })),
        byBucket: meta.byBucket,
        bucketFilter: params.buckets ?? [],
        tokensTotal: meta.tokensTotal,
        tokensWorking: meta.tokensWorking,
        errors: meta.errors,
      };
      if (meta.errors.length) {
        warnings.push(
          `${meta.tokensTotal - meta.tokensWorking} token(s) Meta injoignable(s) — le spend de ces comptes est absent.`
        );
      }
      if (meta.currencies.length > 1) {
        warnings.push(
          `Comptes Meta en devises multiples (${meta.currencies.join(", ")}) — les montants sont additionnés sans conversion.`
        );
      }
    } catch (error) {
      warnings.push(`Meta indisponible : ${error instanceof Error ? error.message : "erreur"}`);
    }
  }

  const hasMeta = metaByDate.size > 0;
  const hasManual = manualByDate.size > 0;
  sources.spend = hasMeta && hasManual ? "meta+manual" : hasMeta ? "meta" : hasManual ? "manual" : "missing";

  // --- Merge ------------------------------------------------------------
  const missingSpendDates: string[] = [];

  const series: RoasDailyPoint[] = eachDay(start, end).map((date) => {
    const shopify = shopifyByDate.get(date);
    const phoenix = phoenixByDate.get(date);
    const spendMeta = Number((metaByDate.get(date) ?? 0).toFixed(2));
    const spendManual = manualByDate.get(date)?.amount ?? 0;
    const spend = Number((spendMeta + spendManual).toFixed(2));

    const directRevenue = shopify?.net ?? 0;
    const initialRevenue = phoenix?.initial ?? 0;
    const recurringRevenue = phoenix?.recurring ?? 0;
    const salvageRevenue = phoenix?.salvage ?? 0;
    const rebillRevenue = initialRevenue + recurringRevenue + salvageRevenue;
    const totalRevenue = directRevenue + rebillRevenue;

    if (spend <= 0 && totalRevenue > 0) missingSpendDates.push(date);

    return {
      date,
      spend,
      spendMeta,
      spendManual,
      directRevenue,
      shopifyReturns: shopify?.returns ?? 0,
      shopifyOrders: shopify?.orders ?? 0,
      initialRevenue,
      recurringRevenue,
      salvageRevenue,
      rebillRevenue,
      totalRevenue,
      roasDirect: ratio(directRevenue, spend),
      roasRebill: ratio(rebillRevenue, spend),
      roasGlobal: ratio(totalRevenue, spend),
    };
  });

  const sum = (pick: (point: RoasDailyPoint) => number) =>
    series.reduce((acc, point) => acc + pick(point), 0);

  const spend = sum((p) => p.spend);
  const directRevenue = sum((p) => p.directRevenue);
  const initialRevenue = sum((p) => p.initialRevenue);
  const recurringRevenue = sum((p) => p.recurringRevenue);
  const salvageRevenue = sum((p) => p.salvageRevenue);
  const rebillRevenue = initialRevenue + recurringRevenue + salvageRevenue;
  const totalRevenue = directRevenue + rebillRevenue;

  return {
    range: { start, end },
    currency,
    attribution,
    series,
    totals: {
      spend,
      spendMeta: Number(sum((p) => p.spendMeta).toFixed(2)),
      spendManual: sum((p) => p.spendManual),
      directRevenue,
      shopifyReturns: sum((p) => p.shopifyReturns),
      shopifyOrders: sum((p) => p.shopifyOrders),
      initialRevenue,
      recurringRevenue,
      salvageRevenue,
      rebillRevenue,
      totalRevenue,
      roasDirect: ratio(directRevenue, spend),
      roasRebill: ratio(rebillRevenue, spend),
      roasGlobal: ratio(totalRevenue, spend),
    },
    sources,
    meta: metaInfo,
    missingSpendDates,
    warnings,
  };
}
