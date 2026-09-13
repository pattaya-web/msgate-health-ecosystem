import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { persistJson, readMirror } from "@/lib/storage";

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ecom-messages.json");

/**
 * Un message laissé par le formulaire de contact d'une boutique.
 *
 * Un souscripteur teste le formulaire ; un client s'en sert. Dans les deux cas
 * il doit aboutir quelque part : ici, lisible dans l'éditeur de la boutique.
 * Rien n'est envoyé par e-mail — il n'y a pas de serveur d'envoi — mais rien
 * ne se perd non plus.
 */
export type EcomMessage = {
  id: string;
  slug: string;
  createdAt: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  /** Envoyé depuis l'aperçu de l'éditeur, pas depuis le site en ligne. */
  preview: boolean;
};

type Store = { messages: EcomMessage[] };

const mem = ((globalThis as typeof globalThis & { __msgateEcomMessages?: Store }).__msgateEcomMessages ??= { messages: [] });
const flags = ((globalThis as typeof globalThis & { __msgateEcomMessagesFlags?: { loaded: boolean } }).__msgateEcomMessagesFlags ??= { loaded: false });

async function load(): Promise<Store> {
  if (flags.loaded) return mem;
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Store;
    mem.messages = Array.isArray(parsed.messages) ? parsed.messages : mem.messages;
    flags.loaded = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      // Disque vide (hébergeur) : la copie Supabase, si elle existe.
      const remote = await readMirror(CACHE_FILE);
      try {
        const parsed = remote ? (JSON.parse(remote) as Store) : null;
        mem.messages = parsed && Array.isArray(parsed.messages) ? parsed.messages : [];
      } catch {
        mem.messages = [];
      }
      flags.loaded = true;
    }
  }
  return mem;
}

async function persist() {
  const payload = JSON.stringify({ messages: mem.messages }, null, 2);
  await persistJson(CACHE_FILE, payload, async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(tmp, payload);
    await rename(tmp, CACHE_FILE);
  });
}

export async function listMessages(slug: string, includePreview = false) {
  const store = await load();
  return store.messages.filter((message) => message.slug === slug && (includePreview || !message.preview)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addMessage(input: Omit<EcomMessage, "id" | "createdAt">) {
  const store = await load();
  const message: EcomMessage = {
    ...input,
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  store.messages.unshift(message);
  // Les 500 derniers par boutique suffisent : un formulaire n'est pas une boîte mail.
  const kept: EcomMessage[] = [];
  const perSlug = new Map<string, number>();
  for (const entry of store.messages) {
    const count = perSlug.get(entry.slug) ?? 0;
    if (count >= 500) continue;
    perSlug.set(entry.slug, count + 1);
    kept.push(entry);
  }
  store.messages = kept;
  await persist();
  return message;
}

export async function removeMessage(id: string) {
  const store = await load();
  const before = store.messages.length;
  store.messages = store.messages.filter((message) => message.id !== id);
  if (store.messages.length !== before) await persist();
  return store.messages.length !== before;
}
