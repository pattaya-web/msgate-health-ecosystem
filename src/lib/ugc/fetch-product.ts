import { scrapeProduct } from "@/lib/meta/ad-copy";
import { guessKind } from "@/lib/ugc/kinds";
import type { ProductInput } from "@/lib/ugc/types";

/**
 * Récupère une fiche produit depuis son URL. Les prix sont la donnée la plus
 * fragile : Shopify les expose sous trois conventions différentes selon la route
 * (« 39.00 » en JSON, 3900 en centimes dans le payload de page, parfois rien du
 * tout dans les balises og:). On essaie donc les sources dans l'ordre de
 * fiabilité, et on ne s'arrête qu'une fois un prix plausible trouvé.
 */
type ShopifyProductJson = {
  title?: string;
  vendor?: string;
  body_html?: string;
  description?: string;
  images?: Array<{ src?: string } | string>;
  featured_image?: string;
  variants?: Array<{
    price?: string | number;
    compare_at_price?: string | number | null;
  }>;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", CAD: "$", CHF: "CHF" };

function decodeEntities(text: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    eacute: "é",
    egrave: "è",
    agrave: "à",
    ccedil: "ç",
    ocirc: "ô",
    ugrave: "ù",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (named[code]) return named[code];
    if (code[0] === "#") {
      const point = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return whole;
  });
}

function stripTags(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Ramène n'importe quelle écriture de prix à un nombre d'unités. Un entier sans
 * décimale et supérieur ou égal à 1000 vient du payload Shopify, qui compte en
 * centimes : sans cette conversion le mannequin annonce « 3900 euros ».
 */
function toAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const isCents = Number.isInteger(value) && !match[0].includes(".") && value >= 1000;
  return isCents ? value / 100 : value;
}

function money(amount: number | null, currency: string) {
  if (amount === null) return "";
  const symbol = SYMBOLS[currency] || "$";
  const shown = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return currency === "EUR" ? `${shown} ${symbol}` : `${symbol}${shown}`;
}

