export type UploadAccount = { id: string; accountId: string; name: string; currency: string; status: number };

export type PickerCampaign = { id: string; name: string; status: string; objective: string };
export type PickerAdset = { id: string; name: string; status: string; campaignId: string };
export type PickerAd = { id: string; name: string; status: string; adsetId: string; campaignId: string };

export type MediaKind = "image" | "video";
export type UploadedMedia = { kind: MediaKind; hash?: string; videoId?: string; fileName: string };

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
