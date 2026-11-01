import { getAssociateScope, type AssociateOverview } from "@/lib/associate/scope";
import { buildSalesBreakdown } from "@/lib/metrics/sales-breakdown";
import { shopifyDirectMode } from "@/lib/shopify/live-sales";
import type { OrderCategory } from "@/lib/phoenix/types";
import { buildOverview } from "@/lib/phoenix/analytics";
import { resolveSource } from "@/lib/phoenix/sources";

/**
 * Ce que l'admin voit en plus d'Alison sur Ventes & Meta Ads : le chiffre
 * d'affaires des boutiques du périmètre par catégorie de vente (Straight
 * sale, VIP Initial, Recurring, Salvage, Upsell) et le ROAS combined (tout ce
 * chiffre ÷ la dépense Meta du périmètre).
 *
 * Servi seulement à une session admin, par /api/associate/overview : la
 * réponse d'Alison n'en contient jamais rien.
 */

export type AdminSalesCategory = { revenue: number | null; orders: number | null };

export type AdminSales = {
  /** « reign » : toutes les catégories ; « shopify » : site en ligne sans Reign, seules les ventes directes existent. */
  source: "reign" | "shopify";
  categories: Record<OrderCategory, AdminSalesCategory>;
  /** Toutes catégories confondues. */
  total: number;
  roasCombined: number | null;
  /** Les abonnés des boutiques du périmètre (même calcul que la page Stats), null sans Reign. */
  subscribers: { active: number; salvage: number; paused: number | null; cancelled: number } | null;
  /** Le taux d'approbation de la période, toutes tentatives confondues. */
  approval: { rate: number; approved: number; attempts: number } | null;
  /** Par MID / processeur : tentatives, approuvées, taux, chiffre encaissé. */
  processors: Array<{ name: string; attempts: number; approved: number; approvalRate: number; revenue: number }>;
};

const TTL_MS = 15_000;

type Breakdown = Awaited<ReturnType<typeof buildSalesBreakdown>>;

/** Le découpage relu au plus toutes les 15 s par période : la page se rafraîchit à ce rythme. */
const state = ((globalThis as typeof globalThis & { __msgateAdminSales?: Map<string, { at: number; breakdown: Breakdown }> }).__msgateAdminSales ??= new Map());

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Les catégories sur la même période et les mêmes boutiques que la vue
 * Associé. Le Straight sale reprend le chiffre de la carte « Chiffre
 * d'affaires » (une vente par commande), pour que les deux ne divergent pas.
 */
export async function buildAdminSales(overview: AssociateOverview): Promise<AdminSales> {
  const { start, end } = overview.range;
  const key = `${start}:${end}`;
  // En Shopify direct, seules les ventes directes existent : rien à relire, la carte CA fait foi.
  const source: AdminSales["source"] = shopifyDirectMode() ? "shopify" : "reign";
  let breakdown: Breakdown = null;
  if (source === "reign") {
    const cached = state.get(key);
    if (cached && Date.now() - cached.at <= TTL_MS) breakdown = cached.breakdown;
    else {
      const scope = await getAssociateScope();
      breakdown = await buildSalesBreakdown({ start, end, stores: scope.stores }).catch(() => null);
      // Un instantané encore en construction n'est pas gardé : le prochain appel relit.
      if (breakdown) state.set(key, { at: Date.now(), breakdown });
    }
  }
  const other = (category: OrderCategory): AdminSalesCategory =>
    source === "shopify" ? { revenue: null, orders: null } : { revenue: breakdown?.revenue[category] ?? 0, orders: breakdown?.approved[category] ?? 0 };
  const categories: Record<OrderCategory, AdminSalesCategory> = {
    direct: { revenue: overview.sales.revenue, orders: overview.sales.orders },
    initial: other("initial"),
    recurring: other("recurring"),
    salvage: other("salvage"),
    upsell: other("upsell"),
  };
  const total = round2(Object.values(categories).reduce((sum, entry) => sum + (entry.revenue ?? 0), 0));

  // Abonnés et approbation : le même tableau que la page Stats, sur les boutiques et la période de la vue.
  let subscribers: AdminSales["subscribers"] = null;
  let approval: AdminSales["approval"] = null;
  let processors: AdminSales["processors"] = [];
  if (source === "reign") {
    const snapshot = await resolveSource(null).peekSnapshot().catch(() => null);
    if (snapshot) {
      const scope = await getAssociateScope();
      const stats = buildOverview(snapshot, { start, end, stores: scope.stores });
      subscribers = {
        active: stats.lifetime.activeSubscriptions,
        salvage: stats.lifetime.subscribersInSalvage,
        paused: stats.lifetime.pausedSubscriptions,
        cancelled: stats.lifetime.cancelledSubscriptions,
      };
      const attempts = stats.checkout.processors.reduce((sum, row) => sum + row.attempts, 0);
      const approved = stats.checkout.processors.reduce((sum, row) => sum + row.approved, 0);
      approval = { rate: attempts ? (approved / attempts) * 100 : 0, approved, attempts };
      processors = stats.checkout.processors
        .filter((row) => row.attempts > 0)
        .map((row) => ({ name: row.name, attempts: row.attempts, approved: row.approved, approvalRate: row.approvalRate, revenue: round2(row.revenue) }))
        .sort((a, b) => b.attempts - a.attempts);
    }
  }
  return { source, categories, total, roasCombined: overview.meta.spend > 0 ? total / overview.meta.spend : null, subscribers, approval, processors };
}
