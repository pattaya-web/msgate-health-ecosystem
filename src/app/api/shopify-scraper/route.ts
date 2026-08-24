import { NextResponse } from "next/server";
import {
  fetchCollections,
  fetchProducts,
  filterByPrice,
  normalizeShopUrl,
  variantPrice,
} from "@/lib/shopify-scraper/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function num(value: string | null) {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shop = normalizeShopUrl(url.searchParams.get("shop") || "");
  if (!shop) {
    return NextResponse.json({ error: "URL de boutique invalide" }, { status: 400 });
  }

  try {
    if (url.searchParams.get("action") === "collections") {
      return NextResponse.json({ shop, collections: await fetchCollections(shop) });
    }

    const collection = url.searchParams.get("collection") || undefined;
    const { products, truncated } = await fetchProducts(shop, collection);
    const filtered = filterByPrice(products, num(url.searchParams.get("min")), num(url.searchParams.get("max")));

    // L'aperçu ne renvoie pas le body_html : inutile à l'écran et très lourd.
    const summaries = filtered.map((product) => {
      const prices = product.variants.map(variantPrice);
      return {
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        type: product.product_type,
        variants: product.variants.length,
        images: product.images?.length ?? 0,
        minPrice: prices.length ? Math.min(...prices) : 0,
        maxPrice: prices.length ? Math.max(...prices) : 0,
        image: product.images?.[0]?.src ?? null,
      };
    });

    return NextResponse.json({
      shop,
      products: summaries,
      totals: {
        products: filtered.length,
        variants: filtered.reduce((sum, product) => sum + product.variants.length, 0),
        scanned: products.length,
      },
      truncated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Boutique injoignable" },
      { status: 502 }
    );
  }
}
