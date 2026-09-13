import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { persistJson, readMirror } from "@/lib/storage";

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ecom-orders.json");

/** Une commande passée sur une boutique, avant encaissement. */
export type EcomOrder = {
  id: string;
  number: string;
  siteId: string;
  slug: string;
  createdAt: string;
  email: string;
  phone: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lines: Array<{ handle: string; name: string; price: number; qty: number }>;
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
  /**
   * Aucune commande n'est encaissée ici.
   *
   * Le tunnel enregistre l'intention d'achat ; le débit arrive quand la
   * passerelle est branchée. Le statut le dit explicitement plutôt que de
   * laisser croire à un paiement passé.
   */
  status: "pending_payment";
};

type Store = { orders: EcomOrder[] };

const mem = ((globalThis as typeof globalThis & {
  __msgateEcomOrders?: Store;
}).__msgateEcomOrders ??= { orders: [] });

/* Le drapeau vit avec la mémoire : une variable de module serait remise
   à zéro par le rechargement à chaud, et la lecture qui suit écraserait
   la mémoire avec un fichier en retard. */
const flags = ((globalThis as typeof globalThis & {
  __msgateEcomOrdersFlags?: { loaded: boolean };
}).__msgateEcomOrdersFlags ??= { loaded: false });

/*
 * Un raté de lecture ne vide plus la mémoire.
 *
 * `catch { … = [] }` suivi de `loaded = true` transformait un EBUSY passager
 * — courant sous Windows quand un `persist()` concurrent fait son `rename` —
 * en store vide déclaré valide, que l'écriture suivante recopiait sur le
 * disque. Seul un fichier réellement absent vaut « rien à charger ».
 */
async function load(): Promise<Store> {
  if (flags.loaded) return mem;
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Store;
    mem.orders = Array.isArray(parsed.orders) ? parsed.orders : mem.orders;
    flags.loaded = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      // Disque vide (hébergeur) : la copie Supabase, si elle existe.
      const remote = await readMirror(CACHE_FILE);
      try {
        const parsed = remote ? (JSON.parse(remote) as Store) : null;
        mem.orders = parsed && Array.isArray(parsed.orders) ? parsed.orders : [];
      } catch {
        mem.orders = [];
      }
      flags.loaded = true;
    }
  }
  return mem;
}

async function persist() {
  const payload = JSON.stringify({ orders: mem.orders }, null, 2);
  await persistJson(CACHE_FILE, payload, async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(tmp, payload);
    await rename(tmp, CACHE_FILE);
  });
}

/**
 * Numéro de commande lisible par un humain au téléphone.
 *
 * Le support en lit un à voix haute, l'acquéreur en demande un sur un litige :
 * un identifiant technique ne s'épelle pas. Le compteur repart de la commande
 * la plus haute déjà enregistrée pour la boutique.
 */
function nextNumber(orders: EcomOrder[], slug: string) {
  const prefix = slug.slice(0, 3).toUpperCase().padEnd(3, "X");
  const highest = orders
    .filter((order) => order.slug === slug)
    .reduce((max, order) => Math.max(max, Number(order.number.split("-")[1]) || 0), 1000);
  return `${prefix}-${highest + 1}`;
}

export async function listOrders(slug?: string) {
  const store = await load();
  const rows = slug ? store.orders.filter((order) => order.slug === slug) : store.orders;
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createOrder(input: Omit<EcomOrder, "id" | "number" | "createdAt" | "status">) {
  const store = await load();
  const order: EcomOrder = {
    ...input,
    id: `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    number: nextNumber(store.orders, input.slug),
    createdAt: new Date().toISOString(),
    status: "pending_payment",
  };
  store.orders.unshift(order);
  await persist();
  return order;
}
