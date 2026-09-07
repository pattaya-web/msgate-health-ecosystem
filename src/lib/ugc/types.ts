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

/** Bornes de Seedance : en dehors, la tâche est refusée. */
export const MIN_CLIP_SECONDS = 4;
export const MAX_CLIP_SECONDS = 15;

/** Durées proposées par plan. Au-delà de 8s le coût grimpe vite pour peu de gain. */
export const CLIP_DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

export function clampDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return MIN_CLIP_SECONDS;
  return Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, Math.round(seconds)));
}

/** Applique une durée choisie à toutes les scènes, en respectant les bornes. */
export function withDuration(scenes: Scene[], seconds?: number): Scene[] {
  if (!seconds) return scenes;
  const duration = clampDuration(seconds);
  return scenes.map((scene) => ({ ...scene, duration }));
}

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

/** Seule la durée compte : accepte aussi bien des scènes que des plans relevés. */
export function estimateCredits(scenes: Array<{ duration: number }>, resolution: Resolution) {
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
