import { buildAssociateOverview } from "@/lib/associate/scope";
import { buildPilotage, type PilotageReport } from "@/lib/pilotage/build";
import { fetchShopifyTraffic, isShopifySalesConfigured } from "@/lib/shopify/sales-orders";

/**
 * La barre « Objectifs » de l'Ads Manager : le ROAS réel global (ventes ÷
 * toute la dépense Meta du périmètre Venom, campagnes coupées comprises) sur la
 * période choisie et sur les 3 derniers jours, avec les seuils recalculés par la
 * page Pilotage (grille fournisseur, panier moyen, frais), le CPA, la
 * conversion du site, le CPC, la dépense du jour contre son plafond et le profit.
 */

export type PeriodFigures = {
  start: string;
  end: string;
  revenue: number;
  orders: number;
  spend: number;
  roas: number | null;
  cpa: number | null;
  /** Commandes ÷ visites Shopify, en %. */
  conversion: number | null;
  cartRate: number | null;
  profit: number;
};

export type ObjectivesBar = {
  period: PeriodFigures;
  last3: { roas: number | null; cpa: number | null; profit: number; spend: number; revenue: number; orders: number };
  today: { spend: number; profit: number; roas: number | null };
  thresholds: PilotageReport["thresholds"];
  cpaMax: number | null;
  cpaTarget: number | null;
  spendCap: number | null;
  budgetsTotal: number;
  cpc: { today: number | null; avg7: number | null };
  builtAt: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const cache = ((globalThis as typeof globalThis & { __msgateObjectives?: Map<string, { at: number; value: ObjectivesBar }> }).__msgateObjectives ??= new Map());

export async function buildObjectivesBar(start: string, end: string): Promise<ObjectivesBar> {
  const key = `${start}_${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 2 * 60_000) return hit.value;
  const [pilotage, overview, traffic] = await Promise.all([
    buildPilotage(),
    buildAssociateOverview(start, end),
    isShopifySalesConfigured() ? fetchShopifyTraffic(start, end).catch(() => null) : Promise.resolve(null),
  ]);
  const rate = pilotage.objectives.processingRate / 100;
  const revenue = overview.sales.revenue;
  const orders = overview.sales.orders;
  const spend = overview.meta.spend;
  const cogs = overview.profit.cogs;
  const last3 = pilotage.profit.last3;
  const value: ObjectivesBar = {
    period: {
      start,
      end,
      revenue: round2(revenue),
      orders,
      spend: round2(spend),
      roas: spend > 0 ? round2(revenue / spend) : null,
      cpa: orders > 0 && spend > 0 ? round2(spend / orders) : null,
      conversion: traffic && traffic.sessions ? round2((orders / traffic.sessions) * 100) : null,
      cartRate: traffic && traffic.sessions ? round2((traffic.cart / traffic.sessions) * 100) : null,
      profit: round2(revenue - cogs - revenue * rate - spend),
    },
    last3: { roas: last3.roas, cpa: last3.orders ? round2(last3.spend / last3.orders) : null, profit: last3.profit, spend: last3.spend, revenue: last3.revenue, orders: last3.orders },
    today: { spend: pilotage.profit.today.spend, profit: pilotage.profit.today.profit, roas: pilotage.profit.today.roas },
    thresholds: pilotage.thresholds,
    cpaMax: pilotage.objectives.cpaMax,
    cpaTarget: pilotage.objectives.cpaTarget,
    spendCap: pilotage.objectives.spendCap,
    budgetsTotal: pilotage.objectives.budgetsTotal,
    cpc: { today: pilotage.ads.cpcToday, avg7: pilotage.ads.cpc7 },
    builtAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
