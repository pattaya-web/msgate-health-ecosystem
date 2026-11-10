import { htmlToBlocks } from "@/lib/ecom-sites/pages";
import type { PageBlock } from "@/lib/ecom-sites/types";
/**
 * Lecture d'un site modèle.
 *
 * Deux cas : une boutique Shopify expose `/products.json` et donne tout d'un
 * coup ; un site sur mesure (les nôtres sont en Next) n'expose rien, on suit
 * donc les liens produit et on lit chaque page.
 *
 * On récupère la structure complète — noms, prix, dosages, texte et photo. La
 * boutique copiée reprend tout cela tel quel ; seul le packaging est regénéré,
 * la photo source servant alors de gabarit pour que le pack garde sa forme et
 * ne change que de couleur et de logo.
 */

const PRODUCT_LINK = /href="((?:https?:\/\/[^"]+)?\/products?\/[^"?#]+)"/gi;
/** Assez large pour reprendre un catalogue entier : les boutiques modèles
 *  tournent autour de la vingtaine de références. */
const MAX_PRODUCTS = 30;
const FETCH_TIMEOUT_MS = 20_000;

export type ReferenceProduct = {
  handle: string;
  name: string;
  /** La marque du modèle (champ vendor de Shopify) : à remplacer par la nôtre dans les textes repris. */
  vendor?: string;
  /** Ligne courte type « Daily · 2 gummies ». */
  dosage: string;
  price: number;
  description: string;
  /** La description avec sa mise en page (tableaux, intertitres), quand le site la donne en HTML. */
  descriptionBlocks?: PageBlock[];
  /** Texte brut de la page, tronqué — sert de matière à la réécriture. */
  raw: string;
  /**
   * Photo du produit sur le site modèle.
   *
   * Elle est affichée telle quelle en attendant, et sert surtout de gabarit au
   * modèle d'image : notre packaging garde la même forme de pack et la même
   * disposition, seuls la couleur et le logo changent.
   */
  imageUrl?: string;
  /** Rapport largeur/hauteur de la photo source, 0 si inconnu. */
  imageRatio?: number;
};

export type ReferenceRead = {
  domain: string;
  source: "shopify" | "woocommerce" | "scrape";
  products: ReferenceProduct[];
  warnings: string[];
  /**
   * Format dominant des photos produit du site modèle.
   *
   * Nos packagings sortaient en carré quelle que soit la source. Une boutique
   * dont les packshots sont en 3:4 et dont la copie les rend en 1:1 ne lui
   * ressemble plus : les cartes produit changent de proportions, la grille se
   * décale, et ça se voit avant même de lire un mot.
   */
  imageRatio: string;
  /**
   * Ordre des sections de la page d'accueil du modèle.
   *
   * Reprendre les produits et les prix ne suffit pas à ressembler à la boutique
   * copiée : c'est l'enchaînement des blocs qui fait qu'on la reconnaît. Un
   * site qui ouvre sur un carrousel puis enchaîne collections, texte-image et
   * grille produit ne se lit pas comme un site qui ouvre sur une grille.
   *
   * On ne reprend ni le HTML ni le CSS de la source — ce serait copier son
   * habillage, et ça n'aurait aucune chance de tenir. On reprend la structure :
   * quels blocs, dans quel ordre.
   */
  layout: string[];
  /** Titres de section lus sur le modèle, pour retrouver son ton. */
  headings: string[];
};

/**
 * Ce que Shopify laisse voir de la structure d'une page.
 *
 * Chaque section rend un `id="shopify-section-…__<type>_<hash>"`, dans l'ordre
 * du document. Le type est le nom du fichier de section du thème : les thèmes
 * les nomment différemment, mais les familles se recoupent assez pour ranger
 * chaque bloc dans l'un des nôtres.
 */
const SECTION_ID = /id="shopify-section-(?:template|sections)--[0-9]+__([a-z0-9_]+?)(?:_[A-Za-z0-9]{6})?"/g;

const BLOCK_RULES: Array<[RegExp, string]> = [
  // « slidshow » sans le e : le nom de section d'un thème réel, faute comprise.
  [/slid|hero|image_banner|banner|carousel/i, "hero"],
  [/featured_collection|product_grid|collection_grid|best|featured_product/i, "products"],
  [/collection_list|tabs_collection|categor/i, "categories"],
  /* Texte-image, récit de marque, colonnes d'arguments : chez nous c'est le
     même bloc — la promesse suivie des trois piliers. */
  [/image_with_text|rich_text|about|story|text_columns|multicolumn|icon|trust|guarantee|value_prop|benefit/i, "pillars"],
  [/testimonial|review|rating/i, "reviews"],
  [/gallery|lookbook|instagram|image_grid/i, "lifestyle"],
  [/faq|collapsible|accordion/i, "faq"],
  [/newsletter|signup|email_capture/i, "newsletter"],
];

/** Les blocs qu'on sait rendre, dans l'ordre où le modèle les pose. */
function readLayout(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SECTION_ID)) {
    const type = match[1];
    // L'en-tête et le pied de page existent toujours : ils ne se choisissent pas.
    if (/^(header|footer|announcement)/.test(type)) continue;
    const rule = BLOCK_RULES.find(([pattern]) => pattern.test(type));
    if (!rule) continue;
    // Un même bloc répété n'apporte rien de plus dans notre rendu.
    if (!blocks.includes(rule[1])) blocks.push(rule[1]);
  }
  return blocks;
}

