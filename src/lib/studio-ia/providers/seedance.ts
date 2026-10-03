import { PROVIDERS } from "../config";
import { kieProvider } from "./kie-base";

/**
 * Seedance 2 (docs.kie.ai/market/bytedance/seedance-2).
 *
 * Schéma vérifié dans .cache/kie-docs/bytedance_seedance-2.md :
 * prompt, reference_image_urls (≤ 9), reference_video_urls (≤ 3, 2-15 s,
 * ≤ 50 Mo, 480p/720p), generate_audio, resolution, aspect_ratio, duration.
 *
 * Seedance régénère la scène à partir des références : on lui dit clairement
 * de copier le mouvement de la vidéo et l'apparence de l'image.
 */
import type { ProviderInput } from "../types";

/** Payload commun a Seedance 2 et 2.5 : meme schema de references. */
export const seedancePayload = (i: ProviderInput) => ({
  prompt:
    `Use the reference video as the exact source of motion, camera, framing, timing and environment. ` +
    `Reproduce the subject's gestures exactly as performed in the reference video, second by second: do not add, remove or exaggerate any action, and do not make the subject interact with the product differently than in the video. ` +
    `The mouth must follow the reference video's speech frame by frame: same lip openings, same articulation timing, lips closed during pauses. ` +
    ((i.referenceImageUrls?.length ?? 1) > 1
      ? `The first ${i.referenceImageUrls!.length} reference images show the SAME person from different angles (face, back, outfit): use them together as the exact source of the person's appearance and clothing.`
      : `Use the first reference image as the exact source of the person's appearance.`) +
    (i.product?.urls.length
      ? ` The next ${i.product.urls.length} reference image${i.product.urls.length > 1 ? "s show" : " shows"} the product held in the hand (${i.product.description?.trim() || "the product"}): reproduce it exactly, same label, colors, text and shape, in the same hand position as the video.`
      : "") +
    (i.sceneImageUrl
      ? ` The last reference image shows the NEW location: replace the entire environment of the video with this place (walls, furniture, light, depth), at correct scale, while keeping the person's motion, framing and camera exactly as in the reference video.`
      : i.sceneFrameUrl
        ? ` The last reference image is a still frame of the reference video, provided ONLY for the environment: keep this exact room, furniture, lighting, colors and framing, but do NOT keep the person visible in that frame; the person's face, hair, gender and body must come from the first reference image only.`
        : "") +
    `\n\n${i.prompt}\n\nAvoid: ${i.negativePrompt}`,
  // Personne d'abord, puis le produit : jusqu'a 9 images au total.
  reference_image_urls: [
    ...(i.referenceImageUrls?.length ? i.referenceImageUrls : [i.referenceImageUrl]),
    ...(i.product?.urls ?? []),
    ...(i.sceneImageUrl ? [i.sceneImageUrl] : i.sceneFrameUrl ? [i.sceneFrameUrl] : []),
  ].slice(0, 9),
  reference_video_urls: [i.sourceVideoUrl],
  generate_audio: false,
  resolution: i.resolution,
  /*
   * Avec une video de reference, Seedance classe la tache en montage video
   * et refuse tout ratio fixe (« The parameter ratio ... is not valid »).
   * « adaptive » le laisse suivre le format de la source, comme duration -1.
   */
  aspect_ratio: "adaptive",
  // La doc n'accepte que 4-15 s ou -1 : -1 laisse le modele suivre la video de reference.
  duration: -1,
});

export const seedance = kieProvider(PROVIDERS.seedance, seedancePayload);
/** Seedance 2.5 : video de reference jusqu'a 30 s, duree -1 calee sur la source. */
export const seedance25 = kieProvider(PROVIDERS.seedance25, seedancePayload);
