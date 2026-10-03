/**
 * Lecture du catalogue public d'une boutique Shopify : `/products.json` et
 * `/collections.json` sont exposés par les boutiques dont la vitrine Shopify
 * est active, sans authentification.
 *
 * Une vitrine « headless » (site React/Next devant un backend Shopify ou
 * Medusa, ex. bluumpeptides.com) ne les sert pas : 404 sur le domaine du
 * site, 429 permanent sur le domaine myshopify.com. Mesuré le 3 oct. 2026.
 * Pour ces boutiques, le catalogue se lit depuis le sitemap et les données
 * structurées (JSON-LD Product / ProductGroup) de chaque page produit —
 * plus lent, sans collections, mais public et complet.
 */

export type ShopifyVariant = {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  sku: string | null;
  requires_shipping: boolean;
  taxable: boolean;
  featured_image: { src: string; position?: number; alt?: string | null } | null;
  available: boolean;
  price: string;
  compare_at_price: string | null;
  grams: number;
  position: number;
};

export type ShopifyImage = {
  id: number;
  position: number;
  src: string;
  variant_ids: number[];
  alt?: string | null;
};

export type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  published_at: string | null;
  vendor: string;
  product_type: string;
  tags: string[] | string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: Array<{ name: string; position: number; values: string[] }>;
};

export type ShopifyCollection = {
  handle: string;
  title: string;
  products_count: number;
};

const PAGE_SIZE = 250;
const MAX_PAGES = 20;

/** Accepte « boutique.com », « https://boutique.com/collections/x » ou un domaine nu. */
export function normalizeShopUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!trimmed || !trimmed.includes(".") || /\s/.test(trimmed)) return null;
  return `https://${trimmed.toLowerCase()}`;
}

/** Échec du catalogue JSON : le repli par sitemap ne s'essaie que sur cette erreur-là. */
class CatalogError extends Error {}

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "msgate-catalog/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new CatalogError(`${new URL(url).pathname} → HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Une boutique protégée par mot de passe renvoie du HTML sur ces routes.
    throw new CatalogError("Réponse non-JSON — la boutique est peut-être protégée par mot de passe.");
  }
}

/* ------------------------------------------------------------------ */
/* Repli : sitemap + JSON-LD des pages produit                          */
/* ------------------------------------------------------------------ */

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
/** Au-delà, on tronque : chaque produit coûte une page HTML entière. */
const SITEMAP_MAX_PRODUCTS = 300;
const SITEMAP_CONCURRENCY = 5;

async function getText(url: string, accept = "text/html,application/xml;q=0.9,*/*;q=0.8") {
  const res = await fetch(url, { headers: { Accept: accept, "User-Agent": BROWSER_UA }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new CatalogError(`${new URL(url).pathname} → HTTP ${res.status}`);
  return res.text();
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].trim());
}