/** Les titres de section du modèle, filtrés du bruit d'interface. */
function readHeadings(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<h2[^>]*>([\s\S]{3,90}?)<\/h2>/gi)) {
    const text = stripTags(match[1]).trim();
    if (!text || text.length < 8) continue;
    if (/cart|total|menu|search|newsletter|follow|contact us|information|useful/i.test(text)) continue;
    if (!found.includes(text)) found.push(text);
    if (found.length >= 6) break;
  }
  return found;
}

/**
 * Structure et titres de la page d'accueil du modèle.
 *
 * Elle est lue à part du catalogue : `/products.json` donne les produits mais
 * ne dit rien de la mise en page. Un échec n'est pas bloquant — on repart alors
 * sur notre enchaînement par défaut, ce qui donne un site correct, simplement
 * moins ressemblant.
 */
async function readHome(domain: string): Promise<{ layout: string[]; headings: string[] }> {
  try {
    const html = await getText(`https://${domain}/`);
    return { layout: readLayout(html), headings: readHeadings(html) };
  } catch {
    return { layout: [], headings: [] };
  }
}

/** Formats acceptés par le modèle d'image, avec leur valeur numérique. */
const RATIOS: Array<[string, number]> = [
  ["9:16", 9 / 16],
  ["3:4", 3 / 4],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
];

/** Format accepté le plus proche du rapport mesuré, en médiane du catalogue. */
function dominantRatio(products: ReferenceProduct[]): string {
  const values = products.map((product) => product.imageRatio || 0).filter((value) => value > 0);
  if (!values.length) return "1:1";
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  return RATIOS.reduce((closest, entry) =>
    Math.abs(entry[1] - median) < Math.abs(closest[1] - median) ? entry : closest
  )[0];
}

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
    // WordPress encode ses apostrophes et tirets typographiques (&#8217;, &#8211;…).
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
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
  vendor?: string;
  body_html?: string;
  product_type?: string;
  variants?: Array<{ price?: string; title?: string }>;
  images?: Array<{ src?: string; width?: number; height?: number }>;
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
    // La mise en page de la description, gardée telle quelle : un tableau d'ingrédients reste un tableau.
    const descriptionBlocks = product.body_html ? htmlToBlocks(product.body_html, `https://${domain}/`, 80).blocks : [];
    const price = Number(product.variants?.[0]?.price) || 0;
    return {
      handle: product.handle || "",
      name: product.title || "",
      vendor: product.vendor || "",
      dosage: product.variants?.[0]?.title && product.variants[0].title !== "Default Title"
        ? product.variants[0].title
        : product.product_type || "",
      price,
      description: description.slice(0, 700),
      descriptionBlocks: descriptionBlocks.length ? descriptionBlocks : undefined,
      raw: description.slice(0, 2000),
      // La photo du pack : affichée telle quelle d'abord, gabarit ensuite.
      imageUrl: readableImage(product.images?.[0]),
      imageRatio:
        product.images?.[0]?.width && product.images?.[0]?.height
          ? product.images[0].width / product.images[0].height
          : 0,
    };
  });

  return {
    domain,
    source: "shopify",
    products,
    warnings: [],
    imageRatio: dominantRatio(products),
    ...(await readHome(domain)),
  };
}

/* ------------------------------------------------------------------ *
 * Site sur mesure
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * WooCommerce (WordPress)
 * ------------------------------------------------------------------ */

type WooProduct = {
  slug?: string;
  name?: string;
  type?: string;
  description?: string;
  short_description?: string;
  prices?: { price?: string; currency_minor_unit?: number };
  images?: Array<{ src?: string; srcset?: string }>;
  categories?: Array<{ name?: string }>;
  brands?: Array<{ name?: string }>;
};

/**
 * Une photo que le modèle d'image sait lire.
 *
 * WordPress sert parfois l'original en AVIF, que Kie refuse (« File type not
 * supported ») : le pack de ce produit ne sortait jamais. Les déclinaisons du
 * srcset, elles, sont en JPG ; on prend la plus grande.
 */
function readableImage(image?: { src?: string; srcset?: string }) {
  const src = image?.src || "";
  if (!/\.(avif|heic)(\?|$)/i.test(src)) return src;
  const options = (image?.srcset || "")
    .split(",")
    .map((entry) => entry.trim().split(/\s+/))
    .filter(([url]) => url && /\.(jpe?g|png|webp)(\?|$)/i.test(url))
    .map(([url, size]) => ({ url, width: parseInt(size || "0", 10) || 0 }))
    .sort((a, b) => b.width - a.width);
  return options[0]?.url || src;
}

