export const ECOM_THEMES = [
  { id: "glow", label: "Glow / beauté", ink: "#2b1a2e", accent: "#d9548a", deep: "#8d2b57", wash: "#fdeef4", sand: "#fbf7f4" },
  { id: "marine", label: "Marine / clinique", ink: "#0f2333", accent: "#1d7fa8", deep: "#0d4f6b", wash: "#e8f5fa", sand: "#f5f9fb" },
  { id: "forest", label: "Forest / naturel", ink: "#17251c", accent: "#3f8f5f", deep: "#255c3c", wash: "#eaf6ee", sand: "#f6f9f5" },
  { id: "amber", label: "Amber / chaleureux", ink: "#2c1f10", accent: "#c9822a", deep: "#8a561a", wash: "#fdf2e2", sand: "#fbf8f3" },
  { id: "mono", label: "Mono / premium", ink: "#141414", accent: "#3d3d3d", deep: "#000000", wash: "#f0f0f0", sand: "#f8f8f7" },
] as const;

export type EcomThemeId = (typeof ECOM_THEMES)[number]["id"];

export function ecomTheme(id: EcomThemeId) {
  return ECOM_THEMES.find((theme) => theme.id === id) || ECOM_THEMES[0];
}

/** Deux couleurs de marque, qui prennent le pas sur le thème quand elles sont posées. */
export type BrandColors = { primary: string; secondary: string };

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Palette effective d'un site.
 *
 * Les couleurs choisies remplacent l'accent et le fond doux du thème ; l'encre
 * et le blanc cassé restent ceux du thème, parce que deux couleurs de marque ne
 * suffisent pas à composer un texte lisible sur toute une page.
 */
export function sitePalette(themeId: EcomThemeId, colors?: BrandColors | null) {
  const theme = ecomTheme(themeId);
  const primary = colors?.primary && HEX.test(colors.primary) ? colors.primary : theme.accent;
  const secondary = colors?.secondary && HEX.test(colors.secondary) ? colors.secondary : theme.wash;
  return { ...theme, accent: primary, wash: secondary, deep: primary };
}

/** Paliers utilisés sur les sites existants — le haut de gamme plafonne à 79.99. */
export const PRICE_POINTS = [19.99, 24.99, 29.99, 34.99, 39.99, 44.99, 49.99, 59.99, 69.99, 79.99] as const;

export const MAX_PRICE = 79.99;

export type EcomCategory = {
  id: string;
  label: string;
  blurb: string;
  /** Visuel d'ambiance de la catégorie, généré avec le reste du site. */
  imageUrl?: string;
};

export type EcomProduct = {
  handle: string;
  name: string;
  subtitle: string;
  category: string;
  price: number;
  compareAtPrice: number | null;
  /** Ex. « Daily · 2 gummies » — le format des sites existants. */
  dosage: string;
  description: string;
  /**
   * La description telle qu'elle est mise en page sur le site copié :
   * paragraphes, intertitres, listes, tableaux d'ingrédients. `description`
   * n'en garde que le texte ; c'est ceci que la fiche affiche quand il existe.
   */
  descriptionBlocks?: PageBlock[];
  bullets: string[];
  usage: string;
  ingredients: string;
  /** Packaging brandé généré via Kie, ou image fournie. */
  imageUrl: string;
  /**
   * Photo du produit du site d'inspiration.
   *
   * Gabarit, jamais visuel final : elle passe au modèle d'image pour que notre
   * pack garde la même forme et les mêmes éléments, seuls la marque et la
   * couleur changeant. Elle n'apparaît nulle part sur la boutique.
   */
  sourceImageUrl?: string;
  /**
   * Rapport largeur/hauteur de la photo d'origine.
   *
   * Le cadre prend le format dominant du catalogue, ce qui va pour les
   * packshots ; mais une boutique glisse parfois une bannière dans sa liste —
   * un abonnement, une carte cadeau — et la recadrer donne un zoom illisible.
   * Connaître le rapport de chaque photo permet de la laisser entière.
   */
  sourceImageRatio?: number;
  /** Tâche Kie en cours, le temps que le packaging sorte. */
  packagingTaskId: string | null;
  badge: string;
};

