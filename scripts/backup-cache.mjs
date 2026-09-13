/**
 * Monte `.msgate-cache/` dans Supabase Storage.
 *
 * Tout le travail produit par l'outil vit aujourd'hui sur un seul disque, sans
 * copie. Ce script en fait un miroir distant : il n'efface rien en local et se
 * relance sans risque, un fichier déjà présent étant simplement réécrit.
 *
 *   node scripts/backup-cache.mjs           envoie ce qui manque
 *   node scripts/backup-cache.mjs --force   réenvoie tout
 *
 * Le dossier `tmp` est ignoré : c'est de l'échafaudage ffmpeg, pas du travail.
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.join(process.cwd(), ".msgate-cache");
const BUCKET = "creatives";
const SKIP = new Set(["tmp"]);
const FORCE = process.argv.includes("--force");

const env = {};
for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Clés Supabase manquantes dans .env.local");
  process.exit(1);
}

const store = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(BUCKET);

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  json: "application/json",
};

const typeOf = (file) =>
  TYPES[file.split(".").pop()?.toLowerCase()] || "application/octet-stream";

/** Liste récursive, en chemins relatifs à la racine du cache. */
async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, rel)));
    else out.push(rel);
  }
  return out;
}

/**
 * Ce qui est déjà là-haut, pour ne pas renvoyer 600 Mo à chaque exécution.
 * La liste est faite dossier par dossier : Supabase ne pagine pas à plat.
 */
async function remoteIndex() {
  const seen = new Set();
  const queue = [""];
  while (queue.length) {
    const folder = queue.shift();
    const { data, error } = await store.list(folder, { limit: 1000 });
    if (error || !data) continue;
    for (const entry of data) {
      const rel = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.id === null) queue.push(rel);
      else seen.add(rel);
    }
  }
  return seen;
}

const files = await walk(ROOT);
const already = FORCE ? new Set() : await remoteIndex();
const todo = files.filter((file) => !already.has(file));

let bytes = 0;
for (const file of todo) bytes += (await stat(path.join(ROOT, file))).size;

console.log(`${files.length} fichiers en local, ${already.size} déjà en ligne.`);
console.log(`À envoyer : ${todo.length} (${(bytes / 1024 / 1024).toFixed(0)} Mo)\n`);
if (!todo.length) {
  console.log("Rien à faire — la sauvegarde est à jour.");
  process.exit(0);
}

let done = 0;
let sent = 0;
const failed = [];

for (const file of todo) {
  const body = await readFile(path.join(ROOT, file));
  const { error } = await store.upload(file, body, {
    contentType: typeOf(file),
    upsert: true,
  });

  done += 1;
  if (error) {
    failed.push(`${file} — ${error.message}`);
  } else {
    sent += body.length;
  }

  if (done % 10 === 0 || done === todo.length) {
    const pct = Math.round((done / todo.length) * 100);
    console.log(
      `  ${String(pct).padStart(3)}%  ${done}/${todo.length}  ${(sent / 1024 / 1024).toFixed(0)} Mo envoyés`
    );
  }
}

console.log(`\nTerminé : ${todo.length - failed.length} envoyés, ${failed.length} en échec.`);
for (const line of failed.slice(0, 10)) console.log(`  ✕ ${line}`);
if (failed.length > 10) console.log(`  … et ${failed.length - 10} autres`);
