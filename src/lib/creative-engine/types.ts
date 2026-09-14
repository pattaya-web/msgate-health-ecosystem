import type { Ratio } from "@/lib/studio/ratios";

/**
 * Le moteur de tests créatifs, en notions tenues séparées :
 *
 *   PRODUIT   — ce qu'on vend (lu sur la page, source de vérité)
 *   ANGLE     — pourquoi le client devrait s'y intéresser
 *   PRESET    — le style de présentation (type de créa du studio)
 *   FAMILLE   — le mécanisme visuel fondamental de la pub
 *   EMPHASE   — ce qui domine visuellement : le résultat ou le produit
 *   VARIANTE  — quel élément d'exécution on teste, l'angle restant fixe
 *   RÉFÉRENCE — l'inspiration visuelle, adaptée au produit courant
 *
 * Rien ici ne suppose une niche : un même lot sert une robe, un gadget ou un
 * protocole digital. Ce qui change d'un produit à l'autre vient de son
 * analyse, jamais du code.
 */

/* ------------------------------------------------------------------ */
/* Produit                                                              */
/* ------------------------------------------------------------------ */

export const PRODUCT_CLASSES = [
  "PHYSICAL_PRODUCT",
  "DIGITAL_INFORMATION_PRODUCT",
  "DIGITAL_TRANSFORMATION_PRODUCT",
  "SERVICE",
  "SOFTWARE",
  "OTHER",
] as const;
export type ProductClass = (typeof PRODUCT_CLASSES)[number];

export const EMPHASES = [
  { id: "outcome", label: "Résultat d'abord", hint: "Le résultat domine, le produit reste discret" },
  { id: "balanced", label: "Équilibré", hint: "Résultat et produit à poids égal" },
  { id: "product", label: "Produit d'abord", hint: "Le produit est le héros" },
] as const;
export type CreativeEmphasis = (typeof EMPHASES)[number]["id"];

export function isDigitalClass(productClass: ProductClass | undefined) {
  return productClass === "DIGITAL_INFORMATION_PRODUCT" || productClass === "DIGITAL_TRANSFORMATION_PRODUCT" || productClass === "SOFTWARE" || productClass === "SERVICE";
}

export type ProductAnalysis = {
  brand: string;
  category: string;
  productType: string;
  /** Classe du produit : décide de l'emphase recommandée et de la représentation. */
  productClass: ProductClass;
  recommendedEmphasis: CreativeEmphasis;
  price: string;
  comparePrice: string;
  offer: string;
  targetCustomer: string;
  gender: string;
  ageRange: string;
  mainProblem: string;
  benefits: string[];
  desires: string[];
  objections: string[];
  mechanism: string;
  features: string[];
  transformation: string;
  differentiation: string;
  guarantee: string;
  tone: string;
  cta: string;
  claims: string[];
};

export type Angle = {
  id: string;
  name: string;
  /** La raison psychologique, en une phrase, pour le prompt. */
  why: string;
  /** Accroches prêtes ; le planificateur les pioche sans en répéter une. */
  hooks: string[];
  source: "auto" | "custom";
};

