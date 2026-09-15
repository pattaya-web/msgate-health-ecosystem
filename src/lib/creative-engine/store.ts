import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { persistBytes, persistJson, readMirror, readMirrorBytes } from "@/lib/storage";
import { saveFile as saveDriveFile } from "@/lib/drive/store";
import { CREATIVE_TYPES } from "@/lib/studio/creative-types";
import { saveStaticCreative } from "@/lib/studio/library";
import { createKieTask, getKieTask, isKieDone, isKieFailed, uploadBase64 } from "@/lib/studio/kie";
import type { Ratio } from "@/lib/studio/ratios";
import { analyzeProductUrl, classify, inferGender } from "@/lib/creative-engine/analysis";
import { creativeName } from "@/lib/creative-engine/naming";
import { buildPromptBatch, type PromptBatchSpec } from "@/lib/creative-engine/prompt-batch";
import type { ProductReferenceType } from "@/lib/creative-engine/types";
import { planBatch, presetsFrom, type Plan } from "@/lib/creative-engine/planner";
import { composeCreativePrompt } from "@/lib/creative-engine/prompt";
import {
  FAMILY_MIX,
  isDigitalClass,
  type BatchItem,
  type CreativeEmphasis,
  type CreativeStatus,
  type FamilyMixSetting,
  type ProductContext,
  type ReferenceStrength,
  type TestBatch,
} from "@/lib/creative-engine/types";

/**
 * Persistance du moteur : deux fichiers JSON (produits, lots) et un dossier
 * par lot pour les images rapatriées. Le disque fait foi ; Supabase reçoit
 * une copie quand il est configuré. Les lots écrits avant l'arrivée des
 * familles et de l'emphase restent lisibles : les champs manquants ont des
 * valeurs par défaut à la lecture.
 */

const ROOT = path.join(process.cwd(), ".msgate-cache", "creative-engine");
const PRODUCTS = path.join(ROOT, "products.json");
const BATCHES = path.join(ROOT, "batches.json");
const MODEL_IMAGE_TO_IMAGE = "gpt-image-2-image-to-image";
const MODEL_TEXT_TO_IMAGE = "gpt-image-2-text-to-image";
const MAX_REFS = 8;
const CREATE_GAP_MS = 700;

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function shortName(name: string) {
  return name.split(/\s+[|–—]\s+/)[0].trim().slice(0, 60) || name.slice(0, 60);
}

/*
 * Lecture : le fichier local d'abord, sinon sa copie Supabase.
 *
 * Sur Vercel le disque est vide à chaque instance : produits et lots
 * n'existaient donc qu'ici, en local. Un fichier absent (et seulement absent :
 * un fichier illisible garde le repli d'avant) est relu depuis le miroir,
 * déposé par `writeJson` à chaque enregistrement. Le format ne change pas.
 */
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return fallback;
    const remote = await readMirror(file);
    if (!remote) return fallback;
    try {
      return JSON.parse(remote) as T;
    } catch {
      return fallback;
    }
  }
}

/** Écriture locale quand le disque le permet, copie Supabase dans tous les cas. */
async function writeJson(file: string, data: unknown) {
  const payload = JSON.stringify(data, null, 2);
  await persistJson(file, payload, async () => {
    await mkdir(ROOT, { recursive: true });
    await writeFile(file, payload);
  });
}

/* ------------------------------------------------------------------ */
/* Produits                                                             */
/* ------------------------------------------------------------------ */

