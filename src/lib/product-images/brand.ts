/**
 * Couleurs d'une boutique, lues sur sa page d'accueil.
 *
 * Une marque ne saisit pas ses couleurs : on les trouve. La page et ses feuilles
 * de style contiennent tout — la couleur de thème déclarée, les variables du
 * thème Shopify, les hexadécimaux répétés. On compte, puis on classe par rôle :
 * un fond clair, une encre foncée, un accent saturé.
 */

export type BrandColors = {
  /** Fond des visuels typographiques. */
  background: string;
  /** Couleur du texte. */
  text: string;
  /** Icônes, badge, filet. */
  accent: string;
  /** Les couleurs les plus fréquentes, pour l'affichage. */
  palette: string[];
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const MAX_SHEETS = 4;
const FETCH_TIMEOUT_MS = 10000;

/**
 * Couleurs de widgets tiers qu'on retrouve sur presque toutes les boutiques :
 * elles ne disent rien de la marque. Le vert Trustpilot passait pour un accent.
 */
const THIRD_PARTY = new Set([
  "#00b67a", // Trustpilot
  "#5a31f4", // Shop Pay
  "#ffb3c7", // Klarna
  "#003087", // PayPal
  "#009cde", // PayPal
  "#1877f2", // Facebook
  "#ff0000", // YouTube
  "#25d366", // WhatsApp
  "#635bff", // Stripe
]);

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, "0")).join("")}`;
}

function expandHex(raw: string) {
  const hex = raw.toLowerCase();
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex;
}

function rgbOf(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Luminance relative, 0 = noir, 1 = blanc. */
export function luminance(hex: string) {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Saturation HSL, 0 = gris, 1 = pur. */
function saturation(hex: string) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

/** Écart de luminance suffisant pour que le texte se lise. */
export function readableOn(background: string, ink: string) {
  return Math.abs(luminance(background) - luminance(ink)) > 0.4;
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,text/css,*/*" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Réponse ${res.status}`);
  return res.text();
}

/** Feuilles de style liées par la page, résolues en URL absolues. */
function stylesheetsOf(html: string, base: URL) {
  const links = html.match(/<link[^>]+>/gi) ?? [];
  const found: string[] = [];
  for (const tag of links) {
    if (!/rel=["'][^"']*stylesheet/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      found.push(new URL(href, base).toString());
    } catch {
      /* href illisible : on l'ignore */
    }
  }
  return found.slice(0, MAX_SHEETS);
}

/** Compte chaque couleur rencontrée, sous toutes ses écritures. */
function countColors(text: string, counts: Map<string, number>, weight = 1) {
  const add = (hex: string) => counts.set(hex, (counts.get(hex) ?? 0) + weight);

  for (const match of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) add(expandHex(match[0]));
  for (const match of text.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
    add(toHex(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  // Thèmes Shopify récents : `--color-background: 255,255,255;`
  for (const match of text.matchAll(/--[\w-]*colou?r[\w-]*:\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*;/gi)) {
    add(toHex(Number(match[1]), Number(match[2]), Number(match[3])));
  }
}

function pick(entries: Array<[string, number]>, test: (hex: string) => boolean) {
  return entries.find(([hex]) => test(hex))?.[0];
}

export async function fetchBrandColors(input: string): Promise<BrandColors> {
  const target = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const html = await fetchText(target.toString()).catch(() => {
    throw new Error("Boutique injoignable");
  });

  const counts = new Map<string, number>();
  countColors(html, counts);

  const sheets = await Promise.allSettled(stylesheetsOf(html, target).map((url) => fetchText(url)));
  for (const sheet of sheets) {
    if (sheet.status === "fulfilled") countColors(sheet.value, counts);
  }

  // La couleur de thème déclarée pèse plus qu'une occurrence : c'est un choix de la marque.
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{3,6})["']/i)?.[1];
  const themeHex = theme ? expandHex(theme) : undefined;
  if (themeHex) counts.set(themeHex, (counts.get(themeHex) ?? 0) + 5);

  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) throw new Error("Aucune couleur trouvée sur cette page");

  const light = (hex: string) => luminance(hex) > 0.8;
  const dark = (hex: string) => luminance(hex) < 0.3;
  const vivid = (hex: string) => saturation(hex) > 0.15 && luminance(hex) > 0.08 && luminance(hex) < 0.85;

  const background =
    (themeHex && light(themeHex) ? themeHex : undefined) ?? pick(entries, light) ?? "#f4f4f4";
  const text = pick(entries, (hex) => dark(hex) && hex !== "#000000") ?? pick(entries, dark) ?? "#111111";
  const accent =
    pick(
      entries,
      (hex) =>
        vivid(hex) && !THIRD_PARTY.has(hex) && hex !== background && hex !== text && readableOn(background, hex)
    ) ?? text;

  const palette = entries.map(([hex]) => hex).filter((hex) => !THIRD_PARTY.has(hex)).slice(0, 8);
  return { background, text, accent, palette };
}
