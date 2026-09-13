import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fetchProducts, normalizeShopUrl, variantPrice, type ShopifyProduct } from "@/lib/shopify-scraper/client";

/**
 * SpyShop : les boutiques qu'on surveille, rangées par projet.
 *
 * Un projet, c'est la marque sur laquelle on travaille — « Aesthetic Lab » —
 * et dedans, les concurrents et les références qu'on suit. Chaque boutique
 * garde la dernière photographie de son catalogue public : au prochain
 * passage, ce qui est nouveau ressort tout seul. Un fichier JSON suffit, et
 * il se lit à l'œil nu si un jour l'interface est fermée.
 */

const FILE = path.join(process.cwd(), ".msgate-cache", "spyshop.json");
const DEFAULT_PROJECT = "Aesthetic Lab";
const LATEST_KEPT = 6;

export type SpyProduct = {
  id: number;
  title: string;
  handle: string;
  url: string;
  price: string;
  image: string | null;
  publishedAt: string | null;
};

export type SpyShop = {
  id: string;
  url: string;
  /** Nom d'affichage : le domaine, ou le vendor lu sur le catalogue. */
  name: string;
  note: string;
  addedAt: string;
  lastCheck: string | null;
  productCount: number | null;
  /** Identifiants vus au dernier passage : la base du « nouveau depuis ». */
  seenIds: number[];
  /** Nouveautés détectées au dernier passage, les plus récentes d'abord. */
  newProducts: SpyProduct[];
  /** Derniers produits publiés, pour lire la boutique d'un coup d'œil. */
  latest: SpyProduct[];
  error: string | null;
};

export type SpyProject = { id: string; name: string; createdAt: string; shops: SpyShop[] };

type Store = { projects: SpyProject[] };

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function load(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    if (Array.isArray(parsed.projects)) return parsed;
  } catch {
    // premier passage
  }
  return { projects: [] };
}

async function save(store: Store) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2));
}

/** Le projet du jour existe toujours : sans lui, la page démarre vide et sans repère. */
export async function listProjects(): Promise<SpyProject[]> {
  const store = await load();
  if (!store.projects.length) {
    store.projects.push({ id: uid(), name: DEFAULT_PROJECT, createdAt: new Date().toISOString(), shops: [] });
    await save(store);
  }
  return store.projects;
}

export async function addProject(name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("Nom du projet manquant");
  const store = await load();
  const existing = store.projects.find((project) => project.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const project: SpyProject = { id: uid(), name: clean, createdAt: new Date().toISOString(), shops: [] };
  store.projects.push(project);
  await save(store);
  return project;
}

export async function removeProject(projectId: string) {
  const store = await load();
  store.projects = store.projects.filter((project) => project.id !== projectId);
  await save(store);
}

function projectOf(store: Store, projectId: string) {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Projet introuvable");
  return project;
}

export async function addShop(projectId: string, rawUrl: string, note = "") {
  const url = normalizeShopUrl(rawUrl);
  if (!url) throw new Error("URL de boutique invalide — colle le domaine, ex. marque.com");
  const store = await load();
  const project = projectOf(store, projectId);
  const existing = project.shops.find((shop) => shop.url === url);
  if (existing) {
    if (note.trim()) existing.note = note.trim();
    await save(store);
    return existing;
  }
  const shop: SpyShop = {
    id: uid(),
    url,
    name: new URL(url).hostname.replace(/^www\./, ""),
    note: note.trim(),
    addedAt: new Date().toISOString(),
    lastCheck: null,
    productCount: null,
    seenIds: [],
    newProducts: [],
    latest: [],
    error: null,
  };
  project.shops.unshift(shop);
  await save(store);
  return shop;
}

export async function removeShop(projectId: string, shopId: string) {
  const store = await load();
  const project = projectOf(store, projectId);
  project.shops = project.shops.filter((shop) => shop.id !== shopId);
  await save(store);
}

export async function updateShop(projectId: string, shopId: string, patch: { note?: string; name?: string }) {
  const store = await load();
  const project = projectOf(store, projectId);
  const shop = project.shops.find((item) => item.id === shopId);
  if (!shop) throw new Error("Boutique introuvable");
  if (patch.note !== undefined) shop.note = patch.note.trim();
  if (patch.name?.trim()) shop.name = patch.name.trim().slice(0, 80);
  await save(store);
  return shop;
}

function toSpyProduct(shop: string, product: ShopifyProduct): SpyProduct {
  const variant = product.variants?.[0];
  const price = variant ? variantPrice(variant) : null;
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    url: `${shop}/products/${product.handle}`,
    price: price !== null && price !== undefined ? String(price) : variant?.price ?? "",
    image: product.images?.[0]?.src ?? null,
    publishedAt: product.published_at ?? null,
  };
}

/**
 * Relit le catalogue public et note ce qui a changé. Une boutique fermée ou
 * protégée garde sa dernière photographie et affiche l'erreur, sans casser
 * la liste.
 */
export async function checkShop(projectId: string, shopId: string) {
  const store = await load();
  const project = projectOf(store, projectId);
  const shop = project.shops.find((item) => item.id === shopId);
  if (!shop) throw new Error("Boutique introuvable");

  try {
    const { products } = await fetchProducts(shop.url);
    const byDate = [...products].sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")));
    const previous = new Set(shop.seenIds);
    const fresh = shop.seenIds.length ? byDate.filter((product) => !previous.has(product.id)) : [];
    shop.newProducts = fresh.slice(0, LATEST_KEPT).map((product) => toSpyProduct(shop.url, product));
    shop.latest = byDate.slice(0, LATEST_KEPT).map((product) => toSpyProduct(shop.url, product));
    shop.seenIds = products.map((product) => product.id);
    shop.productCount = products.length;
    /*
     * Le nom de marque, c'est le vendor le plus fréquent du catalogue — pas
     * le premier venu, qui peut être une app de retours ou un fournisseur.
     */
    const tally = new Map<string, number>();
    for (const product of products) {
      const vendor = product.vendor?.trim();
      if (vendor) tally.set(vendor, (tally.get(vendor) ?? 0) + 1);
    }
    const vendor = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (vendor && shop.name === new URL(shop.url).hostname.replace(/^www\./, "")) shop.name = vendor;
    shop.error = null;
  } catch (error) {
    shop.error = error instanceof Error ? error.message : "Boutique illisible";
  }
  shop.lastCheck = new Date().toISOString();
  await save(store);
  return shop;
}
