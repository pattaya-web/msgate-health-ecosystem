import { NextResponse } from "next/server";
import { buildPartnershipReport, updatePartnership, type PartnershipPatch } from "@/lib/associate/partnership";
import { sessionFromRequest } from "@/lib/auth/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** MoneyTalk : ventes, colliers, frais, pub et bénéfice, sur la période choisie (?from=&to=&view=daily|weekly|monthly). */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json({ ok: true, ...(await buildPartnershipReport({ from: params.get("from"), to: params.get("to"), view: params.get("view") })) });
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
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ ok: true, ...(await buildPartnershipReport({ from: params.get("from"), to: params.get("to"), view: params.get("view") })) });
}
