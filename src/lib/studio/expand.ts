import { scrapeProduct, type ScrapedProduct } from "@/lib/meta/ad-copy";
import { kieClaude, uploadFromUrl } from "@/lib/studio/kie";

export type ExpandInput = {
  brief: string;
  count: number;
  ratio: "1:1" | "9:16" | "3:4";
};

export type ExpandResult = {
  prompts: string[];
  product?: ScrapedProduct;
  referenceUrls: string[];
};

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

function fallbackPrompts(context: string, count: number, ratio: ExpandInput["ratio"]) {
  const n = Math.min(12, Math.max(1, count));
  return Array.from({ length: n }, (_, i) => {
    const angle = ANGLES[i % ANGLES.length];
    return [
      `Create a paid social creative still, aspect ${ratio}.`,
      `Brand / offer context: ${context}`,
      `Visual angle: ${angle}.`,
      `Photorealistic, high detail, ad-ready, no captions, no watermarks, no UI chrome, no extra logos unless present in the brief.`,
      i % 2 === 0 ? "Vertical-safe composition with subject in the upper third." : "Product readable at small size on mobile.",
    ].join(" ");
  });
}

function parsePromptList(raw: string, count: number) {
  try {
    const match = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { prompts?: unknown } | unknown[];
      const list = Array.isArray(parsed) ? parsed : parsed.prompts;
      if (Array.isArray(list)) {
        return list.map((item) => String(item).trim()).filter(Boolean).slice(0, count);
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

export async function expandBrief({ brief, count, ratio }: ExpandInput): Promise<ExpandResult> {
  const clean = brief.trim();
  if (!clean) return { prompts: [], referenceUrls: [] };
  const n = Math.min(12, Math.max(1, count));
  const urls = extractBriefUrls(clean);
  const instructions = clean.replace(/https?:\/\/[^\s)\]>'"]+/gi, " ").replace(/\s+/g, " ").trim();

  let product: ScrapedProduct | undefined;
  if (urls[0]) {
    try {
      product = await scrapeProduct(urls[0]);
    } catch {
      product = { url: urls[0], title: "", description: "", image: "", price: "", text: "" };
    }
  }

  const facts = product
    ? [
        `Product URL: ${product.url}`,
        product.title ? `Name: ${product.title}` : "",
        product.price ? `Price: ${product.price}` : "",
        product.description ? `Description: ${product.description}` : "",
        product.text ? `Page text: ${product.text.slice(0, 3500)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const context = [facts, instructions ? `User instructions: ${instructions}` : "", !facts ? `Brief: ${clean}` : ""]
    .filter(Boolean)
    .join("\n\n");

  let prompts: string[] = [];
  try {
    const raw = await kieClaude(
      `You write GPT Image 2 prompts for paid social static ads.

${context}

Write exactly ${n} distinct image prompts for aspect ratio ${ratio}.
Each prompt: 70–160 words, photoreal, English, ready to paste into GPT Image 2.
Use the product facts from the page (name, color, packaging, form, who it's for). Follow the user instructions for style, talent, setting.
No captions, no watermarks, no UI, no extra logos unless the page has a real packshot logo on the product.
Return ONLY JSON: {"prompts":["..."]}`,
      8000
    );
    prompts = parsePromptList(raw, n);
  } catch {
    prompts = [];
  }
  if (!prompts.length) prompts = fallbackPrompts(context.slice(0, 1800), n, ratio);

  const referenceUrls: string[] = [];
  if (product?.image && /^https:\/\//i.test(product.image)) {
    try {
      referenceUrls.push(await uploadFromUrl(product.image, "product-ref.png"));
    } catch {
      // page photo optional
    }
  }

  return { prompts, product, referenceUrls };
}
