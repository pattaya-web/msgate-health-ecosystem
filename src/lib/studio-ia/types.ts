/**
 * Types du pipeline « Swap vidéo » du Studio.
 *
 * Un job = une vidéo source + une image de référence → une vidéo finale où le
 * sujet a pris l'apparence de la référence, avec la voix d'origine, une voix
 * ElevenLabs, ou pas de son.
 */

export type ProviderId = "wan" | "wanAnimate" | "seedance" | "seedance25" | "kling" | "klingMotion" | "klingMotion26" | "flashOmni" | "genjutsu";
/** Moteurs hors swap video (photo qui parle). */
export type ExtraEngine = "infinitalk";
export type ProviderChoice = ProviderId | "auto";

export type TransformType = "full" | "face" | "outfit" | "face-outfit" | "character";
export type StyleId = "natural" | "strong" | "ugc" | "cinematic";
export type VoiceMode = "keep" | "transform" | "none";
export type VoiceEngine = "elevenlabs-sts" | "kie-tts";
/** Rendu de la voix transformee : brute (micro), ou placee dans la scene a une distance donnee. */
export type VoiceAmbience = "raw" | "close" | "room" | "far";
export type Resolution = "720p" | "1080p";
export type AspectChoice = "original" | "9:16" | "16:9" | "1:1";

export type StudioJobStatus =
  | "queued"
  | "uploading"
  | "generating_video"
  | "processing_voice"
  | "merging"
  | "syncing_lips"
  | "completed"
  | "failed";

export const ACTIVE_STATUSES: StudioJobStatus[] = [
  "queued",
  "uploading",
  "generating_video",
  "processing_voice",
  "merging",
  "syncing_lips",
];

/** Ce que le client envoie pour lancer une ou plusieurs variantes. */
export interface TransformRequest {
  sourceVideo: string;
  sourceVideoName?: string;
  /** Durée mesurée côté navigateur : indication pour le devis, revérifiée au serveur. */
  sourceDurationSec?: number;
  referenceImage: string;
  referenceImageName?: string;
  /** Autres vues du même personnage (profil, dos, tenue), 2 au plus. */
  referenceImages?: string[];
  /** Photo d'un NOUVEAU lieu : le décor de la vidéo est remplacé par celui-ci. */
  sceneImage?: string;
  provider: ProviderChoice;
  transform: TransformType;
  style: StyleId;
  userPrompt: string;
  negativePrompt: string;
  voiceMode: VoiceMode;
  voiceId: string;
  voiceName: string;
  voiceAmbience?: VoiceAmbience;
  /** Passe de synchronisation labiale IA après l'assemblage (Seedance et Kling rejouent la bouche approximativement). */
  lipSync?: boolean;
  /** Photos du produit tenu en main (1 à 4) : le modèle le reproduit à l'identique. */
  productImages?: string[];
  productDescription?: string;
  resolution: Resolution;
  aspectRatio: AspectChoice;
  variants: number;
}

/** Entrée normalisée passée à un provider vidéo. */
export interface ProviderInput {
  /** URL publiques (stockage KIE) : les modèles vont chercher les médias sur internet. */
  sourceVideoUrl: string;
  /** Référence principale : la première photo, ou la planche multi-vues pour les modèles à image unique. */
  referenceImageUrl: string;
  /** Toutes les vues du personnage, pour les modèles qui acceptent plusieurs images. */
  referenceImageUrls?: string[];
  /** Consigne brute de l'utilisateur (les modèles à prompt court, comme Genjutsu, ne prennent qu'elle). */
  userPrompt?: string;
  prompt: string;
  negativePrompt: string;
  resolution: Resolution;
  /** Ratio résolu (jamais « original » ici). */
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSec: number;
  keepAudio: boolean;
  /** Produit à préserver, en URL publiques. Seuls les modèles à « éléments » le lisent. */
  product?: { urls: string[]; description: string };
  /** Image fixe de la vidéo source, publiée : référence de décor pour les modèles qui régénèrent la scène. */
  sceneFrameUrl?: string;
  /** Photo d'un nouveau lieu fournie par l'utilisateur : remplace tout l'environnement. */
  sceneImageUrl?: string;
}

/** « Photo qui parle » : une photo + un texte lu (ou un audio) → video parlante. */
export interface TalkRequest {
  referenceImage: string;
  referenceImageName?: string;
  talkText?: string;
  voiceId?: string;
  voiceName?: string;
  /** Fichier audio ou video (URL locale /api/media/...) dont on prend la piste. */
  talkAudio?: string;
  /** Description de la scene, guide les expressions. */
  talkPrompt?: string;
  resolution: "480p" | "720p";
  variants: number;
}