/** Aucun avis inventé : la liste reste vide tant que de vrais retours ne sont pas saisis. */
export type EcomTestimonial = { author: string; body: string; detail: string };

/** Un bloc de la page d'accueil, et la façon dont il s'affiche. */
export type EcomSection = {
  id: string;
  /** Les blocs nourris par le site, plus deux blocs libres à remplir soi-même. */
  block:
    | "pillars"
    | "categories"
    | "lifestyle"
    | "products"
    | "about"
    | "reviews"
    | "assurances"
    | "text"
    | "image";
  /** Masqué sans être supprimé : on le rallume sans le refaire. */
  hidden?: boolean;
  align?: "left" | "center";
  space?: "tight" | "normal" | "airy";
  /**
   * Marges hautes et basses, en pixels.
   *
   * Les trois réglages nommés suffisaient pour dégrossir, pas pour ajuster :
   * on voulait « un peu moins d'air ici », pas « serré ». Ces valeurs, quand
   * elles sont posées, l'emportent sur le réglage nommé.
   */
  padTop?: number;
  padBottom?: number;
  /** Fond de la section : neutre, teinté sable, ou couleur de marque. */
  background?: "none" | "sand" | "wash";
  /** Titre affiché ; vide, le bloc garde le sien. */
  title?: string;
  /** Blocs libres seulement. */
  body?: string;
  imageUrl?: string;
  /**
   * Les cartes d'un bloc « réassurance », quand on les a retouchées.
   *
   * Le bandeau livraison / retours / support était écrit en dur dans le rendu :
   * il disait ce que le site promettait, et c'est justement ce qui change d'une
   * marque à l'autre. Vide, on retombe sur les trois cartes déduites des
   * réglages de la boutique — un site déjà en ligne ne bouge pas. Rempli, cette
   * liste fait foi, et on y ajoute ce qu'on veut.
   */
  items?: Array<{ title: string; body: string }>;
};

/**
 * Le pied de page, dans ce qu'il a de choisi.
 *
 * Le footer se déduisait entièrement des champs du site : la LLC, les
 * politiques, les trois liens de boutique, les trois cartes de paiement. C'est
 * ce qu'il faut pour un dossier de souscription, et c'est trop rigide pour une
 * marque — on veut y mettre un lien de suivi de commande, une FAQ, un
 * Instagram, retirer AMEX qu'on n'accepte pas. Chaque champ laissé vide reste
 * déduit : un site déjà en ligne ne bouge pas tant qu'on n'y touche pas.
 */
export type EcomFooter = {
  /** Phrase d'identité ; vide = celle déduite de la raison sociale. */
  legalLine?: string;
  /** Colonnes de liens ; vide = « Legal » et « Store » déduites. */
  /**
   * Colonnes ; vide = « Legal » et « Store » deduites.
   *
   * Une colonne porte des liens, un paragraphe, ou les deux : les pieds de page
   * des boutiques ouvrent presque tous sur un bloc « About » en texte, a cote
   * des colonnes de navigation.
   */
  columns?: Array<{ title: string; body?: string; links: Array<{ label: string; href: string }> }>;
  /** Le bloc contact reste déduit des champs support — mais peut se retirer. */
  hideContact?: boolean;
  /** Moyens de paiement affichés ; vide = VISA / MASTERCARD / AMEX. */
  payments?: string[];
  /** Ligne de copyright ; vide = celle déduite de la marque. */
  copyright?: string;
  /** Un dernier mot, sous le copyright. */
  note?: string;
};