/** Les URL /products/… du sitemap, en suivant un index de sitemaps s'il y en a un. */
async function sitemapProductUrls(shop: string): Promise<string[]> {
  const root = await getText(`${shop}/sitemap.xml`);
  const found = new Set<string>();
  const isProduct = (url: string) => /\/products\/[^/?#]+\/?(\?|#|$)/.test(url);
  for (const url of locs(root)) if (isProduct(url)) found.add(url.split(/[?#]/)[0]);
  if (/<sitemapindex/i.test(root)) {
    const nested = locs(root).filter((url) => /sitemap/i.test(url) && !isProduct(url)).slice(0, 20);
    for (const url of nested) {
      try {
        for (const entry of locs(await getText(url))) if (isProduct(entry)) found.add(entry.split(/[?#]/)[0]);
      } catch {
        // un sous-sitemap illisible n'empêche pas les autres
      }
    }
  }
  return [...found];
}

type LdNode = Record<string, unknown>;

function ldBlocks(html: string): LdNode[] {
  const out: LdNode[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") {
          out.push(item as LdNode);
          const graph = (item as LdNode)["@graph"];
          if (Array.isArray(graph)) out.push(...(graph.filter((g) => g && typeof g === "object") as LdNode[]));
        }
      }
    } catch {
      // bloc illisible : on passe au suivant
    }
  }
  return out;
}

function hasType(node: LdNode, type: string) {
  const t = node["@type"];
  return t === type || (Array.isArray(t) && t.includes(type));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function imagesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((entry) => (typeof entry === "string" ? entry : entry && typeof entry === "object" ? str((entry as LdNode).url ?? (entry as LdNode).contentUrl) : ""))
    .filter(Boolean);
}

/** Un prix et une disponibilité depuis `offers` (Offer ou AggregateOffer). */
function offerOf(value: unknown): { price: string; available: boolean } {
  const offer = (Array.isArray(value) ? value[0] : value) as LdNode | undefined;
  if (!offer || typeof offer !== "object") return { price: "0", available: true };
  const raw = offer.price ?? offer.lowPrice ?? (offer.priceSpecification as LdNode | undefined)?.price;
  const price = Number(str(raw).replace(",", "."));
  const availability = str(offer.availability);
  return { price: Number.isFinite(price) ? price.toFixed(2) : "0", available: !availability || /InStock|PreOrder|LimitedAvailability/i.test(availability) };
}

/** Identifiant numérique stable dérivé d'une chaîne (le CSV d'import veut des nombres). */
function numericId(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h || 1;
}

/** Reconstruit un produit au format `/products.json` depuis le JSON-LD d'une page. */
function productFromLd(url: string, nodes: LdNode[]): ShopifyProduct | null {
  const group = nodes.find((node) => hasType(node, "ProductGroup"));
  const single = nodes.find((node) => hasType(node, "Product") && !node.isVariantOf);
  const main = group ?? single;
  if (!main) return null;
  const handle = decodeURIComponent(url.replace(/\/+$/, "").split("/products/")[1] ?? "").split("/")[0];
  if (!handle) return null;
  const title = str(main.name);
  const brand = main.brand && typeof main.brand === "object" ? str((main.brand as LdNode).name) : str(main.brand);
  const variantNodes = group
    ? (Array.isArray(group.hasVariant) ? (group.hasVariant as LdNode[]) : [])
    : [main];
  const productImages = imagesOf(main.image);
  const variants: ShopifyVariant[] = variantNodes.map((node, index) => {
    const name = str(node.name) || title;
    const optionTitle = name.startsWith(title) && name.length > title.length ? name.slice(title.length).replace(/^[\s\-–—:/]+/, "") : group ? name : "Default Title";
    const offer = offerOf(node.offers);
    const image = imagesOf(node.image)[0];
    return {
      id: numericId(`${handle}#${str(node.sku) || index}`),
      title: optionTitle || "Default Title",
      option1: optionTitle || "Default Title",
      option2: null,
      option3: null,
      sku: str(node.sku) || null,
      requires_shipping: true,
      taxable: true,
      featured_image: image ? { src: image, position: 1 } : null,
      available: offer.available,
      price: offer.price,
      compare_at_price: null,
      grams: 0,
      position: index + 1,
    };
  });
  if (!variants.length) return null;
  const seen = new Set<string>();
  const images: ShopifyImage[] = [...productImages, ...variants.map((variant) => variant.featured_image?.src ?? "")]
    .filter((src) => src && !seen.has(src) && seen.add(src))
    .map((src, index) => ({ id: numericId(src), position: index + 1, src, variant_ids: [] }));
  const optionName = Array.isArray(main.variesBy) && main.variesBy.length ? str(main.variesBy[0]) : "Title";
  return {
    id: Number(str(main.productGroupID)) || numericId(handle),
    title,
    handle,
    body_html: str(main.description),
    published_at: null,
    vendor: brand,
    product_type: str(main.category),
    tags: [],
    variants,
    images,
    options: [{ name: optionName || "Title", position: 1, values: [...new Set(variants.map((variant) => variant.option1 ?? "Default Title"))] as string[] }],
  };
}

/** Le catalogue d'une vitrine headless : une page par produit, lues cinq par cinq. */
async function fetchProductsFromSitemap(shop: string): Promise<{ products: ShopifyProduct[]; truncated: boolean }> {
  const urls = await sitemapProductUrls(shop);
  if (!urls.length) throw new CatalogError("Aucune page produit dans le sitemap de la boutique.");
  const truncated = urls.length > SITEMAP_MAX_PRODUCTS;
  const queue = urls.slice(0, SITEMAP_MAX_PRODUCTS);
  const products: ShopifyProduct[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: SITEMAP_CONCURRENCY }, async () => {
      while (cursor < queue.length) {
        const url = queue[cursor++];
        try {
          const product = productFromLd(url, ldBlocks(await getText(url)));
          if (product) products.push(product);
        } catch {
          // une page qui ne répond pas ne bloque pas le reste du catalogue
        }
      }
    })
  );
  if (!products.length) throw new CatalogError("Les pages produit de la boutique ne portent pas de données structurées lisibles.");
  products.sort((a, b) => a.handle.localeCompare(b.handle));
  return { products, truncated };
}

export async function fetchCollections(shop: string): Promise<ShopifyCollection[]> {
  let body: { collections?: unknown };
  try {
    body = await getJson(`${shop}/collections.json?limit=250`);
  } catch (error) {
    // Vitrine headless : pas de collections publiques, mais un catalogue par le sitemap. On rend une liste vide plutôt qu'une erreur.
    if (error instanceof CatalogError && (await sitemapProductUrls(shop).catch(() => [])).length) return [];
    throw error;
  }
  const rows = Array.isArray(body.collections) ? body.collections : [];
  return rows
    .map((row: Record<string, unknown>) => ({
      handle: String(row.handle ?? ""),
      title: String(row.title ?? row.handle ?? ""),
      products_count: Number(row.products_count ?? 0),
    }))
    .filter((row: ShopifyCollection) => row.handle)
    // Alphabétique : on cherche une collection par son nom, pas par sa taille.
    // `numeric` garde « Été 2 » avant « Été 10 », et la comparaison française
    // range les accents là où on les attend.
    .sort((a: ShopifyCollection, b: ShopifyCollection) =>
      a.title.localeCompare(b.title, "fr", { sensitivity: "base", numeric: true })
    );
}

/** `/products.json` pagine par `page`, sans métadonnée de fin : on s'arrête sur une page courte. */
export type CatalogSource = "json" | "sitemap";

export async function fetchProducts(
  shop: string,
  collection?: string
): Promise<{ products: ShopifyProduct[]; truncated: boolean; source: CatalogSource }> {
  const base = collection ? `${shop}/collections/${collection}/products.json` : `${shop}/products.json`;
  const products: ShopifyProduct[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let body: { products?: unknown };
    try {
      body = await getJson(`${base}?limit=${PAGE_SIZE}&page=${page}`);
    } catch (error) {
      // Le JSON public manque dès la première page : vitrine headless, on lit le sitemap (la collection ne peut pas être filtrée).
      if (page === 1 && error instanceof CatalogError) {
        try {
          return { ...(await fetchProductsFromSitemap(shop)), source: "sitemap" };
        } catch (fallback) {
          throw new Error(`${error.message} — repli par le sitemap impossible : ${fallback instanceof Error ? fallback.message : "?"}`);
        }
      }
      throw error;
    }
    const batch: ShopifyProduct[] = Array.isArray(body.products) ? (body.products as ShopifyProduct[]) : [];
    products.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { products, truncated, source: "json" };
}

export function variantPrice(variant: ShopifyVariant) {
  const parsed = Number(variant.price);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Ne conserve que les variantes dans la fourchette, et écarte les produits qui
 * n'en gardent aucune — un produit sans variante n'est pas importable.
 */
export function filterByPrice(
  products: ShopifyProduct[],
  min: number | null,
  max: number | null
): ShopifyProduct[] {
  if (min === null && max === null) return products;

  const kept: ShopifyProduct[] = [];
  for (const product of products) {
    const variants = product.variants.filter((variant) => {
      const price = variantPrice(variant);
      if (min !== null && price < min) return false;
      if (max !== null && price > max) return false;
      return true;
    });
    if (variants.length) kept.push({ ...product, variants });
  }
  return kept;
}
