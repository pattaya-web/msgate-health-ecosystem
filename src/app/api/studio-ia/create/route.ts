import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/studio-ia/jobs";
import { createCreationJobs, CreationError } from "@/lib/studio-ia/creation";
import type { CreateRequest } from "@/lib/studio-ia/types";

export const dynamic = "force-dynamic";

/** « Création » : une image de départ + un script → vidéo Seedance 2.5 avec la voix, dans la même file. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CreateRequest | null;
  if (!body) return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  try {
    const jobs = createCreationJobs(body);
    void tick();
    return NextResponse.json({ jobs });
  } catch (e) {
    const err = e as CreationError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}
