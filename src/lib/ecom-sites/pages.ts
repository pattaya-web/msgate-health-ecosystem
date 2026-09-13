import type { EcomPage, EcomSite, PageBlock } from "@/lib/ecom-sites/types";

/**
 * Les pages ajoutées à une boutique, et la reprise d'une page depuis une URL.
 *
 * Un dossier de souscription se lit page par page : une FAQ, un « How it
 * works », une page d'ingrédients rassurent autant qu'une politique. Plutôt
 * que de les écrire, on colle l'adresse d'une page qu'on aime : on en garde le
 * contenu — titres, paragraphes, listes, tableaux, images — sans son header ni
 * son footer, et on le rend avec les nôtres. Tout reste modifiable ensuite.
 *
 * Le même découpage sert aux descriptions produit reprises d'une boutique
 * Shopify : leur HTML garde ses tableaux et ses intertitres au lieu d'être
 * aplati en un bloc de texte.
 */

/** Les chemins déjà pris par la boutique : une page ne peut pas les recouvrir. */
export const RESERVED_SLUGS = ["shop", "about", "contact", "cart", "checkout", "product", "preview", "shipping-policy", "refund-policy", "terms", "privacy-policy", "legal-notice"];

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BLOCKS = 200;

export function pageSlug(title: string, taken: string[] = []) {
  const base =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "page";
  let slug = base;
  let index = 2;
  while (RESERVED_SLUGS.includes(slug) || taken.includes(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  return slug;
}

export function pageId() {
  return `pg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Une page vide, prête à être remplie dans l'aperçu. */
export function blankPage(title: string, site: Pick<EcomSite, "pages">): EcomPage {
  return {
    id: pageId(),
    slug: pageSlug(title, (site.pages ?? []).map((page) => page.slug)),
    title: title.trim() || "New page",
    blocks: [
      { type: "paragraph", text: "Write the first paragraph of this page here." },
      { type: "heading", level: 2, text: "A section title" },
      { type: "paragraph", text: "And its paragraph. Click any text to change it, empty it to remove it." },
    ],
    inNav: true,
  };
}

/** Les entrées du menu : celles qu'on a écrites, sinon les pages fixes puis les pages ajoutées qu'on y veut. */
export function navItems(site: Pick<EcomSite, "pages" | "nav">) {
  if (site.nav) return site.nav.map((item) => ({ label: item.label, path: item.href }));
  const custom = (site.pages ?? []).filter((page) => page.inNav).map((page) => ({ label: page.title, path: `/${page.slug}` }));
  return [
    { label: "Shop", path: "/shop" },
    { label: "About", path: "/about" },
    ...custom,
    { label: "Shipping", path: "/shipping-policy" },
    { label: "Returns", path: "/refund-policy" },
    { label: "Contact", path: "/contact" },
  ];
}

/* ------------------------------------------------------------------ *
 * Du HTML aux blocs.
 * ------------------------------------------------------------------ */

function decode(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
}

/** Le texte d'un fragment : les balises tombent, les <br> deviennent des retours à la ligne. */
export function textOf(html: string) {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Retire un élément et tout ce qu'il contient, même imbriqué dans un autre du même nom. */
function dropElements(html: string, tag: string) {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const any = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  let out = html;
  let match: RegExpExecArray | null;
  open.lastIndex = 0;
  while ((match = open.exec(out))) {
    const start = match.index;
    let depth = 0;
    any.lastIndex = start;
    let end = -1;
    let step: RegExpExecArray | null;
    while ((step = any.exec(out))) {
      if (step[1] === "/") depth -= 1;
      else depth += 1;
      if (depth === 0) {
        end = step.index + step[0].length;
        break;
      }
    }
    out = end === -1 ? out.slice(0, start) : out.slice(0, start) + out.slice(end);
    open.lastIndex = start;
  }
  return out;
}

function absolute(src: string, base: string) {
  try {
    return new URL(src.trim(), base).href;
  } catch {
    return "";
  }
}

/**
 * Un fragment HTML réduit à ses blocs, dans l'ordre de lecture : titres,
 * paragraphes, listes, tableaux, images. Les questions d'une FAQ en accordéon
 * (<summary>, <dt>) deviennent des titres. Une page écrite en <div> sans un
 * seul <p> est rattrapée par ses éléments feuilles.
 */
export function htmlToBlocks(fragment: string, url: string, limit = MAX_BLOCKS): { blocks: PageBlock[]; firstHeading: string } {
  const main = fragment.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const blocks: PageBlock[] = [];
  let list: string[] | null = null;
  const seenImages = new Set<string>();
  let firstHeading = "";
  const flushList = () => {
    if (list?.length) blocks.push({ type: "list", items: list });
    list = null;
  };
  const push = (block: PageBlock) => {
    if (blocks.length >= limit) return;
    const last = blocks[blocks.length - 1];
    if (last && "text" in last && "text" in block && last.text === block.text) return;
    blocks.push(block);
  };

  const pattern = /<img\b[^>]*>|<table\b[^>]*>[\s\S]*?<\/table>|<(h[1-4]|p|li|blockquote|summary|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(main))) {
    if (match[0].toLowerCase().startsWith("<table")) {
      /* Un tableau, ligne par ligne : la première ligne d'en-têtes (<th>) à part. */
      flushList();
      const header: string[] = [];
      const rows: string[][] = [];
      for (const row of match[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = Array.from(row[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi));
        if (!cells.length) continue;
        const values = cells.map((cell) => textOf(cell[2]).replace(/\n+/g, " "));
        if (cells.every((cell) => cell[1].toLowerCase() === "th") && !header.length && !rows.length) header.push(...values);
        else if (values.some((value) => value)) rows.push(values);
      }
      if (rows.length) push({ type: "table", header, rows });
      continue;
    }
    if (match[0].toLowerCase().startsWith("<img")) {
      const tag = match[0];
      const src = absolute(tag.match(/\b(?:data-src|data-original|src)=["']([^"']+)["']/i)?.[1] ?? "", url);
      const width = Number(tag.match(/\bwidth=["']?(\d+)/i)?.[1] ?? 0);
      // Pas d'icônes ni de vignettes : rien sous 120 px, ni les SVG.
      if (!src || src.startsWith("data:") || /\.svg(\?|\/|$)/i.test(src) || /\/(\d{1,2})px-/.test(src) || (width && width < 120) || seenImages.has(src)) continue;
      seenImages.add(src);
      flushList();
      push({ type: "image", src, alt: decode(tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "") });
      continue;
    }
    const tag = match[1].toLowerCase();
    const text = textOf(match[2]);
    if (!text || text.length < 2) continue;
    if (tag === "li") {
      list = list ?? [];
      list.push(text.replace(/\n+/g, " "));
      continue;
    }
    flushList();
    if (tag.startsWith("h") || tag === "summary" || tag === "dt") {
      if (!firstHeading && tag.startsWith("h")) firstHeading = text;
      push({ type: "heading", level: tag === "h1" || tag === "h2" ? 2 : 3, text: text.replace(/\n+/g, " ") });
    } else {
      push({ type: "paragraph", text });
    }
  }
  flushList();

  const captured = blocks.reduce((sum, block) => sum + ("text" in block ? block.text.length : "items" in block ? block.items.join("").length : "rows" in block ? block.rows.flat().join("").length : 0), 0);
  const total = textOf(main).length;
  if (total > 200 && captured < total * 0.4) {
    const leaves = main.matchAll(/<(div|span|section|article|td)\b[^>]*>((?:(?!<(?:div|span|section|article|p|ul|ol|table|h[1-6])\b)[\s\S])*?)<\/\1>/gi);
    for (const leaf of leaves) {
      const text = textOf(leaf[2]);
      if (text.length < 25) continue;
      if (blocks.some((block) => "text" in block && block.text === text)) continue;
      push({ type: "paragraph", text });
    }
  } else if (!blocks.length && total > 0) {
    // Un fragment sans aucune balise de bloc : son texte, en paragraphes.
    for (const text of textOf(main).split(/\n\s*\n/)) if (text.trim()) push({ type: "paragraph", text: text.trim() });
  }
  return { blocks, firstHeading };
}

/**
 * Le contenu d'une page, entre son header et son footer.
 *
 * Header, menus, footer, barres latérales, formulaires, scripts : tout ce qui
 * habille la page tombe. On garde ce qu'un lecteur lit, dans l'ordre. Le
 * `<main>` de la page fait foi quand il existe et qu'il n'est pas vide.
 */
export function extractPage(html: string, url: string): { title: string; blocks: PageBlock[] } {
  let doc = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "noscript", "template", "svg", "iframe", "header", "nav", "footer", "aside", "form", "button", "select", "dialog"]) {
    doc = dropElements(doc, tag);
  }
  const titleTag = doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const body = doc.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? doc;
  const candidate = doc.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? doc.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? "";
  const main = candidate && textOf(candidate).length >= 200 ? candidate : body;

  const { blocks, firstHeading } = htmlToBlocks(main, url);
  const rawTitle = decode(titleTag).split(/\s+[|–—-]\s+/)[0].trim();
  const title = (rawTitle || firstHeading || "Page").slice(0, 80);
  // Le titre de la page est rendu à part : on ne le répète pas en premier bloc.
  if (blocks[0]?.type === "heading" && blocks[0].text.toLowerCase() === title.toLowerCase()) blocks.shift();
  return { title, blocks };
}

/** Va chercher une page et en fait une page de boutique, prête à ajouter. */
export async function importPage(input: string, site: Pick<EcomSite, "pages">): Promise<EcomPage> {
  const url = input.trim().match(/^https?:\/\//i) ? input.trim() : `https://${input.trim()}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Adresse invalide");
  }
  const res = await fetch(parsed.href, {
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; msgate-pages/1.0)" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`La page répond HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 3_000_000);
  const { title, blocks } = extractPage(html, parsed.href);
  if (!blocks.length) throw new Error("Aucun contenu lisible sur cette page");
  return {
    id: pageId(),
    slug: pageSlug(title, (site.pages ?? []).map((page) => page.slug)),
    title,
    blocks,
    inNav: true,
    sourceUrl: parsed.href,
  };
}
