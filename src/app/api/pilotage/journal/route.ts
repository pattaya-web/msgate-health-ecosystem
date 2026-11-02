import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { appendJournal } from "@/lib/pilotage/journal";

export const dynamic = "force-dynamic";

/** Une note à la main dans le journal (ce qui n'est pas passé par l'outil : changement fait dans Meta, test lancé…). */
export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin" && session?.role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  let body: { note?: unknown; campaignName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!note) return NextResponse.json({ error: "Écris ce qui a été fait" }, { status: 400 });
  const entry = await appendJournal({
    who: session.email,
    action: "note",
    level: null,
    objectId: null,
    objectName: "",
    campaignId: null,
    campaignName: typeof body.campaignName === "string" ? body.campaignName.trim().slice(0, 120) : "",
    accountId: null,
    before: null,
    after: null,
    currency: null,
    source: "manuel",
    note,
  });
  return NextResponse.json({ ok: true, entry });
}
