import { fetchProducts, filterByPrice, normalizeShopUrl } from "@/lib/shopify-scraper/client";
import { buildShopifyCsv, csvFileName } from "@/lib/shopify-scraper/csv";

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
    return new Response("URL de boutique invalide", { status: 400 });
  }

  const collection = url.searchParams.get("collection") || null;

  try {
    const { products } = await fetchProducts(shop, collection ?? undefined);
    const filtered = filterByPrice(
      products,
      num(url.searchParams.get("min")),
      num(url.searchParams.get("max"))
    );

    // BOM UTF-8 : sans lui Excel casse les accents et les caractères des titres.
    const csv = `﻿${buildShopifyCsv(filtered)}`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFileName(shop, collection)}"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Boutique injoignable", {
      status: 502,
    });
  }
}
