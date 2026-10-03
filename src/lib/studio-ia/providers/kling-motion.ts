import { PROVIDERS } from "../config";
import { kieProvider } from "./kie-base";

/**
 * Kling 3.0 Motion Control (docs.kie.ai/market/kling/v3-motion-control).
 *
 * Schéma vérifié dans .cache/kie-docs/kling_motion-control-v3.md : prompt
 * (optionnel), input_urls (1 image), video_urls (1 vidéo 3-30 s), mode
 * (std | pro), character_orientation, background_source.
 *
 * Il refait ENTIÈREMENT le personnage à partir de la photo en copiant tes
 * mouvements : c'est le meilleur pour un changement complet (genre,
 * silhouette), mais il perd ce que tu tiens en main.
 */
export const klingMotion = kieProvider(PROVIDERS.klingMotion, (i) => ({
  // Le prompt est optionnel (0-2500 caracteres) mais il aide a garder le decor
  // de la video : sans lui, Kling a rendu la chambre de la photo de reference.
  prompt: (
    `Keep the source video's background, room, lighting and camera exactly as they are. ` +
    `Ignore the background of the reference image: use it only for the person's appearance.

${i.prompt}

Avoid: ${i.negativePrompt}`
  ).slice(0, 2500),
  input_urls: [i.referenceImageUrl],
  video_urls: [i.sourceVideoUrl],
  /*
   * La description de la doc parle de std / pro, mais son exemple envoie
   * « 720p » et l'API refuse « std » (« mode is not within the range of
   * allowed options »). Pour la 3.0 c'est bien la resolution en clair ;
   * seule la 2.6 attend std / pro.
   */
  mode: i.resolution === "1080p" ? "1080p" : "720p",
  character_orientation: "video",
  background_source: "input_video",
}));
