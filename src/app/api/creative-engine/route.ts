import { NextResponse } from "next/server";
import type { Ratio } from "@/lib/studio/ratios";
import {
  analyzeAndSaveProduct,
  createTestBatch,
  deleteBatch,
  deleteProduct,
  duplicateItem,
  exportToDrive,
  listBatches,
  listProducts,
  previewPlan,
  refreshBatch,
  regenerateItem,
  retryFailed,
  setItemStatus,
  updateProduct,
  setProductReference,
  clearProductReference,
  type GenerateSpec,
} from "@/lib/creative-engine/store";
import { extractProductImages } from "@/lib/creative-engine/product-images";
import { planWorkspaceBatch, VisionUnavailableError } from "@/lib/creative-engine/workspace-writer";
import { uploadBase64 } from "@/lib/studio/kie";
import type { CompetitorInspiration } from "@/lib/brandsearch/types";
import type { ProductReferenceType } from "@/lib/creative-engine/types";
import type { CreativeEmphasis, CreativeStatus, FamilyMixSetting, ReferenceStrength } from "@/lib/creative-engine/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Ce qui entre du navigateur est borné : douze pubs, huit motifs, chaînes courtes. */
function sanitizeCompetitorInspiration(raw: CompetitorInspiration | null | undefined): CompetitorInspiration | null {
  if (!raw || typeof raw !== "object" || typeof raw.domain !== "string" || !Array.isArray(raw.creatives)) return null;
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const list = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().slice(0, 120)).filter(Boolean).slice(0, max) : []);
  const creatives = raw.creatives.slice(0, 12).map((creative) => ({
    id: str(creative?.id, 80),
    archetype: str(creative?.archetype, 120),
    angle: str(creative?.angle, 200),
    hookMechanism: str(creative?.hookMechanism, 300),
    layout: str(creative?.layout, 400),
    elements: list(creative?.elements, 16),
    proof: str(creative?.proof, 300),
    competitorFacts: list(creative?.competitorFacts, 20),
    headline: typeof creative?.headline === "string" ? creative.headline.trim().slice(0, 200) : null,
  })).filter((creative) => creative.id);
  if (!creatives.length) return null;
  const patterns = (Array.isArray(raw.patterns) ? raw.patterns : []).slice(0, 8).map((pattern) => ({ name: str(pattern?.name, 120), description: str(pattern?.description, 600), mechanism: str(pattern?.mechanism, 400), adIds: list(pattern?.adIds, 30) })).filter((pattern) => pattern.name);
  return { domain: str(raw.domain, 255).toLowerCase(), patterns, creatives };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    switch (params.get("action")) {
      case "products":
        return NextResponse.json({ products: await listProducts() });
      case "batches":
        return NextResponse.json({ batches: await listBatches() });
      default:
        return NextResponse.json({ products: await listProducts(), batches: await listBatches() });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lecture impossible" }, { status: 500 });
  }
}

type Body = {
  action?:
    | "analyze"
    | "product-update"
    | "product-delete"
    | "plan"
    | "generate"
    | "refresh"
    | "retry"
    | "status"
    | "item-regenerate"
    | "item-duplicate"
    | "drive-export"
    | "batch-delete"
    | "product-images"
    | "product-reference"
    | "product-reference-clear"
    | "workspace-plan";
  referenceType?: ProductReferenceType;
  referenceUrl?: string;
  brief?: string;
  count?: number;
  hasReference?: boolean;
  avoid?: string[];
  /** Prompt libre : la fiche lue, quand il n'y a pas de produit du moteur. */
  product?: { name?: string; store?: string; url?: string; price?: string } | null;
  /** Créa d'inspiration jointe au brief (data URL image) : hébergée puis vue par Hermes dans la requête de planification. */
  referenceDataUrl?: string | null;
  /** Vrai pour planifier depuis le texte seul quand Hermes ne peut pas voir l'image (choix de l'opérateur). */
  ignoreReference?: boolean;
  /** Pubs concurrentes sélectionnées et analysées (galerie Brand Search du prompt libre). */
  competitorInspiration?: CompetitorInspiration | null;
  url?: string;
  store?: string;
  productId?: string;
  name?: string;
  addAngle?: { name: string; why?: string; hooks?: string[] };
  removeAngleId?: string;
  angleIds?: string[];
  presetIds?: string[];
  variationsPerAngle?: number;
  ratio?: Ratio;
  resolution?: "1K" | "2K";
  referenceDataUrls?: string[];
  referenceStrength?: ReferenceStrength;
  instructions?: string;
  emphasis?: CreativeEmphasis;
  physicalMockup?: boolean;
  familyMix?: FamilyMixSetting;
  seed?: number;
  batchId?: string;
  itemId?: string;
  status?: CreativeStatus;
  prompt?: string;
  /** drive-export : dossier de destination et créas visées (toutes si absent). */
  folder?: string;
  itemIds?: string[];
};

