"use client";

import { createContext, useContext } from "react";

/**
 * La couleur du ROAS dans l'Ads Manager, sur 4 paliers recalculés depuis la
 * grille fournisseur, le panier moyen et les frais (page Pilotage) :
 *  - rouge sous le breakeven : on perd de l'argent, baisser les budgets ;
 *  - orange jusqu'au palier « hold » : rentable mais fragile, ne rien toucher ;
 *  - vert jusqu'au palier « scale » : rentable, +20 % sur un ad set par 48 h ;
 *  - vert foncé au-delà : on scale, +30 % par 48 h.
 * Les campagnes, ad sets et créas sont jugés avec les seuils ramenés au ROAS
 * Meta (fournis par le contexte) ; le ROAS réel global avec les seuils réels.
 * Tant que les seuils ne sont pas connus, l'ancien repère (1,2) sert.
 */
export type RoasThresholds = { breakeven: number | null; hold: number | null; scale: number | null };

export const RoasBreakevenContext = createContext<RoasThresholds | null>(null);

/** Les seuils d'un autre produit (ex. 39,99 $) : ses campagnes sont repérées par leur nom (`pattern`). */
export const ProductThresholdsContext = createContext<Array<{ pattern: string; thresholds: RoasThresholds }>>([]);

export type RoasLevel = "loss" | "hold" | "good" | "scale";

export function roasLevel(roas: number | null | undefined, thresholds: RoasThresholds | null): RoasLevel | null {
  if (!roas || !thresholds?.breakeven) return null;
  if (roas < thresholds.breakeven) return "loss";
  if (thresholds.hold != null && roas < thresholds.hold) return "hold";
  if (thresholds.scale != null && roas < thresholds.scale) return "good";
  return "scale";
}

export const ROAS_LEVEL_CLASS: Record<RoasLevel, string> = {
  loss: "text-rose-600 dark:text-rose-400",
  hold: "text-amber-600 dark:text-amber-400",
  good: "text-emerald-500 dark:text-emerald-400",
  scale: "text-emerald-800 font-bold dark:text-emerald-300",
};

export const ROAS_LEVEL_TEXT: Record<RoasLevel, string> = {
  loss: "on perd de l'argent · baisser les budgets",
  hold: "rentable mais fragile · ne rien toucher",
  good: "rentable · +20 % sur un ad set par 48 h",
  scale: "on scale · +30 % par 48 h, la hyper peut monter",
};

export function roasToneFor(roas: number, thresholds: RoasThresholds | null) {
  if (!roas) return "text-slate-400";
  const level = roasLevel(roas, thresholds);
  if (!level) return roas >= 1.2 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return ROAS_LEVEL_CLASS[level];
}

/** La fonction de couleur du ROAS (Meta) des lignes de l'Ads Manager. */
export function useRoasTone() {
  const thresholds = useContext(RoasBreakevenContext);
  return (roas: number) => roasToneFor(roas, thresholds);
}
