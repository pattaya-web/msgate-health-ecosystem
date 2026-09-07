import { NextResponse } from "next/server";
import { kieClaude } from "@/lib/studio/kie";
import { PRICE_POINTS, type EcomProduct } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  brandName?: string;
  niche?: string;
  audience?: string;
  productCount?: number;
  /** Reprend les prix déjà en place plutôt que d'en réinventer. */
  pricePoints?: number[];
};

type Generated = {
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  promise: string;
  productDisclaimer: string;
  pillars: Array<{ title: string; body: string }>;
  categories: Array<{ id: string; label: string; blurb: string }>;
  products: Array<Omit<EcomProduct, "imageUrl" | "packagingTaskId">>;
};

function handleOf(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

/** Le modèle encadre parfois le JSON de texte ou de balises ```json. */
function parseJson(raw: string): Generated {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Claude n'a pas renvoyé de JSON exploitable");
  return JSON.parse(candidate.slice(start, end + 1)) as Generated;
}

function buildPrompt(body: Body, prices: number[]) {
  const count = Math.min(Math.max(body.productCount || 6, 1), 12);
  return `You are writing the copy for a real US direct-to-consumer ecommerce store that will be submitted to a payment processor for merchant underwriting. Accuracy and restraint matter more than hype.

Brand name: ${body.brandName}
Category: ${body.niche || "beauty and wellness supplements"}
Audience: ${body.audience || "US women 25-55 buying for themselves"}

Write ${count} products. Use these price points, in this order, one per product: ${prices.join(", ")}.

Hard rules:
- Never claim a product treats, cures or prevents any disease.
- Never invent clinical trials, doctor endorsements, press mentions, certifications or award wins.
- Never invent customer reviews, ratings or counts.
- No urgency or scarcity that is not real (no fake countdowns, no "only 3 left").
- Ingredient amounts should be ordinary, realistic doses for the category.
- Write in plain, concrete English. No em dashes.

Return ONLY a JSON object, no commentary, shaped exactly like this:
{
  "tagline": "three to five words",
  "heroTitle": "short sentence, under 60 characters",
  "heroSubtitle": "two sentences saying what the brand sells and who it is for",
  "promise": "one paragraph on how the brand operates: sourcing, testing, labelling honesty",
  "productDisclaimer": "the standard US disclaimer appropriate to this category, or empty string if none applies",
  "pillars": [ { "title": "short", "body": "two sentences" } ],
  "categories": [ { "id": "kebab-case", "label": "short", "blurb": "one line" } ],
  "products": [
    {
      "name": "product name",
      "subtitle": "one short line",
      "category": "must match one category id",
      "price": 0,
      "compareAtPrice": null,
      "dosage": "e.g. Daily . 2 capsules",
      "description": "150 to 220 characters, concrete",
      "bullets": ["four short benefit lines"],
      "usage": "one sentence on how to take it",
      "ingredients": "comma separated actives with realistic doses",
      "badge": "one of: Bestseller, Hero, New, or empty string"
    }
  ]
}

Give 3 pillars and 3 to 4 categories.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.brandName?.trim()) {
      return NextResponse.json({ error: "Nom de marque requis" }, { status: 400 });
    }

    const count = Math.min(Math.max(body.productCount || 6, 1), 12);
    const ladder = body.pricePoints?.length ? body.pricePoints : [...PRICE_POINTS];
    // Étale les prix sur la grille au lieu de répéter le même palier.
    const prices = Array.from({ length: count }, (_, i) => ladder[i % ladder.length]);

    const raw = await kieClaude(buildPrompt(body, prices), 8000);
    const generated = parseJson(raw);

    const categories = (generated.categories || []).map((category) => ({
      id: category.id || handleOf(category.label || "all"),
      label: category.label || "",
      blurb: category.blurb || "",
    }));
    const categoryIds = new Set(categories.map((category) => category.id));

    const products: EcomProduct[] = (generated.products || []).slice(0, count).map((product, index) => ({
      handle: handleOf(product.name || `product-${index + 1}`),
      name: product.name || "",
      subtitle: product.subtitle || "",
      // Un id inventé par le modèle casserait le filtre /shop?cat=…
      category: categoryIds.has(product.category) ? product.category : categories[0]?.id || "",
      price: Number(product.price) || prices[index] || prices[0],
      compareAtPrice:
        product.compareAtPrice === null || product.compareAtPrice === undefined
          ? null
          : Number(product.compareAtPrice) || null,
      dosage: product.dosage || "",
      description: product.description || "",
      bullets: Array.isArray(product.bullets) ? product.bullets.slice(0, 6) : [],
      usage: product.usage || "",
      ingredients: product.ingredients || "",
      badge: product.badge || "",
      imageUrl: "",
      packagingTaskId: null,
    }));

    return NextResponse.json({
      tagline: generated.tagline || "",
      heroTitle: generated.heroTitle || "",
      heroSubtitle: generated.heroSubtitle || "",
      promise: generated.promise || "",
      productDisclaimer: generated.productDisclaimer || "",
      pillars: (generated.pillars || []).slice(0, 4),
      categories,
      products,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération de copy impossible" },
      { status: 502 }
    );
  }
}
