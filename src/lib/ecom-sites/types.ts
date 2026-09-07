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

export type EcomCategory = { id: string; label: string; blurb: string };

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
  bullets: string[];
  usage: string;
  ingredients: string;
  /** Packaging brandé généré via Kie, ou image fournie. */
  imageUrl: string;
  /** Tâche Kie en cours, le temps que le packaging sorte. */
  packagingTaskId: string | null;
  badge: string;
};

/** Aucun avis inventé : la liste reste vide tant que de vrais retours ne sont pas saisis. */
export type EcomTestimonial = { author: string; body: string; detail: string };

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
};

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
