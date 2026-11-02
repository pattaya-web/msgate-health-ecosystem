import { getAssociateScope } from "@/lib/associate/scope";
import { buildSalesBreakdown } from "@/lib/metrics/sales-breakdown";
import { breakevenFrom } from "@/lib/metrics/supplier-grid";

/**
 * Le ROAS breakeven et le CPA max de la boutique (Straight sale du périmètre
 * Venom) sur une période, pour colorer le ROAS de l'Ads Manager : mêmes
 * chiffres que la page Profit (CA, coût des articles à la grille, frais de
 * paiement réglés dans Settings).
 */
export type Breakeven = {
  start: string;
  end: string;
  revenue: number;
  orders: number;
  cogs: number;
  fees: number;
  roasBreakeven: number | null;
  cpaMax: number | null;
};

const cache = ((globalThis as typeof globalThis & { __msgateBreakeven?: Map<string, { at: number; value: Breakeven }> }).__msgateBreakeven ??= new Map());

const round = (value: number) => Math.round(value * 100) / 100;

export async function buildBreakeven(start: string, end: string): Promise<Breakeven | null> {
  const key = `${start}_${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 2 * 60_000) return hit.value;
  const scope = await getAssociateScope();
  const sales = await buildSalesBreakdown({ start, end, stores: scope.stores, categories: ["direct"] });
  if (!sales) return null;
  const revenue = sales.revenue.direct;
  const orders = sales.approved.direct;
  const cogs = sales.cogs?.total ?? 0;
  const fees = (revenue * scope.processingRate) / 100;
  const value: Breakeven = { start, end, revenue: round(revenue), orders, cogs: round(cogs), fees: round(fees), ...breakevenFrom({ revenue, cogs, fees, orders }) };
  cache.set(key, { at: Date.now(), value });
  return value;
}
