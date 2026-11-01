export type UploadAccount = { id: string; accountId: string; name: string; currency: string; status: number };

/** dailyBudget : budget journalier en devise du compte (0 = pas de budget à ce niveau). */
export type PickerCampaign = { id: string; name: string; status: string; objective: string; dailyBudget: number };
export type PickerAdset = { id: string; name: string; status: string; campaignId: string; dailyBudget: number };
export type PickerAd = { id: string; name: string; status: string; adsetId: string; campaignId: string };

/**
 * Les variables du nom des pubs, comme sur adsuploader.com : on écrit le
 * modèle (« S {nn} », « {file} · {adset} »…) et chaque pub reçoit son nom.
 */
export const AD_NAME_TOKENS = [
  { token: "{file}", label: "Nom du fichier", example: "venom-girl" },
  { token: "{nn}", label: "N° du fichier (01, 02…)", example: "01" },
  { token: "{n}", label: "N° du fichier (1, 2…)", example: "1" },
  { token: "{adset}", label: "Nom de l'ad set", example: "STATIC 3:4" },
  { token: "{campaign}", label: "Nom de la campagne", example: "SCALING" },
  { token: "{date}", label: "Date (JJ-MM)", example: "01-11" },
] as const;

export function formatAdName(pattern: string, params: { fileName: string; campaign: string; adset: string; index: number; start?: number; date?: Date }) {
  const number = (params.start && params.start > 0 ? params.start : 1) + params.index;
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" }).format(params.date ?? new Date()).replace("/", "-");
  const stem = params.fileName.replace(/\.[^.]+$/, "").slice(0, 80);
  const raw = (pattern || "{file}")
    .replaceAll("{file}", stem)
    .replaceAll("{campaign}", params.campaign)
    .replaceAll("{adset}", params.adset)
    .replaceAll("{date}", day)
    .replaceAll("{nn}", String(number).padStart(2, "0"))
    .replaceAll("{n}", String(number))
    .trim();
  return raw.slice(0, 200) || `Ad ${number}`;
}

export type MediaKind = "image" | "video" | "post";
/** kind « post » : une publication existante (Post ID), réutilisée telle quelle — likes et commentaires gardés. */
export type UploadedMedia = { kind: MediaKind; hash?: string; videoId?: string; postId?: string; fileName: string };

/**
 * Les Post ID collés dans l'uploader : un par ligne (ou séparés par des
 * virgules / espaces), au format du bouton « Post ID » de l'Ads Manager
 * (« idPage_idPost ») ou le seul numéro du post. Les liens facebook.com
 * « …/posts/123 » et « story_fbid=123&id=456 » sont aussi compris.
 */
export function parsePostIds(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const story = token.match(/story_fbid=(\d+).*?[?&]id=(\d+)/);
    const path = token.match(/facebook\.com\/(\d+)\/(?:posts|videos|photos)\/(?:[^/]+\/)?(\d+)/);
    const id = story ? `${story[2]}_${story[1]}` : path ? `${path[1]}_${path[2]}` : /^\d+(_\d+)?$/.test(token) ? token : null;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export const IMAGE_ENHANCEMENTS = [
  { key: "video_music", label: "Add music" },
  { key: "image_brightness_and_contrast", label: "Adjust brightness and contrast" },
  { key: "enhance_cta", label: "Enhance CTA" },
  { key: "inline_comment", label: "Relevant comments" },
  { key: "image_animation", label: "Reveal details over time" },
  { key: "text_optimizations", label: "Text improvements" },
  { key: "text_translation", label: "Translate text" },
  { key: "image_touchups", label: "Visual touch-ups" },
] as const;

export const VIDEO_ENHANCEMENTS = [
  { key: "video_music", label: "Add music" },
  { key: "video_auto_crop", label: "Add video effects" },
  { key: "enhance_cta", label: "Enhance CTA" },
  { key: "inline_comment", label: "Relevant comments" },
  { key: "image_animation", label: "Reveal details over time" },
  { key: "text_optimizations", label: "Text improvements" },
  { key: "text_translation", label: "Translate text" },
  { key: "video_filtering", label: "Visual touch-ups" },
] as const;

export const CAROUSEL_ENHANCEMENTS = [
  { key: "video_music", label: "Add music" },
  { key: "carousel_to_video", label: "Carousel to video" },
  { key: "description_automation", label: "Dynamic description" },
  { key: "enhance_cta", label: "Enhance CTA" },
  { key: "optimize_card_order", label: "Optimize card order" },
  { key: "inline_comment", label: "Relevant comments" },
  { key: "show_end_card", label: "Show end card" },
  { key: "image_touchups", label: "Visual touch-ups" },
] as const;

export const CTA_OPTIONS = [
  "SHOP_NOW",
  "LEARN_MORE",
  "SIGN_UP",
  "ORDER_NOW",
  "SUBSCRIBE",
  "DOWNLOAD",
  "GET_OFFER",
  "CONTACT_US",
  "BOOK_NOW",
  "WATCH_MORE",
  "APPLY_NOW",
  "GET_QUOTE",
] as const;
