import { execFile } from "child_process";
import { lookup } from "dns/promises";
import { access, mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
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
  /**
   * Un rendu réussi, pris comme modèle pour les autres (IMAGE 3) : même
   * traitement des couleurs et même placement du logo d'un produit à l'autre,
   * le texte venant toujours de la photo d'origine.
   */
  styleReferenceUrl?: string;
  /**
   * « retouch » : la photo d'origine est retouchée (marque et couleurs).
   * « template » : le packaging validé (styleReferenceUrl) est reproduit tel
   * quel, seules les inscriptions propres au produit, lues sur la photo
   * d'origine, changent. Plus homogène quand toute la gamme partage le même
   * contenant.
   */
  mode?: "retouch" | "template";
};

/**
 * Le packaging validé comme gabarit : IMAGE 1 fait autorité sur tout ce qui
 * est visuel, IMAGE 2 (la photo d'origine du produit) n'apporte que ses
 * textes. Rien n'est à « deviner » sur la marque ni les couleurs, elles sont
 * déjà sur le gabarit.
 */
export function templatePrompt(product: Pick<ShopifyProduct, "title" | "vendor"> & { variantTitles?: string[] }, brand: RebrandBrand) {
  const original = (product.vendor || "").trim();
  /*
   * Mesuré sur Hexarelin : la photo dit « 5mg », le catalogue a deux variantes
   * (5mg, 10mg) ; listées toutes les deux, le modèle a imprimé « 10mg ». Le
   * dosage et toute mention chiffrée se lisent donc sur la photo, et seulement
   * là ; le nom du produit, lui, est sûr.
   */
  const title = product.title.trim();
  return [
    "Product packaging photograph. You are given THREE reference images.",
    "YOUR OUTPUT IS IMAGE 1 WITH A FEW WORDS CHANGED. Nothing else.",
    "IMAGE 1 is the APPROVED packaging of a sibling product of the same range: it is the template and the base of the output — its colours, its logo, its box, its label, its layout, its typefaces, its camera, its lighting, its background.",
    "IMAGE 2 is the ORIGINAL photo of the product to produce. It must NOT be reproduced: do not copy its colours, its brand, its box, its label design or its fonts. It is only read, like a text source, to know what the product-specific words are.",
    "IMAGE 3 is the brand logo, as it already appears on IMAGE 1.",
    "Reproduce IMAGE 1 EXACTLY: same container, same box, same proportions, same colours, same finish, same logo in the same places at the same size, same layout of every text block, same typefaces, same camera angle, same lighting, same shadows, same background, same crop.",
    `Change ONLY the product-specific texts, so that they read exactly as printed on IMAGE 2: the product name${title ? ` ("${title}")` : ""}, the dosage or quantity EXACTLY as IMAGE 2 prints it (read the number on IMAGE 2 — never take it from anywhere else, never choose another strength), and any other product-specific mention printed on IMAGE 2 — same wording, same spelling, same capitalisation as IMAGE 2, placed where the template places the corresponding text, in the template's typeface.`,
    "Everything that is not product-specific stays as on IMAGE 1: the logo, the brand colours, the generic mentions (storage, usage warnings) exactly as the template shows them.",
    "The product texts take the template's typeface, size, weight AND colour (the colour IMAGE 1 uses for the corresponding text), never the colour or font of IMAGE 2: IMAGE 2 provides the words only.",
    original ? `Never show the original brand "${original}" or any of its letters, and never show IMAGE 2's black or white packaging: the output has IMAGE 1's colours and IMAGE 1's logo. IMAGE 2 is only read for the product texts.` : "Never show IMAGE 2's packaging, brand or colours: the output has IMAGE 1's colours and logo.",
    brand.brandName ? `NEVER typeset the brand name "${brand.brandName}" as text beyond what the template already shows: the logo carries it.` : "",
    "Do not invent certification seals, award badges, medical claims or star ratings. Photorealistic, sharp label text, no watermark, no border, no collage.",
  ]
    .filter(Boolean)
    .join(" ");
}

export type RenderKind = "rebrand" | "product-only";

