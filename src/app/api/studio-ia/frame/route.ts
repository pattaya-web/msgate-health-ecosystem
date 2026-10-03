import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/studio-ia/jobs";
import { ensureLocal, firstFrame, MediaError } from "@/lib/studio-ia/media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Première image d'un résultat (ou de n'importe quelle vidéo du drive), en
 * JPEG : « Utiliser comme nouvelle référence » part de là.
 */
export async function POST(req: NextRequest) {
  const { jobId, url } = (await req.json().catch(() => ({}))) as { jobId?: string; url?: string };
  let source = url ?? "";
  if (jobId) {
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
    source = job.finalOutput || job.videoOutput || job.remoteVideoUrl;
  }
  if (!source) return NextResponse.json({ error: "Aucune vidéo." }, { status: 400 });
  try {
    const local = await ensureLocal(source);
    const frame = await firstFrame(local.path);
    return NextResponse.json({ url: frame.url });
  } catch (e) {
    const err = e as MediaError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 500 });
  }
}
