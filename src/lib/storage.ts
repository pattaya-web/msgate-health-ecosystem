import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Stockage des fichiers produits par l'outil.
 *
 * Tout vivait jusqu'ici dans `.msgate-cache/`, un dossier local. Ça marche tant
 * qu'on reste sur une machine, mais un hébergeur comme Vercel démarre chaque
 * requête avec un disque vide : une créative écrite là-bas disparaît avant
 * d'avoir été relue. Supabase Storage tient le rôle du disque, en persistant.
 *
 * Le module reste optionnel : sans clés, `isStorageReady()` répond false et les
 * appelants continuent d'écrire en local. C'est ce qui permet de migrer un
 * module à la fois plutôt que de tout basculer d'un coup.
 */

const BUCKET = "creatives";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
/** La clé service est la seule qui écrit : elle ne quitte jamais le serveur. */
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

let client: SupabaseClient | null = null;

export function isStorageReady() {
  return Boolean(url && serviceKey);
}

function storage() {
  if (!url || !serviceKey) throw new Error("Supabase Storage non configuré");
  client ??= createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.storage.from(BUCKET);
}

const TYPES: Record<string, string> = {
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

function typeOf(path: string) {
  return TYPES[path.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";
}

/**
 * Dépose un fichier et rend son URL publique.
 *
 * `upsert` est actif : rejouer une migration ou regénérer une créa écrase la
 * version précédente au lieu d'échouer, ce qui rend l'opération rejouable sans
 * précaution particulière.
 */
export async function putFile(path: string, data: Buffer | Uint8Array): Promise<string> {
  const { error } = await storage().upload(path, data, {
    contentType: typeOf(path),
    upsert: true,
  });
  if (error) throw new Error(`Envoi ${path} impossible — ${error.message}`);
  return publicUrl(path);
}

export function publicUrl(path: string) {
  if (!url) throw new Error("Supabase Storage non configuré");
  return `${url}/storage/v1/object/public/${BUCKET}/${path}`;
}

export async function fileExists(path: string) {
  const slash = path.lastIndexOf("/");
  const folder = slash > 0 ? path.slice(0, slash) : "";
  const name = slash > 0 ? path.slice(slash + 1) : path;
  const { data, error } = await storage().list(folder, { search: name, limit: 1 });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === name);
}

export async function removeFolder(prefix: string) {
  const { data } = await storage().list(prefix, { limit: 1000 });
  const paths = (data ?? []).map((entry) => `${prefix}/${entry.name}`);
  if (paths.length) await storage().remove(paths);
}

/**
 * Copie un fichier vers Supabase sans jamais gêner l'écriture locale.
 *
 * Le disque reste la source : c'est lui que l'application relit. Ce miroir ne
 * fait que doubler chaque écriture, pour que le travail existe ailleurs que sur
 * une seule machine. Trois conséquences voulues :
 *
 * - il ne bloque pas l'appelant, qui n'a aucune raison d'attendre un réseau ;
 * - il n'échoue jamais bruyamment, une coupure Supabase ne devant pas empêcher
 *   d'enregistrer une créative ;
 * - il ne fait rien si les clés manquent, ce qui laisse l'outil fonctionner
 *   exactement comme avant sur une machine non configurée.
 */
export function mirror(cachePath: string, data: Buffer | Uint8Array) {
  if (!isStorageReady()) return;

  const remote = remotePath(cachePath);
  if (!remote || remote.startsWith("tmp/")) return;

  void putFile(remote, data).catch(() => {
    // Le fichier est déjà sur le disque : la copie distante retentera au prochain
    // enregistrement, ou au prochain passage du script de sauvegarde.
  });
}

/** Le chemin distant d'un fichier du cache local : ce qui suit `.msgate-cache/`. */
function remotePath(cachePath: string) {
  return cachePath
    .replace(/\\/g, "/")
    .replace(/^.*\.msgate-cache\//, "")
    .replace(/^\/+/, "");
}

/**
 * La copie distante d'un fichier du cache, quand le disque ne l'a pas.
 *
 * Sur Vercel chaque instance démarre sans `.msgate-cache/` : les boutiques,
 * les commandes, les messages n'existeraient que sur la machine qui les a
 * écrits. Ici on relit la copie Supabase, déposée par `mirror` à chaque
 * enregistrement. Null si rien n'est configuré ou si la copie n'existe pas.
 */
export async function readMirror(cachePath: string): Promise<string | null> {
  if (!isStorageReady()) return null;
  const remote = remotePath(cachePath);
  if (!remote) return null;
  try {
    const { data, error } = await storage().download(remote);
    if (error || !data) return null;
    return await data.text();
  } catch {
    return null;
  }
}

/** Écrit sur le disque si on le peut, et dans Supabase dans tous les cas : un hébergeur au disque en lecture seule ne perd rien. */
export async function persistJson(cachePath: string, payload: string, writeLocal: () => Promise<void>) {
  try {
    await writeLocal();
  } catch (error) {
    // Disque en lecture seule (Vercel) : la copie distante fait foi.
    if (!isStorageReady()) throw error;
  }
  mirror(cachePath, Buffer.from(payload));
}
