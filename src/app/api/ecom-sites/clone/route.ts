import { NextResponse } from "next/server";
import { readReferenceSite, type ReferenceProduct } from "@/lib/ecom-sites/reference";
import { noteReferenceRead } from "@/lib/ecom-sites/reference-store";
import { createEcomSite } from "@/lib/ecom-sites/store";
import { MAX_PRICE, type EcomProduct, type EcomThemeId } from "@/lib/ecom-sites/types";
import { kieClaude } from "@/lib/studio/kie";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  domain?: string;
  brandName?: string;
  themeId?: EcomThemeId;
};

type Rebranded = {
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  promise: string;
  productDisclaimer: string;
  promoBar: string;
  pillars: Array<{ title: string; body: string }>;
  categories: Array<{ id: string; label: string; blurb: string }>;
  products: Array<{
    sourceHandle: string;
    name: string;
    subtitle: string;
    category: string;
    dosage: string;
    description: string;
    bullets: string[];
    usage: string;
    ingredients: string;
    badge: string;
  }>;
};

function handleOf(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function parseJson(raw: string): Rebranded {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Claude n'a pas renvoyé de JSON exploitable");
  return JSON.parse(candidate.slice(start, end + 1)) as Rebranded;
}

function buildPrompt(brandName: string, products: ReferenceProduct[]) {
  const catalogue = products
    .map((product, index) =>
      [
        `--- SOURCE PRODUCT ${index + 1} (handle: ${product.handle}, price: $${product.price})`,
        `Name: ${product.name}`,
        product.dosage ? `Format line: ${product.dosage}` : "",
        `Page text: ${product.raw.slice(0, 900)}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  return `You are rebranding an existing US ecommerce catalogue under a new brand name. The new store will be submitted to a payment processor for merchant underwriting, so the copy must be plain, concrete and defensible.

New brand name: ${brandName}

Below is the source catalogue. Keep the same product LINEUP and the same product FORMATS (a gummy stays a gummy, a capsule stays a capsule, the same dose format). Rewrite every piece of text so it belongs to the new brand: new product names, new subtitles, new descriptions. Do not copy any sentence from the source verbatim.

${catalogue}

Hard rules:
- Never claim a product treats, cures or prevents any disease.
- Never invent clinical trials, doctor endorsements, press mentions, certifications or awards.
- Never invent customer reviews, ratings or review counts.
- Keep ingredient names and doses realistic and consistent with the source format.
- Plain, concrete English. No em dashes.

Return ONLY a JSON object shaped exactly like this, with one entry in "products" per source product, in the same order, and "sourceHandle" copied from the source:
{
  "tagline": "three to five words",
  "heroTitle": "short sentence under 60 characters",
  "heroSubtitle": "two sentences: what the brand sells and who it is for",
  "promise": "one paragraph on sourcing, testing and honest labelling",
  "productDisclaimer": "the standard US disclaimer for this category, or empty string",
  "promoBar": "short uppercase marquee line with shipping and guarantee",
  "pillars": [ { "title": "short", "body": "two sentences" } ],
  "categories": [ { "id": "kebab-case", "label": "short", "blurb": "one line" } ],
  "products": [
    {
      "sourceHandle": "copied from the source block",
      "name": "new product name",
      "subtitle": "one short line",
      "category": "must match one category id",
      "dosage": "e.g. Daily . 2 gummies",
      "description": "150 to 220 characters",
      "bullets": ["four short benefit lines"],
      "usage": "one sentence",
      "ingredients": "comma separated actives with doses",
      "badge": "Bestseller, Hero, New, or empty string"
    }
  ]
}

Give 3 pillars and 3 to 4 categories.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.domain?.trim()) return NextResponse.json({ error: "Modèle requis" }, { status: 400 });
    if (!body.brandName?.trim()) return NextResponse.json({ error: "Nom de marque requis" }, { status: 400 });

    const read = await readReferenceSite(body.domain);
    await noteReferenceRead(read.domain, read.products.length);
    if (!read.products.length) {
      return NextResponse.json(
        { error: `Aucun produit lisible sur ${read.domain}. ${read.warnings.join(" ")}`.trim() },
        { status: 422 }
      );
    }

    const rebranded = parseJson(await kieClaude(buildPrompt(body.brandName, read.products), 8000));

    const categories = (rebranded.categories || []).map((category) => ({
      id: category.id || handleOf(category.label || "all"),
      label: category.label || "",
      blurb: category.blurb || "",
    }));
    const categoryIds = new Set(categories.map((category) => category.id));

    const sourceByHandle = new Map(read.products.map((product) => [product.handle, product]));

    const products: EcomProduct[] = (rebranded.products || []).map((product, index) => {
      const source = sourceByHandle.get(product.sourceHandle) || read.products[index];
      // Le prix vient toujours du modèle, jamais du modèle de langage.
      const sourcePrice = source?.price || 0;
      const price = Math.min(sourcePrice > 0 ? sourcePrice : 29.99, MAX_PRICE);

      return {
        handle: handleOf(product.name || `product-${index + 1}`),
        name: product.name || "",
        subtitle: product.subtitle || "",
        category: categoryIds.has(product.category) ? product.category : categories[0]?.id || "",
        price,
        compareAtPrice: null,
        dosage: product.dosage || source?.dosage || "",
        description: product.description || "",
        bullets: Array.isArray(product.bullets) ? product.bullets.slice(0, 6) : [],
        usage: product.usage || "",
        ingredients: product.ingredients || "",
        badge: product.badge || "",
        // Les visuels ne sont pas repris du modèle : ils se génèrent avec le
        // logo de la nouvelle marque depuis l'onglet.
        imageUrl: "",
        packagingTaskId: null,
      };
    });

    const site = await createEcomSite({
      brandName: body.brandName,
      themeId: body.themeId || "glow",
      tagline: rebranded.tagline || "",
      heroTitle: rebranded.heroTitle || "",
      heroSubtitle: rebranded.heroSubtitle || "",
      promise: rebranded.promise || "",
      productDisclaimer: rebranded.productDisclaimer || "",
      promoBar: rebranded.promoBar || "FREE US SHIPPING OVER $50 ✦ 30-DAY GUARANTEE",
      pillars: (rebranded.pillars || []).slice(0, 4),
      categories,
      products,
    });

    return NextResponse.json({
      site,
      copiedFrom: read.domain,
      source: read.source,
      warnings: read.warnings,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Copie impossible" },
      { status: 502 }
    );
  }
}
