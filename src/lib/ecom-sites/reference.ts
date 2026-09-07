/**
 * Lecture d'un site modèle.
 *
 * Deux cas : une boutique Shopify expose `/products.json` et donne tout d'un
 * coup ; un site sur mesure (les nôtres sont en Next) n'expose rien, on suit
 * donc les liens produit et on lit chaque page.
 *
 * On ne récupère que la structure — noms, paliers de prix, dosages, texte — qui
 * sert de brief à la réécriture. Les visuels ne sont jamais repris : chaque
 * boutique regénère ses packagings avec son propre logo.
 */

const PRODUCT_LINK = /href="((?:https?:\/\/[^"]+)?\/products?\/[^"?#]+)"/gi;
const MAX_PRODUCTS = 14;
const FETCH_TIMEOUT_MS = 20_000;

export type ReferenceProduct = {
  handle: string;
  name: string;
  /** Ligne courte type « Daily · 2 gummies ». */
  dosage: string;
  price: number;
  description: string;
  /** Texte brut de la page, tronqué — sert de matière à la réécriture. */
  raw: string;
};

export type ReferenceRead = {
  domain: string;
  source: "shopify" | "scrape";
  products: ReferenceProduct[];
  warnings: string[];
};

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!trimmed || !trimmed.includes(".") || /\s/.test(trimmed)) return null;
  return trimmed;
}

async function getText(url: string) {
  const res = await fetch(url, {
    headers: { Accept: "text/html,application/json", "User-Agent": "msgate-reference/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).pathname} → HTTP ${res.status}`);
  return res.text();
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function handleOf(url: string) {
  return url.replace(/\/$/, "").split("/").pop() || "";
}

/* ------------------------------------------------------------------ *
 * Shopify
 * ------------------------------------------------------------------ */

type ShopifyJsonProduct = {
  handle?: string;
  title?: string;
  body_html?: string;
  product_type?: string;
  variants?: Array<{ price?: string; title?: string }>;
};

async function readShopify(domain: string): Promise<ReferenceRead | null> {
  let body: { products?: ShopifyJsonProduct[] };
  try {
    body = JSON.parse(await getText(`https://${domain}/products.json?limit=250`)) as {
      products?: ShopifyJsonProduct[];
    };
  } catch {
    return null;
  }
  if (!Array.isArray(body.products) || !body.products.length) return null;

  const products = body.products.slice(0, MAX_PRODUCTS).map((product) => {
    const description = stripTags(product.body_html || "");
    const price = Number(product.variants?.[0]?.price) || 0;
    return {
      handle: product.handle || "",
      name: product.title || "",
      dosage: product.variants?.[0]?.title && product.variants[0].title !== "Default Title"
        ? product.variants[0].title
        : product.product_type || "",
      price,
      description: description.slice(0, 700),
      raw: description.slice(0, 2000),
    };
  });

  return { domain, source: "shopify", products, warnings: [] };
}

/* ------------------------------------------------------------------ *
 * Site sur mesure
 * ------------------------------------------------------------------ */

async function discoverProductUrls(domain: string) {
  const found = new Set<string>();
  for (const path of ["", "/shop", "/collections/all"]) {
    let html: string;
    try {
      html = await getText(`https://${domain}${path}`);
    } catch {
      continue;
    }
    for (const match of html.matchAll(PRODUCT_LINK)) {
      const href = match[1];
      const url = href.startsWith("http") ? href : `https://${domain}${href}`;
      // Une page de collection vit aussi sous /products/ chez certains thèmes.
      if (!/\/products?\/[^/]+$/.test(url)) continue;
      found.add(url);
      if (found.size >= MAX_PRODUCTS) return [...found];
    }
  }
  return [...found];
}

/**
 * Les fiches suivent toutes la même trame :
 *   {nom}{format} ${prix} / {unité} / {portions} {description…}
 * Le prix sert donc d'ancre : ce qui précède est le format, ce qui suit la
 * description, une fois les segments d'unité écartés.
 */
async function scrapeProductPage(url: string): Promise<ReferenceProduct | null> {
  let html: string;
  try {
    html = await getText(url);
  } catch {
    return null;
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = h1 ? stripTags(h1[1]) : "";
  if (!name) return null;

  const text = stripTags(html);
  const start = Math.max(0, text.indexOf(name));
  const body = text.slice(start, start + 2400);
  const afterName = body.slice(name.length).trim();

  const priceMatch = afterName.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0;

  const dosage = priceMatch ? afterName.slice(0, priceMatch.index).trim() : "";

  let rest = priceMatch ? afterName.slice((priceMatch.index ?? 0) + priceMatch[0].length) : afterName;
  // Écarte « / 60 gummies / ~30 servings » avant la vraie phrase. Un segment
  // d'unité commence par un chiffre, ce qui évite d'avaler le début du texte.
  rest = rest.replace(/^(?:\s*\/\s*~?\d[^/]{0,24}?(?=\s*\/|\s+[A-Z]))+/, "").replace(/^\s*\/\s*/, "").trim();

  return {
    handle: handleOf(url),
    name,
    dosage,
    price,
    description: rest.slice(0, 700),
    raw: body,
  };
}

async function readScraped(domain: string): Promise<ReferenceRead> {
  const urls = await discoverProductUrls(domain);
  const warnings: string[] = [];
  if (!urls.length) {
    return {
      domain,
      source: "scrape",
      products: [],
      warnings: ["Aucun lien produit trouvé — la boutique est peut-être protégée ou utilise d'autres URLs."],
    };
  }

  const products: ReferenceProduct[] = [];
  // En série et non en parallèle : un modèle n'est lu qu'une fois, autant ne
  // pas se faire limiter par le site.
  for (const url of urls) {
    const product = await scrapeProductPage(url);
    if (product) products.push(product);
  }

  if (products.length < urls.length) {
    warnings.push(`${urls.length - products.length} page(s) produit illisible(s) sur ${urls.length}.`);
  }

  return { domain, source: "scrape", products, warnings };
}

export async function readReferenceSite(input: string): Promise<ReferenceRead> {
  const domain = normalizeDomain(input);
  if (!domain) throw new Error("Domaine invalide");
  const shopify = await readShopify(domain);
  if (shopify) return shopify;
  return readScraped(domain);
}
