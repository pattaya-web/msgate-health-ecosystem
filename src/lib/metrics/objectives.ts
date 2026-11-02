import { buildAssociateOverview } from "@/lib/associate/scope";
import { buildPilotage, type PilotageReport } from "@/lib/pilotage/build";
import { fetchShopifyTraffic, isShopifySalesConfigured } from "@/lib/shopify/sales-orders";
import { getSupplierGrids, gridPicker, parcelCost } from "@/lib/metrics/supplier-grid";
import { reportToday } from "@/lib/report-tz";

/**
 * Les produits suivis dans la barre : le BOGO à 29,99 $ (objectifs sur les
 * vraies ventes des 7 derniers jours) et le test à 39,99 $ (objectifs
 * calculés : prix − colis de 2 colliers à la grille − frais). `pattern`
 * repère ses campagnes par leur nom, pour les colorer avec ses seuils.
 */
const PRODUCTS = [
  { id: "bogo-2999", label: "Produit 29,99 $", price: 29.99, pattern: "" },
  { id: "bogo-3999", label: "Produit 39,99 $", price: 39.99, pattern: "39[.,]?99" },
];

type Thresholds = { breakeven: number | null; hold: number | null; scale: number | null };

export type ProductObjectives = Thresholds & {
  id: string;
  label: string;
  price: number;
  /** « ventes 7 j » : calculé sur les vraies commandes ; « grille » : prix − colis de 2 colliers − frais. */
  source: "ventes 7 j" | "grille";
  cpaMax: number | null;
  cpaTarget: number | null;
  /** Les mêmes seuils ramenés au ROAS Meta (lignes de l'Ads Manager). */
  meta: Thresholds;
  /** Repère les campagnes du produit par leur nom ; vide = toutes les autres. */
  pattern: string;
};

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
  /** Les objectifs de chaque produit (29,99 $ puis 39,99 $). */
  products: ProductObjectives[];
  builtAt: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const cache = ((globalThis as typeof globalThis & { __msgateObjectives?: Map<string, { at: number; value: ObjectivesBar }> }).__msgateObjectives ??= new Map());

export async function buildObjectivesBar(start: string, end: string): Promise<ObjectivesBar> {
  const key = `${start}_${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 2 * 60_000) return hit.value;
  const [pilotage, overview, traffic, grids] = await Promise.all([
    buildPilotage(),
    buildAssociateOverview(start, end),
    isShopifySalesConfigured() ? fetchShopifyTraffic(start, end).catch(() => null) : Promise.resolve(null),
    getSupplierGrids(),
  ]);
  const grid = gridPicker(grids, () => null)({ number: Number.MAX_SAFE_INTEGER, day: reportToday() });
  const factor = pilotage.thresholds.metaFactor;
  const toMeta = (value: number | null) => (value == null ? null : round2(factor != null ? value * factor : value));
  const t = pilotage.thresholds;
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
    products: PRODUCTS.map((product, index): ProductObjectives => {
      if (index === 0) {
        // Le produit actuel : les seuils calculés sur les vraies ventes des 7 derniers jours.
        return {
          ...product,
          source: "ventes 7 j",
          breakeven: t.breakeven,
          hold: t.hold,
          scale: t.scale,
          cpaMax: pilotage.objectives.cpaMax,
          cpaTarget: pilotage.objectives.cpaTarget,
          meta: t.meta,
        };
      }
      // Un nouveau prix : colis de 2 colliers à la grille (BOGO) et frais de paiement, mêmes écarts de paliers.
      const margin = product.price - parcelCost(grid, 2) - product.price * rate;
      const breakeven = margin > 0 ? product.price / margin : null;
      const hold = breakeven != null ? breakeven * (1.8 / 1.62) : null;
      const scale = breakeven != null ? breakeven * (2.0 / 1.62) : null;
      return {
        ...product,
        source: "grille",
        breakeven: breakeven != null ? round2(breakeven) : null,
        hold: hold != null ? round2(hold) : null,
        scale: scale != null ? round2(scale) : null,
        cpaMax: margin > 0 ? round2(margin) : null,
        cpaTarget: margin > 0 ? round2(margin * 0.75) : null,
        meta: { breakeven: toMeta(breakeven), hold: toMeta(hold), scale: toMeta(scale) },
      };
    }),
    builtAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
