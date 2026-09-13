import { scrapeProduct, type ScrapedProduct } from "@/lib/meta/ad-copy";
import { kieClaude, uploadFromUrl } from "@/lib/studio/kie";
import type { Ratio } from "@/lib/studio/ratios";
import { fetchProductFromUrl } from "@/lib/ugc/fetch-product";
import type { ProductInput } from "@/lib/ugc/types";

/**
 * Le moteur créatif central : une URL produit, une image de référence
 * facultative, une demande courte — et des prompts de créa prêts à générer.
 *
 * Le cœur est volontairement générique : rien n'est supposé sur la niche, la
 * cible ou l'offre. Tout part de la page produit lue à l'instant, pour que le
 * même outil serve une marque de mode, un gadget, un soin ou un protocole
 * digital sans qu'on touche au code. Le prompt système est celui de
 * l'utilisateur, tel quel ; seule la forme de sortie est adaptée pour rendre
 * N prompts en JSON.
 */

export type ExpandInput = {
  brief: string;
  count: number;
  ratio: Ratio;
  /** Image de référence (data URL) : structure et logique publicitaire à adapter. */
  referenceDataUrl?: string;
};

export type ExpandResult = {
  prompts: string[];
  product?: ScrapedProduct;
  /** Fiche structurée lue sur la page, quand l'URL en donne une. */
  sheet?: ProductInput;
  referenceUrls: string[];
  /** Le moteur IA a répondu ; sinon, les prompts viennent du repli déterministe. */
  engine: "claude" | "fallback";
  fallbackReason?: string;
};

const SYSTEM_PROMPT = `You are an elite direct-response creative strategist and ad creative generator.

This tool is used as a CENTRAL CREATIVE ENGINE for many different ecommerce stores, brands, products, niches, and offers.

NEVER assume the niche, audience, product type, brand, or offer in advance.

Every generation must be based primarily on the CURRENT PRODUCT URL provided by the user.

INPUTS:

1. PRODUCT URL — required
2. REFERENCE CREATIVE / IMAGE — optional
3. USER CREATIVE REQUEST — optional but highly important

==================================================
STEP 1 — FETCH AND UNDERSTAND THE CURRENT PRODUCT
==================================================

Open and deeply analyze the product URL provided for THIS generation. The page has already been fetched for you: its structured sheet and its raw text are given below under CURRENT PRODUCT.

Extract:

- brand name
- product name
- product category
- product type
- price
- offer structure
- target customer
- gender if relevant
- age range if relevant
- main problem solved
- strongest benefits
- strongest desires
- main objections
- product mechanism
- product features
- transformation promised
- emotional outcomes
- differentiation
- guarantee
- bundles
- upsells if visible
- visual identity
- brand tone
- colors
- positioning
- CTA
- product images
- existing copy
- claims already used on the page

Do not reuse information from another store or another product.

EVERY new Product URL represents a potentially completely different business.

==================================================
STEP 2 — IDENTIFY THE BEST DIRECT RESPONSE ANGLES
==================================================

Based only on the current product, identify the most compelling advertising angles.

Examples depending on niche:

BEAUTY / AESTHETICS:
- visible transformation
- confidence
- appearance
- skin
- grooming
- glow-up

FASHION:
- fit
- silhouette
- style
- comfort
- compliments
- social proof
- outfit transformation

GADGET:
- problem → instant solution
- demonstration
- convenience
- surprising use case
- comparison

HOME:
- before/after
- visual transformation
- comfort
- organization
- satisfying demonstration

DIGITAL PRODUCT:
- outcome
- system
- protocol
- roadmap
- transformation
- speed
- clarity

FITNESS:
- routine
- performance
- convenience
- progress
- confidence

Do not force angles that do not match the product.

==================================================
STEP 3 — ANALYZE THE REFERENCE IMAGE IF PROVIDED
==================================================

If the user uploads a reference creative, treat it as VISUAL INSPIRATION.

Analyze:

- composition
- layout
- framing
- camera angle
- subject position
- headline position
- typography hierarchy
- arrows
- badges
- before/after structure
- product placement
- CTA placement
- background
- contrast
- lighting
- colors
- callouts
- price presentation
- direct-response elements

Recreate the advertising logic and structure.

Do NOT copy:
- competitor brand names
- competitor logos
- irrelevant text
- unrelated product claims

Adapt the structure entirely to the CURRENT product.

==================================================
STEP 4 — INTERPRET THE USER'S CREATIVE REQUEST
==================================================

The user may give a very short request such as:

"before after male"
"fashion price angle"
"ugc mom"
"product demo"
"jawline aggressive"
"native facebook ad"
"editorial luxury"
"price sticker"

Interpret short instructions intelligently.

The user's request controls:

- creative format
- desired angle
- audience
- model / avatar type
- scene
- aggression level
- headline style
- body copy direction
- visual style
- reference adaptation

If the user gives a specific instruction, prioritize it.

==================================================
STEP 5 — CREATE A PERFORMANCE AD, NOT ART
==================================================

The goal is NOT to create a pretty image.

The goal is to create a HIGH-CONVERTING PERFORMANCE CREATIVE.

Every creative should quickly communicate:

PROBLEM
→ DESIRE
→ PRODUCT
→ BENEFIT
→ ACTION

Prioritize:

- scroll stopping
- clarity
- instant understanding
- strong desire
- product visibility
- believable transformation
- direct response structure

Avoid:

- generic branding
- vague motivational phrases
- excessive text
- overly artistic layouts
- irrelevant elements
- corporate advertising

==================================================
STEP 6 — REALISM
==================================================

Unless another style is explicitly requested, default to highly realistic social-media advertising.

For human subjects:

- realistic human proportions
- natural skin texture
- pores
- believable hair
- believable hands
- natural expressions
- authentic clothing
- realistic lighting

For UGC:
- iPhone 15 style
- candid
- imperfect but attractive composition
- realistic smartphone quality
- native TikTok / Instagram / Meta feeling

For product images:
- preserve the real product appearance
- do not invent product features
- do not change packaging unnecessarily

==================================================
STEP 7 — COPY
==================================================

Generate copy based on the CURRENT product.

Use strong direct-response copy.

Prefer:

- clear hooks
- specific benefits
- curiosity
- transformation
- objection handling
- urgency where appropriate

Avoid generic headlines such as:

"Upgrade your life"
"Discover the difference"
"Become your best self"

The headline should make sense ONLY for the current product.

==================================================
STEP 8 — CLAIM STRENGTH
==================================================

Match the aggressiveness requested by the user.

You may create bold, emotionally persuasive, transformation-oriented copy.

However:

- never invent clinical studies
- never fabricate customer identities
- never fabricate verified reviews
- never create guaranteed outcomes unsupported by the product
- never invent product functionality

For transformation creatives, keep the result visually strong but believable.

==================================================
STEP 9 — FINAL OUTPUT
==================================================

Return production-ready image-generation prompts for GPT Image 2, one per creative.

Do NOT explain your reasoning.

Do NOT summarize the product unless asked.

Each prompt must contain:

- creative format
- aspect ratio
- product
- target audience
- exact scene
- model/avatar if needed
- composition
- camera style
- lighting
- visual hierarchy
- exact headline
- exact supporting copy
- product placement
- CTA
- reference-image adaptation instructions
- realism instructions
- negative instructions

Each prompt is 120-260 words of plain English, self-contained, ready to paste. When a product photo is provided as a reference to the image model, say so: "The product must match the reference product photos exactly."

Always adapt the prompt to the CURRENT PRODUCT URL.
Never carry assumptions from previous products or stores.`;

