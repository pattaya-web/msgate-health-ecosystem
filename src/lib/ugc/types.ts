/** Une scène = un clip. Seedance accepte 4 à 15 secondes par génération. */
export type Scene = {
  label: string;
  prompt: string;
  duration: number;
};

export type Angle = {
  id: string;
  name: string;
  /** Ce que l'angle attaque : sert à choisir vite dans la grille. */
  pitch: string;
  scenes: Scene[];
};

import type { ProductKind } from "@/lib/ugc/kinds";

export type ProductInput = {
  handle: string;
  name: string;
  description: string;
  price: string;
  comparePrice: string;
  brand: string;
  keyPoints: string[];
  imageUrls: string[];
  kind: ProductKind;
};

export type UgcJob = {
  angleId: string;
  angleName: string;
  sceneLabel: string;
  prompt: string;
  duration: number;
  taskId: string | null;
  error: string | null;
  state: "pending" | "done" | "fail";
  urls: string[];
  /** Nom du mp4 rapatrié sur disque, quand le clip a abouti. */
  file?: string;
};

export const RESOLUTIONS = ["720p", "1080p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * Crédits par seconde de vidéo, MESURÉS le 2026-08-24 : 53 secondes générées ont
 * coûté 5 400 crédits, soit ~102 crédits/seconde. Kie ne publie pas ce tarif,
 * et il est très supérieur à ce qu'on pourrait supposer — d'où le garde-fou sur
 * le solde avant chaque lot. Le 1080p est extrapolé au double, non mesuré.
 */
export const CREDITS_PER_SECOND: Record<Resolution, number> = {
  "720p": 102,
  "1080p": 204,
};

export function estimateCredits(scenes: Scene[], resolution: Resolution) {
  const seconds = scenes.reduce((total, scene) => total + scene.duration, 0);
  return Math.round(seconds * CREDITS_PER_SECOND[resolution]);
}

/** Tarif public Kie : 0,005 $ le crédit, soit 200 crédits pour un dollar. */
export const USD_PER_CREDIT = 0.005;

export function formatUsd(credits: number) {
  return (credits * USD_PER_CREDIT).toLocaleString("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
