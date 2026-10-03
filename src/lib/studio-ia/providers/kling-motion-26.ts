import { PROVIDERS } from "../config";
import { kieProvider } from "./kie-base";

/**
 * Kling 2.6 Motion Control (docs.kie.ai/market/kling/motion-control).
 *
 * Schéma vérifié dans .cache/kie-docs/kling_motion-control-26.md : prompt
 * (optionnel, 2500 car.), input_urls (1 image : tête, épaules et buste
 * visibles), video_urls (1 vidéo 3-30 s), character_orientation (image |
 * video), mode (720p | 1080p). Pas de background_source comme la 3.0.
 *
 * En orientation « video », il suit l'orientation du personnage de la vidéo
 * et garde la scène : c'est le réglage qui, dans l'appli Kling, remplace la
 * tête par celle de la photo en gardant le corps et le décor de la vidéo.
 */
export const klingMotion26 = kieProvider(PROVIDERS.klingMotion26, (i) => ({
  prompt: (
    `Keep the source video's background, room, lighting, camera and framing exactly as they are. ` +
    `Keep the body, clothing and gestures of the person in the video. ` +
    `Use the reference image only for the person's face, head and hair; ignore its background.

${i.prompt}

Avoid: ${i.negativePrompt}`
  ).slice(0, 2500),
  input_urls: [i.referenceImageUrl],
  video_urls: [i.sourceVideoUrl],
  // Enum de la doc : 720p | 1080p (pas std/pro comme la 3.0).
  mode: i.resolution === "1080p" ? "1080p" : "720p",
  character_orientation: "video",
}));
