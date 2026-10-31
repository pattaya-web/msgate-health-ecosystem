import type { MetadataRoute } from "next";
import { BRAND_PAPER } from "@/components/layout/app-icon-art";

/**
 * L'outil installé comme une appli (Safari › Partager › « Sur l'écran
 * d'accueil », ou « Installer » sur Chrome) : plein écran sans barre
 * d'adresse, ouvert sur les Stats (l'associée est ramenée sur son espace).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MSGate",
    short_name: "MSGate",
    description: "Le cockpit MSGate : ventes, pubs, SAV et studio.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND_PAPER,
    theme_color: BRAND_PAPER,
    lang: "fr",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
