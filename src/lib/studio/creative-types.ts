/**
 * Catalogue des types de créatives, et fabrique de prompts.
 *
 * Tout est ici et rien dans les composants : ajouter un type de créative doit
 * se faire en écrivant une entrée, pas en retouchant du JSX. C'est la
 * différence entre un catalogue qui grandit et un catalogue qui se fige.
 *
 * Le `preview` n'est pas une image mais un petit schéma — quelques zones
 * nommées. L'interface le dessine. Une vignette figée mentirait dès qu'on
 * touche au prompt, alors qu'un schéma dit la structure, qui est justement ce
 * qu'on choisit.
 */

export type ProductCategory =
  | "fashion"
  | "beauty"
  | "gadget"
  | "home"
  | "fitness"
  | "health"
  | "jewelry"
  | "pet"
  | "digital"
  | "general";

export const PRODUCT_CATEGORIES: Array<{ id: ProductCategory; label: string }> = [
  { id: "fashion", label: "Mode" },
  { id: "beauty", label: "Beauté / Skincare" },
  { id: "gadget", label: "Gadget" },
  { id: "home", label: "Maison / Déco" },
  { id: "fitness", label: "Fitness" },
  { id: "health", label: "Santé" },
  { id: "jewelry", label: "Bijoux" },
  { id: "pet", label: "Animaux" },
  { id: "digital", label: "Digital" },
  { id: "general", label: "E-commerce général" },
];

export type CreativeCategory =
  | "performance"
  | "social-proof"
  | "branding"
  | "urgency"
  | "educational"
  | "native";

export const CREATIVE_CATEGORIES: Array<{ id: CreativeCategory; label: string }> = [
  { id: "performance", label: "Performance" },
  { id: "social-proof", label: "Preuve sociale" },
  { id: "branding", label: "Mode / Branding" },
  { id: "urgency", label: "Urgence" },
  { id: "educational", label: "Pédagogique" },
  { id: "native", label: "Natif / Social" },
];

/**
 * Maquette miniature dessinée sur la card.
 *
 * `layout` place le bloc produit, `accents` pose ce qui l'entoure. Une vraie
 * petite mise en page se lit d'un coup d'œil, là où une liste de mots demande
 * de lire — et on choisit ici sur l'allure, pas sur la description.
 */
export type PreviewLayout =
  | "centered"
  | "product-top"
  | "product-bottom"
  | "split-v"
  | "split-h"
  | "grid"
  | "sidebar"
  | "full";

export type PreviewAccent = {
  kind: "badge" | "price" | "strike" | "stars" | "arrow" | "pill" | "line" | "tick" | "cross";
  at: "tl" | "tr" | "bl" | "br" | "under" | "over" | "left" | "right";
  text?: string;
};

export type Preview = {
  layout: PreviewLayout;
  accents: PreviewAccent[];
};

/** Conservé le temps de la bascule : plus aucun type ne s'en sert. */
export type PreviewBlock = {
  label: string;
  weight: "hero" | "strong" | "normal" | "faint";
};

export type CreativeType = {
  id: string;
  name: string;
  category: CreativeCategory;
  description: string;
  preview: Preview;
  recommendedFor: ProductCategory[];
  /** Consigne envoyée au modèle. Décrit une intention, jamais un gabarit figé. */
  promptInstructions: string;
  defaultVisualElements: string[];
  defaultVariations: number;
  enabled: boolean;
};

