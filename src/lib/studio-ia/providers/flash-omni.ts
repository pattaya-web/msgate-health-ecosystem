import { PROVIDERS } from "../config";
import { kieProvider } from "./kie-base";

/**
 * Gemini Omni Flash 1.1 (docs.kie.ai/market/google/gemini-omni-flash-1-1).
 *
 * Schéma vérifié dans .cache/kie-docs/google_gemini-omni-flash-1-1.md :
 * prompt, image_urls (≤ 7), video_list [{ url, start, ends }] (1 clip, ≤ 10 s
 * de plage), aspect_ratio (16:9 | 9:16), resolution (360p/720p/1080p/4k).
 * Pas de 1:1 : on retombe sur 9:16.
 */
export const flashOmni = kieProvider(PROVIDERS.flashOmni, (i) => ({
  prompt:
    `Use the provided video clip as the exact source of motion, camera, framing, timing and environment, ` +
    `and the provided image as the exact source of the person's appearance.\n\n${i.prompt}\n\nAvoid: ${i.negativePrompt}`,
  image_urls: [i.referenceImageUrl],
  // La plage ne doit pas dépasser la vidéo elle-même, ni 10 s.
  video_list: [{ url: i.sourceVideoUrl, start: 0, ends: Math.min(10, Math.max(0.5, Number((i.durationSec || 10).toFixed(2)))) }],
  aspect_ratio: i.aspectRatio === "16:9" ? "16:9" : "9:16",
  resolution: i.resolution,
}));