export type ProductContext = {
  id: string;
  store: string;
  name: string;
  url: string;
  imageUrls: string[];
  analysis: ProductAnalysis | null;
  suggestedAngles: Angle[];
  customAngles: Angle[];
  engine: "claude" | "fallback";
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Familles visuelles                                                   */
/* ------------------------------------------------------------------ */

export type FamilyGroup = "transformation" | "feature" | "social" | "product";

export type CreativeFamily = {
  id: string;
  label: string;
  group: FamilyGroup;
  /** Le mécanisme visuel, dit au modèle d'image. */
  mechanism: string;
  /** Plusieurs mises en page pour ne pas répéter la même dans un lot. */
  layouts: string[];
  /** Presets du studio qui servent naturellement cette famille, par affinité. */
  presets: string[];
};

export const FAMILIES: CreativeFamily[] = [
  {
    id: "BEFORE_AFTER",
    label: "Avant / après",
    group: "transformation",
    mechanism: "A before/after comparison of the SAME person or scene. Same identity, same basic camera angle when useful; the change comes from presentation, grooming, posture, expression, styling, complexion — strong contrast, photographic realism, no impossible identity change.",
    layouts: [
      "classic 50/50 split with a thin divider, BEFORE left and AFTER right",
      "swipe-style transition: BEFORE fading into AFTER along a diagonal edge with a small drag handle",
      "large AFTER filling the frame with a small BEFORE inset in a corner",
      "two polaroid prints on a table, BEFORE and AFTER, handwritten labels",
      "mirror comparison: the person in front of a mirror, the reflection showing the AFTER",
      "tight close-up crop comparison on the area that changes, side by side",
      "annotated comparison with thin arrows and short callouts on the AFTER",
      "timeline strip DAY 1 → DAY 30 → DAY 90 in three vertical panels",
      "native social post look: a photo pair inside a phone-style card with a short caption",
      "editorial transformation: magazine-style layout, big serif headline, two portraits",
    ],
    presets: ["before-after", "ugc", "testimonial"],
  },
  {
    id: "SINGLE_RESULT",
    label: "Résultat seul",
    group: "transformation",
    mechanism: "One single image of the RESULT — the person or scene after the change, at its best, no before shown. The desire does the selling.",
    layouts: ["full-bleed portrait with the headline in the lower third", "centered subject with generous negative space and the headline at the top", "off-centre subject with a bold headline stacked on the empty side"],
    presets: ["ugc", "lifestyle", "product-focus"],
  },
  {
    id: "FEATURE_TRANSFORMATION",
    label: "Transformation d'un détail",
    group: "feature",
    mechanism: "A close-up on ONE specific feature that changes (a jawline, an eye area, a hairline, a seam, a surface) with a before/after or a marked result on that detail only.",
    layouts: ["macro close-up split on the feature, BEFORE / AFTER", "single close-up AFTER with two thin callouts", "circled detail with a magnifier inset"],
    presets: ["before-after", "feature-highlight", "product-focus"],
  },
  {
    id: "PROBLEM_VISUALIZATION",
    label: "Problème visualisé",
    group: "feature",
    mechanism: "The PROBLEM made visible and relatable: the frustrating moment, the flaw, the bad habit — shown honestly, with the promise of the fix in the headline.",
    layouts: ["candid moment of the problem, headline over it", "problem on the left, small solution card on the right", "annotated photo of the problem with a red mark and a short label"],
    presets: ["problem-solution", "ugc", "native"],
  },
  {
    id: "ANNOTATION",
    label: "Annotations",
    group: "feature",
    mechanism: "A single strong image with two or three short annotations — thin arrows, small labels, a circled detail — that explain what changes and why.",
    layouts: ["portrait with three short arrow callouts", "product or result with a numbered 1-2-3 callout stack", "hand-drawn style circles and notes over a photo"],
    presets: ["feature-highlight", "educational", "product-focus"],
  },
  {
    id: "UGC_RESULT",
    label: "Selfie résultat",
    group: "social",
    mechanism: "A native phone photo taken by the person themselves — selfie, mirror selfie, bathroom or bedroom photo — showing the result casually, with a direct-response hook overlaid. Nothing staged.",
    layouts: ["front-camera selfie, chest up, hook in bold text at the top", "mirror selfie with the phone visible, hook at the bottom", "casual bedroom photo with a short handwritten-style caption"],
    presets: ["ugc", "testimonial", "native"],
  },
  {
    id: "TESTIMONIAL",
    label: "Témoignage",
    group: "social",
    mechanism: "A portrait plus a short quoted sentence in the person's own words, like a real review. Believable, specific, no fabricated names or stars.",
    layouts: ["portrait with a quote card overlaid", "quote in large type above a smaller portrait", "chat-bubble style quote next to the person"],
    presets: ["testimonial", "customer-review", "ugc"],
  },
  {
    id: "SOCIAL_OUTCOME",
    label: "Résultat social",
    group: "social",
    mechanism: "The outcome in a real social situation — being noticed, a conversation, a date, a meeting — the person confident and at ease. No before/after needed.",
    layouts: ["candid social scene, the person in focus, others softly blurred", "two-shot: the person and someone reacting to them", "walking into a room, heads turning subtly"],
    presets: ["lifestyle", "ugc", "native"],
  },
  {
    id: "LIFESTYLE",
    label: "Lifestyle",
    group: "social",
    mechanism: "The product or its result inside a real life moment, aspirational but believable, the environment doing half the selling.",
    layouts: ["wide lifestyle scene, headline in the sky or wall space", "medium shot in a real interior, product or result naturally present", "outdoor daylight moment, handheld feel"],
    presets: ["lifestyle", "native", "ugc"],
  },
  {
    id: "PRODUCT_HERO",
    label: "Produit héros",
    group: "product",
    mechanism: "The product itself is the hero: clean, large, beautifully lit, exactly as in its photos. For a digital product, the hero is its screen or interface, never a printed object unless allowed.",
    layouts: ["centered product on a clean background with the headline above", "product at an angle with a price or benefit badge", "product on a real surface with soft daylight"],
    presets: ["product-focus", "luxury", "price"],
  },
  {
    id: "PRODUCT_DEMO",
    label: "Démonstration",
    group: "product",
    mechanism: "The product in use, hands doing the thing, the benefit visible in the action. For a digital product: the screen being used, a step being ticked.",
    layouts: ["hands using the product, close, headline at the top", "one demo showing three sequential steps inside the same single ad", "over-the-shoulder use in a real environment"],
    presets: ["product-demo", "how-it-works", "educational"],
  },
  {
    id: "COMPARISON",
    label: "Comparaison",
    group: "product",
    mechanism: "Ours versus the generic alternative, on the criteria that matter, marked with ticks and crosses. Never a real competitor brand.",
    layouts: ["two columns, cross left / tick right", "a compact comparison table under one image", "two products side by side with three criteria"],
    presets: ["comparison", "price", "educational"],
  },
  {
    id: "SYSTEM_EXPLAINER",
    label: "Système / protocole",
    group: "product",
    mechanism: "The method itself made visible: a roadmap, pillars, a checklist, a protocol interface on a screen. Clean, structured, the promise 'stop guessing what to fix'.",
    layouts: ["phone screen with a clean checklist app page, headline above", "roadmap of numbered pillars on a flat colour background", "tablet showing a dashboard with the person's result beside it"],
    presets: ["how-it-works", "educational", "feature-highlight"],
  },
  {
    id: "NATIVE_FEED",
    label: "Post natif",
    group: "social",
    mechanism: "Looks like an organic post someone shared, not an ad: casual photo, short caption, imperfect framing, minimal branding.",
    layouts: ["square-ish casual photo with a two-line caption", "screenshot-style post card with a photo and a caption", "photo dump feel: one strong candid image"],
    presets: ["native", "ugc"],
  },
  {
    id: "EDITORIAL",
    label: "Éditorial",
    group: "product",
    mechanism: "Magazine-grade image and typography: a strong portrait or product still, a serif headline, restraint. Premium without being cold.",
    layouts: ["full-bleed editorial portrait with a serif headline", "product still life with a small caption block", "single magazine-page editorial feel, one image and one text column"],
    presets: ["luxury", "product-focus", "lifestyle"],
  },
  {
    id: "INFOGRAPHIC",
    label: "Infographie",
    group: "feature",
    mechanism: "Three or four benefits or steps laid out as a clean infographic around one image, little text per item, real words only.",
    layouts: ["central image with four benefit icons around it", "vertical steps 1-2-3 beside a photo", "a row of small benefit icons under one hero image"],
    presets: ["educational", "feature-highlight", "how-it-works"],
  },
];

export function familyById(id: string | undefined) {
  return FAMILIES.find((family) => family.id === id);
}

/** Répartition par groupe selon l'emphase, en pourcentages. */
export const FAMILY_MIX: Record<CreativeEmphasis, Record<FamilyGroup, number>> = {
  outcome: { transformation: 40, feature: 25, social: 20, product: 15 },
  balanced: { transformation: 30, feature: 20, social: 20, product: 30 },
  product: { transformation: 15, feature: 15, social: 20, product: 50 },
};

export type FamilyMixSetting = { mode: "auto" } | { mode: "custom"; counts: Record<FamilyGroup, number> };

/* ------------------------------------------------------------------ */
/* Variantes                                                            */
/* ------------------------------------------------------------------ */

export const VARIATION_STRATEGIES = [
  { id: "composition", label: "Composition / mécanisme", prompt: "TEST VARIABLE — COMPOSITION and visual mechanism: this creative has its own layout and its own way of showing the argument (its sibling creatives are separate images, never shown here)." },
  { id: "model", label: "Modèle / environnement", prompt: "TEST VARIABLE — SUBJECT and environment: one person or scene in one setting carries this angle; keep the headline direct." },
  { id: "intensity", label: "Cadrage / intensité", prompt: "TEST VARIABLE — FRAMING and message intensity: one chosen framing (tight or wide), and the copy pushes this angle at one chosen intensity while staying believable." },
  { id: "hook", label: "Accroche", prompt: "TEST VARIABLE — the HOOK: this headline idea carries the angle; keep the composition conventional for the family." },
  { id: "context", label: "Contexte", prompt: "TEST VARIABLE — CONTEXT: this angle placed in one specific life moment or occasion." },
  { id: "mechanism", label: "Mécanisme", prompt: "TEST VARIABLE — MECHANISM: the proof is shown through ONE device — callouts, or a comparison, or a close-up, or a timeline — for this angle and hook." },
] as const;
export type VariationStrategy = (typeof VARIATION_STRATEGIES)[number]["id"];

export function strategyFor(variation: number): VariationStrategy {
  return VARIATION_STRATEGIES[(variation - 1) % VARIATION_STRATEGIES.length].id;
}

/* ------------------------------------------------------------------ */
/* Lots et créas                                                        */
/* ------------------------------------------------------------------ */

export type ReferenceStrength = "low" | "medium" | "high";

export const CREATIVE_STATUSES = [
  { id: "generated", label: "Généré" },
  { id: "ready", label: "Prêt à tester" },
  { id: "testing", label: "En test" },
  { id: "potential", label: "Potentiel winner" },
  { id: "winner", label: "Winner" },
  { id: "loser", label: "Loser" },
  { id: "archived", label: "Archivé" },
] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number]["id"];

