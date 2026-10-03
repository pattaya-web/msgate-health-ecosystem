import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { createKieTask, getKieTask, isKieDone, isKieFailed, uploadBase64 } from "@/lib/studio/kie";
import { isStorageReady, persistJson, putFile, readMirror, readMirrorBytes } from "@/lib/storage";
import type { ShopifyProduct } from "@/lib/shopify-scraper/client";

/**
 * Rebranding du packaging d'un catalogue scrapé.
 *
 * Le produit reste exactement le même — même contenant, même étiquette, mêmes
 * inscriptions — seuls le logo et les couleurs deviennent ceux de l'utilisateur.
 * Chaque image produit passe par gpt-image-2 en image-to-image avec deux
 * références : la photo d'origine (IMAGE 1) et le logo (IMAGE 2). C'est le même
 * principe que les packagings des sites e-commerce (api/ecom-sites/packaging),
 * appliqué ici à un catalogue entier et branché sur l'export CSV.
 *
 * Les rendus sont copiés sur le disque et dans Supabase Storage : l'import
 * Shopify télécharge les images par leur URL, il lui faut une adresse publique
 * et durable, pas l'hébergement temporaire de Kie.
 */

export type RebrandModel = "nano-banana-pro" | "gpt-image-2";

export type RebrandBrand = {
  logoUrl: string;
  accent: string;
  background: string;
  brandName: string;
  resolution: "1K" | "2K";
  /**
   * Mesuré le 4 oct. 2026 sur le même pack et le même prompt : GPT Image 2
   * gardait le mot-symbole d'origine sur la boîte et changeait la police du
   * nom ; Nano Banana Pro a remplacé la marque partout en gardant chaque
   * inscription. Il est donc le défaut, GPT Image 2 reste au choix.
   */
  model?: RebrandModel;
};

export type RebrandItem = {
  handle: string;
  src: string;
  taskId: string | null;
  state: "pending" | "done" | "fail";
  /** URL publique du rendu (Supabase) ou route locale de l'outil. */
  url: string | null;
  file: string | null;
  error: string | null;
  /** Vrai tant que la copie Supabase n'a pas abouti : l'envoi est retenté à chaque passage. */
  uploadPending?: boolean;
  /** URL hébergée chez Kie faute de Supabase : publique mais valable quelques jours seulement. */
  temporary?: boolean;
  updatedAt: string;
};

export type RebrandState = {
  host: string;
  brand: RebrandBrand | null;
  items: RebrandItem[];
  updatedAt: string;
};

const ROOT = path.join(process.cwd(), ".msgate-cache", "shopify-scraper", "rebrand");
const CREATE_GAP_MS = 900;
const TRANSIENT = /rate|limit|429|timeout|busy|saturé|too many/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function hostOf(shop: string) {
  return shop.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
}

function stateFile(host: string) {
  return path.join(ROOT, `${host}.json`);
}

function imageDir(host: string) {
  return path.join(ROOT, host);
}

