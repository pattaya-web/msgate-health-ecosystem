import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import { stitchClips } from "@/lib/ugc/stitch";
import type { ProductInput, Resolution, UgcJob } from "@/lib/ugc/types";

/**
 * Chaque lot est écrit sur disque DÈS SA CRÉATION, avant même que le premier
 * clip existe. Kie n'expose aucun historique de tâches : un taskId perdu est une
 * génération payée et irrécupérable. On sauve donc les identifiants d'abord, les
 * vidéos ensuite — et on télécharge les mp4, parce que les URLs de Kie expirent.
 */
const ROOT = path.join(process.cwd(), ".msgate-cache", "ugc-batches");

export type UgcBatch = {
  id: string;
  createdAt: string;
  product: Pick<ProductInput, "name" | "handle" | "price" | "imageUrls">;
  resolution: Resolution;
  jobs: UgcJob[];
  /** Montages produits, un par angle : nom de fichier dans le dossier du lot. */
  cuts?: Record<string, string>;
};

function batchDir(id: string) {
  return path.join(ROOT, id);
}

async function readBatch(id: string): Promise<UgcBatch | null> {
  try {
    return JSON.parse(await readFile(path.join(batchDir(id), "batch.json"), "utf8")) as UgcBatch;
  } catch {
    return null;
  }
}

async function writeBatch(batch: UgcBatch) {
  await mkdir(batchDir(batch.id), { recursive: true });
  await writeFile(path.join(batchDir(batch.id), "batch.json"), JSON.stringify(batch, null, 2));
}

export async function createBatch(input: {
  product: ProductInput;
  resolution: Resolution;
  jobs: UgcJob[];
}): Promise<UgcBatch> {
  const batch: UgcBatch = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    product: {
      name: input.product.name,
      handle: input.product.handle,
      price: input.product.price,
      imageUrls: input.product.imageUrls.slice(0, 3),
    },
    resolution: input.resolution,
    jobs: input.jobs,
  };
  await writeBatch(batch);
  return batch;
}

/** Rapatrie le fichier tant que l'URL Kie est encore valable. */
async function download(batchId: string, taskId: string, url: string) {
  const file = `${taskId}.mp4`;
  const target = path.join(batchDir(batchId), file);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}

/**
 * Applique un relevé de statuts à tous les lots qui contiennent ces tâches. On
 * ne sait pas de quel lot vient un taskId : on balaie, c'est peu coûteux et ça
 * évite au client d'avoir à suivre l'appartenance.
 */
export async function applyResults(
  results: Array<{ taskId: string; state?: string; urls: string[]; failMsg: string | null }>
) {
  const byTask = new Map(results.map((row) => [row.taskId, row]));
  let ids: string[] = [];
  try {
    ids = await readdir(ROOT);
  } catch {
    return;
  }

  for (const id of ids) {
    const batch = await readBatch(id);
    if (!batch) continue;
    let touched = false;

    for (const job of batch.jobs) {
      if (!job.taskId || job.state !== "pending") continue;
      const hit = byTask.get(job.taskId);
      if (!hit) continue;

      if (hit.state === "success" && hit.urls.length) {
        job.state = "done";
        job.urls = hit.urls;
        const saved = await download(batch.id, job.taskId, hit.urls[0]);
        if (saved) job.file = saved;
        touched = true;
      } else if (hit.state === "fail") {
        job.state = "fail";
        job.error = hit.failMsg || "Échec";
        touched = true;
      }
    }

    if (touched) await writeBatch(batch);
  }
}

export async function listBatches(): Promise<UgcBatch[]> {
  let ids: string[] = [];
  try {
    ids = await readdir(ROOT);
  } catch {
    return [];
  }
  const batches = await Promise.all(ids.map(readBatch));
  return batches
    .filter((batch): batch is UgcBatch => Boolean(batch))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Assemble les clips d'un angle dans l'ordre des scènes. On refuse tant que
 * l'angle n'est pas complet : un montage amputé d'une scène se remarque tout
 * de suite et ferait croire à un échec de génération.
 */
export async function stitchAngle(batchId: string, angleId: string) {
  const batch = await readBatch(batchId);
  if (!batch) throw new Error("Lot introuvable");

  const jobs = batch.jobs.filter((job) => job.angleId === angleId);
  if (!jobs.length) throw new Error("Angle introuvable dans ce lot");
  if (jobs.some((job) => job.state !== "done" || !job.file)) {
    throw new Error("Tous les clips de cet angle ne sont pas encore prêts");
  }

  const name = `montage-${angleId}.mp4`;
  await stitchClips(batchDir(batchId), jobs.map((job) => job.file as string), name);

  batch.cuts = { ...(batch.cuts ?? {}), [angleId]: name };
  await writeBatch(batch);
  return name;
}

export async function readBatchFile(id: string, file: string) {
  // Un nom de fichier ne traverse jamais de dossier : on le réduit à sa base.
  const safe = path.basename(file);
  return readFile(path.join(batchDir(id), safe));
}

export async function deleteBatch(id: string) {
  await rm(batchDir(path.basename(id)), { recursive: true, force: true });
}
