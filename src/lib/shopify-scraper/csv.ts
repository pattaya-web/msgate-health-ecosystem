import type { ShopifyProduct, ShopifyVariant } from "@/lib/shopify-scraper/client";

/** En-têtes de l'export produits Shopify, dans l'ordre attendu par l'import. */
const HEADERS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Barcode",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Google Shopping / Google Product Category",
  "Google Shopping / Gender",
  "Google Shopping / Age Group",
  "Google Shopping / MPN",
  "Google Shopping / AdWords Grouping",
  "Google Shopping / AdWords Labels",
  "Google Shopping / Condition",
  "Google Shopping / Custom Product",
  "Google Shopping / Custom Label 0",
  "Google Shopping / Custom Label 1",
  "Google Shopping / Custom Label 2",
  "Google Shopping / Custom Label 3",
  "Google Shopping / Custom Label 4",
  "Variant Image",
  "Variant Weight Unit",
  "Variant Tax Code",
  "Cost per item",
  "Status",
] as const;

type Row = Partial<Record<(typeof HEADERS)[number], string>>;

/**
 * Guillemets seulement quand le format l'exige. La route ajoute un BOM UTF-8 en
 * tête, et `﻿"Handle"` fait lire à Shopify une colonne nommée `﻿"Handle"` : il ne
 * trouve plus la colonne obligatoire et rejette tout le fichier avec « aucune
 * donnée de produit ». Un premier champ nu évite ça chez tous les parseurs.
 */
function cell(value: string | undefined) {
  const text = value ?? "";
  const needsQuotes = /[",\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

function serialize(rows: Row[]) {
  const lines = [HEADERS.map((header) => cell(header)).join(",")];
  for (const row of rows) {
    lines.push(HEADERS.map((header) => cell(row[header])).join(","));
  }
  return lines.join("\n");
}

function optionName(product: ShopifyProduct, index: number) {
  return product.options?.[index]?.name ?? "";
}

function variantRow(product: ShopifyProduct, variant: ShopifyVariant, first: boolean): Row {
  const row: Row = {
    Handle: product.handle,
    "Option1 Name": optionName(product, 0),
    "Option1 Value": variant.option1 ?? "",
    "Option2 Name": optionName(product, 1),
    "Option2 Value": variant.option2 ?? "",
    "Option3 Name": optionName(product, 2),
    "Option3 Value": variant.option3 ?? "",
    "Variant SKU": variant.sku ?? "",
    "Variant Grams": String(variant.grams ?? 0),
    "Variant Inventory Policy": "deny",
    "Variant Fulfillment Service": "manual",
    "Variant Price": variant.price ?? "",
    "Variant Compare At Price": variant.compare_at_price ?? "",
    "Variant Requires Shipping": String(variant.requires_shipping ?? true),
    "Variant Taxable": String(variant.taxable ?? true),
    Status: "active",
  };

  // La première ligne d'un produit porte les champs de niveau produit.
  if (first) {
    row.Title = product.title;
    // Le HTML produit contient des retours à la ligne : valides en CSV quoté, mais
    // Excel et Sheets les rendent mal. L'export Shopify de référence est sur une ligne.
    row["Body (HTML)"] = (product.body_html ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
    row.Vendor = product.vendor ?? "";
    row.Type = product.product_type ?? "";
    row.Tags = Array.isArray(product.tags) ? product.tags.join(",") : (product.tags ?? "");
    row.Published = product.published_at ?? "";
    row["Gift Card"] = "false";
  }

  return row;
}

/**
 * Reproduit la structure d'un export Shopify : une ligne par variante, puis une
 * ligne par image non rattachée à une variante (Handle + image seulement).
 */
export function buildShopifyCsv(products: ShopifyProduct[]) {
  const rows: Row[] = [];

  for (const product of products) {
    const images = product.images ?? [];
    const usedImages = new Set<string>();

    product.variants.forEach((variant, index) => {
      const row = variantRow(product, variant, index === 0);
      const featured = variant.featured_image?.src;
      const matched = featured
        ? images.find((image) => image.src === featured)
        : index === 0
          ? images[0]
          : undefined;

      if (matched) {
        row["Image Src"] = matched.src;
        row["Image Position"] = String(matched.position);
        row["Image Alt Text"] = matched.alt ?? "";
        usedImages.add(matched.src);
      }
      if (featured) row["Variant Image"] = featured;

      rows.push(row);
    });

    for (const image of images) {
      if (usedImages.has(image.src)) continue;
      rows.push({
        Handle: product.handle,
        "Image Src": image.src,
        "Image Position": String(image.position),
        "Image Alt Text": image.alt ?? "",
      });
    }
  }

  return serialize(rows);
}

export function csvFileName(shop: string, collection: string | null) {
  const host = shop.replace(/^https?:\/\//, "").replace(/[^\w.-]/g, "");
  return `${host}${collection ? `_${collection}` : ""}_shopify.csv`;
}