/** La devise annoncée par la page bat toujours une déduction sur le domaine. */
function currencyOf(html: string, url: string) {
  const found =
    html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/)?.[1] ||
    html.match(/"currency"\s*:\s*"([A-Z]{3})"/)?.[1] ||
    html.match(/<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([A-Z]{3})["']/i)?.[1];
  if (found) return found;
  if (/€/.test(html)) return "EUR";
  if (/£/.test(html)) return "GBP";
  return /\.fr|\.eu|\/fr[-/]/i.test(url) ? "EUR" : "USD";
}

/**
 * Les arguments de vente sont presque toujours dans une liste à puces. À défaut,
 * on découpe en phrases et on garde les plus courtes : une phrase courte fait un
 * meilleur argument parlé qu'un paragraphe.
 */
function keyPointsFrom(html: string, fallbackText: string): string[] {
  const bullets = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((line) => line.length > 8 && line.length < 120);

  if (bullets.length >= 2) return [...new Set(bullets)].slice(0, 6);

  return [
    ...new Set(
      (fallbackText || stripTags(html))
        .split(/[.!?•\n]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 12 && part.length < 120)
    ),
  ].slice(0, 6);
}

/** Le vendor Shopify fait la marque ; sinon on la tire du domaine. */
function brandOf(vendor: string | undefined, url: string) {
  if (vendor && vendor.trim()) return vendor.trim();
  const host = new URL(url).hostname.replace(/^www./i, "").split(".")[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
}

function handleOf(url: string) {
  const path = new URL(url).pathname.replace(/\/$/, "");
  return path.split("/").pop() || "produit";
}

async function get(url: string, accept: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    cache: "no-store",
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function fromShopifyProduct(product: ShopifyProductJson, currency: string, url: string): ProductInput | null {
  if (!product.title) return null;
  const html = product.body_html || product.description || "";

  // Le variant le moins cher porte le prix d'appel, celui qui s'affiche.
  const priced = (product.variants ?? [])
    .map((variant) => ({
      price: toAmount(variant.price),
      compare: toAmount(variant.compare_at_price),
    }))
    .filter((row) => row.price !== null)
    .sort((a, b) => (a.price as number) - (b.price as number));
  const best = priced[0];

  const images = (product.images ?? [])
    .map((image) => (typeof image === "string" ? image : image.src ?? ""))
    .map(secure)
    .filter((src) => /^https:\/\//i.test(src));

  return {
    handle: handleOf(url),
    name: decodeEntities(product.title),
    description: stripTags(html).slice(0, 220),
    price: money(best?.price ?? null, currency),
    // Un prix barré inférieur au prix de vente est une donnée morte : on l'écarte.
    comparePrice:
      best?.compare && best.price && best.compare > best.price ? money(best.compare, currency) : "",
    brand: brandOf(product.vendor, url),
    keyPoints: keyPointsFrom(html, ""),
    imageUrls: images.slice(0, 6),
    // Pré-réglage seulement : l'utilisateur corrige d'un clic dans l'interface.
    kind: guessKind(product.title + " " + stripTags(html).slice(0, 200)),
  };
}

/** Les CDN servent souvent l'og:image en http : on la remonte en https. */
function secure(src: string) {
  if (src.startsWith("//")) return `https:${src}`;
  return src.replace(/^http:\/\//i, "https://");
}

/**
 * Une landing (`/pages/...`) n'a pas de fiche : elle pointe vers un ou plusieurs
 * produits. On suit le lien le plus cité, qui est celui que la page vend.
 */
function linkedProduct(html: string, url: string) {
  const counts = new Map<string, number>();
  for (const match of html.matchAll(/\/products\/([a-z0-9][a-z0-9-]{2,})/gi)) {
    const handle = match[1].toLowerCase();
    counts.set(handle, (counts.get(handle) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? `${new URL(url).origin}/products/${best[0]}` : null;
}

export async function fetchProductFromUrl(input: string, depth = 0): Promise<ProductInput> {
  const url = input.trim().split("?")[0].replace(/\/$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("URL invalide");

  /**
   * Shopify localise ses prix sur l'IP appelante : la même fiche renvoie 55.00
   * depuis un poste français et 880000.00 depuis un datacenter indonésien.
   * `?currency=` force le marché, sans quoi le mannequin annonce un prix en
   * roupies dans une pub destinée aux États-Unis.
   */
  const wanted = /\.fr\b|\.eu\b|\/fr[-/]/i.test(url) ? "EUR" : "USD";

  // 1) Route JSON de Shopify : prix décimaux, toutes les images, prix barré.
  for (const suffix of [".json", ".js"]) {
    try {
      const raw = await get(`${url}${suffix}?currency=${wanted}`, "application/json");
      const parsed = JSON.parse(raw) as { product?: ShopifyProductJson } & ShopifyProductJson;
      const product = parsed.product ?? parsed;
      const built = fromShopifyProduct(product, wanted, url);
      if (built?.name) return built;
    } catch {
      // Boutique non-Shopify, route bloquée ou fiche privée : on continue.
    }
  }

  // 2) Le payload produit embarqué dans la page, quand les routes sont fermées.
  let html = "";
  try {
    html = await get(url, "text/html");

    // Une landing renvoie vers sa fiche : on y va plutôt que de gratter la page.
    if (depth === 0 && !/\/products\//i.test(url)) {
      const target = linkedProduct(html, url);
      if (target) return fetchProductFromUrl(target, depth + 1);
    }

    const embedded =
      html.match(/(?:var\s+meta|ShopifyAnalytics\.meta)\s*=\s*(\{[\s\S]{0,4000}?\});/)?.[1] ||
      html.match(/"product"\s*:\s*(\{[\s\S]{0,8000}?"variants"[\s\S]{0,8000}?\})\s*[,}]/)?.[1];
    if (embedded) {
      const meta = JSON.parse(embedded) as { product?: ShopifyProductJson };
      const built = fromShopifyProduct(meta.product ?? {}, currencyOf(html, url), url);
      if (built?.name && built.price) return built;
    }
  } catch {
    // Payload absent ou illisible : les balises prennent le relais.
  }

  // 3) Balises JSON-LD et og:, dernier recours mais présent presque partout.
  const scraped = await scrapeProduct(url);
  if (!scraped.title) throw new Error("Impossible de lire cette page produit");

  const currency = currencyOf(html || scraped.text, url);
  const compare =
    toAmount(html.match(/"compare_?at_?price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i)?.[1]) ??
    toAmount(html.match(/"highPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/i)?.[1]);
  // Un entier sous 5 sans centimes vient d'un faux positif de regex, pas d'une
  // fiche : mieux vaut aucun prix qu'un « un dollar » annoncé dans la vidéo.
  const loose = toAmount(scraped.price);
  const price = loose !== null && loose < 5 && Number.isInteger(loose) ? null : loose;

  return {
    handle: handleOf(url),
    name: scraped.title,
    description: scraped.description.slice(0, 220),
    price: money(price, currency),
    comparePrice: compare && price && compare > price ? money(compare, currency) : "",
    brand: brandOf(undefined, url),
    keyPoints: keyPointsFrom(html, scraped.description || scraped.text),
    imageUrls: /^https?:\/\//i.test(scraped.image) ? [secure(scraped.image)] : [],
    kind: guessKind(`${scraped.title} ${scraped.description}`),
  };
}
