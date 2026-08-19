import { kieClaude } from "@/lib/studio/kie";

function pickMeta(html: string, key: string) {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
    "i"
  );
  return html.match(regex)?.[1] || html.match(alt)?.[1] || "";
}

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export type ScrapedProduct = {
  url: string;
  title: string;
  description: string;
  image: string;
  price: string;
  text: string;
};

function isPublicHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0") return false;
    if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function jsonLdBits(html: string) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const out = { name: "", description: "", image: "", brand: "", price: "" };
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1] || "");
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const node of nodes) {
        const type = String(node?.["@type"] || "");
        if (!/product|offer/i.test(type) && !node?.offers) continue;
        out.name = out.name || String(node.name || "");
        out.description = out.description || String(node.description || "");
        out.brand = out.brand || String(node.brand?.name || node.brand || "");
        const img = node.image;
        out.image = out.image || (typeof img === "string" ? img : Array.isArray(img) ? String(img[0]?.url || img[0] || "") : String(img?.url || ""));
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        out.price = out.price || String(offer?.price ? `${offer.priceCurrency || "$"}${offer.price}` : "");
      }
    } catch {
      // ignore bad json-ld
    }
  }
  return out;
}

function pageText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 7000);
}

export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
  if (!isPublicHttpUrl(url)) throw new Error("URL produit refusée");
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  const html = await res.text();
  const ld = jsonLdBits(html);
  const title =
    decode(pickMeta(html, "og:title") || pickMeta(html, "twitter:title")) ||
    ld.name ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
    "";
  const description =
    decode(pickMeta(html, "og:description") || pickMeta(html, "description")) || ld.description;
  const image = pickMeta(html, "og:image") || ld.image;
  const price =
    ld.price ||
    html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i)?.[1] ||
    html.match(/\$\s?\d+(?:\.\d{2})?/)?.[0] ||
    "";
  const brandLine = ld.brand ? `Brand: ${ld.brand}. ` : "";
  return {
    url,
    title,
    description,
    image,
    price,
    text: `${brandLine}${pageText(html)}`,
  };
}

function parseJsonBlock(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("L’IA n’a pas renvoyé de JSON");
  return JSON.parse(match[0]) as {
    headlines?: string[];
    primaryTexts?: string[];
    linkDescription?: string;
    websiteUrl?: string;
  };
}

export async function generateAdCopyFromUrl(productUrl: string) {
  const url = productUrl.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("URL produit invalide");
  let product = { url, title: "", description: "", image: "", price: "" };
  try {
    product = await scrapeProduct(url);
  } catch {
    // Claude still generates from the URL alone.
  }

  const raw = await kieClaude(
    `You write Meta (Facebook/Instagram) paid social ad copy for DTC brands.

Product URL: ${url}
Title: ${product.title || "(unknown)"}
Price hint: ${product.price || "(unknown)"}
Description: ${product.description || "(unknown)"}

Return ONLY valid JSON with this shape:
{
  "headlines": ["...", "..."],
  "primaryTexts": ["...", "...", "...", "...", "..."],
  "linkDescription": "...",
  "websiteUrl": "${url}"
}

Rules:
- 2 headlines, max 40 characters, punchy, can include price + 1 emoji (like 🏃)
- 5 primary texts, each 400-900 characters, native UGC/ad style, not corporate
- Vary angles: price hook, problem/solution, social proof, urgency, feature-benefit
- Include 1-3 emojis max per primary text, short lines, a clear CTA (👉 Shop now)
- Put the product URL on its own line inside at least 2 of the primary texts
- English, US DTC tone, like winning Meta ads for a foldable treadmill / supplement / gadget
- No hashtags dump, no "as an AI"`
  );

  const parsed = parseJsonBlock(raw);
  return {
    headlines: (parsed.headlines || []).map((item) => String(item).slice(0, 255)).filter(Boolean).slice(0, 5),
    primaryTexts: (parsed.primaryTexts || []).map((item) => String(item)).filter(Boolean).slice(0, 10),
    linkDescription: String(parsed.linkDescription || "").slice(0, 30),
    websiteUrl: String(parsed.websiteUrl || url),
  };
}
