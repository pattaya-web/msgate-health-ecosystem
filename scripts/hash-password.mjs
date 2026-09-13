#!/usr/bin/env node
/**
 * Produit le hash scrypt d'un mot de passe, pour AUTH_USERS.
 *
 *   echo -n 'mon mot de passe' | node scripts/hash-password.mjs
 *
 * Le mot de passe est lu sur l'entrée standard, jamais passé en argument (il
 * finirait dans l'historique du shell). Seul le hash est affiché.
 */
import { randomBytes, scrypt } from "node:crypto";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
if (!password) {
  console.error("Aucun mot de passe lu sur l'entrée standard.");
  process.exit(1);
}
const params = { N: 32768, r: 8, p: 1 };
const salt = randomBytes(32);
scrypt(password.normalize("NFKC"), salt, 64, { ...params, maxmem: 256 * params.N * params.r }, (error, key) => {
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  process.stdout.write(`$scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}\n`);
});
