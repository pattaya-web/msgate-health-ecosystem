/**
 * Types partagés navigateur / serveur du panneau « Ask Hermes ».
 *
 * Le panneau n'est pas un second assistant : c'est une porte vers l'instance
 * Hermes déjà utilisée sur Telegram (même mémoire, mêmes skills, mêmes outils
 * MCP). Le CRM lui apporte ce que Telegram n'a pas : le contexte de la page
 * ouverte et les métadonnées réelles des créas du Creative Engine.
 */

export type PageType =
  | "dashboard"
  | "ads"
  | "ads-uploader"
  | "mass-test"
  /** Une fiche produit est ouverte sur la page (Mass test, studio statique, Reproduire) : « ce produit » désigne celle-là. */
  | "product"
  /** L'espace de création centré produit : produit actif + référence visuelle principale. */
  | "product-creative-workspace"
  | "studio"
  | "studio-library"
  | "ugc"
  | "drive"
  | "bank-pages"
  | "spyshop"
  | "phoenix"
  | "profit"
  | "sav"
  | "ecosystem"
  | "shopify"
  | "product-images"
  | "other";

/** Ce que le CRM sait de la page ouverte. Seuls les champs réellement connus sont posés. */
export type PageContext = {
  route: string;
  pageType: PageType;
  storeId?: string;
  storeName?: string;
  productId?: string;
  productName?: string;
  productUrl?: string;
  batchId?: string;
  batchNumber?: number;
  creativeId?: string;
  creativeName?: string;
  /** URL (relative au CRM) de l'image de la créa ouverte, pour la joindre en un clic. */
  creativeImageUrl?: string;
  /** Référence visuelle principale du produit actif (URL hébergée) et son type. */
  primaryReferenceUrl?: string;
  primaryReferenceType?: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
};

/** Métadonnées réelles d'une créa générée par le Creative Engine, telles que stockées. */
export type CreativeRecord = {
  source: "creative-engine";
  batchId: string;
  batchNumber: number;
  store: string;
  productId: string;
  productName: string;
  productUrl: string;
  creativeId: string;
  name: string;
  family: { id: string; label: string };
  angle: { id: string; name: string };
  hook: string;
  layout: string;
  preset: { id: string; name: string };
  emphasis: string;
  variation: number;
  strategy: string;
  subject: { gender: string; ageRange: string; notes: string } | null;
  productVisibility: string;
  visualConcept: string;
  ratio: string;
  resolution: string;
  model: string;
  status: string;
  state: string;
  generatedAt: string | null;
  /** Direction créative saisie par l'opérateur au lancement du lot (niveau lot). */
  instructions: string;
  /** Le prompt exact envoyé au modèle d'image. */
  prompt: string;
  referenceUsed: boolean;
  imageUrl: string | null;
};

/** La fiche d'un produit du Creative Engine, résumée pour Hermes (jamais le texte brut de la page). */
export type ProductRecord = {
  id: string;
  name: string;
  store: string;
  url: string;
  engine: "claude" | "hermes" | "fallback";
  category: string;
  productType: string;
  productClass: string;
  targetCustomer: string;
  mainProblem: string;
  mechanism: string;
  transformation: string;
  benefits: string[];
  features: string[];
  angles: string[];
  imageUrl: string | null;
};

export type QuickAction = "analyze" | "original" | "reverse" | "angle" | "variations";

export const QUICK_ACTIONS: Array<{ id: QuickAction; label: string; needsImage: boolean }> = [
  { id: "analyze", label: "Analyze Creative", needsImage: true },
  { id: "original", label: "Original Prompt", needsImage: true },
  { id: "reverse", label: "Reverse Prompt", needsImage: true },
  { id: "angle", label: "Find Angle", needsImage: true },
  { id: "variations", label: "Suggest 5 Variations", needsImage: true },
];

/** Corps de POST /api/ask-hermes/chat. */
export type ChatRequest = {
  conversationId: string;
  message: string;
  context?: PageContext;
  /** Créa du CRM à joindre (image + métadonnées chargées côté serveur). */
  creative?: { batchId: string; creativeId: string } | null;
  /** Images externes déjà réduites par le navigateur, en data URL. */
  images?: Array<{ name: string; dataUrl: string }>;
  action?: QuickAction;
};

/** Une ligne du flux NDJSON renvoyé par POST /api/ask-hermes/chat. */
export type StreamEvent =
  | { t: "meta"; sessionId: string; creative: { name: string; batchNumber: number } | null }
  | { t: "delta"; text: string }
  | { t: "tool"; name: string; label: string; status: string; emoji?: string; id?: string }
  | { t: "done"; finish: string; error?: string }
  | { t: "error"; message: string };

export type HermesStatus = {
  configured: boolean;
  reachable: boolean | null;
  checkedAt: string;
};

/** Identifiant de conversation choisi par le navigateur, sûr pour Hermes (il le met dans un nom de fichier). */
export const CONVERSATION_ID_PATTERN = /^crm-[a-z0-9][a-z0-9-]{7,60}$/;
