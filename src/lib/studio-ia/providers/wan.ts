import { PROVIDERS } from "../config";
import { kieProvider } from "./kie-base";

/**
 * Wan 2.7 — video edit (docs.kie.ai/market/wan/2-7-videoedit).
 *
 * Schéma vérifié dans .cache/kie-docs/wan_2-7-videoedit.md :
 * video_url, reference_image, prompt, negative_prompt (≤ 500), resolution,
 * aspect_ratio, duration (0 = toute la vidéo), audio_setting (origin|auto),
 * prompt_extend.
 */
export const wan = kieProvider(PROVIDERS.wan, (i) => ({
  video_url: i.sourceVideoUrl,
  reference_image: i.referenceImageUrl,
  prompt: i.prompt.slice(0, 5000),
  negative_prompt: i.negativePrompt.slice(0, 500),
  resolution: i.resolution,
  aspect_ratio: i.aspectRatio,
  duration: 0,
  // « origin » force la piste d'origine : c'est elle qu'on remplace ensuite si besoin.
  audio_setting: i.keepAudio ? "origin" : "auto",
  // Le prompt est déjà long et précis : la réécriture automatique le diluerait.
  prompt_extend: false,
  watermark: false,
}));
