/**
 * Types et catalogue du studio Vidéo IA — sans aucune dépendance serveur, pour
 * que l'interface les importe sans embarquer ffmpeg, le disque ou Kie.
 */

export type VideoStyleId =
  | "ugc"
  | "ad"
  | "cinematic"
  | "cartoon3d"
  | "anime"
  | "claymation"
  | "comic"
  | "stopmotion"
  | "pixel";

export type VideoStyle = { id: VideoStyleId; label: string; hint: string; block: string; keyframe: string };

export const VIDEO_STYLES: VideoStyle[] = [
  {
    id: "ugc",
    label: "UGC réaliste",
    hint: "Filmé au téléphone, vrai, pas pub",
    block:
      "Photorealistic handheld phone footage, natural light, real skin texture, believable everyday location, slight micro-shake. NOT cinematic, NOT studio-lit, NOT glossy, NOT AI-smooth.",
    keyframe: "photorealistic iPhone photo, natural light, real skin texture, everyday location, no text",
  },
  {
    id: "ad",
    label: "Pub premium",
    hint: "Produit héros, lumière studio, DTC propre",
    block:
      "Premium direct-to-consumer commercial look: clean studio or lifestyle set, soft directional key light, shallow depth of field, smooth slow camera moves (slow push-in, gentle orbit), rich but natural colour grade.",
    keyframe: "premium commercial product photography, soft studio light, shallow depth of field, clean set, no text",
  },
  {
    id: "cinematic",
    label: "Cinéma",
    hint: "Mini-film, grain, lumière dramatique",
    block:
      "Cinematic short-film look: anamorphic feel, dramatic motivated lighting, film grain, shallow focus, deliberate camera moves (dolly, slow pan), 2.39 composition feel even in vertical, teal-and-amber restraint.",
    keyframe: "cinematic film still, dramatic lighting, film grain, shallow depth of field, no text",
  },
  {
    id: "cartoon3d",
    label: "Cartoon 3D",
    hint: "Style Pixar, personnages expressifs",
    block:
      "3D animated cartoon in the style of a modern feature animation studio: stylised characters with big expressive eyes, soft subsurface skin, rounded shapes, saturated but harmonious palette, global illumination, gentle depth of field. Consistent character design across all shots.",
    keyframe: "3D animated cartoon character sheet, modern feature animation style, big expressive eyes, soft lighting, plain background, no text",
  },
  {
    id: "anime",
    label: "Anime",
    hint: "2D japonais, lignes nettes, ciel peint",
    block:
      "2D Japanese anime style: clean line art, cel shading with two-tone shadows, painted backgrounds with soft gradients, expressive faces, dynamic speed lines on action, consistent character design across all shots.",
    keyframe: "anime character design sheet, clean line art, cel shading, painted background, no text",
  },
  {
    id: "claymation",
    label: "Pâte à modeler",
    hint: "Stop-motion argile, fingerprints visibles",
    block:
      "Claymation stop-motion: hand-sculpted plasticine characters with visible fingerprints and tool marks, miniature sets, slightly jerky 12-fps motion, warm practical lighting, tactile textures.",
    keyframe: "claymation character, plasticine texture with fingerprints, miniature set, warm light, no text",
  },
  {
    id: "comic",
    label: "BD / comics",
    hint: "Encre, aplats, trames, cases",
    block:
      "Comic-book style: bold ink outlines, flat colour fills with halftone dot shading, dramatic panel-like compositions, occasional motion lines, limited palette, consistent character design across all shots.",
    keyframe: "comic book illustration, bold ink outlines, flat colours, halftone shading, no text, no speech bubbles",
  },
  {
    id: "stopmotion",
    label: "Stop-motion papier",
    hint: "Papier découpé, cartons, lumière chaude",
    block:
      "Paper cut-out stop-motion: layered paper and cardboard characters and sets, visible paper grain and cut edges, slightly stepped motion, warm tungsten light with soft shadows between layers.",
    keyframe: "paper cut-out stop-motion scene, layered cardboard, visible paper texture, warm light, no text",
  },
  {
    id: "pixel",
    label: "Pixel art",
    hint: "Jeu rétro 16 bits",
    block:
      "16-bit pixel art animation: crisp pixels, limited palette, parallax backgrounds, chunky sprite characters, retro game feel, no anti-aliasing blur.",
    keyframe: "16-bit pixel art scene, crisp pixels, limited palette, no text",
  },
];

export const VIDEO_RATIOS = ["9:16", "1:1", "16:9"] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

export type ShotDraft = { label: string; duration: number; prompt: string };

export type VideoJob = {
  label: string;
  prompt: string;
  duration: number;
  taskId: string | null;
  error: string | null;
  state: "pending" | "done" | "fail";
  urls: string[];
  file?: string;
  /** Bloc de la recette dont vient ce plan (page Reproduire). */
  block?: string;
  /** Plan muet : la voix off est posée au montage. */
  silent?: boolean;
};

export type VideoBatch = {
  id: string;
  createdAt: string;
  title: string;
  mode: "product" | "scene";
  style: VideoStyleId;
  ratio: VideoRatio;
  resolution: "720p" | "1080p";
  keyframeUrl?: string;
  productName?: string;
  jobs: VideoJob[];
  cut?: string;
  /** Recette d'origine, quand le lot vient de la page Reproduire. */
  recipeId?: string;
  /** Voix off à poser sur les plans muets, bloc par bloc. */
  voiceover?: Record<string, string>;
  /** Fichier audio de la voix off une fois générée. */
  voiceoverFile?: Record<string, string>;
  /** Texte du carton final, s'il y en a un. */
  endCard?: string;
};

export function styleFor(id: VideoStyleId | string | undefined) {
  return VIDEO_STYLES.find((style) => style.id === id) ?? VIDEO_STYLES[0];
}
