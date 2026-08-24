// Récupère des leçons Whop via ScrapingBee et les écrit en markdown lisible.
//
//   node scripts/whop-scrape.mjs --links https://whop.com/…/course-page
//   node scripts/whop-scrape.mjs https://whop.com/…/lesson-1 https://whop.com/…/lesson-2
//   node scripts/whop-scrape.mjs --list urls.txt
//
// Le contenu payant n'est visible que connecté : renseigne WHOP_COOKIE dans
// .env.local (DevTools > Application > Cookies > whop.com, copie la ligne
// entière « nom=valeur; nom2=valeur2 »). Sans lui tu récupères la page publique.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

function loadEnv() {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

const env = loadEnv();
const KEY = env.SCRAPINGBEE_API_KEY;
if (!KEY) {
  console.error("SCRAPINGBEE_API_KEY manquante dans .env.local");
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), "whop-export");

/**
 * Whop est une app React : sans rendu JS la page arrive vide de son contenu.
 * `render_js` coûte 5 crédits par page au lieu d'1 — d'où le compteur en fin de
 * course, pour savoir où on en est des 1000 du plan.
 */
async function fetchPage(url) {
  const params = new URLSearchParams({
    api_key: KEY,
    url,
    render_js: "true",
    wait: "6000",
    block_resources: "false",
  });

  /**
   * La session part en en-tête plutôt qu'en paramètre `cookies` : mise dans
   * l'URL, elle la fait dépasser la limite de ScrapingBee, qui répond 500.
   */
  const headers = {};
  if (env.WHOP_COOKIE) {
    params.set("forward_headers", "true");
    headers["Spb-Cookie"] = env.WHOP_COOKIE;
  }

  const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, { headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`ScrapingBee ${res.status} — ${body.slice(0, 200)}`);
  return body;
}

/** Décode les entités les plus courantes ; le reste passe tel quel. */
function decode(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (named[code]) return named[code];
    if (code[0] === "#") {
      const point = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return whole;
  });
}

/**
 * Extraction volontairement sans dépendance : on jette scripts, styles et nav,
 * on garde les titres et les paragraphes. Le but est un texte relisible, pas une
 * copie fidèle de la mise en page.
 */
function toMarkdown(html) {
  let s = html;
  s = s.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n))} `);
  s = s.replace(/<\/h[1-6]>/gi, "\n\n");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|tr)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s);
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function titleOf(html, fallback) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decode(m[1]).trim() : fallback;
}

/** Liens internes de la page, dédupliqués, pour retrouver les leçons d'un cours. */
function linksOf(html, base) {
  const found = new Set();
  for (const m of html.matchAll(/href="(\/[^"#?]*|https:\/\/whop\.com\/[^"#?]*)"/gi)) {
    try {
      found.add(new URL(m[1], base).toString());
    } catch {
      // href inexploitable : on l'ignore plutôt que d'interrompre la collecte.
    }
  }
  return [...found];
}

function slugify(url) {
  return (
    new URL(url).pathname
      .replace(/^\/|\/$/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .slice(0, 80) || "page"
  );
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage : node scripts/whop-scrape.mjs [--links|--list fichier] <url…>");
  process.exit(1);
}

let pages = 0;

async function run() {
  if (!env.WHOP_COOKIE) {
    console.warn("⚠ WHOP_COOKIE vide : seules les pages publiques seront lisibles.\n");
  }

  if (args[0] === "--links") {
    const url = args[1];
    const html = await fetchPage(url);
    pages += 1;
    const links = linksOf(html, url).filter((link) => link.includes("/app/") || /lesson|course|chapter/i.test(link));
    console.log(`${links.length} liens candidats depuis ${url} :\n`);
    links.forEach((link) => console.log(link));
    console.log("\nRelance le script avec ceux qui t'intéressent, ou --list fichier.txt");
    return;
  }

  const urls =
    args[0] === "--list"
      ? readFileSync(args[1], "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
      : args;

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      pages += 1;
      const title = titleOf(html, url);
      const body = toMarkdown(html);
      const file = path.join(OUT_DIR, `${slugify(url)}.md`);
      writeFileSync(file, `# ${title}\n\n<${url}>\n\n${body}\n`);
      console.log(`✓ ${title} → ${path.relative(process.cwd(), file)} (${body.length} caractères)`);
      if (body.length < 500) {
        console.log("  ↳ très court : la page est probablement restée derrière le login.");
      }
    } catch (error) {
      console.error(`✗ ${url} — ${error.message}`);
    }
  }
}

run()
  .then(() => console.log(`\n${pages} page(s) — environ ${pages * 5} crédits ScrapingBee consommés.`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
