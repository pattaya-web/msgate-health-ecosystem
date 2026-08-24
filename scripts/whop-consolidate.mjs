// Fusionne les leçons aspirées en un seul document lisible.
//
//   node scripts/whop-consolidate.mjs [dossier] > cours.md
//
// Chaque page contient la même barre latérale : on ne garde que ce qui suit la
// navigation « Précédent / Suivant », c'est-à-dire le contenu propre à la leçon.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] || "whop-export";

/** Blocs d'interface présents partout, sans valeur pour un résumé. */
const NOISE = [
  /^Bienvenue sur Whop/,
  /^Whop est l'endroit où vous venez/,
  /^Compris$/,
  /^Notes$/,
  /^Écrivez vos notes/,
  /^Contenu$/,
  /^Précédent$/,
  /^Suivant$/,
  /^Retour$/,
  /^\d+$/,
];

function lessonBody(markdown) {
  const lines = markdown.split("\n");
  // La navigation se termine par « Suivant » : tout ce qui précède est le menu.
  const start = lines.lastIndexOf("Suivant");
  const kept = (start >= 0 ? lines.slice(start + 1) : lines)
    .map((line) => line.trim())
    .filter((line) => line && !NOISE.some((pattern) => pattern.test(line)));
  return kept;
}

const files = readdirSync(dir)
  .filter((file) => file.endsWith(".md") && !file.startsWith("_"))
  .sort();

const out = ["# Marketing Mafia — AI UGC V3", "", `${files.length} leçons aspirées.`, ""];

for (const file of files) {
  const raw = readFileSync(path.join(dir, file), "utf8");
  const url = (raw.match(/^<(https[^>]+)>$/m) || [])[1] || "";
  const body = lessonBody(raw);
  if (!body.length) continue;

  // Les deux premières lignes utiles sont le chapitre puis le titre de la leçon.
  const [chapter, title, ...rest] = body;
  out.push(`## ${title || chapter}`, "", `*Chapitre : ${chapter}*  `, `<${url}>`, "");
  if (rest.length) out.push(...rest, "");
  else out.push("_Aucun texte : leçon entièrement vidéo._", "");
}

const target = path.join(dir, "_cours-complet.md");
writeFileSync(target, out.join("\n"));
console.log(`→ ${target} (${out.join("\n").length} caractères, ${files.length} leçons)`);
