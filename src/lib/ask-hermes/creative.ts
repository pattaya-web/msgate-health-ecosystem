import { listBatches, readBatchFile } from "@/lib/creative-engine/store";
import type { BatchItem, TestBatch } from "@/lib/creative-engine/types";
import type { CreativeRecord } from "./types";

const SAFE_ID = /^[\w-]+$/;

export function creativeImageUrl(batchId: string, file: string) {
  return `/api/creative-engine/file?${new URLSearchParams({ batch: batchId, file })}`;
}

function toRecord(batch: TestBatch, item: BatchItem): CreativeRecord {
  return {
    source: "creative-engine",
    batchId: batch.id,
    batchNumber: batch.number,
    store: batch.store,
    productId: batch.productId,
    productName: batch.productName,
    productUrl: batch.productUrl,
    creativeId: item.id,
    name: item.name,
    family: { id: item.familyId, label: item.familyLabel },
    angle: { id: item.angleId, name: item.angleName },
    hook: item.hook,
    layout: item.layout,
    preset: { id: item.presetId, name: item.presetName },
    emphasis: item.emphasis,
    variation: item.variation,
    strategy: item.strategy,
    subject: item.subject ? { gender: item.subject.gender, ageRange: item.subject.ageRange, notes: item.subject.notes } : null,
    productVisibility: item.productVisibility,
    visualConcept: item.visualConcept,
    ratio: batch.ratio,
    resolution: batch.resolution,
    model: item.model,
    status: item.status,
    state: item.state,
    generatedAt: item.generatedAt,
    instructions: batch.instructions ?? "",
    prompt: item.prompt,
    referenceUsed: item.referenceUsed,
    imageUrl: item.file ? creativeImageUrl(batch.id, item.file) : null,
  };
}

/** Les métadonnées stockées d'une créa du Creative Engine, ou null si elle n'existe pas. Lecture seule. */
export async function loadCreativeRecord(batchId: string, creativeId: string): Promise<CreativeRecord | null> {
  if (!SAFE_ID.test(batchId) || !SAFE_ID.test(creativeId)) return null;
  const batch = (await listBatches()).find((entry) => entry.id === batchId);
  const item = batch?.items.find((entry) => entry.id === creativeId);
  if (!batch || !item) return null;
  return toRecord(batch, item);
}

/** L'image générée, en data URL PNG, prête pour une partie `image_url` — ou null si elle n'est pas encore là. */
export async function loadCreativeImageDataUrl(record: CreativeRecord): Promise<string | null> {
  const file = record.imageUrl ? new URL(record.imageUrl, "http://local").searchParams.get("file") : null;
  if (!file) return null;
  try {
    const bytes = await readBatchFile(record.batchId, file);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