export type EcomSite = {
  id: string;
  slug: string;
  createdAt: string;
  updatedAt: string;

  /* Identité */
  domain: string;
  brandName: string;
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  promoBar: string;
  logoDataUrl: string;
  /**
   * Images d'ambiance du site.
   *
   * Une boutique qui n'a que des packshots sur fond blanc a l'air d'un
   * catalogue, pas d'une marque — et un underwriter le voit aussi. Ces visuels
   * sont générés, jamais repris du site modèle.
   */
  heroImageUrl?: string;
  /**
   * Enchaînement des blocs de la page d'accueil, relevé sur le site copié.
   *
   * Vide, on retombe sur notre ordre par défaut. Rempli, la page se réordonne
   * pour suivre le modèle : c'est ce qui fait qu'on reconnaît la boutique dont
   * elle s'inspire, une fois les produits et les prix déjà repris.
   */
  layout?: string[];
  /** Titres de section relevés sur le modèle, réutilisés dans l'ordre. */
  sectionTitles?: string[];
  /**
   * La page d'accueil, section par section, telle qu'on la retouche.
   *
   * `layout` disait seulement quels blocs et dans quel ordre — assez pour
   * ressembler au modèle copié, pas pour retravailler la page ensuite. Ici
   * chaque section porte son ordre, son titre, son cadrage, son espacement, et
   * peut être masquée ou déplacée. Deux types s'ajoutent aux blocs du site :
   * un bloc de texte libre et un bloc d'image, pour combler ce qui manque.
   *
   * Vide, on retombe sur `layout` : les sites déjà copiés continuent de
   * s'afficher, et se convertissent à la première retouche.
   */
  sections?: EcomSection[];
  /** Ce qu'on a choisi dans le pied de page ; le reste se déduit. */
  footer?: EcomFooter;
  /**
   * Récit de marque de la page « About ».
   *
   * Une boutique sans page « qui sommes-nous » se repère immédiatement en
   * souscription : c'est l'une des premières que l'analyste ouvre. Mais son
   * contenu se vérifie — un fondateur nommé, une année de création, un
   * laboratoire, une certification. Ce récit reste donc positionnel : ce que la
   * marque vend, pour qui, comment la gamme est choisie, ce qu'elle promet au
   * client. Rien qu'on puisse aller contredire.
   */
  aboutStory?: { heading: string; paragraphs: string[]; points: Array<{ title: string; body: string }> };
  /** Visuel d'atelier accompagnant le récit. */
  aboutImageUrl?: string;
  /** Génération d'image en cours, retrouvée après un rechargement. */
  aboutTaskId?: string | null;
  /**
   * Format des photos produit, repris du site modèle.
   *
   * Une boutique dont les packshots sont en 3:4 et dont la copie les rend en
   * carré ne lui ressemble plus : les cartes changent de proportions et la
   * grille se décale, avant même qu'on lise un mot.
   */
  imageRatio?: string;
  lifestyleUrls?: string[];
  /** Tâches d'images en cours, pour retrouver une génération au rechargement. */
  mediaTaskIds?: string[];
  themeId: EcomThemeId;
  /** Deux couleurs de marque ; vide = on garde celles du thème. */
  brandColors: BrandColors | null;

  /* Entité légale — repris tel quel dans le footer et les politiques */
  legalName: string;
  stateOfIncorporation: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;

  /* Support — le processeur vérifie que ça répond vraiment */
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  /** Ce qui s'affiche sur le relevé de carte du client. */
  billingDescriptor: string;

  /* Commerce */
  currency: string;
  freeShippingThreshold: number;
  handlingTimeDays: number;
  deliveryMinDays: number;
  deliveryMaxDays: number;
  shipsFrom: string;
  returnWindowDays: number;

  /* Contenu */
  promise: string;
  pillars: Array<{ title: string; body: string }>;
  categories: EcomCategory[];
  products: EcomProduct[];
  testimonials: EcomTestimonial[];
  /** Ex. mention FDA pour les compléments. Vide si non applicable. */
  productDisclaimer: string;
  /**
   * Textes corrigés depuis l'aperçu, quand ils ne vivent dans aucun champ.
   *
   * Les politiques, les cartes de réassurance et le pied de page sont déduits
   * des réglages : on ne peut pas y taper directement. Une phrase corrigée dans
   * l'aperçu est gardée ici, texte d'origine → texte voulu, et remplacée au
   * rendu partout où elle sort telle quelle.
   */
  textEdits?: Record<string, string>;
  /**
   * Pages ajoutées à la boutique : une FAQ, un « How it works », une page
   * reprise d'un autre site. Elles ont un lien dans le menu si on le veut, et
   * leur contenu se corrige dans l'aperçu comme le reste.
   */
  pages?: EcomPage[];
  /**
   * Le menu du header, quand on l'a réécrit. Vide, il se déduit : les pages
   * fixes puis les pages ajoutées. Un lien est relatif à la boutique (`/shop`)
   * ou absolu (un Instagram).
   */
  nav?: Array<{ label: string; href: string }>;
  /** Le formulaire de contact sur la page Contact ; absent = affiché. */
  contactForm?: boolean;
};