/** « Création » : une image de départ + un script → une vidéo où la personne parle, sans rien filmer. */
export interface CreateRequest {
  startImage: string;
  startImageName?: string;
  /** Photos du produit (0 à 4). Avec, l'image et le produit passent en références. */
  productImages?: string[];
  productDescription?: string;
  /** Ce que la personne dit, mot pour mot. */
  script: string;
  /** Langue parlée : fr, en, es, ar, it, de, pt. */
  language?: string;
  /** Attitude, rythme, gestes : une phrase. */
  scenePrompt?: string;
  /** 4 à 30 s, ou -1 : le modèle choisit. */
  durationSec: number;
  resolution: "480p" | "720p" | "1080p";
  aspectRatio: "9:16" | "16:9" | "1:1" | "adaptive";
  variants: number;
}

export interface StudioJob {
  id: string;
  type: "video-transform" | "talking-photo" | "creation";
  /** Variantes lancées d'un coup : même batchId. */
  batchId: string;
  provider: ProviderId | ExtraEngine;
  requestedProvider: ProviderChoice;
  transform: TransformType;
  style: StyleId;

  sourceVideo: string;
  sourceVideoName: string;
  sourceDurationSec: number;
  referenceImage: string;
  referenceImageName: string;
  /** Toutes les vues (la première = referenceImage). */
  referenceImages: string[];
  remoteReferenceUrls: string[];
  /** Planche multi-vues assemblée (locale), quand plusieurs photos ont été fournies. */
  referenceSheet: string;
  /** La référence unique était une planche : découpée en panneaux (portrait d'abord) dans remoteReferenceUrls. */
  referenceSplit?: boolean;
  /** Consigne traduite en anglais, telle qu'envoyée au modèle. */
  userPromptEn?: string;
  /** Nouveau lieu (locale) et sa copie publiée. Vide : le décor de la vidéo est gardé. */
  sceneImage: string;
  remoteSceneImageUrl: string;

  userPrompt: string;
  /** Prompt complet réellement envoyé (système + consigne). */
  prompt: string;
  negativePrompt: string;

  voiceMode: VoiceMode;
  voiceId: string;
  voiceName: string;
  /** Moteur reellement utilise : speech-to-speech ElevenLabs, ou TTS via KIE (repli). */
  voiceEngine: VoiceEngine | "";
  voiceAmbience: VoiceAmbience;
  lipSync: boolean;
  /** Une synchro labiale ratée ne détruit pas la vidéo : l'erreur vit à part. */
  lipSyncError: string;
  /** La vidéo générée a déjà été recalée sur la durée de la source. */
  retimed?: boolean;

  productImages: string[];
  productDescription: string;
  remoteProductUrls: string[];
  remoteSceneUrl?: string;

  /* --- Photo qui parle (et script de la Création) --- */
  talkText?: string;
  talkAudio?: string;
  remoteAudioUrl?: string;
  talkResolution?: "480p" | "720p";

  /* --- Création depuis zéro --- */
  createResolution?: "480p" | "720p" | "1080p";
  /** 4-30 s, ou -1 pour laisser le modèle choisir. */
  createDurationSec?: number;
  createMode?: "first-frame" | "references";
  createLanguage?: string;

  resolution: Resolution;
  aspectRatio: AspectChoice;

  status: StudioJobStatus;
  /** 0-100 quand le provider publie une progression réelle, sinon 0. */
  progress: number;
  providerJobId: string;
  providerInput: Record<string, unknown>;
  /** Copies publiques (KIE) des sources, pour ne pas les renvoyer à chaque retry. */
  remoteSourceUrl: string;
  remoteReferenceUrl: string;
  /** Résultat brut chez le provider (CDN KIE). */
  remoteVideoUrl: string;

  /** Sorties locales (/api/media/...). */
  videoOutput: string;
  audioOutput: string;
  finalOutput: string;

  error: string;
  /** Une voix ratée ne détruit pas la vidéo : l'erreur vit à part. */
  voiceError: string;

  creditsEstimated: number;
  creditsConsumed: number;

  createdAt: string;
  updatedAt: string;
  startedAt: string;
  completedAt: string;
}

/** Personnage enregistré : une image de référence nommée, réutilisable en un clic. */
export interface StudioCharacter {
  id: string;
  name: string;
  imageUrl: string;
  createdAt: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  category: string;
  gender: string;
  age: string;
  accent: string;
  description: string;
  previewUrl: string;
}

export interface Quote {
  provider: ProviderId;
  providerLabel: string;
  /** Facturé ailleurs qu'en crédits KIE (ex. Higgsfield en dollars). */
  billedBy?: string;
  durationSec: number;
  creditsPerVideo: number;
  credits: number;
  usdPerVideo: number;
  usd: number;
  variants: number;
  verified: boolean;
}