/** Un produit analysé avant l'arrivée des classes reçoit la sienne à la lecture, sans relire la page. */
function normalizeProduct(input: ProductContext): ProductContext {
  if (!input.analysis) return input;
  /* Un produit analysé sans public (IA absente) reçoit le sien d'après ses
     bénéfices : une page « barbe, barbier » ne met pas de femmes en sujet. */
  const gender = input.analysis.gender || inferGender(`${input.name} ${input.analysis.benefits.join(" ")} ${input.analysis.transformation} ${input.analysis.mainProblem}`);
  const product: ProductContext & { analysis: NonNullable<ProductContext["analysis"]> } = { ...input, analysis: { ...input.analysis, gender } };
  if (product.analysis.productClass) return product;
  const guess = classify(
    {
      handle: "",
      name: product.name,
      description: product.analysis.transformation || product.analysis.benefits.join(". "),
      price: product.analysis.price,
      comparePrice: product.analysis.comparePrice,
      brand: product.analysis.brand,
      keyPoints: product.analysis.benefits,
      imageUrls: product.imageUrls,
      kind: "other",
    },
    `${product.name} ${product.analysis.benefits.join(" ")} ${product.analysis.transformation}`
  );
  return { ...product, analysis: { ...product.analysis, productClass: guess.productClass, recommendedEmphasis: guess.emphasis } };
}

/** Un produit digital n'a pas de stock : l'accroche « Sold out, back in stock » d'une vieille analyse est remplacée à la lecture. */
function withoutStockHooks(product: ProductContext): ProductContext {
  if (!isDigitalClass(product.analysis?.productClass)) return product;
  const fix = (hook: string) => (/sold out|back in stock|restock/i.test(hook) ? `Thousands started this month. Your turn: ${shortName(product.name)}.` : hook);
  return {
    ...product,
    suggestedAngles: product.suggestedAngles.map((angle) => ({ ...angle, hooks: angle.hooks.map(fix) })),
  };
}

export async function listProducts(): Promise<ProductContext[]> {
  const store = await readJson<{ items: ProductContext[] }>(PRODUCTS, { items: [] });
  return store.items.map((item) => withoutStockHooks(normalizeProduct(item)));
}

async function saveProducts(items: ProductContext[]) {
  await writeJson(PRODUCTS, { items });
}

