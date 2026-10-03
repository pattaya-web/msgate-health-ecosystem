import { PROVIDERS } from "../config";
import { PRODUCT_ELEMENT } from "../prompts";
import { kieProvider } from "./kie-base";

/**
 * Kling 3.0 Omni — transformation (docs.kie.ai/market/kling/v3-omni-transformation).
 *
 * Schéma vérifié dans .cache/kie-docs/kling_v3-omni-transformation.md :
 * prompt (≤ 3072), video_urls (1), image_urls (≤ 4), resolution, aspect_ratio,
 * audio (bool). Pas de negative prompt : on l'ajoute au prompt en clair.
 */
export const kling = kieProvider(PROVIDERS.kling, (i) => {
  const urls = i.product?.urls ?? [];
  // Un sujet multi-images demande 2 à 4 photos : avec une seule, on la double.
  const elementUrls = urls.length === 1 ? [urls[0], urls[0]] : urls.slice(0, 4);
  return {
    prompt: `${i.prompt}${i.sceneImageUrl ? "\n\nThe last image shows the NEW location: replace the whole environment with it while keeping the motion and camera." : ""}\n\nAvoid: ${i.negativePrompt}`.slice(0, 3072),
    video_urls: [i.sourceVideoUrl],
    // Jusqu'a 4 images de la personne : face, profil, dos, tenue.
    image_urls: [...(i.referenceImageUrls?.length ? i.referenceImageUrls : [i.referenceImageUrl]), ...(i.sceneImageUrl ? [i.sceneImageUrl] : [])].slice(0, 4),
    ...(elementUrls.length
      ? {
          elements: [
            {
              name: PRODUCT_ELEMENT,
              description: i.product?.description?.trim() || "the product held in the hand",
              element_input_urls: elementUrls,
            },
          ],
        }
      : {}),
    resolution: i.resolution,
    // La doc n'annonce que « auto », mais l'API accepte un ratio explicite (vérifié :
    // en auto une vidéo verticale ressortait en 16:9).
    aspect_ratio: i.aspectRatio,
    audio: i.keepAudio,
  };
});
