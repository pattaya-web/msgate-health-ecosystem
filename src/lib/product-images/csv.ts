/**
 * Aller-retour sur un CSV d'export Shopify : on relit le fichier tel quel, on ne
 * remplace que les colonnes d'images, et tout le reste est réécrit à l'identique.
 */

export type CsvTable = { headers: string[]; rows: string[][] };

export type CsvProduct = {
  handle: string;
  title: string;
  type: string;
  vendor: string;
  /** Images d'origine, dans l'ordre des positions. */
  images: string[];
  /** Texte alternatif de chaque image, aligné sur `images`. Sert à reconnaître
   *  quelle photo montre quel article quand une fiche en mélange plusieurs. */
  imageAlts: string[];
  /** Une entrée par couleur déclinée, avec la photo de cette couleur. */
  colors: Array<{ name: string; image: string }>;
  /** Index des lignes du tableau qui appartiennent à ce produit. */
  rowIndexes: number[];
};

/** Parseur RFC 4180 : les champs quotés peuvent contenir virgules et retours ligne. */
export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  // Une ligne vide en fin de fichier ne doit pas devenir un produit fantôme.
  return { headers, rows: rows.filter((entry) => entry.some((cell) => cell.trim() !== "")) };
}

function cell(value: string | undefined) {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

export function serializeCsv(table: CsvTable) {
  const lines = [table.headers.map(cell).join(",")];
  for (const row of table.rows) {
    lines.push(table.headers.map((_, index) => cell(row[index])).join(","));
  }
  return `﻿${lines.join("\n")}`;
}

function column(table: CsvTable, name: string) {
  return table.headers.indexOf(name);
}

/** Regroupe les lignes par handle : un produit Shopify s'étale sur plusieurs lignes. */
export function groupProducts(table: CsvTable): CsvProduct[] {
  const handleAt = column(table, "Handle");
  const titleAt = column(table, "Title");
  const typeAt = column(table, "Type");
  const vendorAt = column(table, "Vendor");
  const imageAt = column(table, "Image Src");
  const altAt = column(table, "Image Alt Text");
  const variantImageAt = column(table, "Variant Image");
  // Shopify n'impose pas l'ordre des options : la couleur peut être en 1, 2 ou 3.
  const optionCols = [1, 2, 3]
    .map((n) => ({ name: column(table, `Option${n} Name`), value: column(table, `Option${n} Value`) }))
    .filter((pair) => pair.name >= 0 && pair.value >= 0);

  if (handleAt < 0) return [];

  const byHandle = new Map<string, CsvProduct>();

  table.rows.forEach((row, index) => {
    const handle = (row[handleAt] ?? "").trim();
    if (!handle) return;

    let product = byHandle.get(handle);
    if (!product) {
      product = { handle, title: "", type: "", vendor: "", images: [], imageAlts: [], colors: [], rowIndexes: [] };
      byHandle.set(handle, product);
    }

    product.rowIndexes.push(index);
    if (titleAt >= 0 && row[titleAt]?.trim() && !product.title) product.title = row[titleAt].trim();
    if (typeAt >= 0 && row[typeAt]?.trim() && !product.type) product.type = row[typeAt].trim();
    if (vendorAt >= 0 && row[vendorAt]?.trim() && !product.vendor) product.vendor = row[vendorAt].trim();

    const image = imageAt >= 0 ? (row[imageAt] ?? "").trim() : "";
    if (image && !product.images.includes(image)) {
      product.images.push(image);
      product.imageAlts.push(altAt >= 0 ? (row[altAt] ?? "").trim() : "");
    }

    // Une couleur n'est retenue que si elle a sa propre photo : sans image de
    // référence, la décliner ne produirait qu'une invention de plus.
    const colorCol = optionCols.find((pair) => /colou?r|couleur/i.test(row[pair.name] ?? ""));
    if (colorCol) {
      const name = (row[colorCol.value] ?? "").trim();
      const variantImage = variantImageAt >= 0 ? (row[variantImageAt] ?? "").trim() : "";
      const shot = variantImage || image;
      if (name && shot && !product.colors.some((entry) => entry.name === name)) {
        product.colors.push({ name, image: shot });
      }
    }
  });

  return [...byHandle.values()];
}

/**
 * Réécrit le tableau en substituant les images des produits validés.
 *
 * Les lignes de variantes gardent toutes leurs données et reçoivent la première
 * image ; les images suivantes deviennent des lignes « image seule ». Les anciennes
 * lignes d'images sont supprimées, et `Variant Image` est vidé — les visuels
 * générés ne sont pas déclinés par variante, laisser l'ancienne URL pointerait
 * vers une photo qui ne correspond plus au produit.
 */
export function applyGeneratedImages(
  table: CsvTable,
  replacements: Map<string, string[]>
): CsvTable {
  const handleAt = column(table, "Handle");
  const skuAt = column(table, "Variant SKU");
  const imageAt = column(table, "Image Src");
  const positionAt = column(table, "Image Position");
  const altAt = column(table, "Image Alt Text");
  const variantImageAt = column(table, "Variant Image");

  if (handleAt < 0 || imageAt < 0) return table;

  const isVariantRow = (row: string[]) =>
    skuAt >= 0 ? (row[skuAt] ?? "").trim() !== "" : false;

  // Index de la dernière ligne de variante de chaque produit : les images
  // supplémentaires s'insèrent juste après, comme dans un export Shopify.
  const lastVariantRow = new Map<string, number>();
  table.rows.forEach((row, index) => {
    const handle = (row[handleAt] ?? "").trim();
    if (handle && isVariantRow(row)) lastVariantRow.set(handle, index);
  });

  const out: string[][] = [];
  const emitted = new Set<string>();

  table.rows.forEach((row, index) => {
    const handle = (row[handleAt] ?? "").trim();
    const urls = replacements.get(handle);

    if (!urls?.length) {
      out.push(row);
      return;
    }

    // Les anciennes lignes « image seule » du produit disparaissent.
    if (!isVariantRow(row)) return;

    const next = [...row];
    if (variantImageAt >= 0) next[variantImageAt] = "";

    if (!emitted.has(handle)) {
      next[imageAt] = urls[0];
      if (positionAt >= 0) next[positionAt] = "1";
      emitted.add(handle);
    } else {
      next[imageAt] = "";
      if (positionAt >= 0) next[positionAt] = "";
    }
    if (altAt >= 0) next[altAt] = "";

    out.push(next);

    if (lastVariantRow.get(handle) === index) {
      urls.slice(1).forEach((url, offset) => {
        const imageRow = new Array<string>(table.headers.length).fill("");
        imageRow[handleAt] = handle;
        imageRow[imageAt] = url;
        if (positionAt >= 0) imageRow[positionAt] = String(offset + 2);
        out.push(imageRow);
      });
    }
  });

  return { headers: table.headers, rows: out };
}