export type ProductVisibility = "none" | "subtle" | "medium" | "hero";

export type SubjectSpec = {
  gender: string;
  ageRange: string;
  notes: string;
};

/** La fiche d'une créa planifiée : tout ce qui décide du prompt, lisible et rejouable. */
export type CreativeSpec = {
  angleId: string;
  angleName: string;
  presetId: string;
  presetName: string;
  familyId: string;
  familyLabel: string;
  emphasis: CreativeEmphasis;
  variation: number;
  strategy: VariationStrategy;
  hook: string;
  layout: string;
  subject: SubjectSpec | null;
  productVisibility: ProductVisibility;
  physicalProductAllowed: boolean;
  referenceStrategy: string;
  /** Concept en une phrase, pour lire le lot sans ouvrir les prompts. */
  visualConcept: string;
  /**
   * Contrat entre planner, compositeur de prompt et générateur : UNE image =
   * UNE pub. La diversité vit entre les créas du lot, jamais dans une image
   * (pas de collage, planche, grille, moodboard). Toujours vrai en Mass test ;
   * un futur mode multi-panneaux le mettra à false explicitement.
   */
  singleCreativeOnly: boolean;
};

export type BatchItem = CreativeSpec & {
  id: string;
  /** STORE_PRODUCT_ANGLE_FAMILY_V01 */
  name: string;
  prompt: string;
  taskId: string | null;
  state: "pending" | "done" | "fail";
  error: string | null;
  urls: string[];
  file: string | null;
  status: CreativeStatus;
  model: string;
  referenceUsed: boolean;
  generatedAt: string | null;
  /** Pour « variations depuis un winner » : la créa d'origine. */
  parentId?: string | null;
};

