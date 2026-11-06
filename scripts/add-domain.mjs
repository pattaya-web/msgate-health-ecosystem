/**
 * Branche un nom de domaine acheté (Namecheap…) sur une boutique ou une page agence.
 *
 *   node scripts/add-domain.mjs marque.com          ajoute marque.com et www.marque.com, puis redéploie
 *   node scripts/add-domain.mjs marque.com --dry    montre seulement les domaines actuels et ceux qui seraient ajoutés
 *
 * Avant : chez le registrar, A @ et A www → 185.97.146.171 ; dans l'outil, le champ
 * « Domaine » de la boutique = marque.com. Coolify sert alors le domaine (Traefik),
 * et le HTTPS Let's Encrypt se fait tout seul une fois le DNS propagé.
 *
 * Le jeton d'API est lu dans ~/.msgate-coolify-token (jamais dans le dépôt).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const COOLIFY = "http://srv1998631.hstgr.cloud:8000/api/v1";
const APP_UUID = "mruzxrpvi1pzpeucwalktgsr";
const TOKEN_FILE = path.join(os.homedir(), ".msgate-coolify-token");

const token = () => fs.readFileSync(TOKEN_FILE, "utf8").trim();

async function api(route, init = {}) {
  const res = await fetch(`${COOLIFY}/${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function main() {
  const raw = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!raw) {
    console.error("Usage : node scripts/add-domain.mjs marque.com [--dry]");
    process.exit(1);
  }
  const domain = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error(`Domaine illisible : ${raw}`);

  const app = await api(`applications/${APP_UUID}`);
  const current = String(app.fqdn ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const wanted = [`https://${domain}`, `https://www.${domain}`];
  const missing = wanted.filter((value) => !current.includes(value));
  console.log("Domaines actuels :", current.join(", ") || "(aucun)");
  if (!missing.length) {
    console.log(`${domain} est déjà déclaré.`);
    return;
  }
  console.log("À ajouter :", missing.join(", "));
  if (dry) return;

  await api(`applications/${APP_UUID}`, { method: "PATCH", body: JSON.stringify({ domains: [...current, ...missing].join(",") }) });
  console.log("Déclarés dans Coolify. Redéploiement pour que le proxy les prenne…");
  const deploy = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "deploy.mjs")], { stdio: "inherit" });
  if (deploy.status !== 0) console.log("Le redéploiement a échoué : relance « node scripts/deploy.mjs ».");
  console.log(`Ensuite : https://www.${domain} (le HTTPS arrive quelques minutes après la propagation DNS).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
