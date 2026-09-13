export const BANK_THEMES = [
  { id: "cyan", label: "Blumel Cyan", blue: "#00a3d4", deep: "#007fa8", wash: "#e8f7fc" },
  { id: "navy", label: "Navy", blue: "#1d4ed8", deep: "#1e3a8a", wash: "#e8eefc" },
  { id: "forest", label: "Forest", blue: "#0f766e", deep: "#115e59", wash: "#e6f7f4" },
  { id: "graphite", label: "Graphite", blue: "#334155", deep: "#0f172a", wash: "#eef2f6" },
  { id: "sand", label: "Sand", blue: "#b45309", deep: "#92400e", wash: "#fdf4e7" },
] as const;

export type BankThemeId = (typeof BANK_THEMES)[number]["id"];

export type BankPage = {
  id: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  brandName: string;
  legalName: string;
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  logoDataUrl: string;
  themeId: BankThemeId;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  stats: Array<{ value: string; label: string }>;
  services: Array<{ title: string; body: string }>;
  results: Array<{ brand: string; metric: string; detail: string; note: string }>;
  /** Textes de la page corrigés depuis l'aperçu, par clé (voir BANK_DEFAULT_TEXTS). */
  texts?: Record<string, string>;
  /** Le nom de domaine qui sert cette page, quand on en a acheté un (ex. blumelmrkt.com). */
  domain?: string;
};

/** Une page en cours de création : tout sauf ce que le serveur attribue. */
export type BankPageDraft = Omit<BankPage, "id" | "slug" | "createdAt" | "updatedAt">;

/**
 * Applique une correction faite dans l'aperçu. Le chemin désigne un champ
 * (`heroTitle`), une entrée de liste (`stats.0.label`) ou un texte libre
 * (`texts.about.p1`). Rend une copie, l'original n'est pas touché.
 */
export function withTextEdit<T extends BankPageDraft>(page: T, path: string, value: string): T {
  if (path.startsWith("texts.")) {
    return { ...page, texts: { ...(page.texts ?? {}), [path.slice("texts.".length)]: value } };
  }
  const [field, index, sub] = path.split(".");
  if (index !== undefined && sub !== undefined) {
    const list = [...((page as unknown as Record<string, unknown>)[field] as Array<Record<string, string>>)];
    list[Number(index)] = { ...list[Number(index)], [sub]: value };
    return { ...page, [field]: list };
  }
  return { ...page, [field]: value };
}

/** Tout le texte d'une page, dans l'ordre de lecture, pour le presse-papiers. */
export function bankPageText(root: HTMLElement) {
  const parts: string[] = [];
  root.querySelectorAll<HTMLElement>("[data-edit]").forEach((element) => {
    const text = element.innerText.trim();
    if (text) parts.push(text);
  });
  return parts.join("\n");
}

export function defaultBankPage(): Omit<BankPage, "id" | "slug" | "createdAt" | "updatedAt"> {
  return {
    brandName: "Blumel Growth",
    legalName: "BLUMEL MARKETING LLC",
    tagline: "US performance",
    heroTitle: "Paid acquisition that protects your margin.",
    heroSubtitle:
      "We help DTC brands turn Meta and TikTok spend into predictable customer acquisition — with weekly operator work, not deck theater.",
    logoDataUrl: "",
    themeId: "cyan",
    email: "admin@blumelmrkt.com",
    phone: "+1 (941) 420-8932",
    addressLine: "11155 Lost Creek Terrace",
    city: "Bradenton",
    region: "FL",
    postalCode: "34211",
    country: "United States",
    stats: [
      { value: "4.2x", label: "Avg ROAS held" },
      { value: "+41%", label: "Margin lift cases" },
      { value: "24h", label: "First reply" },
      { value: "US DTC", label: "Focus market" },
    ],
    services: [
      {
        title: "Meta Ads",
        body: "Account rebuilds, creative sprints, and spend rules tuned for profitable CAC on Facebook & Instagram.",
      },
      {
        title: "TikTok Ads",
        body: "Native hooks, spark-style testing, and structures built for TikTok’s feed — not Meta copy-paste.",
      },
      {
        title: "Store conversion",
        body: "Landing, offer, and checkout fixes so paid traffic stops leaking before purchase.",
      },
      {
        title: "Brand systems",
        body: "Messaging and visual consistency that make paid creatives feel like one brand, not random ads.",
      },
    ],
    results: [
      { brand: "Skincare DTC", metric: "3.8x", detail: "ROAS held while scaling", note: "Spend ×2.4 in eight weeks" },
      { brand: "Home goods", metric: "+41%", detail: "Contribution margin", note: "Meta rebuilt in 30 days" },
      { brand: "Apparel · 7-fig", metric: "+27%", detail: "YoY margin lift", note: "Creative system + clean tracking" },
      { brand: "Beauty launch", metric: "4.2x", detail: "Average client ROAS", note: "Across active accounts" },
    ],
  };
}

export function themeOf(id: BankThemeId) {
  return BANK_THEMES.find((item) => item.id === id) || BANK_THEMES[0];
}
