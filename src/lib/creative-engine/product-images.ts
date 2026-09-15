/**
 * Les images d'une page produit, pour choisir la référence visuelle d'un
 * produit. Trois sources, dans l'ordre de confiance : la route JSON de Shopify
 * (toutes les photos, avec leurs dimensions), les balises og: / JSON-LD, puis
 * les <img> de la page. Rien n'est jeté : ce qui ressemble à un logo, un
 * pictogramme, un pixel ou un badge de paiement est seulement marqué « junk »
 * et replié dans l'interface, l'opérateur tranche.
 */

export type ProductImageCandidate = {
  url: string;
  width: number | null;
  height: number | null;
  alt: string;
  source: "shopify" | "og" | "jsonld" | "html";
  /** Déjà parmi les photos produit du CRM. */
  stored: boolean;
  junk: boolean;
  reason: string | null;
};

const JUNK_URL = /(logo|icon|favicon|sprite|pixel|badge|payment|visa|mastercard|amex|paypal|applepay|apple-pay|gpay|klarna|trust|secure|guarantee-seal|flag|arrow|chevron|spinner|loading|placeholder|blank|spacer|avatar|star|rating|swatch|thumb_?nail|1x1|tracking|facebook\.com\/tr|\.svg(\?|$)|\.gif(\?|$))/i;
const JUNK_ALT = /(logo|icon|payment|visa|mastercard|paypal|badge|arrow|flag|rating|stars?)/i;

/** Une URL d'image sans sa variante de taille (Shopify `_600x`, `?width=`), pour dédoublonner. */
export function normalizeImageUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.protocol = "https:";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/_(?:\d+x\d*|\d*x\d+|small|medium|large|grande|compact|icon|thumb|pico|master)(?=\.[a-z0-9]+$)/i, "").replace(/@\dx(?=\.[a-z0-9]+$)/i, "");
  return url.toString();
}

export function classifyImage(url: string, alt: string, width: number | null, height: number | null): { junk: boolean; reason: string | null } {
  if (width !== null && height !== null && (width < 200 || height < 200)) return { junk: true, reason: `trop petite (${width}×${height})` };
  if (JUNK_URL.test(url)) return { junk: true, reason: "nom de fichier de logo, pictogramme ou badge" };
  if (alt && JUNK_ALT.test(alt)) return { junk: true, reason: `texte alternatif « ${alt.slice(0, 40)} »` };
  return { junk: false, reason: null };
}

function area(candidate: { width: number | null; height: number | null }) {
  return candidate.width && candidate.height ? candidate.width * candidate.height : 0;
}

/** Fusionne les découvertes : une URL par image, la plus grande version déclarée gagne. */
export function mergeCandidates(found: ProductImageCandidate[], stored: string[]): ProductImageCandidate[] {
  const storedKeys = new Set(stored.map((url) => normalizeImageUrl(url) ?? url));
  const byKey = new Map<string, ProductImageCandidate>();
  const order: string[] = [];
  const rank = { shopify: 0, jsonld: 1, og: 2, html: 3 };
  for (const candidate of found) {
    const key = normalizeImageUrl(candidate.url);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate, url: key, stored: storedKeys.has(key) });
      order.push(key);
      continue;
    }
    // Garde la meilleure source et les dimensions les plus grandes connues.
    if (rank[candidate.source] < rank[existing.source]) existing.source = candidate.source;
    if (area(candidate) > area(existing)) {
      existing.width = candidate.width;
      existing.height = candidate.height;
    }
    if (!existing.alt && candidate.alt) existing.alt = candidate.alt;
  }
  return order
    .map((key) => byKey.get(key) as ProductImageCandidate)
    .map((candidate) => ({ ...candidate, ...classifyImage(candidate.url, candidate.alt, candidate.width, candidate.height) }))
    .sort((a, b) => Number(a.junk) - Number(b.junk) || rank[a.source] - rank[b.source] || area(b) - area(a))
    .slice(0, 40);
}

