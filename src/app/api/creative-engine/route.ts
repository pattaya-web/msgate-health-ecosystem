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
import { planWorkspaceBatch } from "@/lib/creative-engine/workspace-writer";
import type { ProductReferenceType } from "@/lib/creative-engine/types";
import type { CreativeEmphasis, CreativeStatus, FamilyMixSetting, ReferenceStrength } from "@/lib/creative-engine/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
        const product = body.productId ? (await listProducts()).find((item) => item.id === body.productId) : null;
        if (!product) return NextResponse.json({ error: "Produit manquant" }, { status: 400 });
        if (!body.brief?.trim()) return NextResponse.json({ error: "Brief manquant" }, { status: 400 });
        const plan = await planWorkspaceBatch({
          brief: body.brief,
          count: body.count ?? 1,
          ratio: body.ratio || "3:4",
          product,
          hasReference: Boolean(body.hasReference),
          avoid: (body.avoid ?? []).map(String).slice(0, 30),
        });
        return NextResponse.json({ plan });
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