/** Un bloc d'une page ajoutée : ce qu'on retrouve sur n'importe quelle page de contenu. */
export type PageBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "image"; src: string; alt?: string }
  /** Un tableau : une ligne d'en-têtes (peut être vide) et des lignes de cellules. */
  | { type: "table"; header: string[]; rows: string[][] }
  /** Le formulaire de contact de la boutique, posé sur une page ajoutée. */
  | { type: "form" };

export type EcomPage = {
  id: string;
  slug: string;
  title: string;
  blocks: PageBlock[];
  /** Lien dans le menu du header, entre About et Shipping. */
  inNav: boolean;
  /** L'adresse d'où le contenu a été repris, pour mémoire. */
  sourceUrl?: string;
};

/** Un texte déduit, tel qu'il doit s'afficher une fois les corrections appliquées. */
export function editedText(site: Pick<EcomSite, "textEdits">, text: string) {
  return site.textEdits?.[text] ?? text;
}

export type EcomSiteInput = Omit<EcomSite, "id" | "slug" | "createdAt" | "updatedAt">;

export function fullAddress(site: Pick<EcomSite, "addressLine" | "city" | "region" | "postalCode">) {
  return [site.addressLine, site.city, site.region, site.postalCode].filter(Boolean).join(", ");
}

export function defaultEcomSite(): EcomSiteInput {
  return {
    domain: "",
    brandName: "",
    tagline: "",
    heroTitle: "",
    heroSubtitle: "",
    promoBar: "FREE US SHIPPING OVER $50 ✦ 30-DAY GUARANTEE ✦ SUBSCRIBE & SAVE 15%",
    logoDataUrl: "",
    heroImageUrl: "",
    layout: [],
    sectionTitles: [],
    sections: [],
    footer: undefined,
    aboutStory: undefined,
    aboutImageUrl: "",
    aboutTaskId: null,
    imageRatio: "1:1",
    lifestyleUrls: [],
    mediaTaskIds: [],
    themeId: "glow",
    brandColors: null,

    legalName: "",
    stateOfIncorporation: "Florida",
    addressLine: "",
    city: "",
    region: "",
    postalCode: "",
    country: "United States",

    supportEmail: "",
    supportPhone: "",
    supportHours: "9 AM – 6 PM, Mon–Fri (EST)",
    billingDescriptor: "",

    currency: "USD",
    freeShippingThreshold: 50,
    handlingTimeDays: 1,
    deliveryMinDays: 4,
    deliveryMaxDays: 7,
    shipsFrom: "United States",
    returnWindowDays: 30,

    promise: "",
    pillars: [],
    categories: [],
    products: [],
    testimonials: [],
    productDisclaimer: "",
  };
}

export function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}
