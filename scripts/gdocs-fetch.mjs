// Télécharge en texte les Google Docs / Drive référencés par les leçons Whop.
//
//   node scripts/gdocs-fetch.mjs [fichier-source]
//
// Les liens du cours sont en « anyone with the link », donc l'export texte passe
// sans authentification. Un doc restreint ressort en HTML de connexion : on le
// détecte et on le signale plutôt que d'écrire un fichier inutile.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "whop-export", "docs");
const source = process.argv[2] || path.join("whop-export", "_cours-complet.md");

/** Ramasse les identifiants dans le cours consolidé et dans chaque leçon. */
function collect() {
  const texts = [readFileSync(source, "utf8")];
  const dir = path.dirname(source);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    texts.push(readFileSync(path.join(dir, file), "utf8"));
  }
  const ids = new Map();
  for (const text of texts) {
    for (const m of text.matchAll(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{20,})/g)) {
      ids.set(m[1], "document");
    }
    for (const m of text.matchAll(/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]{20,})/g)) {
      ids.set(m[1], "folder");
    }
  }
  return [...ids.entries()];
}

const LOGIN = /accounts\.google\.com|Sign in|ServiceLogin|Request access/i;

async function grabDoc(id) {
  const res = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (LOGIN.test(body.slice(0, 3000))) throw new Error("accès restreint (login demandé)");
  return body;
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const entries = collect();
console.log(`${entries.length} liens Google trouvés.\n`);

let ok = 0;
for (const [id, kind] of entries) {
  if (kind === "folder") {
    console.log(`− dossier Drive ${id} : à ouvrir à la main, l'export texte ne s'applique pas`);
    continue;
  }
  try {
    const text = await grabDoc(id);
    // La première ligne non vide fait un nom de fichier plus parlant que l'id.
    const firstLine = text.split("\n").find((line) => line.trim())?.trim() || id;
    const slug = firstLine
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)
      .toLowerCase();
    writeFileSync(path.join(OUT_DIR, `${slug || id}.txt`), `# ${firstLine}\n\nhttps://docs.google.com/document/d/${id}/\n\n${text}`);
    console.log(`✓ ${firstLine} — ${text.length} caractères`);
    ok += 1;
  } catch (error) {
    console.error(`✗ ${id} — ${error.message}`);
  }
}

console.log(`\n${ok}/${entries.filter(([, k]) => k === "document").length} documents récupérés → whop-export/docs/`);
