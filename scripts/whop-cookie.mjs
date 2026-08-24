// Extrait le cookie de session d'un « Copy as cURL » et le range dans .env.local.
//
//   node scripts/whop-cookie.mjs curl.txt
//
// Le fichier source est supprimé après extraction : il contient la session
// complète, il n'a aucune raison de traîner sur le disque.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

const source = process.argv[2] || "curl.txt";
if (!existsSync(source)) {
  console.error(`Fichier introuvable : ${source}`);
  console.error("Colle le « Copy as cURL » dans ce fichier, puis relance.");
  process.exit(1);
}

const raw = readFileSync(source, "utf8");

/**
 * Chrome, Firefox et Edge n'écrivent pas le cURL pareil : selon le navigateur et
 * le shell, le cookie arrive en -H 'cookie: …', en -H "cookie: …" ou en -b '…'.
 * On essaie les formes connues plutôt que d'imposer un navigateur.
 */
const PATTERNS = [
  /-H\s+'cookie:\s*([^']+)'/i,
  /-H\s+"cookie:\s*([^"]+)"/i,
  /-H\s+\^"cookie:\s*([^"^]+)\^"/i, // Windows cmd, qui échappe avec des ^
  /-b\s+'([^']+)'/,
  /-b\s+"([^"]+)"/,
  /"Cookie"\s*=\s*"([^"]+)"/i, // Copy as PowerShell
];

let cookie = null;
for (const pattern of PATTERNS) {
  const match = raw.match(pattern);
  if (match) {
    cookie = match[1].trim();
    break;
  }
}

if (!cookie) {
  console.error("Aucun en-tête Cookie trouvé dans ce fichier.");
  console.error("Vérifie que tu as bien copié la requête du DOCUMENT (la première");
  console.error("ligne de l'onglet Network), et pas une image ou un script.");
  process.exit(1);
}

// Une session Whop est longue et contient des noms préfixés whop-core.
const names = cookie
  .split(";")
  .map((part) => part.trim().split("=")[0])
  .filter(Boolean);

const envPath = new URL("../.env.local", import.meta.url);
let env = readFileSync(envPath, "utf8");
const line = `WHOP_COOKIE=${cookie}`;

env = /^WHOP_COOKIE=.*$/m.test(env)
  ? env.replace(/^WHOP_COOKIE=.*$/m, line)
  : `${env.replace(/\s*$/, "")}\r\n${line}\r\n`;

writeFileSync(envPath, env);
unlinkSync(source);

console.log(`✓ Cookie enregistré dans .env.local (${cookie.length} caractères, ${names.length} cookies)`);
console.log(`  Noms trouvés : ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}`);
console.log(`✓ ${source} supprimé.`);

const whopish = names.some((name) => /whop|session|auth/i.test(name));
if (!whopish) {
  console.log("\n⚠ Aucun cookie qui ressemble à une session Whop dans le lot.");
  console.log("  Tu étais peut-être déconnecté, ou ce n'était pas une requête whop.com.");
}
