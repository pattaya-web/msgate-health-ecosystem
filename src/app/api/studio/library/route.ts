import type { Ratio } from "@/lib/studio/ratios";
import { NextResponse } from "next/server";
import { listStaticCreatives, saveStaticCreative } from "@/lib/studio/library";
import { reconcilePendingTasks } from "@/lib/studio/pending";
import { listBatches } from "@/lib/ugc/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Les deux stockages, présentés comme un seul.
 *
 * Les images du studio et les vidéos UGC vivent dans des dossiers distincts
 * pour de bonnes raisons — pas le même cycle de vie, pas le même poids. Mais on
 * ne cherche pas une créa par son dossier : on la cherche par ce qu'elle est.
 * La fusion se fait donc à la lecture, sans rien déplacer.
 */
export async function GET() {
  /* Les tâches lancées dont personne n'a vu la fin (onglet fermé, navigateur
     coupé) sont rangées ici, à l'ouverture de la bibliothèque — borné pour ne
     pas retarder la page. */
  await reconcilePendingTasks().catch(() => undefined);
  const statics = (await listStaticCreatives()).map((item) => ({
    ...item,
    source: "static" as const,
    media: item.media ?? ("image" as const),
  }));

  let ugc: Array<Record<string, unknown>> = [];
  try {
    const batches = await listBatches();
    ugc = batches.flatMap((batch) =>
      batch.jobs
        .filter((job) => job.state === "done" && job.file)
        .map((job) => ({
          id: `${batch.id}::${job.file}`,
          createdAt: batch.createdAt,
          brief: batch.product?.name || "",
          prompt: job.prompt || "",
          ratio: "9:16",
          resolution: batch.resolution === "1080p" ? "2K" : "1K",
          resultFiles: [job.file as string],
          refFiles: [],
          source: "ugc" as const,
          media: "video" as const,
          batchId: batch.id,
        }))
    );
  } catch {
    // Aucun lot UGC : la bibliothèque reste celle du studio.
  }

  const items = [...statics, ...ugc].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      brief?: string;
      prompt?: string;
      ratio?: Ratio;
      resolution?: "1K" | "2K";
      resultUrls?: string[];
      referenceUrls?: string[];
      media?: "image" | "video";
      taskId?: string;
    };
    const item = await saveStaticCreative({
      brief: body.brief,
      prompt: body.prompt || "",
      ratio: body.ratio,
      resolution: body.resolution,
      resultUrls: body.resultUrls || [],
      referenceUrls: body.referenceUrls,
      media: body.media,
      taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sauvegarde impossible" },
      { status: 400 }
    );
  }
}
