import { RATIOS, type Ratio } from "@/lib/studio/ratios";

/**
 * Les modèles Kie ouverts au prompt libre, image et vidéo.
 *
 * Chaque famille regroupe un modèle texte et, quand il existe, son jumeau
 * image-to-image ; le studio choisit le second dès qu'une référence est
 * jointe. `build` traduit les réglages communs (prompt, ratio, taille, durée,
 * références) dans les paramètres exacts documentés par Kie pour ce modèle
 * (docs.kie.ai/market/…, relus le 15 sept. 2026) : un ratio que le modèle ne
 * connaît pas est remplacé par le plus proche qu'il accepte, jamais inventé.
 */

export type ModelKind = "image" | "video";

export type BuildInput = {
  prompt: string;
  ratio: Ratio;
  resolution: string;
  referenceUrls: string[];
  duration?: number;
};

export type ModelFamily = {
  id: string;
  label: string;
  vendor: string;
  kind: ModelKind;
  /** Identifiant Kie sans référence ; null si la famille exige une image. */
  textModel: string | null;
  /** Identifiant Kie avec référence(s) ; null si la famille n'accepte pas d'image. */
  imageModel: string | null;
  /** Ratios (parmi les nôtres) que le modèle accepte ; vide = le modèle ne règle pas le cadre. */
  ratios: Ratio[];
  /** Options de taille proposées ; vide = le modèle ne règle pas la taille. */
  resolutions: string[];
  /** Durées proposées (vidéo). */
  durations?: number[];
  maxRefs: number;
  note?: string;
  build: (input: BuildInput) => Record<string, unknown>;
};

const ALL: Ratio[] = RATIOS.map((entry) => entry.id);

function value(ratio: Ratio) {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}

/** Le ratio accepté le plus proche du ratio demandé. */
export function closestRatio(ratio: Ratio, allowed: Ratio[]): Ratio {
  if (!allowed.length || allowed.includes(ratio)) return ratio;
  const target = value(ratio);
  return [...allowed].sort((a, b) => Math.abs(value(a) - target) - Math.abs(value(b) - target))[0];
}

function pick<T extends string>(wanted: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(wanted) ? (wanted as T) : fallback;
}

function clampDuration(duration: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(duration)) return fallback;
  return Math.min(max, Math.max(min, Math.round(duration as number)));
}

/** Tailles nommées (Seedream 4, Ideogram) : le cadre le plus proche de nos ratios. */
const NAMED_SIZE: Record<Ratio, string> = { "1:1": "square_hd", "3:4": "portrait_4_3", "9:16": "portrait_16_9", "4:3": "landscape_4_3", "16:9": "landscape_16_9" };

const R_NO_WIDE: Ratio[] = ["1:1", "3:4", "9:16", "4:3", "16:9"];
const R_SQUARE_TALL_WIDE: Ratio[] = ["1:1", "9:16", "16:9"];

