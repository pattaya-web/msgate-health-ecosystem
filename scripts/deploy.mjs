/**
 * Redéploie MSGate en ligne (www.mabillmafia.com, VPS Hostinger) via l'API Coolify.
 *
 *   node scripts/deploy.mjs          lance un déploiement et attend la fin
 *   node scripts/deploy.mjs --status affiche seulement le dernier déploiement
 *
 * Le jeton d'API est lu dans ~/.msgate-coolify-token (jamais dans le dépôt).
 * Coolify reconstruit l'image depuis GitHub : pense à pousser avant.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Nom d'hôte plutôt que l'IP : le 2026-10-30 la route IPv4 vers le VPS est tombée depuis le PC, l'IPv6 passait.
const COOLIFY = "http://srv1998631.hstgr.cloud:8000/api/v1";
const APP_UUID = "mruzxrpvi1pzpeucwalktgsr";
const TOKEN_FILE = path.join(os.homedir(), ".msgate-coolify-token");

function token() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    console.error(`Jeton introuvable : ${TOKEN_FILE}`);
    process.exit(1);
  }
}

async function api(route, init = {}) {
  const res = await fetch(`${COOLIFY}/${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function lastDeployment() {
  const list = await api("deployments");
  return list.find((d) => d.application_id === APP_UUID || d.application_name?.includes("msgate")) ?? list[0] ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.argv.includes("--status")) {
    const d = await lastDeployment();
    console.log(d ? `${d.status} · ${d.commit?.slice(0, 7) ?? ""} · ${d.created_at}` : "aucun déploiement");
    return;
  }

  const started = await api(`deploy?uuid=${APP_UUID}&force=false`, { method: "POST" });
  const uuid = started.deployments?.[0]?.deployment_uuid;
  console.log(started.deployments?.[0]?.message ?? "Déploiement demandé.");
  if (!uuid) return;

  // Un build prend 2 a 4 minutes : on suit jusqu'au bout. Si Coolify repond
  // « already queued », l'uuid renvoye n'existe pas (404) : on suit alors le
  // dernier deploiement de l'application.
  const t0 = Date.now();
  let byUuid = true;
  for (;;) {
    await sleep(10_000);
    let d = null;
    if (byUuid) d = await api(`deployments/${uuid}`).catch(() => null);
    if (!d) {
      byUuid = false;
      d = await lastDeployment();
      if (!d) {
        console.log("Aucun déploiement trouvé : regarde Coolify.");
        process.exit(1);
      }
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    process.stdout.write(`\r${d.status} (${sec}s)   `);
    if (d.status === "finished") {
      console.log("\n✓ En ligne : https://www.mabillmafia.com");
      return;
    }
    if (d.status === "failed" || d.status === "cancelled-by-user") {
      console.log(`\n✗ Déploiement ${d.status}. Logs dans Coolify.`);
      process.exit(1);
    }
    if (sec > 900) {
      console.log("\nToujours en cours après 15 min : regarde Coolify.");
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
