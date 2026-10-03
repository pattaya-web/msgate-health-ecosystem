import { NextRequest, NextResponse } from "next/server";
import { countByStatus, createJobs, deleteJob, JobError, tick } from "@/lib/studio-ia/jobs";
import type { TransformRequest } from "@/lib/studio-ia/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Liste + un tour de file : c'est ce sondage qui fait avancer les jobs. */
export async function GET() {
  const jobs = await tick();
  /*
   * `providerInput` (la requete brute envoyee au fournisseur) pesait la
   * moitie de la liste et l'interface ne la lit jamais : 190 Ko par sondage
   * pour 33 rendus, toutes les 15 s. On la retire de la liste.
   */
  const slim = jobs.slice(0, 120).map(({ providerInput: _omit, ...rest }) => rest);
  return NextResponse.json({ jobs: slim, counts: countByStatus(jobs) });
}

/**
 * Création d'un lot de variantes. La réponse part tout de suite : l'upload
 * chez le fournisseur et la génération tournent en arrière-plan.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as TransformRequest | null;
  if (!body) return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  try {
    const jobs = createJobs(body);
    // Coup de pouce immédiat : pas besoin d'attendre le prochain sondage.
    void tick();
    return NextResponse.json({ jobs });
  } catch (e) {
    const err = e as JobError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  return NextResponse.json({ ok: deleteJob(id) });
}
