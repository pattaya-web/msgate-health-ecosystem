import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadCreativeImageDataUrl, loadCreativeRecord } from "@/lib/ask-hermes/creative";
import { createPromptBatch } from "@/lib/creative-engine/store";
import { RATIOS } from "@/lib/studio/ratios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * POST /api/creative-engine/from-prompts — lance un lot du Creative Engine à
 * partir de prompts déjà écrits (panneau Ask Hermes).
 *
 * Seule porte vers Kie depuis le chat, et elle n'est franchie que par le
 * bouton « Confirm Generation » de la fenêtre de confirmation : le corps
 * doit porter `confirm: "generate"`, la session CRM est requise (proxy) et
 * un compte viewer est refusé (POST). Hermes n'a aucun outil qui y mène.
 */

const SAFE_ID = /^[\w-]+$/;
const DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const ratioIds = RATIOS.map((entry) => entry.id) as [string, ...string[]];

const schema = z
  .object({
    confirm: z.literal("generate"),
    prompts: z
      .array(z.object({ prompt: z.string().trim().min(20).max(8000), userPrompt: z.string().max(8000).optional(), angle: z.string().max(120).optional(), hook: z.string().max(300).optional(), useProductReference: z.boolean().optional(),
          label: z.string().max(120).optional() }))
      .min(1)
      .max(30),
    productId: z.string().regex(SAFE_ID).nullable().optional(),
    productName: z.string().trim().min(1).max(300),
    productUrl: z.string().max(1000).optional(),
    store: z.string().max(120).optional(),
    ratio: z.enum(ratioIds),
    resolution: z.enum(["1K", "2K"]),
    referenceDataUrls: z.array(z.string().max(5_500_000).regex(DATA_URL)).max(3).default([]),
    referenceCreative: z.object({ batchId: z.string().regex(SAFE_ID), creativeId: z.string().regex(SAFE_ID) }).nullable().optional(),
    useProductImages: z.boolean().default(false),
    sessionId: z.string().max(80).nullable().optional(),
    referenceFrameworkId: z.string().max(120).nullable().optional(),
    source: z.enum(["ask-hermes", "product-workspace"]).default("ask-hermes"),
    /** Références déjà hébergées en https (la référence principale d'un produit) : envoyées telles quelles au modèle. */
    referenceUrls: z.array(z.string().url().max(1000).regex(/^https:\/\//)).max(3).default([]),
    primaryReferenceUrl: z.string().url().max(1000).nullable().optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON illisible." }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide : confirmation ou champs manquants.", details: z.treeifyError(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;
  const referenceDataUrls = [...body.referenceDataUrls];
  if (body.referenceCreative) {
    const record = await loadCreativeRecord(body.referenceCreative.batchId, body.referenceCreative.creativeId);
    const dataUrl = record ? await loadCreativeImageDataUrl(record) : null;
    if (!dataUrl) return NextResponse.json({ error: "La créa de référence n'a pas d'image." }, { status: 404 });
    referenceDataUrls.unshift(dataUrl);
  }
  try {
    const batch = await createPromptBatch({
      source: body.source,
      hostedReferenceUrls: body.referenceUrls,
      primaryReferenceUrl: body.primaryReferenceUrl ?? null,
      productId: body.productId ?? null,
      productName: body.productName,
      productUrl: body.productUrl,
      store: body.store,
      prompts: body.prompts,
      ratio: body.ratio as (typeof RATIOS)[number]["id"],
      resolution: body.resolution,
      referenceDataUrls: referenceDataUrls.slice(0, 3),
      useProductImages: body.useProductImages,
      sessionId: body.sessionId ?? null,
      referenceFrameworkId: body.referenceFrameworkId ?? null,
    });
    return NextResponse.json({
      batch: {
        id: batch.id,
        number: batch.number,
        productName: batch.productName,
        ratio: batch.ratio,
        resolution: batch.resolution,
        items: batch.items.map((item) => ({ id: item.id, name: item.name, state: item.state, error: item.error, model: item.model })),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Génération impossible" }, { status: 500 });
  }
}