async function get(url: string, accept: string) {
  const response = await fetch(url, { headers: { accept, "user-agent": "Mozilla/5.0 (compatible; MSGateCRM/1.0)" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function fromShopify(raw: string): ProductImageCandidate[] {
  const parsed = JSON.parse(raw) as { product?: { images?: Array<{ src?: string; width?: number; height?: number; alt?: string | null } | string> } };
  const images = parsed.product?.images ?? (parsed as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => {
    const src = typeof image === "string" ? image : image.src ?? "";
    if (!src) return [];
    const dims = typeof image === "string" ? { width: null, height: null, alt: "" } : { width: image.width ?? null, height: image.height ?? null, alt: image.alt ?? "" };
    return [{ url: src, ...dims, source: "shopify" as const, stored: false, junk: false, reason: null }];
  });
}

function fromHtml(html: string, base: string): ProductImageCandidate[] {
  const out: ProductImageCandidate[] = [];
  for (const match of html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) {
    out.push({ url: new URL(match[1], base).toString(), width: null, height: null, alt: "", source: "og", stored: false, junk: false, reason: null });
  }
  for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(block[1]) as unknown;
      const stack: unknown[] = [data];
      while (stack.length) {
        const node = stack.pop();
        if (Array.isArray(node)) stack.push(...node);
        else if (node && typeof node === "object") {
          const record = node as Record<string, unknown>;
          const image = record.image;
          const urls = typeof image === "string" ? [image] : Array.isArray(image) ? image.map((entry) => (typeof entry === "string" ? entry : (entry as { url?: string })?.url ?? "")) : image && typeof image === "object" ? [(image as { url?: string }).url ?? ""] : [];
          for (const url of urls) if (url) out.push({ url: new URL(url, base).toString(), width: null, height: null, alt: "", source: "jsonld", stored: false, junk: false, reason: null });
          for (const value of Object.values(record)) if (value && typeof value === "object") stack.push(value);
        }
      }
    } catch {
      // JSON-LD illisible : les <img> suffisent
    }
  }
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = tag[0];
    const attr = (name: string) => attrs.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? "";
    const srcset = attr("srcset") || attr("data-srcset");
    let src = attr("src") || attr("data-src") || attr("data-original");
    if (srcset) {
      // Le plus grand descripteur de largeur du srcset.
      const best = srcset.split(",").map((part) => part.trim().split(/\s+/)).map(([u, d]) => ({ u, w: Number.parseInt(d ?? "0", 10) || 0 })).sort((a, b) => b.w - a.w)[0];
      if (best?.u) src = best.u;
    }
    if (!src || src.startsWith("data:")) continue;
    const width = Number.parseInt(attr("width"), 10) || null;
    const height = Number.parseInt(attr("height"), 10) || null;
    try {
      out.push({ url: new URL(src, base).toString(), width, height, alt: attr("alt"), source: "html", stored: false, junk: false, reason: null });
    } catch {
      // src relatif cassé
    }
  }
  return out;
}

/** Toutes les images trouvées sur une page produit, classées et dédoublonnées. Lecture seule. */
export async function extractProductImages(productUrl: string, stored: string[]): Promise<ProductImageCandidate[]> {
  const clean = productUrl.trim().split("?")[0].replace(/\/$/, "");
  if (!/^https?:\/\//i.test(clean)) throw new Error("URL produit invalide");
  const found: ProductImageCandidate[] = [];
  try {
    found.push(...fromShopify(await get(`${clean}.json`, "application/json")));
  } catch {
    // Boutique non-Shopify ou route fermée : la page HTML prend le relais.
  }
  try {
    found.push(...fromHtml(await get(clean, "text/html"), clean));
  } catch (error) {
    if (!found.length) throw new Error(`Page produit illisible (${error instanceof Error ? error.message : "?"})`);
  }
  return mergeCandidates(found, stored);
}
