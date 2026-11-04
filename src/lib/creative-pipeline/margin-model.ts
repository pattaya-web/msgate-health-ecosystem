import { gridPicker, parcelCost, type getSupplierGrids } from "@/lib/metrics/supplier-grid";

/**
 * Le modèle de marge nette, commun au pipeline créa et à la rampe de scaling :
 *  ventes corrigées = achats Meta × facteur réel (commandes ÷ achats Meta) ;
 *  CA = ventes × prix + 9,99 $ × ventes × taux d'upsell ;
 *  marge = CA − ventes × coût colis − frais × CA − dépense (en $).
 */

export const UPSELL_PRICE = 9.99;
export const DEFAULT_UPSELL = 0.1;
export const DEFAULT_FACTOR = 1.1;

export type MarginCosts = { upsellRate: number; cogsPerOrder: number; feeRate: number; pieces: number; piecesDefault: boolean };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Coût colis par commande (grille fournisseur, à la moyenne de pièces par commande), frais et upsell. */
export function marginCosts(input: {
  grids: Awaited<ReturnType<typeof getSupplierGrids>>;
  today: string;
  collarsPerOrder?: number | null;
  processingRate?: number | null;
  upsellRate?: number | null;
}): MarginCosts {
  const piecesRaw = input.collarsPerOrder ?? 0;
  const pieces = piecesRaw >= 1 ? piecesRaw : 2;
  const grid = gridPicker(input.grids, () => null)({ number: Number.MAX_SAFE_INTEGER, day: input.today });
  const low = Math.max(1, Math.floor(pieces));
  const cogsPerOrder = round2(parcelCost(grid, low) + (pieces - low) * (parcelCost(grid, low + 1) - parcelCost(grid, low)));
  return { upsellRate: input.upsellRate ?? DEFAULT_UPSELL, cogsPerOrder, feeRate: (input.processingRate ?? 4) / 100, pieces, piecesDefault: piecesRaw < 1 };
}

/** La marge nette d'un total (achats Meta, dépense en $) ; pct en % du CA, null sans CA. */
export function netMargin(input: { purchases: number; spendUsd: number; factor: number; price: number }, costs: MarginCosts) {
  const sales = input.purchases * input.factor;
  const revenue = sales * input.price + UPSELL_PRICE * sales * costs.upsellRate;
  const margin = revenue - sales * costs.cogsPerOrder - revenue * costs.feeRate - input.spendUsd;
  const pct = revenue > 0 ? margin / revenue : null;
  return { sales, revenue, margin, pct: pct == null ? null : round2(pct * 100) };
}

/**
 * Le CPA Meta (dépense $ par achat Meta) qui laisse `pct` % de marge nette :
 * par achat Meta, CA = facteur × (prix + 9,99 $ × upsell) ; marge = CA × (1 − frais) − facteur × colis − CPA.
 */
export function cpaAtMargin(pct: number, input: { factor: number; price: number }, costs: MarginCosts) {
  const revenue = input.factor * (input.price + UPSELL_PRICE * costs.upsellRate);
  return round2(revenue * (1 - costs.feeRate - pct / 100) - input.factor * costs.cogsPerOrder);
}
