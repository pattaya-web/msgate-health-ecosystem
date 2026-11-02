"use client";

import { createContext, useContext } from "react";

/**
 * La couleur du ROAS dans l'Ads Manager, calée sur le ROAS breakeven de la
 * période (page Profit : CA ÷ (CA − coût des articles − frais)) :
 * rouge sous le breakeven, orange jusqu'à breakeven + 0,2, vert au-dessus.
 * Tant que le breakeven n'est pas connu, l'ancien repère (1,2) sert.
 */
export const RoasBreakevenContext = createContext<number | null>(null);

export const ROAS_ORANGE_BAND = 0.2;

export function roasToneFor(roas: number, breakeven: number | null) {
  if (!roas) return "text-slate-400";
  if (breakeven == null) return roas >= 1.2 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  if (roas < breakeven) return "text-rose-600 dark:text-rose-400";
  if (roas < breakeven + ROAS_ORANGE_BAND) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

/** La fonction de couleur du ROAS, avec le breakeven de la page. */
export function useRoasTone() {
  const breakeven = useContext(RoasBreakevenContext);
  return (roas: number) => roasToneFor(roas, breakeven);
}
