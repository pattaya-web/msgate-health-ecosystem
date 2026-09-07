/**
 * Avatar persistant.
 *
 * Les URLs Kie expirent : garder l'adresse du portrait ne suffit pas à le
 * réutiliser dans un mois. On stocke donc l'image elle-même en base64 sur
 * disque, et on la ré-uploade avant chaque lot pour obtenir une URL fraîche.
 * C'est ce qui permet de retrouver exactement la même personne d'une génération
 * à l'autre, y compris après un redémarrage.
 */

import { mkdir, readFile, rename, writeFile, rm } from "fs/promises";
import path from "path";
import { uploadBase64 } from "@/lib/studio/kie";
import type { Casting } from "@/lib/ugc/casting";

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const FILE = path.join(CACHE_DIR, "ugc-avatars.json");

export type SavedAvatar = {
  id: string;
  name: string;
  createdAt: string;
  /** L'image complète, en data URL — la seule copie qui ne périme pas. */
  dataUrl: string;
  casting: Casting;
  /** Un avatar chargé par l'utilisateur fait foi sur le genre et l'âge. */
  uploaded: boolean;
};

type Store = { avatars: SavedAvatar[]; activeId: string | null };

/**
 * Toujours un tableau neuf : un `{ ...CONST }` partagerait la référence du
 * tableau avec la constante, et le premier `unshift` la polluerait pour tous
 * les chargements suivants — y compris après suppression du fichier.
 */
async function load(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    return {
      avatars: Array.isArray(parsed.avatars) ? [...parsed.avatars] : [],
      activeId: parsed.activeId ?? null,
    };
  } catch {
    return { avatars: [], activeId: null };
  }
}

async function persist(store: Store) {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, FILE);
}

function uid() {
  return `av-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Rapatrie une URL Kie en base64 pendant qu'elle est encore valide. */
export async function toDataUrl(url: string) {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Avatar illisible (HTTP ${res.status})`);
  const type = res.headers.get("content-type") || "image/png";
  const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return `data:${type};base64,${base64}`;
}

/** La data URL pèse plusieurs Mo : elle ne sort jamais vers le client. */
export type AvatarMeta = Omit<SavedAvatar, "dataUrl">;

export function toMeta(avatar: SavedAvatar): AvatarMeta {
  return {
    id: avatar.id,
    name: avatar.name,
    createdAt: avatar.createdAt,
    casting: avatar.casting,
    uploaded: avatar.uploaded,
  };
}

export async function listAvatars() {
  const store = await load();
  return { activeId: store.activeId, avatars: store.avatars.map(toMeta) };
}

export async function getActiveAvatar(): Promise<SavedAvatar | null> {
  const store = await load();
  if (!store.activeId) return null;
  return store.avatars.find((avatar) => avatar.id === store.activeId) || null;
}

export async function getAvatar(id: string): Promise<SavedAvatar | null> {
  const store = await load();
  return store.avatars.find((avatar) => avatar.id === id) || null;
}

export async function saveAvatar(input: {
  urlOrDataUrl: string;
  casting: Casting;
  uploaded: boolean;
  name?: string;
}): Promise<SavedAvatar> {
  const store = await load();
  const avatar: SavedAvatar = {
    id: uid(),
    name: input.name?.trim() || `Avatar ${store.avatars.length + 1}`,
    createdAt: new Date().toISOString(),
    dataUrl: await toDataUrl(input.urlOrDataUrl),
    casting: input.casting,
    uploaded: input.uploaded,
  };
  store.avatars.unshift(avatar);
  // Le dernier enregistré devient celui qu'on réutilise par défaut.
  store.activeId = avatar.id;
  await persist(store);
  return avatar;
}

export async function setActiveAvatar(id: string) {
  const store = await load();
  if (!store.avatars.some((avatar) => avatar.id === id)) return false;
  store.activeId = id;
  await persist(store);
  return true;
}

export async function renameAvatar(id: string, name: string) {
  const store = await load();
  const avatar = store.avatars.find((item) => item.id === id);
  if (!avatar) return false;
  avatar.name = name.trim() || avatar.name;
  await persist(store);
  return true;
}

export async function deleteAvatar(id: string) {
  const store = await load();
  const next = store.avatars.filter((avatar) => avatar.id !== id);
  if (next.length === store.avatars.length) return false;
  store.avatars = next;
  if (store.activeId === id) store.activeId = next[0]?.id ?? null;
  await persist(store);
  if (!next.length) await rm(FILE, { force: true });
  return true;
}

/**
 * URL fraîche pour l'avatar demandé, à passer en première référence.
 * Ré-upload à chaque appel : c'est le prix à payer pour que la même personne
 * reste disponible indéfiniment.
 */
export async function freshAvatarUrl(id?: string) {
  const avatar = id ? await getAvatar(id) : await getActiveAvatar();
  if (!avatar) return null;
  const url = await uploadBase64(avatar.dataUrl, `${avatar.id}.png`);
  return { url, avatar };
}
