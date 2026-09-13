import type { Ratio } from "@/lib/studio/ratios";

/**
 * D'où vient la créa. Le studio écrit des images, l'UGC des vidéos : chacun a
 * son stockage, mais « Toutes les créas » les montre ensemble — c'est le seul
 * endroit où l'on cherche quand on ne sait plus où on a produit.
 */
export type CreativeSource = "static" | "ugc";

export type StaticCreative = {
  id: string;
  createdAt: string;
  source?: CreativeSource;
  /** Une vidéo se lit avec <video>, pas avec <img>. */
  media?: "image" | "video";
  brief: string;
  prompt: string;
  ratio: Ratio;
  resolution: "1K" | "2K";
  resultFiles: string[];
  refFiles: string[];
};

export const STUDIO_REUSE_KEY = "msgate.studio.reuse";