function specFrom(body: Body): GenerateSpec {
  if (!body.productId) throw new Error("Produit manquant");
  return {
    productId: body.productId,
    angleIds: body.angleIds ?? [],
    presetIds: body.presetIds ?? [],
    variationsPerAngle: body.variationsPerAngle ?? 3,
    ratio: body.ratio ?? "3:4",
    resolution: body.resolution ?? "1K",
    referenceDataUrls: body.referenceDataUrls ?? [],
    referenceStrength: body.referenceStrength ?? "medium",
    instructions: body.instructions ?? "",
    emphasis: body.emphasis,
    physicalMockup: body.physicalMockup,
    familyMix: body.familyMix,
    seed: body.seed,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "analyze":
        if (!body.url) return NextResponse.json({ error: "URL manquante" }, { status: 400 });
        return NextResponse.json(await analyzeAndSaveProduct(body.url, body.store));
      case "product-update":
        if (!body.productId) return NextResponse.json({ error: "Produit manquant" }, { status: 400 });
        return NextResponse.json({ product: await updateProduct(body.productId, { store: body.store, name: body.name, addAngle: body.addAngle, removeAngleId: body.removeAngleId }) });
      case "product-images": {
        const products = await listProducts();
        const product = body.productId ? products.find((item) => item.id === body.productId) : null;
        const url = product?.url ?? body.url;
        if (!url) return NextResponse.json({ error: "Produit ou URL manquant" }, { status: 400 });
        return NextResponse.json({ images: await extractProductImages(url, product?.imageUrls ?? []) });
      }
      case "workspace-plan": {
        const stored = body.productId ? (await listProducts()).find((item) => item.id === body.productId) : null;
        if (body.productId && !stored) return NextResponse.json({ error: "Produit introuvable" }, { status: 400 });
        const sheet = body.product?.name?.trim() ? { name: body.product.name.trim().slice(0, 200), store: body.product.store?.trim().slice(0, 100), url: body.product.url?.trim().slice(0, 500), price: body.product.price?.trim().slice(0, 40) } : null;
        const product = stored ?? sheet;
        if (!body.brief?.trim()) return NextResponse.json({ error: "Brief manquant" }, { status: 400 });
        const referenceDataUrl = typeof body.referenceDataUrl === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(body.referenceDataUrl) && body.referenceDataUrl.length <= 5_500_000 ? body.referenceDataUrl : null;
        // Hermes lit une image par URL https (jamais en data URL) : l'inspiration est hébergée puis jointe à la requête de planification elle-même.
        let referenceImageUrl: string | null = null;
        if (referenceDataUrl && !body.ignoreReference) {
          try {
            referenceImageUrl = await uploadBase64(referenceDataUrl, `inspiration-${Date.now().toString(36)}.png`);
          } catch (error) {
            return NextResponse.json({ error: `Hébergement de l'image d'inspiration impossible : ${error instanceof Error ? error.message : "?"}` }, { status: 502 });
          }
        }
        try {
          const plan = await planWorkspaceBatch({
            brief: body.brief,
            count: body.count ?? 1,
            ratio: body.ratio || "3:4",
            product,
            hasReference: Boolean(body.hasReference) || Boolean(referenceImageUrl),
            avoid: (body.avoid ?? []).map(String).slice(0, 30),
            referenceImageUrl,
            referenceAttached: Boolean(referenceDataUrl),
            competitorInspiration: sanitizeCompetitorInspiration(body.competitorInspiration),
          });
          return NextResponse.json({ plan });
        } catch (error) {
          if (error instanceof VisionUnavailableError) return NextResponse.json({ error: error.message, visionUnavailable: true }, { status: 422 });
          throw error;
        }
      }
      case "product-reference":
        if (!body.productId || !body.referenceUrl) return NextResponse.json({ error: "Produit ou image manquant" }, { status: 400 });
        return NextResponse.json({ product: await setProductReference(body.productId, { type: body.referenceType ?? "primary", url: body.referenceUrl }) });
      case "product-reference-clear":
        if (!body.productId) return NextResponse.json({ error: "Produit manquant" }, { status: 400 });
        return NextResponse.json({ product: await clearProductReference(body.productId, body.referenceType ?? "primary") });
      case "product-delete":
        if (!body.productId) return NextResponse.json({ error: "Produit manquant" }, { status: 400 });
        await deleteProduct(body.productId);
        return NextResponse.json({ ok: true });
      case "plan":
        return NextResponse.json({ plan: await previewPlan(specFrom(body)) });
      case "generate":
        return NextResponse.json({ batch: await createTestBatch(specFrom(body)) });
      case "refresh":
        if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });
        return NextResponse.json({ batch: await refreshBatch(body.batchId) });
      case "retry":
        if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });
        return NextResponse.json(await retryFailed(body.batchId));
      case "status":
        if (!body.batchId || !body.itemId || !body.status) return NextResponse.json({ error: "Créa ou statut manquant" }, { status: 400 });
        return NextResponse.json({ item: await setItemStatus(body.batchId, body.itemId, body.status) });
      case "item-regenerate":
        if (!body.batchId || !body.itemId) return NextResponse.json({ error: "Créa manquante" }, { status: 400 });
        return NextResponse.json({ item: await regenerateItem(body.batchId, body.itemId, body.prompt) });
      case "item-duplicate":
        if (!body.batchId || !body.itemId) return NextResponse.json({ error: "Créa manquante" }, { status: 400 });
        return NextResponse.json({ item: await duplicateItem(body.batchId, body.itemId) });
      case "drive-export":
        if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });
        return NextResponse.json(await exportToDrive(body.batchId, (body.folder ?? "").replace(/^\/+|\/+$/g, ""), body.itemIds ?? null));
      case "batch-delete":
        if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });
        await deleteBatch(body.batchId);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opération impossible" }, { status: 502 });
  }
}
