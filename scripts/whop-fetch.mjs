// Récupère une page Whop directement depuis cette machine, avec la session de
// .env.local. Pas de service tiers : les cookies ne vont qu'à whop.com.
//
//   node scripts/whop-fetch.mjs <url> [fichier-de-sortie]
//
// Whop rend ses pages côté serveur (TanStack Start), donc le document contient
// souvent déjà les données de la route — sans exécuter le moindre JavaScript.
import { readFileSync, writeFileSync } from "node:fs";

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
const url = process.argv[2];
const out = process.argv[3] || "lesson.html";
if (!url) {
  console.error("Usage : node scripts/whop-fetch.mjs <url> [sortie.html]");
  process.exit(1);
}

/** Les en-têtes d'un vrai Chrome : Whop varie sa réponse selon le client. */
const res = await fetch(url, {
  headers: {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "fr,en-US;q=0.9,en;q=0.8",
    cookie: env.WHOP_COOKIE || "",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "upgrade-insecure-requests": "1",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  },
});

const body = await res.text();
writeFileSync(out, body);
console.log(`HTTP ${res.status} — ${body.length} caractères → ${out}`);
