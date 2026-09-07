/**
 * Catalogue produits de la boutique configurée.
 *
 * L'Admin API donne le catalogue complet (brouillons, stock, SKU) mais réclame
 * le scope `read_products`. Tant qu'il n'est pas accordé, on retombe sur
 * `/products.json`, exposé sans authentification par toutes les boutiques : les
 * titres, les handles et donc les liens produit sont les mêmes, seuls les
 * produits non publiés et les données d'inventaire manquent.
 */

import { ShopifyError, getShopifyConfig, shopifyGraphql } from "@/lib/shopify/client";
import type {
  ShopifyCatalog,
  ShopifyCatalogProduct,
  ShopifyCatalogVariant,
  ShopifyProductsResponse,
} from "@/lib/shopify/types";
import { fetchProducts as fetchPublicProducts } from "@/lib/shopify-scraper/client";

const PAGE_SIZE = 100;
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;

export type ListProductsParams = {
  /** Syntaxe de recherche Shopify, ex. `title:chair` ou `status:active`. */
  query?: string;
  limit?: number;
};

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function priceRange(variants: ShopifyCatalogVariant[]) {
  const prices = variants.map((variant) => variant.price);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: 0, max: 0 };
}

/** Ordre alphabétique : Shopify pagine par date de création, illisible à l'œil. */
function byTitle(a: ShopifyCatalogProduct, b: ShopifyCatalogProduct) {
  return a.title.localeCompare(b.title, "fr", { sensitivity: "base", numeric: true });
}

const PRODUCTS_QUERY = `query Products($cursor: String, $q: String) {
  products(first: ${PAGE_SIZE}, after: $cursor, query: $q, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      status
      vendor
      productType
      tags
      createdAt
      publishedAt
      onlineStoreUrl
      featuredImage { url altText }
      media(first: 10) { nodes { preview { image { url } } } }
      variants(first: 100) {
        nodes { id title sku price compareAtPrice availableForSale inventoryQuantity }
      }
    }
  }
}`;

type ProductNode = NonNullable<
  NonNullable<ShopifyProductsResponse["data"]>["products"]
>["nodes"][number];

async function listFromAdmin(shop: string, params: ListProductsParams) {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const collected: ProductNode[] = [];
  let cursor: string | null = null;
  let truncated = false;

  while (collected.length < limit) {
    const body: ShopifyProductsResponse = await shopifyGraphql<ShopifyProductsResponse>(
      PRODUCTS_QUERY,
      { cursor, q: params.query || null }
    );
    const conn = body.data?.products;
    if (!conn) break;
    collected.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    if (collected.length >= limit) {
      truncated = true;
      break;
    }
    cursor = conn.pageInfo.endCursor;
  }

  const products: ShopifyCatalogProduct[] = collected.slice(0, limit).map((node) => {
    const variants: ShopifyCatalogVariant[] = node.variants.nodes.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku || null,
      price: num(variant.price),
      compareAtPrice: variant.compareAtPrice === null ? null : num(variant.compareAtPrice),
      available: variant.availableForSale,
      inventory: typeof variant.inventoryQuantity === "number" ? variant.inventoryQuantity : null,
    }));

    const images = node.media.nodes
      .map((media) => media.preview?.image?.url)
      .filter((url): url is string => Boolean(url));

    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      status: node.status,
      vendor: node.vendor || "",
      productType: node.productType || "",
      tags: node.tags || [],
      createdAt: node.createdAt,
      publishedAt: node.publishedAt,
      // onlineStoreUrl est null pour un produit retiré de la vitrine : le lien
      // myshopify reste le bon point d'entrée pour l'admin.
      url: node.onlineStoreUrl || `https://${shop}/products/${node.handle}`,
      image: node.featuredImage?.url ?? images[0] ?? null,
      images,
      variants,
      priceRange: priceRange(variants),
    };
  });

  products.sort(byTitle);
  return { products, truncated };
}

async function listFromPublic(shop: string, params: ListProductsParams) {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const { products: raw, truncated } = await fetchPublicProducts(`https://${shop}`);

  const needle = params.query?.trim().toLowerCase() || "";
  const matched = needle
    ? raw.filter((product) =>
        `${product.title} ${product.handle} ${product.vendor} ${product.product_type}`
          .toLowerCase()
          .includes(needle)
      )
    : raw;

  const products: ShopifyCatalogProduct[] = matched.slice(0, limit).map((product) => {
    const variants: ShopifyCatalogVariant[] = product.variants.map((variant) => ({
      id: String(variant.id),
      title: variant.title,
      sku: variant.sku || null,
      price: num(variant.price),
      compareAtPrice: variant.compare_at_price === null ? null : num(variant.compare_at_price),
      available: variant.available,
      inventory: null,
    }));

    const images = (product.images || []).map((image) => image.src);

    return {
      id: String(product.id),
      title: product.title,
      handle: product.handle,
      // `/products.json` ne liste que le publié — un brouillon n'y apparaît pas.
      status: "ACTIVE" as const,
      vendor: product.vendor || "",
      productType: product.product_type || "",
      tags: Array.isArray(product.tags)
        ? product.tags
        : String(product.tags || "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
      createdAt: null,
      publishedAt: product.published_at,
      url: `https://${shop}/products/${product.handle}`,
      image: images[0] ?? null,
      images,
      variants,
      priceRange: priceRange(variants),
    };
  });

  products.sort(byTitle);
  return { products, truncated: truncated || matched.length > limit };
}

export async function listShopifyProducts(
  params: ListProductsParams = {}
): Promise<ShopifyCatalog> {
  const config = getShopifyConfig();
  if (!config) {
    throw new Error(
      "Shopify n'est pas configuré (SHOPIFY_SHOP_DOMAIN + SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET)"
    );
  }

  const warnings: string[] = [];

  try {
    const { products, truncated } = await listFromAdmin(config.shop, params);
    return {
      shop: config.shop,
      source: "admin",
      products,
      count: products.length,
      truncated,
      warnings,
    };
  } catch (error) {
    const denied = error instanceof ShopifyError && error.code === "ACCESS_DENIED";
    if (!denied) throw error;

    warnings.push(
      "Scope `read_products` non accordé à l'app Shopify — repli sur le catalogue public. " +
        "Ajoute read_products dans le Dev Dashboard puis réinstalle l'app pour voir aussi les brouillons et le stock."
    );

    const { products, truncated } = await listFromPublic(config.shop, params);
    return {
      shop: config.shop,
      source: "public",
      products,
      count: products.length,
      truncated,
      warnings,
    };
  }
}