/** Lit la page et (ré)écrit le contexte produit : source de vérité des lots. */
export async function analyzeAndSaveProduct(url: string, store?: string) {
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) throw new Error("Colle l'URL complète de la page produit");
  const result = await analyzeProductUrl(clean);
  const items = await listProducts();
  const existing = items.find((item) => item.url === clean);
  if (result.engine === "fallback" && existing) {
    throw new Error(`Analyse IA indisponible (${result.fallbackReason ?? "moteurs muets"}) : l'analyse précédente de « ${existing.name} » est conservée.`);
  }
  const host = new URL(clean).hostname.replace(/^www\./, "");
  const now = new Date().toISOString();
  const context: ProductContext = {
    id: existing?.id ?? uid("prod"),
    store: (store?.trim() || existing?.store || result.analysis.brand || host).slice(0, 80),
    // Un titre de page « Produit | Boutique | Slogan » se coupe au premier séparateur.
    name: shortName(result.sheet?.name || existing?.name || host),
    url: clean,
    imageUrls: (result.sheet?.imageUrls ?? []).filter((item) => /^https:\/\//i.test(item)).slice(0, MAX_REFS),
    analysis: result.analysis,
    suggestedAngles: result.angles,
    customAngles: existing?.customAngles ?? [],
    engine: result.engine,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing ? items.map((item) => (item.id === context.id ? context : item)) : [context, ...items];
  await saveProducts(next);
  return { product: context, fallbackReason: result.fallbackReason };
}

export async function updateProduct(id: string, patch: { store?: string; name?: string; addAngle?: { name: string; why?: string; hooks?: string[] }; removeAngleId?: string }) {
  const items = await listProducts();
  const product = items.find((item) => item.id === id);
  if (!product) throw new Error("Produit introuvable");
  if (patch.store?.trim()) product.store = patch.store.trim().slice(0, 80);
  if (patch.name?.trim()) product.name = patch.name.trim().slice(0, 120);
  if (patch.addAngle?.name?.trim()) {
    product.customAngles.push({
      id: uid("angle"),
      name: patch.addAngle.name.trim().slice(0, 60),
      why: patch.addAngle.why?.trim() || `The argument is ${patch.addAngle.name.trim()}.`,
      hooks: (patch.addAngle.hooks ?? []).map((hook) => hook.trim()).filter(Boolean).slice(0, 3),
      source: "custom",
    });
  }
  if (patch.removeAngleId) {
    product.customAngles = product.customAngles.filter((angle) => angle.id !== patch.removeAngleId);
    product.suggestedAngles = product.suggestedAngles.filter((angle) => angle.id !== patch.removeAngleId);
  }
  product.updatedAt = new Date().toISOString();
  await saveProducts(items);
  return product;
}

/**
 * Pose (ou remplace) la référence visuelle d'un type pour un produit. La
 * référence principale entre aussi dans les photos produit, pour que les lots
 * planifiés du Mass test la voient comme les autres.
 */
export async function setProductReference(id: string, input: { type: ProductReferenceType; url: string; source?: "page" | "upload" }) {
  const url = input.url.trim();
  if (!/^https:\/\//i.test(url)) throw new Error("La référence doit être une URL https");
  const items = await listProducts();
  const product = items.find((item) => item.id === id);
  if (!product) throw new Error("Produit introuvable");
  const references = (product.references ?? []).filter((reference) => reference.type !== input.type);
  references.unshift({ id: uid("ref"), type: input.type, url, source: input.source ?? "page", selectedAt: new Date().toISOString() });
  product.references = references;
  if (input.type === "primary" && !product.imageUrls.includes(url)) product.imageUrls = [url, ...product.imageUrls].slice(0, MAX_REFS);
  product.updatedAt = new Date().toISOString();
  await saveProducts(items);
  return product;
}

export async function clearProductReference(id: string, type: ProductReferenceType) {
  const items = await listProducts();
  const product = items.find((item) => item.id === id);
  if (!product) throw new Error("Produit introuvable");
  product.references = (product.references ?? []).filter((reference) => reference.type !== type);
  product.updatedAt = new Date().toISOString();
  await saveProducts(items);
  return product;
}

export async function deleteProduct(id: string) {
  const items = await listProducts();
  await saveProducts(items.filter((item) => item.id !== id));
}

/* ------------------------------------------------------------------ */
/* Lots                                                                 */
/* ------------------------------------------------------------------ */

/** Un lot d'avant les familles reçoit des valeurs par défaut, sans migration de fichier. */
function normalizeBatch(batch: TestBatch): TestBatch {
  const emphasis: CreativeEmphasis = batch.emphasis ?? "balanced";
  return {
    ...batch,
    emphasis,
    physicalMockup: batch.physicalMockup ?? true,
    familyMix: batch.familyMix ?? { mode: "auto" },
    plan: batch.plan ?? { total: batch.items.length, families: [], groups: { transformation: 0, feature: 0, social: 0, product: 0 }, angles: [], layouts: 0, subjects: 0, hooks: 0, adjustments: [] },
    items: batch.items.map((item) => ({
      ...item,
      familyId: item.familyId ?? "PRODUCT_HERO",
      familyLabel: item.familyLabel ?? "Produit héros",
      emphasis: item.emphasis ?? emphasis,
      hook: item.hook ?? "",
      layout: item.layout ?? "",
      subject: item.subject ?? null,
      productVisibility: item.productVisibility ?? "medium",
      physicalProductAllowed: item.physicalProductAllowed ?? true,
      referenceStrategy: item.referenceStrategy ?? "none",
      singleCreativeOnly: item.singleCreativeOnly ?? true,
      visualConcept: item.visualConcept ?? "",
    })),
  };
}

export async function listBatches(): Promise<TestBatch[]> {
  const store = await readJson<{ items: TestBatch[] }>(BATCHES, { items: [] });
  return store.items.map(normalizeBatch);
}

async function saveBatches(items: TestBatch[]) {
  await writeJson(BATCHES, { items });
}

export function batchDir(id: string) {
  return path.join(ROOT, "batches", id);
}

export type GenerateSpec = {
  productId: string;
  angleIds: string[];
  presetIds: string[];
  variationsPerAngle: number;
  ratio: Ratio;
  resolution: "1K" | "2K";
  referenceDataUrls: string[];
  referenceStrength: ReferenceStrength;
  instructions: string;
  emphasis?: CreativeEmphasis;
  physicalMockup?: boolean;
  familyMix?: FamilyMixSetting;
  seed?: number;
};

async function planFor(spec: GenerateSpec, hasReference: boolean): Promise<{ product: ProductContext; plan: Plan; emphasis: CreativeEmphasis; physicalMockup: boolean; familyMix: FamilyMixSetting; presets: ReturnType<typeof presetsFrom> }> {
  const product = (await listProducts()).find((item) => item.id === spec.productId);
  if (!product) throw new Error("Produit introuvable — analyse d'abord son URL");
  const angles = [...product.suggestedAngles, ...product.customAngles].filter((angle) => spec.angleIds.includes(angle.id));
  if (!angles.length) throw new Error("Choisis au moins un angle");
  const presets = presetsFrom(spec.presetIds);
  if (!presets.length) throw new Error("Choisis au moins un style");
  const variations = Math.min(10, Math.max(1, Math.round(spec.variationsPerAngle || 1)));
  const emphasis = spec.emphasis ?? product.analysis?.recommendedEmphasis ?? "balanced";
  const physicalMockup = spec.physicalMockup ?? false;
  const familyMix: FamilyMixSetting = spec.familyMix ?? { mode: "auto" };
  const plan = planBatch({
    product,
    angles,
    presets,
    variations,
    emphasis,
    physicalMockup,
    familyMix,
    referenceStrength: spec.referenceStrength,
    hasReference,
    seed: spec.seed ?? Date.now() % 1_000_000,
  });
  return { product, plan, emphasis, physicalMockup, familyMix, presets };
}

/** Le plan seul, sans image ni crédit : pour relire la diversité avant de lancer. */
export async function previewPlan(spec: GenerateSpec) {
  const { plan, emphasis } = await planFor(spec, spec.referenceDataUrls.length > 0);
  return { ...plan.summary, specs: plan.specs, emphasis, mixDefaults: FAMILY_MIX[emphasis] };
}

function modelFor(inputs: string[]) {
  return inputs.length ? MODEL_IMAGE_TO_IMAGE : MODEL_TEXT_TO_IMAGE;
}

async function launch(item: BatchItem, batch: TestBatch) {
  const inputs = [...batch.referenceUrls, ...batch.productImageUrls].slice(0, MAX_REFS);
  try {
    item.taskId = inputs.length
      ? await createKieTask(MODEL_IMAGE_TO_IMAGE, { prompt: item.prompt, input_urls: inputs, aspect_ratio: batch.ratio, resolution: batch.resolution })
      : await createKieTask(MODEL_TEXT_TO_IMAGE, { prompt: item.prompt, aspect_ratio: batch.ratio, resolution: batch.resolution });
    item.state = "pending";
    item.error = null;
    item.urls = [];
    item.file = null;
    item.generatedAt = null;
  } catch (error) {
    item.state = "fail";
    item.error = error instanceof Error ? error.message : "Création refusée";
  }
}

/**
 * Construit et lance un lot : le plan de diversité décide de la famille, de
 * la mise en page, du sujet et de l'accroche de chaque créa ; le prompt en
 * découle. Le lot est écrit AVANT les créations, pour qu'une coupure ne perde
 * ni le plan ni les prompts.
 */
export async function createTestBatch(spec: GenerateSpec) {
  const referenceUrls: string[] = [];
  for (const [index, dataUrl] of spec.referenceDataUrls.slice(0, 3).entries()) {
    try {
      referenceUrls.push(await uploadBase64(dataUrl, `reference-${Date.now()}-${index}.png`));
    } catch {
      // une référence qui ne monte pas ne bloque pas le lot
    }
  }
  const { product, plan, emphasis, physicalMockup, familyMix, presets } = await planFor(spec, referenceUrls.length > 0);

  const batches = await listBatches();
  const number = batches.reduce((max, batch) => Math.max(max, batch.number), 0) + 1;
  const batch: TestBatch = {
    id: uid("batch"),
    number,
    store: product.store,
    productId: product.id,
    productName: product.name,
    productUrl: product.url,
    createdAt: new Date().toISOString(),
    ratio: spec.ratio,
    resolution: spec.resolution,
    emphasis,
    physicalMockup,
    familyMix,
    referenceStrength: spec.referenceStrength,
    referenceUrls,
    productImageUrls: product.imageUrls,
    instructions: spec.instructions.trim(),
    angles: [...product.suggestedAngles, ...product.customAngles].filter((angle) => spec.angleIds.includes(angle.id)),
    presets: presets.map((preset) => preset.id),
    variationsPerAngle: Math.min(10, Math.max(1, Math.round(spec.variationsPerAngle || 1))),
    plan: plan.summary,
    items: [],
  };
  const inputs = [...referenceUrls, ...product.imageUrls].slice(0, MAX_REFS);

  for (const creative of plan.specs) {
    const preset = presets.find((item) => item.id === creative.presetId) ?? presets[0];
    batch.items.push({
      ...creative,
      id: uid("crea"),
      name: creativeName(product.store, product.name, creative.angleName, creative.familyLabel, creative.variation),
      prompt: composeCreativePrompt({
        context: product,
        spec: creative,
        preset,
        hasReference: referenceUrls.length > 0,
        referenceStrength: spec.referenceStrength,
        instructions: spec.instructions,
        ratio: spec.ratio,
      }),
      taskId: null,
      state: "pending",
      error: null,
      urls: [],
      file: null,
      status: "generated",
      model: modelFor(inputs),
      referenceUsed: referenceUrls.length > 0,
      generatedAt: null,
      parentId: null,
    });
  }
  batches.unshift(batch);
  await saveBatches(batches);

  for (const [index, item] of batch.items.entries()) {
    if (index) await new Promise((resolve) => setTimeout(resolve, CREATE_GAP_MS));
    await launch(item, batch);
    await saveBatches(batches);
  }
  return batch;
}

/**
 * Lance un lot à partir de prompts déjà écrits (Ask Hermes). Même chemin que
 * createTestBatch après le plan : lot écrit avant les créations, une tâche Kie
 * par prompt avec le même écart, refreshBatch / retryFailed inchangés. Le
 * modèle image-to-image n'est choisi que si une référence explicite ou, sur
 * demande, les photos produit du CRM sont fournies.
 */
export async function createPromptBatch(spec: Omit<PromptBatchSpec, "referenceUrls" | "productImageUrls"> & { referenceDataUrls: string[]; useProductImages: boolean; /** Références déjà hébergées (https), ex. la référence principale d'un produit. */ hostedReferenceUrls?: string[] }) {
  const products = await listProducts();
  const product = spec.productId ? products.find((entry) => entry.id === spec.productId) ?? null : null;
  const referenceUrls: string[] = (spec.hostedReferenceUrls ?? []).filter((url) => /^https:\/\//i.test(url)).slice(0, 3);
  for (const [index, dataUrl] of spec.referenceDataUrls.slice(0, 3).entries()) {
    try {
      referenceUrls.push(await uploadBase64(dataUrl, `hermes-reference-${Date.now()}-${index}.png`));
    } catch {
      // une référence qui ne monte pas ne bloque pas le lot
    }
  }
  const batches = await listBatches();
  const number = batches.reduce((max, batch) => Math.max(max, batch.number), 0) + 1;
  const batch = buildPromptBatch({
    spec: { ...spec, referenceUrls, productImageUrls: spec.useProductImages && product ? product.imageUrls.slice(0, MAX_REFS) : [] },
    product,
    number,
    ids: { batch: uid("batch"), items: spec.prompts.map(() => uid("crea")) },
  });
  batches.unshift(batch);
  await saveBatches(batches);

  for (const [index, item] of batch.items.entries()) {
    if (index) await new Promise((resolve) => setTimeout(resolve, CREATE_GAP_MS));
    await launch(item, batch);
    await saveBatches(batches);
  }
  return batch;
}

/** Relance uniquement les créas en échec d'un lot, avec les mêmes références. */
export async function retryFailed(batchId: string) {
  const batches = await listBatches();
  const batch = batches.find((item) => item.id === batchId);
  if (!batch) throw new Error("Lot introuvable");
  let relaunched = 0;
  for (const item of batch.items.filter((entry) => entry.state === "fail")) {
    if (relaunched) await new Promise((resolve) => setTimeout(resolve, CREATE_GAP_MS));
    await launch(item, batch);
    if (item.state === "pending") relaunched += 1;
  }
  await saveBatches(batches);
  return { batch, relaunched };
}

/** Régénère une créa, avec son prompt ou un prompt retouché. */
export async function regenerateItem(batchId: string, itemId: string, prompt?: string) {
  const batches = await listBatches();
  const batch = batches.find((item) => item.id === batchId);
  const item = batch?.items.find((entry) => entry.id === itemId);
  if (!batch || !item) throw new Error("Créa introuvable");
  if (prompt?.trim()) item.prompt = prompt.trim();
  item.status = "generated";
  await launch(item, batch);
  await saveBatches(batches);
  return item;
}

/**
 * Duplique une créa : même fiche, même prompt, nouvelle génération. La copie
 * garde un lien vers l'original — c'est la base des « variations depuis un
 * winner » à venir.
 */
export async function duplicateItem(batchId: string, itemId: string) {
  const batches = await listBatches();
  const batch = batches.find((item) => item.id === batchId);
  const source = batch?.items.find((entry) => entry.id === itemId);
  if (!batch || !source) throw new Error("Créa introuvable");
  const siblings = batch.items.filter((entry) => entry.angleId === source.angleId).length;
  const copy: BatchItem = {
    ...source,
    id: uid("crea"),
    variation: siblings + 1,
    name: creativeName(batch.store, batch.productName, source.angleName, source.familyLabel, siblings + 1),
    taskId: null,
    state: "pending",
    error: null,
    urls: [],
    file: null,
    status: "generated",
    generatedAt: null,
    parentId: source.id,
  };
  const at = batch.items.findIndex((entry) => entry.id === itemId);
  batch.items.splice(at + 1, 0, copy);
  await launch(copy, batch);
  await saveBatches(batches);
  return copy;
}

/**
 * Suit les rendus en attente et rapatrie chaque image terminée. Les URL Kie
 * expirent : l'image est copiée sur disque dès qu'elle existe.
 */
const refreshQueue = ((globalThis as typeof globalThis & { __msgateRefreshQueue?: { chain: Promise<unknown> } }).__msgateRefreshQueue ??= { chain: Promise.resolve() });

/** Un rafraîchissement à la fois : le fichier des lots est réécrit en entier, deux sondes croisées se perdraient des résultats. */
export function refreshBatch(batchId: string) {
  const run = refreshQueue.chain.then(() => refreshBatchNow(batchId));
  refreshQueue.chain = run.catch(() => undefined);
  return run;
}

async function refreshBatchNow(batchId: string) {
  const batches = await listBatches();
  const batch = batches.find((item) => item.id === batchId);
  if (!batch) throw new Error("Lot introuvable");
  const pending = batch.items.filter((item) => item.state === "pending" && item.taskId);
  for (const item of pending) {
    try {
      const task = await getKieTask(item.taskId as string);
      if (isKieDone(task.state) && task.urls[0]) {
        item.urls = task.urls;
        item.state = "done";
        item.generatedAt = new Date().toISOString();
        try {
          const res = await fetch(task.urls[0], { cache: "no-store" });
          if (res.ok) {
            const data = Buffer.from(await res.arrayBuffer());
            const dir = batchDir(batch.id);
            const file = `${item.id}.png`;
            // Disque local si possible, copie Supabase dans tous les cas : sur un hébergeur, seule la copie reste.
            await persistBytes(path.join(dir, file), data, async () => {
              await mkdir(dir, { recursive: true });
              await writeFile(path.join(dir, file), data);
            });
            item.file = file;
            // Les rendus de l'espace produit et d'Ask Hermes vivent aussi dans Creatives : la bibliothèque du studio les reçoit, une fois.
            if ((batch.source === "product-workspace" || batch.source === "ask-hermes") && !item.libraryId) {
              try {
                const saved = await saveStaticCreative({
                  brief: item.userPrompt || batch.instructions || batch.productName,
                  prompt: item.prompt,
                  ratio: batch.ratio,
                  resolution: batch.resolution,
                  resultUrls: [`data:image/png;base64,${data.toString("base64")}`],
                  referenceUrls: batch.primaryReferenceUrl ? [batch.primaryReferenceUrl] : [],
                  media: "image",
                  origin: batch.source,
                  productName: batch.productName,
                });
                item.libraryId = saved.id;
              } catch {
                // la bibliothèque n'est qu'une copie : le rendu reste dans le lot
              }
            }
          }
        } catch {
          // l'URL Kie reste utilisable un moment ; le prochain passage réessaiera
        }
      } else if (isKieFailed(task.state)) {
        item.state = "fail";
        item.error = task.failMsg || "Génération échouée";
      }
    } catch {
      // limite de cadence ou réseau : on réessaiera au prochain passage
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await saveBatches(batches);
  return batch;
}

export async function setItemStatus(batchId: string, itemId: string, status: CreativeStatus) {
  const batches = await listBatches();
  const batch = batches.find((item) => item.id === batchId);
  const item = batch?.items.find((entry) => entry.id === itemId);
  if (!batch || !item) throw new Error("Créa introuvable");
  item.status = status;
  await saveBatches(batches);
  return item;
}

export async function deleteBatch(batchId: string) {
  const batches = await listBatches();
  await saveBatches(batches.filter((item) => item.id !== batchId));
  await rm(batchDir(batchId), { recursive: true, force: true });
}

/**
 * Copie des créas d'un lot dans un dossier du Drive : tout le lot, ou une
 * sélection. Les fichiers sont déjà sur le disque, la copie est immédiate ;
 * chaque créa garde son nom propre, et un petit .json garde son angle, sa
 * famille, son statut et son prompt.
 */
export async function exportToDrive(batchId: string, folder: string, itemIds: string[] | null) {
  const batch = (await listBatches()).find((item) => item.id === batchId);
  if (!batch) throw new Error("Lot introuvable");
  const wanted = itemIds ? new Set(itemIds) : null;
  let sent = 0;
  let skipped = 0;
  for (const item of batch.items) {
    if (wanted && !wanted.has(item.id)) continue;
    if (item.state !== "done" || !item.file) {
      skipped += 1;
      continue;
    }
    const data = await readFile(path.join(batchDir(batch.id), item.file));
    await saveDriveFile(folder, `${item.name}.png`, data);
    const meta = {
      source: "mass-test",
      batch: batch.number,
      store: batch.store,
      product: batch.productName,
      angle: item.angleName,
      family: item.familyLabel,
      preset: item.presetName,
      emphasis: item.emphasis,
      variation: item.variation,
      hook: item.hook,
      status: item.status,
      generatedAt: item.generatedAt,
      prompt: item.prompt,
    };
    await saveDriveFile(folder, `${item.name}.json`, Buffer.from(JSON.stringify(meta, null, 2)));
    sent += 1;
  }
  return { sent, skipped };
}

export async function readBatchFile(batchId: string, file: string) {
  if (!/^[\w.-]+$/.test(file) || !/^[\w-]+$/.test(batchId)) throw new Error("Chemin refusé");
  const local = path.join(batchDir(batchId), file);
  try {
    return await readFile(local);
  } catch (error) {
    // Image absente du disque (hébergeur) : sa copie Supabase, déposée à la génération.
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    const remote = await readMirrorBytes(local);
    if (!remote) throw error;
    return remote;
  }
}

export { CREATIVE_TYPES };
