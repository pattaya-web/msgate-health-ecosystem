/**
 * Lecture du catalogue public d'une boutique Shopify : `/products.json` et
 * `/collections.json` sont exposés par toutes les boutiques, sans authentification.
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

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "msgate-catalog/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).pathname} → HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Une boutique protégée par mot de passe renvoie du HTML sur ces routes.
    throw new Error("Réponse non-JSON — la boutique est peut-être protégée par mot de passe.");
  }
}

export async function fetchCollections(shop: string): Promise<ShopifyCollection[]> {
  const body = await getJson(`${shop}/collections.json?limit=250`);
  const rows = Array.isArray(body.collections) ? body.collections : [];
  return rows
    .map((row: Record<string, unknown>) => ({
      handle: String(row.handle ?? ""),
      title: String(row.title ?? row.handle ?? ""),
      products_count: Number(row.products_count ?? 0),
    }))
    .filter((row: ShopifyCollection) => row.handle)
    .sort((a: ShopifyCollection, b: ShopifyCollection) => b.products_count - a.products_count);
}

/** `/products.json` pagine par `page`, sans métadonnée de fin : on s'arrête sur une page courte. */
export async function fetchProducts(
  shop: string,
  collection?: string
): Promise<{ products: ShopifyProduct[]; truncated: boolean }> {
  const base = collection ? `${shop}/collections/${collection}/products.json` : `${shop}/products.json`;
  const products: ShopifyProduct[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await getJson(`${base}?limit=${PAGE_SIZE}&page=${page}`);
    const batch: ShopifyProduct[] = Array.isArray(body.products) ? body.products : [];
    products.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { products, truncated };
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