/**
 * L'API publique d'une boutique WooCommerce (Store API) : noms, prix,
 * descriptions et photos d'un coup, comme le `/products.json` de Shopify.
 */
async function readWooCommerce(domain: string): Promise<ReferenceRead | null> {
  const list: WooProduct[] = [];
  for (let page = 1; page <= 3 && list.length < MAX_PRODUCTS; page += 1) {
    let batch: WooProduct[];
    try {
      batch = JSON.parse(await getText(`https://${domain}/wp-json/wc/store/v1/products?per_page=100&page=${page}`)) as WooProduct[];
    } catch {
      break;
    }
    if (!Array.isArray(batch) || !batch.length) break;
    list.push(...batch);
    if (batch.length < 100) break;
  }
  if (!list.length) return null;

  const products = list.slice(0, MAX_PRODUCTS).map((product) => {
    const html = product.description || product.short_description || "";
    const description = stripTags(html);
    const descriptionBlocks = html ? htmlToBlocks(html, `https://${domain}/`, 80).blocks : [];
    const minor = product.prices?.currency_minor_unit ?? 2;
    return {
      handle: product.slug || "",
      name: stripTags(product.name || ""),
      vendor: product.brands?.[0]?.name || "",
      dosage: stripTags(product.categories?.[0]?.name || ""),
      price: Number(product.prices?.price || 0) / 10 ** minor,
      description: description.slice(0, 700),
      descriptionBlocks: descriptionBlocks.length ? descriptionBlocks : undefined,
      raw: description.slice(0, 2000),
      imageUrl: readableImage(product.images?.[0]),
      imageRatio: 0,
    };
  });

  return {
    domain,
    source: "woocommerce",
    products: products.filter((product) => product.handle && product.name),
    warnings: [],
    imageRatio: "1:1",
    ...(await readHome(domain)),
  };
}

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
      // WordPress termine ses liens par « / » (« /product/cat-tunnel/ ») : sans ce slash, le test ci-dessous les rejetait tous.
      const url = (href.startsWith("http") ? href : `https://${domain}${href}`).replace(/\/+$/, "");
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

  /*
   * Les données produit standard d'abord : presque toutes les plateformes
   * (Wix, Squarespace, BigCommerce, thèmes sur mesure) publient un JSON-LD
   * « Product » et des balises Open Graph. Nom, prix, texte et surtout la
   * photo, qui sert de gabarit au packaging — la lecture du texte seule n'en
   * donnait aucune.
   */
  const ld = ldProduct(html);
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1] ??
    "";
  const imageUrl = ld.image || meta("og:image");
  const metaPrice = Number(ld.price || meta("product:price:amount") || meta("og:price:amount")) || 0;

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = (h1 ? stripTags(h1[1]) : "") || ld.name || stripTags(meta("og:title"));
  if (!name) return null;

  const text = stripTags(html);
  const start = Math.max(0, text.indexOf(name));
  const body = text.slice(start, start + 2400);
  const afterName = body.slice(name.length).trim();

  const priceMatch = afterName.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  const price = metaPrice || (priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0);

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
    description: (stripTags(ld.description) || rest).slice(0, 700),
    raw: body,
    imageUrl: imageUrl ? new URL(imageUrl.replace(/&amp;/g, "&"), url).href : "",
    imageRatio: 0,
  };
}

/** Le premier objet JSON-LD de type Product de la page (aussi dans un @graph). */
function ldProduct(html: string) {
  const out = { name: "", price: "", description: "", image: "" };
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) {
        queue.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const item = node as Record<string, unknown>;
      if (Array.isArray(item["@graph"])) queue.push(...(item["@graph"] as unknown[]));
      const type = item["@type"];
      if (!(type === "Product" || (Array.isArray(type) && type.includes("Product")))) continue;
      const image = item.image;
      const firstImage = Array.isArray(image) ? image[0] : image;
      const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      const offer = (offers ?? {}) as Record<string, unknown>;
      out.name = String(item.name ?? "");
      out.description = String(item.description ?? "");
      out.image = typeof firstImage === "string" ? firstImage : String((firstImage as Record<string, unknown> | undefined)?.url ?? "");
      out.price = String(offer.price ?? offer.lowPrice ?? "");
      return out;
    }
  }
  return out;
}

async function readScraped(domain: string): Promise<ReferenceRead> {
  const urls = await discoverProductUrls(domain);
  const warnings: string[] = [];
  if (!urls.length) {
    return {
      domain,
      source: "scrape",
      products: [],
      imageRatio: "1:1",
      layout: [],
      headings: [],
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

  return {
    domain,
    source: "scrape",
    products,
    warnings,
    imageRatio: dominantRatio(products),
    ...(await readHome(domain)),
  };
}

export async function readReferenceSite(input: string): Promise<ReferenceRead> {
  const domain = normalizeDomain(input);
  if (!domain) throw new Error("Domaine invalide");
  const shopify = await readShopify(domain);
  if (shopify) return shopify;
  const woo = await readWooCommerce(domain);
  if (woo) return woo;
  return readScraped(domain);
}
