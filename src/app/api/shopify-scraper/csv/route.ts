import { fetchProducts, filterByPrice, normalizeShopUrl } from "@/lib/shopify-scraper/client";
import { buildShopifyCsv, csvFileName } from "@/lib/shopify-scraper/csv";
import { hostOf, rebrandedSources } from "@/lib/shopify-scraper/rebrand";

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
    let filtered = filterByPrice(
      products,
      num(url.searchParams.get("min")),
      num(url.searchParams.get("max"))
    );
    // `handles=a,b,c` : seuls les produits cochés dans la page partent dans le fichier.
    const handles = new Set((url.searchParams.get("handles") || "").split(",").map((entry) => entry.trim()).filter(Boolean));
    if (handles.size) filtered = filtered.filter((product) => handles.has(product.handle));

    // Même ordre qu'à l'écran : un CSV rangé autrement que l'aperçu qu'on vient
    // de valider donne l'impression de ne pas avoir exporté la même chose.
    filtered.sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base", numeric: true }));

    // `rebrand=1` : les images rebrandées remplacent celles d'origine là où un rendu existe.
    const replace = url.searchParams.get("rebrand") === "1" ? await rebrandedSources(hostOf(shop)) : undefined;

    // BOM UTF-8 : sans lui Excel casse les accents et les caractères des titres.
    const csv = `﻿${buildShopifyCsv(filtered, replace)}`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${replace ? csvFileName(shop, collection).replace(/\.csv$/, "_rebrand.csv") : csvFileName(shop, collection)}"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Boutique injoignable", {
      status: 502,
    });
  }
}