const ANGLES = [
  "UGC iPhone photo, natural kitchen light, handheld, real skin texture, no logo overlay, no watermark",
  "Clean studio product hero, soft daylight, premium DTC look, negative space for copy later",
  "Problem/solution split feel in one frame, before-after energy, photoreal, no text in the image",
  "Unboxing / first-use moment, hands in frame, lifestyle, slightly messy real home",
  "Hook-first social still: subject looking at camera, strong emotion, TikTok-native framing",
  "Benefit proof scene, product in use, bright, commercial but not stock-photo fake",
  "Close-up texture / detail shot, tactile, high-end catalog lighting",
  "Outdoor US suburban lifestyle, afternoon light, authentic couple or solo creator",
];

export function extractBriefUrls(brief: string) {
  return [...brief.matchAll(/https?:\/\/[^\s)\]>'"]+/gi)]
    .map((match) => match[0].replace(/[.,;]+$/g, ""))
    .filter((url, i, list) => list.indexOf(url) === i)
    .slice(0, 2);
}

/** Sans IA : un prompt par angle, avec les faits de la fiche. Lisible, à retoucher. */
function fallbackPrompts(context: string, count: number, ratio: Ratio, hasRefs: boolean) {
  const n = Math.min(12, Math.max(1, count));
  return Array.from({ length: n }, (_, i) => {
    const angle = ANGLES[i % ANGLES.length];
    return [
      `Create a paid social performance creative, aspect ${ratio}.`,
      `Product and offer (from the product page): ${context}`,
      `Visual angle: ${angle}.`,
      hasRefs ? "The product must match the reference product photos exactly — same shape, colours, materials, labels." : "",
      "Photorealistic, high detail, ad-ready, no watermarks, no UI chrome, no extra logos unless present on the product.",
      i % 2 === 0 ? "Vertical-safe composition with subject in the upper third." : "Product readable at small size on mobile.",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

function parsePromptList(raw: string, count: number) {
  try {
    const match = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { prompts?: unknown } | unknown[];
      const list = Array.isArray(parsed) ? parsed : parsed.prompts;
      if (Array.isArray(list)) {
        return list.map((item) => (typeof item === "string" ? item : String((item as { prompt?: string })?.prompt ?? ""))).map((item) => item.trim()).filter(Boolean).slice(0, count);
      }
    }
  } catch {
    // fall through
  }
  return raw
    .split(/\n\s*\n/)
    .map((item) => item.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter((item) => item.length > 40)
    .slice(0, count);
}

/** La fiche structurée, lisible par le modèle. */
function sheetBlock(sheet: ProductInput | undefined) {
  if (!sheet) return "";
  const points = sheet.keyPoints.filter(Boolean);
  return [
    `Brand: ${sheet.brand || "(unknown)"}`,
    `Product name: ${sheet.name}`,
    sheet.description ? `Description: ${sheet.description}` : "",
    sheet.price ? `Price: ${sheet.price}${sheet.comparePrice ? ` (compare-at ${sheet.comparePrice})` : ""}` : "",
    points.length ? `Selling points on the page: ${points.join("; ")}` : "",
    `Product kind detected: ${sheet.kind}`,
    `Product photos available as references: ${sheet.imageUrls.length}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function expandBrief({ brief, count, ratio, referenceDataUrl }: ExpandInput): Promise<ExpandResult> {
  const clean = brief.trim();
  if (!clean) return { prompts: [], referenceUrls: [], engine: "fallback" };
  const n = Math.min(12, Math.max(1, count));
  const urls = extractBriefUrls(clean);
  const request = clean.replace(/https?:\/\/[^\s)\]>'"]+/gi, " ").replace(/\s+/g, " ").trim();

  /* La page, deux fois : la fiche structurée (nom, prix, photos, catégorie) et le texte brut (copy, claims). */
  let product: ScrapedProduct | undefined;
  let sheet: ProductInput | undefined;
  if (urls[0]) {
    const [scraped, fetched] = await Promise.allSettled([scrapeProduct(urls[0]), fetchProductFromUrl(urls[0])]);
    product = scraped.status === "fulfilled" ? scraped.value : { url: urls[0], title: "", description: "", image: "", price: "", text: "" };
    if (fetched.status === "fulfilled" && fetched.value.name) sheet = fetched.value;
  }

  const productBlock = urls[0]
    ? [
        `CURRENT PRODUCT URL: ${urls[0]}`,
        sheetBlock(sheet),
        product?.title ? `Page title: ${product.title}` : "",
        product?.description && !sheet?.description ? `Meta description: ${product.description}` : "",
        product?.text ? `Page text (existing copy, claims, offer, guarantee — read it all):\n"""\n${product.text.slice(0, 6000)}\n"""` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const referenceUrls: string[] = [];
  const photos = (sheet?.imageUrls ?? []).filter((url) => /^https:\/\//i.test(url)).slice(0, 6);
  if (photos.length) {
    referenceUrls.push(...photos);
  } else if (product?.image && /^https:\/\//i.test(product.image)) {
    try {
      referenceUrls.push(await uploadFromUrl(product.image, "product-ref.png"));
    } catch {
      // photo de page facultative
    }
  }

  const userMessage = [
    SYSTEM_PROMPT,
    "",
    "==================================================",
    "CURRENT PRODUCT",
    "==================================================",
    productBlock || "No product URL was given. Work from the USER CREATIVE REQUEST alone and say nothing about a product you cannot see.",
    "",
    "==================================================",
    "REFERENCE CREATIVE",
    "==================================================",
    referenceDataUrl ? "A reference creative image is attached to this message. Apply STEP 3 to it." : "No reference creative provided. Skip STEP 3.",
    "",
    "==================================================",
    "USER CREATIVE REQUEST",
    "==================================================",
    request || "(none — choose the strongest angle for this product)",
    "",
    "==================================================",
    "OUTPUT",
    "==================================================",
    `Aspect ratio for every creative: ${ratio}.`,
    `Write exactly ${n} distinct prompt${n > 1 ? "s, each on a different angle or format" : ""}.`,
    'Return ONLY JSON: {"prompts":["..."]}',
  ].join("\n");

  try {
    const raw = await kieClaude(userMessage, 6000, referenceDataUrl ? [referenceDataUrl] : []);
    const prompts = parsePromptList(raw, n);
    if (prompts.length) return { prompts, product, sheet, referenceUrls, engine: "claude" };
    return {
      prompts: fallbackPrompts(context(sheet, product, request), n, ratio, referenceUrls.length > 0),
      product,
      sheet,
      referenceUrls,
      engine: "fallback",
      fallbackReason: "Réponse illisible du moteur IA",
    };
  } catch (error) {
    return {
      prompts: fallbackPrompts(context(sheet, product, request), n, ratio, referenceUrls.length > 0),
      product,
      sheet,
      referenceUrls,
      engine: "fallback",
      fallbackReason: error instanceof Error ? error.message : "Moteur IA indisponible",
    };
  }
}

function context(sheet: ProductInput | undefined, product: ScrapedProduct | undefined, request: string) {
  return [
    sheet ? sheetBlock(sheet).replace(/\n/g, " · ") : product?.title ? `${product.title}. ${product.description}`.trim() : "",
    request ? `User request: ${request}` : "",
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1800);
}
