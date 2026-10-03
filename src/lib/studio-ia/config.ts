import type { ProviderId, Resolution, TransformType } from "./types";

/**
 * Configuration centralisée du Swap vidéo.
 *
 * Tout ce qui est susceptible de changer avec le temps vit ICI et nulle part
 * ailleurs : identifiants de modèles, limites, tarifs, priorités du mode Auto.
 * Aucun `if (provider === ...)` ne doit apparaître dans les composants.
 */

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  vendor: string;
  /** Identifiant du modèle sur le marketplace KIE (docs.kie.ai/market/...). */
  kieModel: string;
  /** Durée de vidéo source acceptée, en secondes. */
  minDurationSec: number;
  maxDurationSec: number;
  /** Poids max du fichier source, en octets (limite la plus stricte : upload KIE ou modèle). */
  maxSourceBytes: number;
  resolutions: Resolution[];
  /**
   * Tarif indicatif en crédits par seconde de vidéo produite.
   * `verified` : relevé sur une facture réelle de ce compte ; sinon estimation.
   */
  creditsPerSec: Record<Resolution, number>;
  verifiedPricing: boolean;
  /** Le modèle sait-il conserver la piste audio d'origine lui-même ? */
  keepsOriginalAudio: boolean;
  /**
   * Vrai quand la limite de poids est basse mais contournable : la source est
   * recompressée en 720p avant l'envoi au lieu d'être refusée.
   */
  compressSource?: boolean;
  /** Nombre max de pixels par image (largeur × hauteur) accepté en entrée, s'il est borné. */
  maxSourcePixels?: number;
  /** Accepte des photos du produit (« éléments ») pour le reproduire fidèlement. */
  supportsProduct?: boolean;
  /** Régénère la scène : on lui donne en plus une image fixe de la vidéo pour tenir le décor. */
  wantsSceneFrame?: boolean;
  /** Accepte plusieurs photos du personnage (profil, dos, tenue). Sinon on lui passe une planche assemblée. */
  multiRef?: boolean;
  /** Facturé hors crédits KIE : libellé affiché dans le devis. */
  billedBy?: string;
  /**
   * Modèle d'édition : il garde la bouche et le timing de la vidéo source.
   * La voix convertie (même rythme) tombe juste, la passe lèvres est inutile.
   */
  preservesMouth?: boolean;
  blurb: string;
  /** Pour quel type de vidéo ce modèle est fait, et ce qu'il ne sait pas faire. Affiché dans l'onglet. */
  bestFor: string;
  avoidFor: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  wan: {
    id: "wan",
    label: "Wan 2.7",
    vendor: "Alibaba",
    kieModel: "wan/2-7-videoedit",
    preservesMouth: true,
    minDurationSec: 2,
    maxDurationSec: 10,
    maxSourceBytes: 100 * 1024 * 1024,
    resolutions: ["720p", "1080p"],
    creditsPerSec: { "720p": 18, "1080p": 24 },
    verifiedPricing: true,
    keepsOriginalAudio: true,
    blurb: "Édition vidéo : retouche ta vidéo au lieu de la refaire. Le plus fidèle au décor et aux objets.",
    bestFor: "Petite retouche (visage) sur une vidéo de 10 s max, décor et objets strictement identiques.",
    avoidFor: "Changement complet de personne ou de genre : rendu lisse, transformation timide.",
  },
  kling: {
    id: "kling",
    label: "Kling 3.0 Omni",
    vendor: "Kuaishou",
    kieModel: "kling-3.0-omni/transformation",
    minDurationSec: 3,
    maxDurationSec: 15.5,
    maxSourceBytes: 100 * 1024 * 1024,
    resolutions: ["720p", "1080p"],
    creditsPerSec: { "720p": 20, "1080p": 28 },
    verifiedPricing: true,
    keepsOriginalAudio: true,
    supportsProduct: true,
    multiRef: true,
    blurb: "Plus créatif, recrée la scène. Accepte des vidéos jusqu'à 15 s. Le seul qui reproduit ton produit à l'identique à partir de ses photos.",
    bestFor: "Tes gestes exacts + ton produit en main (avec ses photos), à moitié prix de Seedance. Plan fixe ou léger mouvement.",
    avoidFor: "Longs déplacements et mouvements de caméra rapides.",
  },
  wanAnimate: {
    id: "wanAnimate",
    label: "Wan Animate (remplacement)",
    vendor: "Alibaba",
    kieModel: "wan/2-2-animate-replace",
    preservesMouth: true,
    minDurationSec: 2,
    maxDurationSec: 30,
    // 10 Mo côté modèle : la source est recompressée pour tenir dedans.
    maxSourceBytes: 10 * 1024 * 1024,
    resolutions: ["720p"],
    // Releve le 2026-09-25 : 100 credits pour 8,6 s.
    creditsPerSec: { "720p": 12, "1080p": 12 },
    verifiedPricing: true,
    keepsOriginalAudio: false,
    compressSource: true,
    blurb: "Remplace la personne par celle de la photo en gardant le décor, l'éclairage, les objets en main et le texte incrusté. Le rendu « une autre personne dans ma vidéo ». 720p max, pas de consigne.",
    bestFor: "Tu te déplaces, tu marches, la caméra bouge : il copie le mouvement image par image et garde ton décor. Jusqu'à 30 s, le moins cher.",
    avoidFor: "Produit tenu en main (il le réinvente) et tenue précise (pas de consigne).",
  },
  seedance25: {
    id: "seedance25",
    label: "Seedance 2.5",
    vendor: "ByteDance",
    kieModel: "bytedance/seedance-2-5",
    minDurationSec: 2,
    maxDurationSec: 30,
    maxSourceBytes: 200 * 1024 * 1024,
    maxSourcePixels: 927408,
    compressSource: true,
    resolutions: ["720p", "1080p"],
    // Tarif non releve : on reprend celui de Seedance 2 en attendant une facture.
    creditsPerSec: { "720p": 44, "1080p": 70 },
    verifiedPricing: false,
    keepsOriginalAudio: false,
    supportsProduct: true,
    wantsSceneFrame: true,
    multiRef: true,
    blurb: "La version que Higgsfield utilise pour son « Ad Multiplier » : édition de vidéo jusqu'à 30 s, durée calée sur la source, mêmes références (personne, produit, décor).",
    bestFor: "Comme Seedance 2, mais jusqu'à 30 s et une durée qui suit ta vidéo : le choix pour les clips longs face caméra avec tenue et produit.",
    avoidFor: "Déplacements et mouvements de caméra, comme Seedance 2. Tarif à confirmer sur la première facture.",
  },
  klingMotion: {
    id: "klingMotion",
    label: "Kling 3.0 Motion Control",
    vendor: "Kuaishou",
    kieModel: "kling-3.0/motion-control",
    minDurationSec: 3,
    maxDurationSec: 30,
    maxSourceBytes: 100 * 1024 * 1024,
    resolutions: ["720p", "1080p"],
    creditsPerSec: { "720p": 20, "1080p": 27 },
    verifiedPricing: true,
    keepsOriginalAudio: false,
    blurb: "Refait tout le personnage à partir de la photo en copiant tes mouvements. Le plus fort pour changer de genre ou de silhouette ; perd les objets tenus en main.",
    bestFor: "Personnage complet en pied, gestes amples, danse, jusqu'à 30 s.",
    avoidFor: "Objet en main et décor à garder à l'identique : il peut reprendre le fond de la photo.",
  },
  klingMotion26: {
    id: "klingMotion26",
    label: "Kling 2.6 Motion Control",
    vendor: "Kuaishou",
    kieModel: "kling-2.6/motion-control",
    minDurationSec: 3,
    maxDurationSec: 30,
    maxSourceBytes: 100 * 1024 * 1024,
    resolutions: ["720p", "1080p"],
    // Tarif non releve : on reprend celui de la 3.0 en attendant une facture.
    creditsPerSec: { "720p": 20, "1080p": 27 },
    verifiedPricing: false,
    keepsOriginalAudio: false,
    blurb: "L'ancienne génération de Motion Control : ta vidéo donne les mouvements, la photo donne le visage. En orientation « vidéo », il garde ta scène et ne refait que la personne : c'est celui qui remplaçait ta tête dans l'autre appli.",
    bestFor: "Changer la tête ou le visage en gardant tes gestes, ta scène et ton cadrage. Photo de référence cadrée tête-épaules-buste, 3 à 30 s.",
    avoidFor: "Objet en main (perdu) et produit. Moins précis que la 3.0 sur les gestes amples. Tarif à confirmer.",
  },
  genjutsu: {
    id: "genjutsu",
    label: "Higgsfield Genjutsu",
    vendor: "Higgsfield",
    kieModel: "higgsfield/genjutsu/object-swap/v1.0",
    preservesMouth: true,
    minDurationSec: 1,
    maxDurationSec: 30,
    maxSourceBytes: 200 * 1024 * 1024,
    resolutions: ["720p"],
    // 0,681 $/s en 720p facture par Higgsfield, converti en equivalent credits (0,005 $) pour l'affichage.
    creditsPerSec: { "720p": 136, "1080p": 136 },
    verifiedPricing: true,
    keepsOriginalAudio: false,
    supportsProduct: true,
    multiRef: true,
    billedBy: "Higgsfield (USD)",
    blurb: "L'Object Swap de Higgsfield : ta vidéo + les photos du personnage (plusieurs vues) + une phrase. Facturé chez Higgsfield en dollars, pas en crédits KIE.",
    bestFor: "Remplacement de personnage avec plusieurs vues (face, dos, tenue) et produit, jusqu'à 30 s, prompt court. Le rendu de leurs exemples.",
    avoidFor: "Le prix : environ 0,68 $ la seconde en 720p, trois fois Seedance. 720p maximum.",
  },
  seedance: {
    id: "seedance",
    label: "Seedance 2",
    vendor: "ByteDance",
    kieModel: "bytedance/seedance-2",
    minDurationSec: 2,
    maxDurationSec: 15,
    maxSourceBytes: 50 * 1024 * 1024,
    // La video de reference doit rester sous 834x1112 pixels : on la reduit avant l'envoi.
    maxSourcePixels: 927408,
    compressSource: true,
    resolutions: ["720p", "1080p"],
    // Releve le 2026-09-25 : 175 credits pour 4 s en 720p. Le plus cher de la liste.
    creditsPerSec: { "720p": 44, "1080p": 70 },
    verifiedPricing: true,
    keepsOriginalAudio: false,
    supportsProduct: true,
    wantsSceneFrame: true,
    multiRef: true,
    blurb: "Référence multimodale (vidéo + images) : la personne ET le produit en références, rendu cinéma.",
    bestFor: "Plan fixe face caméra : le rendu le plus réaliste, tenue changeable par consigne, produit en main avec ses photos. Ton modèle principal.",
    avoidFor: "Déplacements et mouvements de caméra (il les suit mal), lèvres approximatives : coche la synchro des lèvres. Le plus cher.",
  },
  flashOmni: {
    id: "flashOmni",
    label: "Gemini Omni Flash",
    vendor: "Google",
    kieModel: "google/gemini-omni-flash-1-1",
    minDurationSec: 1,
    maxDurationSec: 10,
    maxSourceBytes: 100 * 1024 * 1024,
    resolutions: ["720p", "1080p"],
    creditsPerSec: { "720p": 12, "1080p": 18 },
    verifiedPricing: false,
    keepsOriginalAudio: false,
    blurb: "Alternative rapide, montage multimodal. Clip limité à 10 s.",
    bestFor: "Clips très courts (1 à 10 s) et essais rapides, décor et produit plutôt bien gardés.",
    avoidFor: "Vidéos longues, rendu final publié.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/**
 * Priorités du mode Auto, par type de transformation.
 *
 * Le premier provider de la liste qui accepte la vidéo (durée, poids) gagne.
 * Modifier l'ordre ici change le comportement de toute l'application.
 */
export const AUTO_PRIORITY: Record<TransformType, ProviderId[]> = {
  full: ["wan", "wanAnimate", "klingMotion", "kling", "seedance", "flashOmni"],
  face: ["wan", "kling", "flashOmni", "seedance", "wanAnimate", "klingMotion26", "klingMotion"],
  outfit: ["wan", "kling", "flashOmni", "seedance", "wanAnimate", "klingMotion"],
  "face-outfit": ["wan", "wanAnimate", "klingMotion", "kling", "seedance", "flashOmni"],
  // Personnage complet : tout le sujet est refait en gardant la scène, c'est le mode « replace » de Wan Animate.
  character: ["wanAnimate", "klingMotion", "kling", "seedance", "wan", "flashOmni"],
};

/** Générations vidéo menées de front chez les providers ; le reste attend en file. */
export const MAX_CONCURRENT_GENERATIONS = 4;

/** Au-delà, une étape sans verrou en mémoire est considérée interrompue (redémarrage serveur). */
export const STALE_STEP_MS = 12 * 60 * 1000;

/** Variantes lançables d'un coup. */
export const MAX_VARIANTS = 4;

/** Prix d'un crédit KIE en USD quand les réglages ne le précisent pas. */
export const DEFAULT_CREDIT_USD = 0.005;

/* ------------------------------ Higgsfield ------------------------------ */

export const HIGGSFIELD = {
  baseUrl: "https://api.higgsfield.ai",
  objectSwapPath: "higgsfield/genjutsu/object-swap/v1.0",
  envKeyId: "HIGGSFIELD_API_KEY_ID",
  envKeySecret: "HIGGSFIELD_API_KEY_SECRET",
  /** Prix Higgsfield en dollars par seconde de video source (arrondie a la seconde superieure). */
  usdPerSec: { "480p": 0.318, "720p": 0.681 },
};

/* ------------------------------ Photo qui parle ------------------------------ */

export const TALKING_PHOTO = {
  kieModel: "infinitalk/from-audio",
  label: "InfiniteTalk",
  vendor: "MeiGen (open source)",
  /** Tarif indicatif par seconde d'audio, non verifie (WaveSpeed facture 0,15 $/s en 720p). */
  creditsPerSec: { "480p": 18, "720p": 30 } as Record<"480p" | "720p", number>,
  verifiedPricing: false,
  maxAudioSec: 90,
  defaultPrompt: "A person talking naturally to the camera, subtle head movements, natural blinking and expressions, steady framing.",
};

/**
 * « Création » : Seedance 2.5 depuis une image de départ, voix générée par
 * le modèle à partir du script (docs : first_frame_url + generate_audio).
 * Tarif non relevé : celui de Seedance 2.5 en édition, majoré pour l'audio,
 * à confirmer sur la première facture.
 */
export const CREATION = {
  kieModel: "bytedance/seedance-2-5",
  label: "Seedance 2.5",
  vendor: "ByteDance",
  resolutions: ["480p", "720p", "1080p"] as ("480p" | "720p" | "1080p")[],
  creditsPerSec: { "480p": 28, "720p": 50, "1080p": 80 } as Record<"480p" | "720p" | "1080p", number>,
  verifiedPricing: false,
  minDurationSec: 4,
  maxDurationSec: 30,
};

/** Libelle d'un moteur, swap video ou photo qui parle. */
export function engineLabel(id: string): string {
  if (id === "infinitalk") return TALKING_PHOTO.label;
  return (PROVIDERS as Record<string, ProviderConfig | undefined>)[id]?.label ?? id;
}

export function engineVendor(id: string): string {
  if (id === "infinitalk") return TALKING_PHOTO.vendor;
  return (PROVIDERS as Record<string, ProviderConfig | undefined>)[id]?.vendor ?? "";
}

export function engineModel(id: string): string {
  if (id === "infinitalk") return TALKING_PHOTO.kieModel;
  return (PROVIDERS as Record<string, ProviderConfig | undefined>)[id]?.kieModel ?? "";
}

/* ------------------------------ Synchro labiale ------------------------------ */

export const LIPSYNC = {
  kieModel: "volcengine/video-to-video-lip-sync",
  /** lite : une personne de face, plus rapide. basic : scènes complexes. */
  mode: "lite" as "lite" | "basic",
  /** Relevé le 2026-09-26 : 48 crédits pour 6,2 s. */
  creditsPerSec: 8,
  verifiedPricing: true,
  timeoutMs: 12 * 60 * 1000,
  /** Tentatives quand KIE repond « server is busy », et delai de base entre deux. */
  attempts: 3,
  retryDelayMs: 25_000,
};

/* ------------------------------ ElevenLabs ------------------------------ */

export const ELEVENLABS = {
  baseUrl: "https://api.elevenlabs.io/v1",
  /** Variable d'environnement lue en priorité ; sinon la clé saisie dans Réglages. */
  envKey: "ELEVENLABS_API_KEY",
  /** Modèle speech-to-speech : garde mots, rythme et intonation, change le timbre. */
  stsModel: "eleven_multilingual_sts_v2",
  outputFormat: "mp3_44100_128",
  /** Durée du cache de la liste des voix, côté serveur. */
  voicesCacheMs: 10 * 60 * 1000,
};

/** Hôtes distants dont on accepte de rapatrier un média (résultats et uploads KIE). */
export const REMOTE_MEDIA_HOSTS = new Set([
  "file.aiquickdraw.com",
  "tempfile.aiquickdraw.com",
  "static.aiquickdraw.com",
  "tempfile.redpandaai.co",
  "kieai.redpandaai.co",
]);