export type RebrandItem = {
  handle: string;
  /** Image d'origine du catalogue : la clé, avec `kind`. */
  src: string;
  /** « rebrand » : la photo d'origine rebrandée ; « product-only » : le produit seul, sans sa boîte, dérivé du rendu rebrandé. */
  kind?: RenderKind;
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

/** Nom de fichier stable pour une image source et un type de rendu : le même rendu remplace le précédent. */
function fileNameFor(src: string, kind: RenderKind = "rebrand") {
  const seed = kind === "rebrand" ? src : `${src}#${kind}`;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${h.toString(36)}.png`;
}

function kindOf(item: Pick<RebrandItem, "kind">): RenderKind {
  return item.kind ?? "rebrand";
}

function sameItem(item: RebrandItem, src: string, kind: RenderKind) {
  return item.src === src && kindOf(item) === kind;
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
export function rebrandPrompt(product: Pick<ShopifyProduct, "title" | "vendor"> & { variantTitles?: string[] }, brand: RebrandBrand) {
  /*
   * Mesuré : sans nommer la marque d'origine, le modèle garde son mot-symbole
   * (« bluum ») et pose le nouveau logo à côté, en petit. Le nom du vendeur,
   * lu dans le catalogue, lui dit quel texte est la marque à remplacer. Et
   * sans lister ce qui doit rester, il a aussi remplacé le nom du produit
   * imprimé sur la boîte (« GHK-Cu ») par un second logo : on énumère donc
   * les textes à garder, et on fixe le nombre de logos.
   */
  const original = (product.vendor || "").trim();
  const originalWords = [...new Set(original.split(/\s+/).filter((word) => word.length > 2))];
  const keep = [product.title, ...(product.variantTitles ?? [])].map((text) => text.trim()).filter((text) => text && text.toLowerCase() !== "default title");
  const hasStyle = Boolean(brand.styleReferenceUrl);
  return [
    `Product packaging photograph. You are given ${hasStyle ? "THREE" : "TWO"} reference images.`,
    "IMAGE 1 is the original product photo. IMAGE 2 is the new brand logo.",
    hasStyle ? "IMAGE 3 is the finished pack of a sibling product already rebranded: match its colour treatment, its finish and its logo placement exactly, so the whole range looks consistent. But IMAGE 3 is only a style guide: every text, shape and layout detail comes from IMAGE 1." : "",
    original
      ? `The original brand is "${original}"${originalWords.length > 1 ? ` (wordmark "${originalWords[0]}")` : ""}. ONLY this brand name / wordmark / logo is replaced: wherever it appears on IMAGE 1 — the large wordmark on the label, the large wordmark on the box, any small brand mention — put the logo from IMAGE 2 in its place, same size, same orientation, one logo per original wordmark, never more. No letter of the original brand may remain.`
      : "The brand name or wordmark printed on IMAGE 1 (the largest text that is not the product name) is the only thing to REPLACE with the logo from IMAGE 2, wherever it appears, one logo per original wordmark.",
    keep.length
      ? `These texts are NOT the brand and, wherever IMAGE 1 shows them, MUST stay exactly where and as they are, on every surface (label AND box sides): ${keep.map((text) => `"${text}"`).join(", ")}. Never replace them with the logo, never move them, never retype them in another font. Only what IMAGE 1 actually shows: never add a dosage, a strength or any text that IMAGE 1 does not print, never change a number.`
      : "",
    "Reproduce IMAGE 1 exactly: same container type and shape, same proportions, same cap or closure,",
    "same label geometry, same placement and size of every block on the label, same camera angle,",
    "same lighting, same shadows, same background and same crop.",
    "Treat IMAGE 1 as a photograph to EDIT, not a scene to re-imagine: the output must look like the very same photo in which only the brand mark and the colours were retouched.",
    "Keep EVERY OTHER printed text of IMAGE 1 exactly as it is — product name, dosage, quantity, ingredients,",
    "claims, warnings, barcodes, small print — same wording, same fonts, same positions. Do not translate,",
    "do not rephrase, do not remove and do not add any text.",
    `ONLY TWO THINGS CHANGE: the brand mark becomes the logo from IMAGE 2, and the packaging colours become these, exactly: every surface that carried the original brand colour — the box faces and the label background — becomes ${brand.background}; the printed text and the logo on those surfaces become ${brand.accent}. Use these two colours and no other new colour; do not darken, do not lighten, do not pick a different hue.`,
    "Place the logo from IMAGE 2 exactly where the original brand mark sits, at the same size and the same orientation, pixel-faithful —",
    "the COMPLETE logo of IMAGE 2, symbol and lettering together, with its own typeface and spacing, never redrawn, never restyled, never retyped in another font. It must be legible. Do not add the logo anywhere else, do not duplicate it.",
    "Same objects, same count: if IMAGE 1 shows one vial and one box, the output shows that same vial and that same box, same proportions, same geometry, same text on each face of the box.",
    "Recolour only the areas that carried the original brand colours; keep white, black, metallic and photographic areas as they are.",
    brand.brandName ? `NEVER typeset the brand name "${brand.brandName}" as text: the logo already carries it.` : "",
    `This is the product "${product.title}". Do not invent certification seals, award badges, medical claims or star ratings.`,
    "Photorealistic, sharp label text, no watermark, no border, no collage.",
  ]
    .filter(Boolean)
    .join(" ");
}

type Target = { handle: string; title: string; vendor: string; src: string; kind?: RenderKind; /** Rendu rebrandé (URL publique) qui sert de référence au produit seul. */ reference?: string; /** Titres des variantes (« 50mg ») : des textes imprimés à garder. */ variantTitles?: string[] };

function variantTitlesOf(product: ShopifyProduct) {
  return [...new Set((product.variants ?? []).map((variant) => (variant.title || "").trim()).filter(Boolean))].slice(0, 8);
}

/**
 * Le produit seul, sans sa boîte, dérivé du rendu rebrandé.
 *
 * On part du rendu et non de la photo d'origine : la marque et les couleurs
 * sont déjà les bonnes, il ne reste qu'à retirer l'emballage extérieur. Tout
 * ce qui est imprimé sur le produit lui-même reste tel quel.
 */
export function productOnlyPrompt(product: Pick<ShopifyProduct, "title">, brand: RebrandBrand) {
  return [
    "Product photograph. You are given TWO reference images.",
    "IMAGE 1 is the finished packshot of the product with its outer box or carton. IMAGE 2 is the brand logo.",
    "Produce the SAME photograph with the outer box, carton, sleeve or any secondary packaging REMOVED: only the product itself remains",
    "(the vial, bottle, jar, tube, pouch or device exactly as it appears in IMAGE 1), centred, same camera angle, same lighting, same shadows,",
    "same background and same crop. Do not move the camera, do not change the scale, do not add props.",
    "The product keeps its label EXACTLY as in IMAGE 1: identical brand mark (the logo of IMAGE 2, pixel-faithful), identical colours,",
    "identical text — product name, dosage, quantity, warnings, small print — same wording, same fonts, same positions. Nothing added, nothing removed, nothing rephrased.",
    brand.brandName ? `NEVER typeset the brand name "${brand.brandName}" as text: the logo already carries it.` : "",
    `This is the product "${product.title}". Do not invent certification seals, award badges, medical claims or star ratings.`,
    "Photorealistic, sharp label text, no watermark, no border, no collage, one single product in frame.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Les images à traiter : la première de chaque produit, ou toutes. */
export function rebrandTargets(products: ShopifyProduct[], scope: "first" | "all", handles?: string[]): Target[] {
  const wanted = handles?.length ? new Set(handles) : null;
  const out: Target[] = [];
  for (const product of products) {
    if (wanted && !wanted.has(product.handle)) continue;
    const images = (product.images ?? []).filter((image) => /^https?:\/\//i.test(image.src));
    for (const image of scope === "all" ? images : images.slice(0, 1)) {
      out.push({ handle: product.handle, title: product.title, vendor: product.vendor ?? "", src: image.src, variantTitles: variantTitlesOf(product) });
    }
  }
  return out;
}

async function createTask(target: Target, brand: RebrandBrand) {
  const productOnly = target.kind === "product-only";
  if (productOnly && !target.reference) throw new Error("Rendu rebrandé manquant pour ce produit");
  const template = !productOnly && brand.mode === "template" && brand.styleReferenceUrl;
  const prompt = productOnly
    ? productOnlyPrompt({ title: target.title }, brand)
    : template
      ? templatePrompt({ title: target.title, vendor: target.vendor, variantTitles: target.variantTitles }, brand)
      : rebrandPrompt({ title: target.title, vendor: target.vendor, variantTitles: target.variantTitles }, brand);
  /*
   * L'ordre des références est celui du prompt. Retouche : l'original (IMAGE 1),
   * le logo, le modèle de style éventuel. Gabarit : le packaging validé
   * (IMAGE 1), l'original pour ses textes (IMAGE 2), le logo (IMAGE 3). Produit
   * seul : le rendu rebrandé, le logo.
   */
  const references = productOnly
    ? [target.reference as string, brand.logoUrl]
    : template
      ? [brand.styleReferenceUrl as string, target.src, brand.logoUrl]
      : [target.src, brand.logoUrl, ...(brand.styleReferenceUrl ? [brand.styleReferenceUrl] : [])];
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
  for (const target of targets) {
    const kind = target.kind ?? "rebrand";
    const existing = state.items.find((item) => sameItem(item, target.src, kind));
    // Une image en cours n'est jamais relancée ; une image prête ne l'est que sur demande (« Refaire »).
    if (existing && (existing.state === "pending" || (existing.state === "done" && !force))) continue;
    const item: RebrandItem = existing ?? { handle: target.handle, src: target.src, kind, taskId: null, state: "pending", url: null, file: null, error: null, updatedAt: "" };
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
    if (!existing) state.items.push(item);
    await sleep(CREATE_GAP_MS);
  }
  await saveRebrand(state);
  return state;
}

/**
 * Les cibles « produit seul » : un rendu rebrandé prêt par produit (sa première
 * image) sert de référence. Un rendu qui n'a qu'une adresse locale est d'abord
 * déposé chez Kie, dont les modèles ne lisent que des URL publiques.
 */
export async function productOnlyTargets(host: string, products: ShopifyProduct[], handles?: string[]): Promise<{ targets: Target[]; missing: string[] }> {
  const state = await getRebrand(host);
  const wanted = handles?.length ? new Set(handles) : null;
  const targets: Target[] = [];
  const missing: string[] = [];
  for (const product of products) {
    if (wanted && !wanted.has(product.handle)) continue;
    const first = (product.images ?? []).find((image) => /^https?:\/\//i.test(image.src));
    const render = first ? state.items.find((item) => sameItem(item, first.src, "rebrand") && item.state === "done" && item.file) : null;
    if (!first || !render) {
      missing.push(product.handle);
      continue;
    }
    let reference = render.url && /^https:\/\//i.test(render.url) ? render.url : null;
    if (!reference) {
      const data = await readRebrandFile(host, render.file as string);
      if (!data) {
        missing.push(product.handle);
        continue;
      }
      reference = await uploadBase64(`data:image/png;base64,${data.toString("base64")}`, `rebrand-ref-${host}-${render.file}`);
    }
    targets.push({ handle: product.handle, title: product.title, vendor: product.vendor ?? "", src: first.src, kind: "product-only", reference });
  }
  return { targets, missing };
}

/*
 * Supabase injoignable : chaque tentative coûte dix secondes de résolution DNS
 * avant d'échouer. Après un échec, on n'essaie plus pendant dix minutes, sinon
 * chaque sonde de la page attend ce délai pour rien.
 */
const storageBackoff = ((globalThis as typeof globalThis & { __msgateRebrandStorageBackoff?: { until: number } }).__msgateRebrandStorageBackoff ??= { until: 0 });
const STORAGE_BACKOFF_MS = 10 * 60 * 1000;

function storageUsable() {
  return isStorageReady() && Date.now() >= storageBackoff.until;
}

/**
 * Le domaine Supabase se résout-il ? Mesuré : un `putFile` vers un projet
 * disparu met jusqu'à deux minutes à échouer, le temps que le client épuise ses
 * essais. Une résolution DNS bornée à trois secondes répond à la même question.
 */
async function storageReachable() {
  const host = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!host) return false;
  try {
    await Promise.race([lookup(host), new Promise((_, reject) => setTimeout(() => reject(new Error("DNS timeout")), 3_000))]);
    return true;
  } catch {
    return false;
  }
}

async function tryPutFile(remote: string, data: Buffer): Promise<string | null> {
  if (!storageUsable()) return null;
  if (!(await storageReachable())) {
    storageBackoff.until = Date.now() + STORAGE_BACKOFF_MS;
    return null;
  }
  try {
    const url = await putFile(remote, data);
    storageBackoff.until = 0;
    return url;
  } catch {
    storageBackoff.until = Date.now() + STORAGE_BACKOFF_MS;
    return null;
  }
}

/**
 * Le rendu servi par l'outil lui-même, depuis son disque : c'est ce que la
 * page affiche, l'URL publique ne sert qu'au CSV. `version` change à chaque
 * rendu : un rendu refait garde le même nom de fichier, et sans ça le
 * navigateur montrait l'ancien (mesuré : GHK-Cu refait, aperçu inchangé).
 */
export function localUrl(host: string, file: string, version?: string) {
  const v = version ? `&v=${encodeURIComponent(version.replace(/[^0-9a-z]/gi, "").slice(-10))}` : "";
  return `/api/shopify-scraper/rebrand/file?shop=${encodeURIComponent(host)}&name=${file}${v}`;
}

/**
 * Copie un rendu Kie chez nous et rend son URL publique (Supabase) ou locale.
 *
 * Le fichier est écrit sur le disque AVANT l'envoi distant : un rendu payé ne
 * se perd plus parce que Supabase ne répond pas (mesuré : « fetch failed »
 * sur le stable). Dans ce cas l'URL est locale et l'envoi sera retenté.
 */
async function storeResult(host: string, src: string, resultUrl: string, kind: RenderKind = "rebrand") {
  const res = await fetch(resultUrl, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Téléchargement du rendu impossible (HTTP ${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  const file = fileNameFor(src, kind);
  const dir = imageDir(host);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), data);
  /*
   * Rien de plus ici : copier chaque rendu vers Supabase ou Kie dans la sonde
   * la faisait durer plusieurs minutes pour cinquante images, et la page
   * restait sur ses spinners alors que tout était fini. L'adresse publique
   * est obtenue ensuite, quelques rendus par passage, et avant tout export.
   */
  return { file, url: localUrl(host, file), uploadPending: true, temporary: false };
}

/**
 * Donne une adresse publique aux rendus qui n'en ont pas encore, quelques-uns
 * par passage : Supabase quand il répond, sinon l'hébergement d'envoi de Kie
 * (public, valable quelques jours). Un rendu déjà chez Kie retente Supabase
 * plus tard, pour une adresse durable.
 */
async function ensurePublicUrls(host: string, items: RebrandItem[], max = 3, budgetMs = 8_000) {
  const started = Date.now();
  let changed = 0;
  for (const item of items) {
    if (changed >= max || Date.now() - started > budgetMs) break;
    if (item.state !== "done" || !item.file || !item.uploadPending) continue;
    const isPublic = /^https:\/\//i.test(item.url ?? "");
    let data: Buffer;
    try {
      data = await readFile(path.join(imageDir(host), item.file));
    } catch {
      continue;
    }
    const remote = await tryPutFile(`shopify-scraper/rebrand/${host}/${item.file}`, data);
    if (remote) {
      item.url = remote;
      item.uploadPending = false;
      item.temporary = false;
      item.updatedAt = new Date().toISOString();
      changed += 1;
      continue;
    }
    if (isPublic) continue; // déjà chez Kie, Supabase attendra
    try {
      item.url = await uploadBase64(`data:image/png;base64,${data.toString("base64")}`, `rebrand-${host}-${item.file}`);
      item.temporary = true;
      item.uploadPending = isStorageReady();
      item.updatedAt = new Date().toISOString();
      changed += 1;
    } catch {
      // Kie refuse l'envoi : on garde l'adresse locale, prochain passage
    }
  }
  return changed > 0;
}

/**
 * Sonde les rendus en attente et range ceux qui ont abouti.
 *
 * Bornée : quatre tâches interrogées à la fois, et on s'arrête au budget.
 * Une sonde qui durait des minutes bloquait la page sur ses spinners ; le
 * reste sera vu au passage suivant, quelques secondes plus tard.
 */
export async function refreshRebrand(host: string, budgetMs = 12_000): Promise<RebrandState> {
  const state = await getRebrand(host);
  const started = Date.now();
  const pending = state.items.filter((item) => item.state === "pending" && item.taskId);
  let dirty = false;
  const settle = async (item: RebrandItem) => {
    try {
      const task = await getKieTask(item.taskId as string);
      if (isKieDone(task.state) && task.urls[0]) {
        const stored = await storeResult(host, item.src, task.urls[0], kindOf(item));
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
      } else {
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // Une limite de cadence ou un téléchargement raté ne condamne pas la tâche : on réessaiera.
      if (TRANSIENT.test(message) || /Téléchargement/.test(message)) return;
      item.state = "fail";
      item.error = message || "Statut illisible";
      dirty = true;
    }
    item.updatedAt = new Date().toISOString();
  };
  for (let i = 0; i < pending.length; i += 4) {
    if (Date.now() - started > budgetMs) break;
    await Promise.all(pending.slice(i, i + 4).map(settle));
    await sleep(200);
  }
  // Un seul envoi par passage : la page sonde toutes les quatre secondes, l'export CSV finit le travail.
  if (await ensurePublicUrls(host, state.items, 1, 6_000)) dirty = true;
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

const runFfmpeg = promisify(execFile);
const THUMB_WIDTHS = new Set([96, 160, 320]);

/**
 * Miniature d'un rendu, fabriquée une fois par ffmpeg et gardée à côté.
 *
 * Un rendu pèse plus d'un mégaoctet : en afficher cinquante dans le tableau
 * laissait des cases blanches le temps du chargement. Une largeur hors liste
 * rend l'original.
 */
export async function readRebrandThumb(host: string, name: string, width: number): Promise<Buffer | null> {
  if (!THUMB_WIDTHS.has(width) || !isRebrandFile(name) || !ffmpegPath) return readRebrandFile(host, name);
  const source = path.join(imageDir(host), name);
  const thumb = path.join(imageDir(host), `${name.replace(/\.png$/, "")}.w${width}.jpg`);
  try {
    // Une miniature plus ancienne que le rendu est celle d'un rendu refait : on la refabrique.
    const [thumbStat, sourceStat] = await Promise.all([stat(thumb), stat(source)]);
    if (thumbStat.mtimeMs >= sourceStat.mtimeMs) return await readFile(thumb);
  } catch {
    // pas encore fabriquée, ou rendu absent du disque
  }
  try {
    await access(source);
  } catch {
    const remote = await readMirrorBytes(source);
    if (!remote) return null;
    await mkdir(imageDir(host), { recursive: true });
    await writeFile(source, remote);
  }
  try {
    await runFfmpeg(ffmpegPath, ["-y", "-loglevel", "error", "-i", source, "-vf", `scale=${width}:-1`, "-q:v", "4", thumb], { timeout: 30_000 });
    return await readFile(thumb);
  } catch (error) {
    const detail = error as { code?: unknown; signal?: unknown; stderr?: unknown; message?: string };
    console.error("[rebrand] miniature impossible :", { code: detail.code, signal: detail.signal, stderr: String(detail.stderr ?? "").slice(0, 300), message: detail.message?.slice(0, 120) });
    return readRebrandFile(host, name);
  }
}

/** L'adresse publique d'un rendu prêt (Supabase, sinon Kie), pour le passer en référence à un modèle. */
export async function publicUrlOfRender(host: string, src: string): Promise<string | null> {
  const state = await getRebrand(host);
  const item = state.items.find((entry) => sameItem(entry, src, "rebrand") && entry.state === "done" && entry.file);
  if (!item) return null;
  if (item.url && /^https:\/\//i.test(item.url)) return item.url;
  const data = await readRebrandFile(host, item.file as string);
  if (!data) return null;
  const url = await uploadBase64(`data:image/png;base64,${data.toString("base64")}`, `rebrand-style-${host}-${item.file}`);
  item.url = url;
  item.temporary = true;
  await saveRebrand(state);
  return url;
}

/** La table « image d'origine → image rebrandée » pour l'export CSV. */
export async function rebrandedSources(host: string): Promise<Map<string, string>> {
  // Avant l'export, tous les rendus prêts reçoivent une adresse publique : le CSV ne peut pas porter d'adresse locale.
  const state = await refreshRebrand(host, 20_000);
  if (await ensurePublicUrls(host, state.items, state.items.length, 240_000)) await saveRebrand(state);
  return new Map(state.items.filter((item) => kindOf(item) === "rebrand" && item.state === "done" && item.url).map((item) => [item.src, item.url as string]));
}

/** Les photos « produit seul » prêtes, par produit : elles s'ajoutent au CSV comme image supplémentaire. */
export async function productOnlyImages(host: string): Promise<Map<string, string[]>> {
  const state = await getRebrand(host);
  const out = new Map<string, string[]>();
  for (const item of state.items) {
    if (kindOf(item) !== "product-only" || item.state !== "done" || !item.url) continue;
    out.set(item.handle, [...(out.get(item.handle) ?? []), item.url]);
  }
  return out;
}
