import { NextResponse } from "next/server";
import { buildPartnershipReport, updatePartnership, type PartnershipPatch } from "@/lib/associate/partnership";
import { sessionFromRequest } from "@/lib/auth/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Le partage 50/50 : ventes, pub de chacun, bénéfice et ce que Mady doit à Alison, période par période. */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await buildPartnershipReport()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Partage indisponible" }, { status: 502 });
  }
}

/** L'associée choisit son rythme de paiement ; l'admin règle aussi la date de début, les payeurs et les paiements. */
export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin" && session?.role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  let body: PartnershipPatch;
  try {
    body = (await request.json()) as PartnershipPatch;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  await updatePartnership(body, session.role);
  return NextResponse.json({ ok: true, ...(await buildPartnershipReport()) });
}
