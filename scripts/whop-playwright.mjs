// Aspire des leçons Whop avec un vrai navigateur, en local.
//
//   node scripts/whop-playwright.mjs --links <url-du-cours>
//   node scripts/whop-playwright.mjs <url…>
//   node scripts/whop-playwright.mjs --list urls.txt
//
// Rien ne sort de cette machine à part vers whop.com : pas de service tiers.
// On lit le texte tel que le navigateur l'affiche (innerText) plutôt que de
// désosser le HTML, et on garde au passage les réponses JSON de l'app — c'est
// là que se trouvent les identifiants de vidéo et les pistes de sous-titres.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

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
if (!env.WHOP_COOKIE) {
  console.error("WHOP_COOKIE vide dans .env.local — recopie ta session depuis le navigateur.");
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), "whop-export");

/** Playwright veut des objets ; `url` lui laisse gérer domaine, path et Secure. */
function cookies() {
  return env.WHOP_COOKIE.split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf("=");
      return { name: part.slice(0, at), value: part.slice(at + 1), url: "https://whop.com/" };
    })
    .filter((cookie) => cookie.name && cookie.value);
}

function slugify(url) {
  return (
    new URL(url).pathname
      .replace(/^\/|\/$/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .slice(0, 90) || "page"
  );
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage : node scripts/whop-playwright.mjs [--links|--list fichier] <url…>");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  locale: "fr-FR",
  viewport: { width: 1440, height: 900 },
});
await context.addCookies(cookies());

const page = await context.newPage();

/** Les réponses JSON de l'app portent les données que le HTML ne contient pas. */
const captured = [];
page.on("response", async (response) => {
  const url = response.url();
  if (!/whop\.com|mux\.com/.test(url)) return;
  const type = response.headers()["content-type"] || "";
  if (!/json|vtt|text\/plain/.test(type)) return;
  try {
    const body = await response.text();
    if (body.length > 200) captured.push({ url, type, body: body.slice(0, 200000) });
  } catch {
    // Réponse déjà consommée ou binaire : sans importance pour la collecte.
  }
});

/** Attend que le rendu se stabilise plutôt que de parier sur un délai fixe. */
async function settle() {
  try {
    await page.waitForLoadState("networkidle", { timeout: 30000 });
  } catch {
    // Whop garde des websockets ouvertes : l'inactivité totale n'arrive jamais.
  }
  await page.waitForTimeout(4000);
}

async function grab(url) {
  captured.length = 0;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle();

  const text = await page.evaluate(() => document.body.innerText);
  const title = await page.title();
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((a) => a.href)
  );
  return { title, text, links, captured: [...captured] };
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

if (args[0] === "--links") {
  const { title, links } = await grab(args[1]);
  const lessons = [...new Set(links.filter((link) => /\/lessons\/lesn_/.test(link)))];
  console.log(`${title}\n${lessons.length} leçons trouvées :\n`);
  lessons.forEach((link) => console.log(link));
  writeFileSync(path.join(OUT_DIR, "_lessons.txt"), lessons.join("\n") + "\n");
  console.log(`\n→ whop-export/_lessons.txt`);
} else {
  const urls =
    args[0] === "--list"
      ? readFileSync(args[1], "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
      : args;

  for (const url of urls) {
    try {
      const { title, text, captured: payloads } = await grab(url);
      const slug = slugify(url);
      writeFileSync(path.join(OUT_DIR, `${slug}.md`), `# ${title}\n\n<${url}>\n\n${text}\n`);
      if (payloads.length) {
        writeFileSync(path.join(OUT_DIR, `${slug}.api.json`), JSON.stringify(payloads, null, 2));
      }
      console.log(`✓ ${title} — ${text.length} caractères, ${payloads.length} réponses API`);
    } catch (error) {
      console.error(`✗ ${url} — ${error.message}`);
    }
  }
}

await browser.close();