export type PlanSummary = {
  total: number;
  families: Array<{ id: string; label: string; group: FamilyGroup; count: number }>;
  groups: Record<FamilyGroup, number>;
  angles: Array<{ id: string; name: string; count: number }>;
  layouts: number;
  subjects: number;
  hooks: number;
  adjustments: string[];
};

export type TestBatch = {
  id: string;
  number: number;
  store: string;
  productId: string;
  productName: string;
  productUrl: string;
  createdAt: string;
  ratio: Ratio;
  resolution: "1K" | "2K";
  emphasis: CreativeEmphasis;
  physicalMockup: boolean;
  familyMix: FamilyMixSetting;
  referenceStrength: ReferenceStrength;
  referenceUrls: string[];
  productImageUrls: string[];
  instructions: string;
  angles: Angle[];
  presets: string[];
  variationsPerAngle: number;
  plan: PlanSummary;
  items: BatchItem[];
  /** Absent pour un lot planifié par le moteur ; « ask-hermes » quand les prompts viennent du chat, après confirmation. */
  source?: "ask-hermes";
  /** Conversation Ask Hermes d'origine, pour retrouver l'échange. */
  sessionId?: string | null;
  referenceFrameworkId?: string | null;
};

export type BatchSummary = {
  total: number;
  generated: number;
  failed: number;
  byStatus: Record<CreativeStatus, number>;
};

export function summarize(batch: TestBatch): BatchSummary {
  const byStatus = Object.fromEntries(CREATIVE_STATUSES.map((status) => [status.id, 0])) as Record<CreativeStatus, number>;
  let generated = 0;
  let failed = 0;
  for (const item of batch.items) {
    if (item.state === "done") generated += 1;
    if (item.state === "fail") failed += 1;
    byStatus[item.status] += 1;
  }
  return { total: batch.items.length, generated, failed, byStatus };
}