export const MODEL_FAMILIES: ModelFamily[] = [
  /* ----------------------------- Images ----------------------------- */
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    vendor: "OpenAI",
    kind: "image",
    textModel: "gpt-image-2-text-to-image",
    imageModel: "gpt-image-2-image-to-image",
    ratios: ALL,
    resolutions: ["1K", "2K", "4K"],
    maxRefs: 8,
    note: "Le modèle du Creative Engine : texte lisible, fidèle aux références.",
    build: ({ prompt, ratio, resolution, referenceUrls }) => ({ prompt, aspect_ratio: ratio, resolution: pick(resolution, ["1K", "2K", "4K"], "1K"), ...(referenceUrls.length ? { input_urls: referenceUrls.slice(0, 8) } : {}) }),
  },
  {
    id: "gpt-image-2-5-flare",
    label: "GPT Image 2.5 Flare",
    vendor: "OpenAI",
    kind: "image",
    textModel: "gpt-image-2-5-flare-text-to-image",
    imageModel: null,
    ratios: ALL,
    resolutions: ["1K", "2K", "4K"],
    maxRefs: 0,
    build: ({ prompt, ratio, resolution }) => ({ prompt, aspect_ratio: ratio, resolution: pick(resolution, ["1K", "2K", "4K"], "1K") }),
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    vendor: "Google",
    kind: "image",
    textModel: "nano-banana-pro",
    imageModel: "nano-banana-pro",
    ratios: ALL,
    resolutions: ["1K", "2K", "4K"],
    maxRefs: 8,
    note: "Gemini 3 Pro Image : très bon sur le texte et les montages multi-références.",
    build: ({ prompt, ratio, resolution, referenceUrls }) => ({ prompt, aspect_ratio: ratio, resolution: pick(resolution, ["1K", "2K", "4K"], "1K"), output_format: "png", ...(referenceUrls.length ? { image_input: referenceUrls.slice(0, 8) } : {}) }),
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    vendor: "Google",
    kind: "image",
    textModel: "nano-banana-2",
    imageModel: "nano-banana-2",
    ratios: ALL,
    resolutions: ["1K", "2K", "4K"],
    maxRefs: 14,
    build: ({ prompt, ratio, resolution, referenceUrls }) => ({ prompt, aspect_ratio: ratio, resolution: pick(resolution, ["1K", "2K", "4K"], "1K"), output_format: "png", ...(referenceUrls.length ? { image_input: referenceUrls.slice(0, 14) } : {}) }),
  },
  {
    id: "nano-banana-2-lite",
    label: "Nano Banana 2 Lite",
    vendor: "Google",
    kind: "image",
    textModel: "nano-banana-2-lite",
    imageModel: "nano-banana-2-lite",
    ratios: ALL,
    resolutions: [],
    maxRefs: 10,
    note: "Rapide et peu cher.",
    build: ({ prompt, ratio, referenceUrls }) => ({ prompt, aspect_ratio: ratio, ...(referenceUrls.length ? { image_urls: referenceUrls.slice(0, 10) } : {}) }),
  },
  {
    id: "nano-banana",
    label: "Nano Banana",
    vendor: "Google",
    kind: "image",
    textModel: "google/nano-banana",
    imageModel: "google/nano-banana-edit",
    ratios: ALL,
    resolutions: [],
    maxRefs: 10,
    build: ({ prompt, ratio, referenceUrls }) => ({ prompt, aspect_ratio: ratio, output_format: "png", ...(referenceUrls.length ? { image_urls: referenceUrls.slice(0, 10) } : {}) }),
  },
  {
    id: "seedream-4",
    label: "Seedream 4.0",
    vendor: "ByteDance",
    kind: "image",
    textModel: "bytedance/seedream-v4-text-to-image",
    imageModel: "bytedance/seedream-v4-edit",
    ratios: R_NO_WIDE,
    resolutions: ["1K", "2K", "4K"],
    maxRefs: 10,
    build: ({ prompt, ratio, resolution, referenceUrls }) => ({ prompt, image_size: NAMED_SIZE[closestRatio(ratio, R_NO_WIDE)], image_resolution: pick(resolution, ["1K", "2K", "4K"], "1K"), max_images: 1, ...(referenceUrls.length ? { image_urls: referenceUrls.slice(0, 10) } : {}) }),
  },
  {
    id: "seedream-4-5",
    label: "Seedream 4.5",
    vendor: "ByteDance",
    kind: "image",
    textModel: "seedream/4.5-text-to-image",
    imageModel: "seedream/4.5-edit",
    ratios: R_NO_WIDE,
    resolutions: ["2K", "4K"],
    maxRefs: 14,
    build: ({ prompt, ratio, resolution, referenceUrls }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), quality: resolution === "4K" ? "high" : "basic", ...(referenceUrls.length ? { image_urls: referenceUrls.slice(0, 14) } : {}) }),
  },
  {
    id: "seedream-5-pro",
    label: "Seedream 5.0 Pro",
    vendor: "ByteDance",
    kind: "image",
    textModel: "seedream/5-pro-text-to-image",
    imageModel: "seedream/5-pro-image-to-image",
    ratios: R_NO_WIDE,
    resolutions: ["1K", "2K"],
    maxRefs: 10,
    build: ({ prompt, ratio, resolution, referenceUrls }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), quality: resolution === "2K" ? "high" : "basic", output_format: "png", ...(referenceUrls.length ? { image_urls: referenceUrls.slice(0, 10) } : {}) }),
  },
  {
    id: "flux-2-pro",
    label: "Flux 2 Pro",
    vendor: "Black Forest Labs",
    kind: "image",
    textModel: "flux-2/pro-text-to-image",
    imageModel: "flux-2/pro-image-to-image",
    ratios: R_NO_WIDE,
    resolutions: ["1K", "2K"],
    maxRefs: 8,
    build: ({ prompt, ratio, resolution, referenceUrls }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), resolution: pick(resolution, ["1K", "2K"], "1K"), ...(referenceUrls.length ? { input_urls: referenceUrls.slice(0, 8) } : {}) }),
  },
  {
    id: "flux-2-flex",
    label: "Flux 2 Flex",
    vendor: "Black Forest Labs",
    kind: "image",
    textModel: "flux-2/flex-text-to-image",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: ["1K", "2K"],
    maxRefs: 0,
    build: ({ prompt, ratio, resolution }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), resolution: pick(resolution, ["1K", "2K"], "1K") }),
  },
  {
    id: "z-image",
    label: "Z-Image",
    vendor: "Tongyi",
    kind: "image",
    textModel: "z-image",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: [],
    maxRefs: 0,
    build: ({ prompt, ratio }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE) }),
  },
  {
    id: "imagen4",
    label: "Imagen 4",
    vendor: "Google",
    kind: "image",
    textModel: "google/imagen4",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: [],
    maxRefs: 0,
    build: ({ prompt, ratio }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE) }),
  },
  {
    id: "imagen4-ultra",
    label: "Imagen 4 Ultra",
    vendor: "Google",
    kind: "image",
    textModel: "google/imagen4-ultra",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: [],
    maxRefs: 0,
    build: ({ prompt, ratio }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE) }),
  },
  {
    id: "ideogram-v3",
    label: "Ideogram v3",
    vendor: "Ideogram",
    kind: "image",
    textModel: "ideogram/v3-text-to-image",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: [],
    maxRefs: 0,
    note: "Typographie et affiches.",
    build: ({ prompt, ratio }) => ({ prompt, image_size: NAMED_SIZE[closestRatio(ratio, R_NO_WIDE)], rendering_speed: "QUALITY", style: "AUTO" }),
  },
  {
    id: "qwen3-pro",
    label: "Qwen3 Pro",
    vendor: "Alibaba",
    kind: "image",
    textModel: "qwen3/pro-text-to-image",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: ["1K", "2K"],
    maxRefs: 0,
    build: ({ prompt, ratio, resolution }) => ({ prompt, image_size: closestRatio(ratio, R_NO_WIDE), resolution: pick(resolution, ["1K", "2K"], "1K"), output_format: "png" }),
  },
  {
    id: "grok-imagine-image-2",
    label: "Grok Imagine Image 2.0",
    vendor: "xAI",
    kind: "image",
    textModel: "grok-imagine-image-2-0/text-to-image",
    imageModel: null,
    ratios: R_SQUARE_TALL_WIDE,
    resolutions: [],
    maxRefs: 0,
    build: ({ prompt, ratio }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_SQUARE_TALL_WIDE) }),
  },

  /* ----------------------------- Vidéos ----------------------------- */
  {
    id: "seedance-2",
    label: "Seedance 2.0",
    vendor: "ByteDance",
    kind: "video",
    textModel: "bytedance/seedance-2",
    imageModel: "bytedance/seedance-2",
    ratios: R_NO_WIDE,
    resolutions: ["480p", "720p", "1080p"],
    durations: [4, 5, 8, 10, 12, 15],
    maxRefs: 9,
    note: "Le modèle des vidéos UGC du CRM, avec audio.",
    build: ({ prompt, ratio, resolution, referenceUrls, duration }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), resolution: pick(resolution, ["480p", "720p", "1080p", "4k"], "720p"), duration: clampDuration(duration, 4, 15, 5), generate_audio: true, ...(referenceUrls.length ? { reference_image_urls: referenceUrls.slice(0, 9) } : {}) }),
  },
  {
    id: "seedance-2-fast",
    label: "Seedance 2.0 Fast",
    vendor: "ByteDance",
    kind: "video",
    textModel: "bytedance/seedance-2-fast",
    imageModel: "bytedance/seedance-2-fast",
    ratios: R_NO_WIDE,
    resolutions: ["480p", "720p"],
    durations: [4, 5, 8, 10, 12, 15],
    maxRefs: 9,
    build: ({ prompt, ratio, resolution, referenceUrls, duration }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), resolution: pick(resolution, ["480p", "720p"], "720p"), duration: clampDuration(duration, 4, 15, 5), generate_audio: true, ...(referenceUrls.length ? { reference_image_urls: referenceUrls.slice(0, 9) } : {}) }),
  },
  {
    id: "seedance-2-5",
    label: "Seedance 2.5",
    vendor: "ByteDance",
    kind: "video",
    textModel: "bytedance/seedance-2-5",
    imageModel: "bytedance/seedance-2-5",
    ratios: R_NO_WIDE,
    resolutions: ["480p", "720p", "1080p"],
    durations: [4, 5, 8, 10, 15, 20, 30],
    maxRefs: 10,
    build: ({ prompt, ratio, resolution, referenceUrls, duration }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), resolution: pick(resolution, ["480p", "720p", "1080p"], "720p"), duration: clampDuration(duration, 4, 30, 5), generate_audio: true, output_format: "mp4", ...(referenceUrls.length ? { reference_image_urls: referenceUrls.slice(0, 10) } : {}) }),
  },
  {
    id: "wan-2-5",
    label: "Wan 2.5",
    vendor: "Alibaba",
    kind: "video",
    textModel: "wan/2-5-text-to-video",
    imageModel: "wan/2-5-image-to-video",
    ratios: R_SQUARE_TALL_WIDE,
    resolutions: ["720p", "1080p"],
    durations: [5, 10],
    maxRefs: 1,
    note: "Avec une image : elle devient la première image de la vidéo.",
    build: ({ prompt, ratio, resolution, referenceUrls, duration }) => ({
      prompt,
      duration: String(duration === 10 ? 10 : 5),
      resolution: pick(resolution, ["720p", "1080p"], "720p"),
      ...(referenceUrls.length ? { image_url: referenceUrls[0] } : { aspect_ratio: closestRatio(ratio, R_SQUARE_TALL_WIDE) }),
    }),
  },
  {
    id: "wan-2-7",
    label: "Wan 2.7",
    vendor: "Alibaba",
    kind: "video",
    textModel: "wan/2-7-text-to-video",
    imageModel: "wan/2-7-image-to-video",
    ratios: R_NO_WIDE,
    resolutions: ["720p", "1080p"],
    durations: [3, 5, 8, 10, 15],
    maxRefs: 1,
    note: "Avec une image : elle devient la première image de la vidéo.",
    build: ({ prompt, ratio, resolution, referenceUrls, duration }) => ({
      prompt,
      resolution: pick(resolution, ["720p", "1080p"], "1080p"),
      duration: clampDuration(duration, 2, 15, 5),
      ...(referenceUrls.length ? { first_frame_url: referenceUrls[0] } : { ratio: closestRatio(ratio, R_NO_WIDE) }),
    }),
  },
  {
    id: "wan-3-0",
    label: "Wan 3.0",
    vendor: "Alibaba",
    kind: "video",
    textModel: "wan/3-0-video",
    imageModel: "wan/3-0-video",
    ratios: R_NO_WIDE,
    resolutions: ["480P", "720P", "1080P"],
    durations: [3, 5, 8, 10, 15, 20, 30],
    maxRefs: 10,
    note: "Références multiples (personnage, produit) et audio.",
    build: ({ prompt, ratio, resolution, referenceUrls, duration }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), resolution: pick(resolution, ["480P", "720P", "1080P"], "1080P"), duration: clampDuration(duration, 2, 30, 5), audio: true, ...(referenceUrls.length ? { reference_image_urls: referenceUrls.slice(0, 10) } : {}) }),
  },
  {
    id: "kling-v3-turbo",
    label: "Kling v3 Turbo",
    vendor: "Kuaishou",
    kind: "video",
    textModel: "kling/v3-turbo-text-to-video",
    imageModel: "kling/v3-turbo-image-to-video",
    ratios: R_SQUARE_TALL_WIDE,
    resolutions: ["720p", "1080p"],
    durations: [3, 5, 8, 10, 15],
    maxRefs: 2,
    build: ({ prompt, ratio, resolution, referenceUrls, duration }) => ({
      prompt,
      duration: String(clampDuration(duration, 3, 15, 5)),
      resolution: pick(resolution, ["720p", "1080p"], "720p"),
      ...(referenceUrls.length ? { image_urls: referenceUrls.slice(0, 2) } : { aspect_ratio: closestRatio(ratio, R_SQUARE_TALL_WIDE) }),
    }),
  },
  {
    id: "kling-v2-1-master",
    label: "Kling v2.1 Master",
    vendor: "Kuaishou",
    kind: "video",
    textModel: "kling/v2-1-master-text-to-video",
    imageModel: null,
    ratios: R_SQUARE_TALL_WIDE,
    resolutions: [],
    durations: [5, 10],
    maxRefs: 0,
    build: ({ prompt, ratio, duration }) => ({ prompt, duration: String(duration === 10 ? 10 : 5), aspect_ratio: closestRatio(ratio, R_SQUARE_TALL_WIDE) }),
  },
  {
    id: "hailuo-02-pro",
    label: "Hailuo 02 Pro",
    vendor: "MiniMax",
    kind: "video",
    textModel: "hailuo/02-text-to-video-pro",
    imageModel: "hailuo/2-3-image-to-video-pro",
    ratios: [],
    resolutions: ["768P", "1080P"],
    durations: [6, 10],
    maxRefs: 1,
    note: "En texte seul, le modèle choisit le cadre ; avec une image, elle devient la première image.",
    build: ({ prompt, resolution, referenceUrls, duration }) =>
      referenceUrls.length
        ? { prompt, image_url: referenceUrls[0], duration: String(duration === 10 ? 10 : 6), resolution: pick(resolution, ["768P", "1080P"], "768P") }
        : { prompt, prompt_optimizer: true },
  },
  {
    id: "pixverse-v6",
    label: "PixVerse v6",
    vendor: "PixVerse",
    kind: "video",
    textModel: "pixverse-v6/text-to-video",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: ["540p", "720p", "1080p"],
    durations: [3, 5, 8, 10, 15],
    maxRefs: 0,
    build: ({ prompt, ratio, resolution, duration }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), quality: pick(resolution, ["360p", "540p", "720p", "1080p"], "720p"), duration: clampDuration(duration, 1, 15, 5) }),
  },
  {
    id: "minimax-h3",
    label: "MiniMax H3",
    vendor: "MiniMax",
    kind: "video",
    textModel: "minimax-h3/text-to-video",
    imageModel: null,
    ratios: R_NO_WIDE,
    resolutions: ["768P", "2K"],
    durations: [4, 6, 8, 10, 15],
    maxRefs: 0,
    build: ({ prompt, ratio, resolution, duration }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_NO_WIDE), duration: clampDuration(duration, 4, 15, 6), resolution: pick(resolution, ["768P", "2K"], "2K") }),
  },
  {
    id: "grok-imagine-video",
    label: "Grok Imagine Video",
    vendor: "xAI",
    kind: "video",
    textModel: "grok-imagine/text-to-video",
    imageModel: null,
    ratios: R_SQUARE_TALL_WIDE,
    resolutions: ["480p", "720p", "1080p"],
    durations: [6, 8, 10, 15, 20, 30],
    maxRefs: 0,
    build: ({ prompt, ratio, resolution, duration }) => ({ prompt, aspect_ratio: closestRatio(ratio, R_SQUARE_TALL_WIDE), duration: clampDuration(duration, 6, 30, 6), resolution: pick(resolution, ["480p", "720p", "1080p"], "720p"), mode: "normal" }),
  },
];

export const DEFAULT_MODEL_FAMILY = "gpt-image-2";

export function modelFamily(id: string | undefined | null): ModelFamily | null {
  return MODEL_FAMILIES.find((family) => family.id === (id || DEFAULT_MODEL_FAMILY)) ?? null;
}

/** L'identifiant Kie à appeler pour cette famille selon qu'une référence est jointe, ou une raison de refus. */
export function resolveModel(family: ModelFamily, referenceUrls: string[]): { model: string } | { error: string } {
  if (referenceUrls.length) {
    if (family.imageModel) return { model: family.imageModel };
    return { error: `${family.label} n'accepte pas d'image de référence : retire les références ou choisis un autre modèle.` };
  }
  if (family.textModel) return { model: family.textModel };
  return { error: `${family.label} demande au moins une image de référence.` };
}