/** Nom de fichier stable pour une image source : le même rendu remplace le précédent. */
function fileNameFor(src: string) {
  let h = 0;
  for (const ch of src) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${h.toString(36)}.png`;
}

export function isRebrandFile(name: string) {
  return /^[a-z0-9]+\.png$/.test(name);
}

export async function getRebrand(host: string): Promise<RebrandState> {
  const empty: RebrandState = { host, brand: null, items: [], updatedAt: new Date().toISOString() };
  try {
    return JSON.parse(await readFile(stateFile(host), "utf8")) as RebrandState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return empty;
    const remote = await readMirror(stateFile(host));
    if (!remote) return empty;
    try {
      return JSON.parse(remote) as RebrandState;
    } catch {
      return empty;
    }
  }
}

async function saveRebrand(state: RebrandState) {
  state.updatedAt = new Date().toISOString();
  const payload = JSON.stringify(state, null, 2);
  await persistJson(stateFile(state.host), payload, async () => {
    await mkdir(ROOT, { recursive: true });
    await writeFile(stateFile(state.host), payload);
  });
}

/**
 * La consigne : tout garder, sauf la marque et les couleurs.
 *
 * Le modèle a tendance à « améliorer » un pack qu'on lui donne : il réécrit
 * les mentions, invente des sceaux, simplifie l'étiquette. Chaque phrase ici
 * ferme une de ces portes. Le logo est la seule marque : on interdit de
 * composer le nom en lettres, sinon le modèle arbitre entre les deux.
 */
export function rebrandPrompt(product: Pick<ShopifyProduct, "title" | "vendor">, brand: RebrandBrand) {
  /*
   * Mesuré : sans nommer la marque d'origine, le modèle garde son mot-symbole
   * (« bluum ») et pose le nouveau logo à côté, en petit. Le nom du vendeur,
   * lu dans le catalogue, lui dit quel texte est la marque à remplacer.
   */
  const original = (product.vendor || "").trim();
  return [
    "Product packaging photograph. You are given TWO reference images.",
    "IMAGE 1 is the original product photo. IMAGE 2 is the new brand logo.",
    original
      ? `The original brand is "${original}". Every occurrence of its name, wordmark or logo on IMAGE 1 — on the label, on the box, on every visible side, large or small — is the brand mark to REPLACE with the logo from IMAGE 2. None of it may remain.`
      : "The brand name or wordmark printed on IMAGE 1 (the largest text that is not the product name) is the brand mark to REPLACE with the logo from IMAGE 2, everywhere it appears. None of it may remain.",
    "Reproduce IMAGE 1 exactly: same container type and shape, same proportions, same cap or closure,",
    "same label geometry, same placement and size of every block on the label, same camera angle,",
    "same lighting, same shadows, same background and same crop.",
    "Keep EVERY OTHER printed text of IMAGE 1 exactly as it is — product name, dosage, quantity, ingredients,",
    "claims, warnings, barcodes, small print — same wording, same fonts, same positions. Do not translate,",
    "do not rephrase, do not remove and do not add any text.",
    `ONLY TWO THINGS CHANGE: the brand mark becomes the logo from IMAGE 2, and the colour scheme becomes ${brand.accent} as the main colour against ${brand.background}.`,
    "Place the logo from IMAGE 2 exactly where the original brand mark sits, at the same size and the same orientation, pixel-faithful —",
    "never redrawn, never restyled, never replaced by typed letters. It must be legible. Do not add the logo anywhere else.",
    "Recolour only the areas that carried the original brand colours; keep white, black, metallic and photographic areas as they are.",
    brand.brandName ? `NEVER typeset the brand name "${brand.brandName}" as text: the logo already carries it.` : "",
    `This is the product "${product.title}". Do not invent certification seals, award badges, medical claims or star ratings.`,
    "Photorealistic, sharp label text, no watermark, no border, no collage.",
  ]
    .filter(Boolean)
    .join(" ");
}

type Target = { handle: string; title: string; vendor: string; src: string };

/** Les images à traiter : la première de chaque produit, ou toutes. */
export function rebrandTargets(products: ShopifyProduct[], scope: "first" | "all", handles?: string[]): Target[] {
  const wanted = handles?.length ? new Set(handles) : null;
  const out: Target[] = [];
  for (const product of products) {
    if (wanted && !wanted.has(product.handle)) continue;
    const images = (product.images ?? []).filter((image) => /^https?:\/\//i.test(image.src));
    for (const image of scope === "all" ? images : images.slice(0, 1)) {
      out.push({ handle: product.handle, title: product.title, vendor: product.vendor ?? "", src: image.src });
    }
  }
  return out;
}

async function createTask(target: Target, brand: RebrandBrand) {
  const prompt = rebrandPrompt({ title: target.title, vendor: target.vendor }, brand);
  // La photo d'origine en PREMIÈRE référence : le prompt l'appelle IMAGE 1.
  const references = [target.src, brand.logoUrl];
  if (brand.model === "gpt-image-2") {
    return createKieTask("gpt-image-2-image-to-image", { prompt, input_urls: references, aspect_ratio: "1:1", resolution: brand.resolution });
  }
  return createKieTask("nano-banana-pro", { prompt, image_input: references, aspect_ratio: "1:1", resolution: brand.resolution, output_format: "png" });
}

/**
 * Lance (ou relance) les rendus. Une image déjà réussie n'est pas refaite,
 * sauf si on la demande explicitement (`force`), pour ne pas payer deux fois.
 */
export async function startRebrand(host: string, brand: RebrandBrand, targets: Target[], force = false): Promise<RebrandState> {
  const state = await getRebrand(host);
  state.brand = brand;
  const byScr = new Map(state.items.map((item) => [item.src, item]));
  for (const target of targets) {
    const existing = byScr.get(target.src);
    if (existing && !force && (existing.state === "done" || existing.state === "pending")) continue;
    const item: RebrandItem = existing ?? { handle: target.handle, src: target.src, taskId: null, state: "pending", url: null, file: null, error: null, updatedAt: "" };
    try {
      item.taskId = await createTask(target, brand);
      item.state = "pending";
      item.error = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Création impossible";
      item.taskId = null;
      item.state = "fail";
      item.error = TRANSIENT.test(message) ? "Kie saturé — relance cette image" : message;
    }
    item.updatedAt = new Date().toISOString();
    if (!existing) {
      state.items.push(item);
      byScr.set(item.src, item);
    }
    await sleep(CREATE_GAP_MS);
  }
  await saveRebrand(state);
  return state;
}

function localUrl(host: string, file: string) {
  return `/api/shopify-scraper/rebrand/file?shop=${encodeURIComponent(host)}&name=${file}`;
}

/**
 * Copie un rendu Kie chez nous et rend son URL publique (Supabase) ou locale.
 *
 * Le fichier est écrit sur le disque AVANT l'envoi distant : un rendu payé ne
 * se perd plus parce que Supabase ne répond pas (mesuré : « fetch failed »
 * sur le stable). Dans ce cas l'URL est locale et l'envoi sera retenté.
 */
async function storeResult(host: string, src: string, resultUrl: string) {
  const res = await fetch(resultUrl, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Téléchargement du rendu impossible (HTTP ${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  const file = fileNameFor(src);
  const dir = imageDir(host);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), data);
  if (isStorageReady()) {
    try {
      // Attendu, pas lancé en arrière-plan : le CSV peut référencer l'URL tout de suite.
      return { file, url: await putFile(`shopify-scraper/rebrand/${host}/${file}`, data), uploadPending: false, temporary: false };
    } catch {
      // Supabase injoignable (mesuré : le domaine du projet ne se résout plus) : on retentera.
    }
  }
  /*
   * Sans copie Supabase, une URL publique reste nécessaire : l'import Shopify
   * télécharge les images lui-même. L'hébergement d'envoi de Kie convient le
   * temps d'un import — ses fichiers vivent quelques jours, pas plus.
   */
  try {
    const url = await uploadBase64(`data:image/png;base64,${data.toString("base64")}`, `rebrand-${host}-${file}`);
    return { file, url, uploadPending: isStorageReady(), temporary: true };
  } catch {
    return { file, url: localUrl(host, file), uploadPending: isStorageReady(), temporary: false };
  }
}

/** Retente l'envoi Supabase des rendus restés en local. */
async function retryUploads(host: string, items: RebrandItem[]) {
  if (!isStorageReady()) return false;
  let changed = false;
  for (const item of items.filter((entry) => entry.state === "done" && entry.uploadPending && entry.file).slice(0, 10)) {
    try {
      const data = await readFile(path.join(imageDir(host), item.file as string));
      item.url = await putFile(`shopify-scraper/rebrand/${host}/${item.file}`, data);
      item.uploadPending = false;
      item.temporary = false;
      item.updatedAt = new Date().toISOString();
      changed = true;
    } catch {
      // Supabase toujours injoignable : on garde l'URL locale, prochain passage.
    }
  }
  return changed;
}

/** Sonde les rendus en attente et range ceux qui ont abouti. */
export async function refreshRebrand(host: string): Promise<RebrandState> {
  const state = await getRebrand(host);
  const pending = state.items.filter((item) => item.state === "pending" && item.taskId).slice(0, 40);
  let dirty = false;
  for (const item of pending) {
    try {
      const task = await getKieTask(item.taskId as string);
      if (isKieDone(task.state) && task.urls[0]) {
        const stored = await storeResult(host, item.src, task.urls[0]);
        item.file = stored.file;
        item.url = stored.url;
        item.uploadPending = stored.uploadPending;
        item.temporary = stored.temporary;
        item.state = "done";
        item.error = null;
        dirty = true;
      } else if (isKieFailed(task.state)) {
        item.state = "fail";
        item.error = task.failMsg || "Génération échouée";
        dirty = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // Une limite de cadence ou un téléchargement raté ne condamne pas la tâche : on réessaiera.
      if (!TRANSIENT.test(message) && !/Téléchargement/.test(message)) {
        item.state = "fail";
        item.error = message || "Statut illisible";
        dirty = true;
      }
    }
    if (dirty) item.updatedAt = new Date().toISOString();
    await sleep(250);
  }
  if (await retryUploads(host, state.items)) dirty = true;
  if (dirty) await saveRebrand(state);
  return state;
}

/** Les octets d'un rendu local (ou sa copie Supabase), pour la route de fichiers. */
export async function readRebrandFile(host: string, name: string): Promise<Buffer | null> {
  if (!isRebrandFile(name) || host !== hostOf(host)) return null;
  const local = path.join(imageDir(host), name);
  try {
    return await readFile(local);
  } catch {
    return readMirrorBytes(local);
  }
}

/** La table « image d'origine → image rebrandée » pour l'export CSV. */
export async function rebrandedSources(host: string): Promise<Map<string, string>> {
  // Un dernier essai d'envoi avant l'export : le CSV doit porter des URL publiques quand c'est possible.
  const state = await refreshRebrand(host);
  return new Map(state.items.filter((item) => item.state === "done" && item.url).map((item) => [item.src, item.url as string]));
}