export const CREATIVE_TYPES: CreativeType[] = [
  /* ---------------- Performance ---------------- */
  {
    id: "price-highlight",
    name: "Price Highlight",
    category: "performance",
    description: "Le prix domine l'image",
    preview: { layout: "centered", accents: [{ kind: "price", at: "under", text: "$29.99" }, { kind: "strike", at: "under", text: "$79.99" }] },
    recommendedFor: ["fashion", "beauty", "gadget", "home", "general"],
    promptInstructions:
      "Build the creative around the price. The price is the loudest element after the product: set it large and unmissable, with the compare-at price struck through beside or above it. Everything else stays quiet.",
    defaultVisualElements: ["price-badge", "arrow", "cta"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "discount-sale",
    name: "Discount / Sale",
    category: "performance",
    description: "Promotion, remise, offre limitée",
    preview: { layout: "centered", accents: [{ kind: "badge", at: "tl", text: "-50%" }, { kind: "pill", at: "under", text: "SALE" }] },
    recommendedFor: ["fashion", "beauty", "gadget", "home", "jewelry", "general"],
    promptInstructions:
      "Centre the creative on a promotion. A discount figure carries the image, with a sale badge and a short scarcity line. Loud, commercial, unambiguous.",
    defaultVisualElements: ["discount-badge", "price-badge", "sticker"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "product-benefits",
    name: "Product Benefits",
    category: "performance",
    description: "Produit au centre, bénéfices autour",
    preview: { layout: "centered", accents: [{ kind: "arrow", at: "left" }, { kind: "arrow", at: "right" }, { kind: "line", at: "under" }] },
    recommendedFor: ["gadget", "beauty", "health", "fitness", "home", "pet"],
    promptInstructions:
      "Place the product at the centre and arrange three short benefit callouts around it, each connected by a thin line or arrow pointing at the relevant part of the product.",
    defaultVisualElements: ["arrow", "feature-icons", "checkmarks"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "feature-callout",
    name: "Feature Callout",
    category: "performance",
    description: "Une seule caractéristique, mise en avant",
    preview: { layout: "centered", accents: [{ kind: "arrow", at: "tr" }, { kind: "line", at: "under", text: "Ultra Soft" }] },
    recommendedFor: ["fashion", "gadget", "beauty", "fitness", "home"],
    promptInstructions:
      "Pick the single most convincing feature of the product and build the whole image around it. One headline, one arrow or circle pointing at the exact spot on the product where that feature lives.",
    defaultVisualElements: ["arrow", "circle-highlight"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "problem-solution",
    name: "Problem → Solution",
    category: "performance",
    description: "Le problème en haut, le produit en réponse",
    preview: { layout: "split-h", accents: [{ kind: "cross", at: "over" }, { kind: "tick", at: "under" }] },
    recommendedFor: ["gadget", "health", "beauty", "home", "pet", "fitness"],
    promptInstructions:
      "Split the frame in two. The upper half states a frustration the buyer recognises; the lower half answers it with the product. The turn between the two must read instantly.",
    defaultVisualElements: ["crosses", "checkmarks", "arrow"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "comparison",
    name: "Comparison",
    category: "performance",
    description: "Le produit contre l'alternative",
    preview: { layout: "split-v", accents: [{ kind: "cross", at: "left" }, { kind: "tick", at: "right" }] },
    recommendedFor: ["gadget", "home", "fitness", "health", "general"],
    promptInstructions:
      "Two columns side by side: a generic, unbranded alternative on the left marked with a cross, our product on the right marked with a tick. Never name or show a real competitor brand.",
    defaultVisualElements: ["comparison-table", "checkmarks", "crosses"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "before-after",
    name: "Before / After",
    category: "performance",
    description: "Avant / après, séparés nettement",
    preview: { layout: "split-v", accents: [{ kind: "line", at: "left", text: "BEFORE" }, { kind: "line", at: "right", text: "AFTER" }] },
    recommendedFor: ["beauty", "health", "fitness", "home", "pet", "digital"],
    promptInstructions:
      "Split the frame down the middle, labelled BEFORE and AFTER. The SAME person, same framing, same neutral clothing, same light, same phone camera on both sides, so only the change reads. Make the change STRONG and immediately readable at thumbnail size — the AFTER is the best version of that person: clearer skin, sharper jawline, better groomed, upright and confident, well dressed, rested; the BEFORE is visibly tired, neglected and slouched. A viewer must instantly want the AFTER. Still the same human, a few months later — no surgery look, no different person.",
    defaultVisualElements: ["arrow"],
    defaultVariations: 5,
    enabled: true,
  },

  /* ---------------- Preuve sociale ---------------- */
  {
    id: "social-proof",
    name: "Social Proof",
    category: "social-proof",
    description: "Note, volume de clients, best-seller",
    preview: { layout: "centered", accents: [{ kind: "stars", at: "over" }, { kind: "line", at: "under", text: "10,000+" }] },
    recommendedFor: ["fashion", "beauty", "gadget", "health", "jewelry", "general"],
    promptInstructions:
      "Build the creative around proof: a star rating, a customer count and a short trust line, set cleanly next to the product.",
    defaultVisualElements: ["star-rating", "bestseller-badge"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "customer-review",
    name: "Customer Review",
    category: "social-proof",
    description: "Produit plus un avis mis en page",
    preview: { layout: "product-bottom", accents: [{ kind: "stars", at: "over" }, { kind: "line", at: "over", text: "« ... »" }] },
    recommendedFor: ["fashion", "beauty", "gadget", "home", "pet", "general"],
    promptInstructions:
      "Lay a short customer quote over or beside the product, set like a real review card with a star row. Keep the wording ordinary and specific, the way a real buyer writes.",
    defaultVisualElements: ["star-rating", "review"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "best-seller",
    name: "Best Seller",
    category: "social-proof",
    description: "Best-seller, tendance, le plus demandé",
    preview: { layout: "centered", accents: [{ kind: "badge", at: "tr", text: "BEST" }] },
    recommendedFor: ["fashion", "beauty", "jewelry", "gadget", "general"],
    promptInstructions:
      "Crown the product: a best-seller or trending badge sits on the image, everything else stays out of its way.",
    defaultVisualElements: ["bestseller-badge", "sticker"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "ugc",
    name: "UGC Style",
    category: "social-proof",
    description: "Photo prise sur le vif, peu designée",
    preview: { layout: "full", accents: [{ kind: "line", at: "under", text: "légende" }] },
    recommendedFor: ["fashion", "beauty", "gadget", "home", "pet", "fitness"],
    promptInstructions:
      "Shoot it like a real customer would: handheld phone photo, ordinary room or street, imperfect light, no studio polish. Any text looks typed into the app afterwards, not designed.",
    defaultVisualElements: ["sticky-note"],
    defaultVariations: 5,
    enabled: true,
  },

  /* ---------------- Mode / Branding ---------------- */
  {
    id: "editorial",
    name: "Editorial",
    category: "branding",
    description: "Style magazine, très propre",
    preview: { layout: "centered", accents: [{ kind: "line", at: "over", text: "titre" }] },
    recommendedFor: ["fashion", "beauty", "jewelry", "home"],
    promptInstructions:
      "Compose it like a fashion magazine page: generous negative space, one restrained serif headline, controlled light, no badge and no promotional clutter.",
    defaultVisualElements: [],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "luxury",
    name: "Premium / Luxury",
    category: "branding",
    description: "Minimal, presque sans texte",
    preview: { layout: "centered", accents: [] },
    recommendedFor: ["jewelry", "fashion", "beauty", "home"],
    promptInstructions:
      "Strip everything away: the product, one deep or muted ground, one directional light, at most three words. Silence is the effect.",
    defaultVisualElements: [],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "lifestyle",
    name: "Lifestyle",
    category: "branding",
    description: "Le produit dans son environnement",
    preview: { layout: "full", accents: [] },
    recommendedFor: ["fashion", "home", "fitness", "pet", "beauty"],
    promptInstructions:
      "Show the product where it actually gets used, in a believable everyday setting, being handled by someone. The scene carries the image; text stays minimal.",
    defaultVisualElements: [],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "product-focus",
    name: "Product Focus",
    category: "branding",
    description: "Produit très gros, presque sans texte",
    preview: { layout: "full", accents: [] },
    recommendedFor: ["gadget", "jewelry", "beauty", "fashion", "general"],
    promptInstructions:
      "Fill the frame with the product. Texture, material and construction must read. One short line at most.",
    defaultVisualElements: [],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "new-arrival",
    name: "New Arrival",
    category: "branding",
    description: "Nouveauté, nouvelle collection",
    preview: { layout: "product-bottom", accents: [{ kind: "pill", at: "over", text: "NEW" }] },
    recommendedFor: ["fashion", "jewelry", "beauty", "home"],
    promptInstructions:
      "Announce a launch: a short newness line — new drop, just in, new collection — set with confidence above or beside the product.",
    defaultVisualElements: ["sticker"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "minimal-text",
    name: "Minimal Text",
    category: "branding",
    description: "Produit, une accroche, un CTA",
    preview: { layout: "product-top", accents: [{ kind: "line", at: "under", text: "accroche" }, { kind: "pill", at: "under", text: "CTA" }] },
    recommendedFor: ["fashion", "beauty", "home", "digital", "general"],
    promptInstructions:
      "Three elements and nothing else: the product, one headline, one call to action. Clean ground, no badge, no arrow.",
    defaultVisualElements: ["cta-button"],
    defaultVariations: 5,
    enabled: true,
  },

  /* ---------------- Urgence ---------------- */
  {
    id: "limited-stock",
    name: "Limited Stock",
    category: "urgency",
    description: "Stock faible, part vite",
    preview: { layout: "centered", accents: [{ kind: "pill", at: "over", text: "FEW LEFT" }] },
    recommendedFor: ["fashion", "gadget", "beauty", "jewelry", "general"],
    promptInstructions:
      "Put scarcity on the image: a low-stock or selling-fast line, set as a stamp or a strip. Urgent but not shouted.",
    defaultVisualElements: ["limited-stock", "sticker"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "free-shipping",
    name: "Free Shipping",
    category: "urgency",
    description: "Livraison offerte, aujourd'hui",
    preview: { layout: "centered", accents: [{ kind: "pill", at: "under", text: "FREE SHIP" }] },
    recommendedFor: ["general", "home", "gadget", "pet", "fashion"],
    promptInstructions:
      "Lead with free shipping as the offer, with a same-day or today-only qualifier under it.",
    defaultVisualElements: ["free-shipping", "cta-button"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "gift-idea",
    name: "Gift Idea",
    category: "urgency",
    description: "Idée cadeau, pour elle, pour lui",
    preview: { layout: "centered", accents: [{ kind: "badge", at: "tl", text: "GIFT" }] },
    recommendedFor: ["jewelry", "beauty", "fashion", "home", "pet"],
    promptInstructions:
      "Frame the product as a gift: wrapping, ribbon or a giving gesture, with a short gift line. Warm light.",
    defaultVisualElements: ["sticker"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "viral-trend",
    name: "Viral / Trend",
    category: "urgency",
    description: "Tout le monde en parle",
    preview: { layout: "full", accents: [{ kind: "line", at: "over", text: "viral" }] },
    recommendedFor: ["fashion", "beauty", "gadget", "pet", "home"],
    promptInstructions:
      "Make it look like the thing everyone is posting about: a caption in the voice of a feed — viral right now, everyone is talking about this — over an unpolished photo.",
    defaultVisualElements: ["sticky-note"],
    defaultVariations: 5,
    enabled: true,
  },

  /* ---------------- Pédagogique ---------------- */
  {
    id: "how-it-works",
    name: "How It Works",
    category: "educational",
    description: "Le fonctionnement en trois temps",
    preview: { layout: "grid", accents: [{ kind: "arrow", at: "under" }] },
    recommendedFor: ["gadget", "health", "beauty", "home", "fitness", "digital"],
    promptInstructions:
      "Explain the product in three numbered steps laid out in sequence, each with a small illustration of that step. Plain and instructional.",
    defaultVisualElements: ["arrow", "feature-icons"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "benefits-grid",
    name: "Benefits Grid",
    category: "educational",
    description: "Produit plus une grille de bénéfices",
    preview: { layout: "sidebar", accents: [{ kind: "tick", at: "right" }, { kind: "tick", at: "right" }] },
    recommendedFor: ["gadget", "health", "home", "fitness", "beauty"],
    promptInstructions:
      "Product on one side, a tidy grid of four short benefits with small icons on the other. Legible at thumbnail size.",
    defaultVisualElements: ["feature-icons", "checkmarks"],
    defaultVariations: 5,
    enabled: true,
  },
  {
    id: "listicle",
    name: "Listicle",
    category: "educational",
    description: "3 raisons de l'acheter",
    preview: { layout: "sidebar", accents: [{ kind: "line", at: "over", text: "3 raisons" }, { kind: "tick", at: "right" }] },
    recommendedFor: ["general", "gadget", "beauty", "health", "home"],
    promptInstructions:
      "Head the image with a numbered promise — three reasons you need this — then the three lines beneath, product alongside.",
    defaultVisualElements: ["checkmarks"],
    defaultVariations: 5,
    enabled: true,
  },

  /* ---------------- Natif / Social ---------------- */
  {
    id: "native-feed",
    name: "Native Feed",
    category: "native",
    description: "Ressemble à un vrai post",
    preview: { layout: "full", accents: [{ kind: "line", at: "under", text: "post" }] },
    recommendedFor: ["fashion", "beauty", "gadget", "pet", "home"],
    promptInstructions:
      "Make it read as an organic post rather than an ad: casual framing, a caption in a normal person's voice. No badge, no price, no call to action.",
    defaultVisualElements: [],
    defaultVariations: 5,
    enabled: true,
  },
];

/* ---------------- Angles marketing ---------------- */

export const MARKETING_ANGLES: Array<{ id: string; label: string; prompt: string }> = [
  { id: "price", label: "Prix", prompt: "The argument is value for money." },
  { id: "convenience", label: "Praticité", prompt: "The argument is how much easier it makes things." },
  { id: "comfort", label: "Confort", prompt: "The argument is comfort and how it feels to use." },
  { id: "transformation", label: "Transformation", prompt: "The argument is the change it produces." },
  { id: "social-proof", label: "Preuve sociale", prompt: "The argument is that many people already chose it." },
  { id: "luxury", label: "Luxe", prompt: "The argument is refinement and status." },
  { id: "problem", label: "Problème résolu", prompt: "The argument is a specific frustration it removes." },
  { id: "trend", label: "Tendance", prompt: "The argument is that it is what people want right now." },
  { id: "scarcity", label: "Rareté", prompt: "The argument is that it will not stay available." },
  { id: "quality", label: "Qualité", prompt: "The argument is materials and how well it is made." },
  { id: "gift", label: "Cadeau", prompt: "The argument is that it makes a good gift." },
  { id: "newness", label: "Nouveauté", prompt: "The argument is that it has just arrived." },
];

/* ---------------- Éléments visuels ---------------- */

export const VISUAL_ELEMENTS: Array<{ id: string; label: string; prompt: string }> = [
  { id: "arrow", label: "Flèche", prompt: "a hand-drawn arrow pointing at the product" },
  { id: "price-badge", label: "Badge prix", prompt: "a price badge" },
  { id: "discount-badge", label: "Badge remise", prompt: "a discount badge" },
  { id: "star-rating", label: "Étoiles", prompt: "a row of rating stars" },
  { id: "review", label: "Avis", prompt: "a short review card" },
  { id: "circle-highlight", label: "Cercle", prompt: "a hand-drawn circle around a detail" },
  { id: "product-outline", label: "Contour produit", prompt: "a traced outline around the product" },
  { id: "sticker", label: "Sticker", prompt: "a die-cut sticker" },
  { id: "sticky-note", label: "Post-it", prompt: "a handwritten sticky note" },
  { id: "torn-paper", label: "Papier déchiré", prompt: "a torn paper strip" },
  { id: "cta-button", label: "Bouton CTA", prompt: "a call-to-action button" },
  { id: "bestseller-badge", label: "Badge best-seller", prompt: "a best-seller badge" },
  { id: "free-shipping", label: "Livraison offerte", prompt: "a free-shipping strip" },
  { id: "limited-stock", label: "Stock limité", prompt: "a low-stock stamp" },
  { id: "feature-icons", label: "Icônes", prompt: "small feature icons" },
  { id: "comparison-table", label: "Tableau comparatif", prompt: "a two-column comparison" },
  { id: "checkmarks", label: "Coches", prompt: "green tick marks" },
  { id: "crosses", label: "Croix", prompt: "red cross marks" },
];

/**
 * Axes que l'Auto Mix fait varier d'une déclinaison à l'autre.
 *
 * Sans ça, dix déclinaisons d'un même type ne changent que par le texte : dix
 * fois le même gabarit ne teste rien. On force donc une variation sur la
 * composition elle-même — l'inverse d'un lot inutile.
 */
const MIX_AXES = [
  ["a clean studio sweep", "a real interior", "a bold flat colour", "a soft gradient", "an outdoor daylight setting"],
  ["product centred", "product off-centre left", "product off-centre right", "product low in the frame", "product filling most of the frame"],
  ["headline above the product", "headline below the product", "headline overlapping the product", "headline in a corner"],
  ["soft diffused light", "hard directional light with a crisp shadow", "warm backlight", "flat even light"],
  ["shot straight on", "shot slightly from above", "shot from a low angle", "shot at a three-quarter angle"],
];

/**
 * Lieux réels tirés au sort.
 *
 * Sans ancrage, le modèle rejoue toujours le même studio blanc et le lot entier
 * se ressemble. Un endroit précis et banal donne une lumière, un désordre et
 * une matière que le fond neutre ne produit jamais.
 */
const PLACES = [
  "a small tiled bathroom with a fogged mirror",
  "a sunlit kitchen counter with crumbs and a used mug",
  "an unmade bed with rumpled linen, morning light",
  "a car passenger seat, seatbelt visible",
  "a cluttered desk with cables and a half-open notebook",
  "a supermarket aisle under strip lighting",
  "a stairwell landing with scuffed paint",
  "a balcony rail overlooking a street",
  "a laundry room with a full basket",
  "a hallway with coats on a hook",
  "a park bench with dry leaves",
  "a bedroom floor beside a radiator",
];

/**
 * Ce qui trahit une image générée, énoncé pour être évité.
 *
 * Le repli du modèle est le rendu publicitaire lisse : peau retouchée, lumière
 * sans source, symétrie parfaite. Nommer ces travers coûte quelques lignes et
 * change plus le résultat que n'importe quel réglage.
 */
const ANTI_AI = [
  "NOT AI-looking. Shot on a real camera or a modern phone: visible sensor grain,",
  "true depth of field, one identifiable light source casting a consistent shadow.",
  "Real skin with pores, stray hairs, uneven tone. Fabric with real weave, creases",
  "and lint. Surfaces slightly worn, dust and fingerprints allowed.",
  "AVOID: plastic airbrushed skin, waxy highlights, glowing rim light with no source,",
  "perfect symmetry, floating objects, impossible reflections, over-saturated HDR,",
  "smeared background bokeh, mangled hands or fingers, garbled letterforms, extra limbs,",
  "duplicated product, watermark, stock-photo blandness, centred-everything composition.",
];

/**
 * Générateur semé (mulberry32).
 *
 * `Math.random()` donnerait bien du hasard, mais un lot ne serait plus
 * rejouable : une créa qui sort bien serait irreproductible. Avec une graine,
 * le tirage reste statistiquement aléatoire et le même lot se refait à
 * l'identique — on garde le bénéfice du hasard sans en payer le prix.
 */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tire `count` entrées distinctes, sans jamais remettre la même. */
function pickDistinct<T>(pool: T[], count: number, rand: () => number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  for (let i = 0; i < count && rest.length; i += 1) {
    out.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  }
  return out;
}

export type BuildPromptInput = {
  creativeType: CreativeType;
  angleIds: string[];
  visualElementIds: string[];
  productName: string;
  productDescription?: string;
  price?: string;
  comparePrice?: string;
  keyPoints?: string[];
  /** Index de la déclinaison, pour que chacune diffère vraiment. */
  variation: number;
  autoMix: boolean;
  /** Couleur du produit, rappelée discrètement dans un détail de l'image. */
  echoColor?: string | null;
  /** Graine du lot : même graine, même lot. Change à chaque lancement. */
  seed?: number;
  /** Tirage aléatoire des éléments plutôt que rotation régulière. */
  randomElements?: boolean;
  /** Catégorie choisie dans la barre : décide de la forme que prend le produit. */
  productCategory?: ProductCategory | null;
};

/**
 * Un programme vendu en ligne n'a pas de corps. Sans cette règle le modèle lui
 * en donne un — presque toujours un livre — alors que le client ne reçoit
 * aucun livre. Le produit se montre par son résultat sur une personne, par un
 * écran, ou par de la typographie ; jamais par un objet.
 */
const DIGITAL_FORM = [
  "PRODUCT FORM — DIGITAL PROGRAMME, delivered online and followed on a phone. There is NO",
  "physical object: never a book, never an ebook or paperback cover, never a box, booklet,",
  "binder, cards, paper or printed pages. Show the product ONLY through (a) the person and the",
  "result they get, (b) their own phone or laptop screen with a clean minimal app-style page",
  "that carries the product name, or (c) bold typography on a flat colour. If a reference image",
  "shows a person or a screen, match it; never turn the product name into a printed cover.",
].join(" ");

/**
 * Assemble le prompt final.
 *
 * L'ordre compte : le produit d'abord parce qu'il est le seul élément qui ne
 * doit jamais bouger, l'intention ensuite, la variation en dernier pour
 * qu'elle infléchisse sans écraser.
 */
export function buildCreativePrompt(input: BuildPromptInput): string {
  const angles = MARKETING_ANGLES.filter((angle) => input.angleIds.includes(angle.id));
  /**
   * Les éléments cochés forment une palette, pas une liste de courses.
   *
   * Tous posés sur la même image, on obtient une créa saturée — badge prix,
   * flèche, étoiles, coches et pastille CTA d'un coup — qui ne ressemble à
   * aucune publicité réelle. Chaque déclinaison en prend deux, prélevés à un
   * endroit différent de la palette : sur dix créas, la palette est couverte
   * sans qu'aucune ne soit chargée.
   */
  const pool = VISUAL_ELEMENTS.filter((item) => input.visualElementIds.includes(item.id));
  const rand = seeded((input.seed ?? 1) * 9301 + input.variation * 49297 + 233280);

  /*
   * En aléatoire, le NOMBRE d'éléments varie aussi, pas seulement lesquels :
   * la densité est elle-même une variable à tester. Une créa à un seul badge
   * et une créa à trois annotations ne performent pas pareil, et c'est
   * précisément ce qu'on cherche à savoir.
   */
  const elements = !pool.length
    ? []
    : input.randomElements
      ? pickDistinct(pool, 1 + Math.floor(rand() * Math.min(3, pool.length)), rand)
      : Array.from({ length: Math.min(2, pool.length) }, (_, offset) =>
          pool[(input.variation * Math.min(2, pool.length) + offset) % pool.length]
        );

  const product = [
    `PRODUCT: ${input.productName}.`,
    input.productDescription ? input.productDescription : "",
    input.price ? `Price ${input.price}${input.comparePrice ? `, was ${input.comparePrice}` : ""}.` : "",
    input.keyPoints?.filter(Boolean).length
      ? `Selling points: ${input.keyPoints.filter(Boolean).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const mix = input.autoMix
    ? MIX_AXES.map((axis) =>
        input.randomElements
          ? axis[Math.floor(rand() * axis.length)]
          : axis[(input.variation + axis.length) % axis.length]
      ).join(", ")
    : "";

  /*
   * Rappel de couleur.
   *
   * Une robe bleue et un détail bleu quelque part dans l'image, c'est ce qui
   * fait qu'une créa a l'air composée plutôt qu'assemblée. Le mot « discret »
   * compte : appliqué franchement, ça donne une image monochrome ratée.
   */
  const echo = input.echoColor
    ? [
        `COLOUR ECHO: the product's dominant colour is ${input.echoColor}. Let exactly one`,
        "small element pick it up — a prop, a thread in the fabric behind, a reflection, or",
        "the text colour. Subtle enough that nobody would name it. Never tint the whole",
        "image, never repeat it more than once.",
      ].join(" ")
    : "";

  const place = input.randomElements
    ? PLACES[Math.floor(rand() * PLACES.length)]
    : PLACES[(input.variation * 7 + input.creativeType.name.length) % PLACES.length];

  const digital = input.productCategory === "digital";

  return [
    "Photorealistic advertising still for a single product.",
    product,
    digital
      ? DIGITAL_FORM
      : [
          "The product must match the reference images exactly — same colour, same print,",
          "same cut, same material. Never invent a variant or a different item.",
        ].join(" "),
    `CREATIVE TYPE — ${input.creativeType.name}. ${input.creativeType.promptInstructions}`,
    angles.length ? `ANGLE: ${angles.map((angle) => angle.prompt).join(" ")}` : "",
    elements.length
      ? `INCLUDE, and nothing beyond these: ${elements.map((item) => item.prompt).join(" and ")}. Keep the image uncluttered.`
      : "Choose whatever on-image elements serve this creative type best.",
    mix ? `THIS VARIATION: ${mix}.` : "",
    // Le lieu ne s'applique pas aux types qui vivent sur fond neutre.
    ["luxury", "product-focus", "minimal-text"].includes(input.creativeType.id)
      ? ""
      : `SETTING: ${place}. A real place, lived in, not styled for a shoot.`,
    echo,
    ANTI_AI.join(" "),
    [
      "Set every text in one confident advertising typeface, professionally kerned, no",
      "spelling mistakes. No logo, no brand name, no watermark.",
    ].join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function creativeTypesFor(category: ProductCategory | null) {
  if (!category) return [];
  return CREATIVE_TYPES.filter((type) => type.recommendedFor.includes(category)).map((type) => type.id);
}
