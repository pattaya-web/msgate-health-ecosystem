import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { appendJournal } from "@/lib/pilotage/journal";
import { updatePriceTest } from "@/lib/pilotage/tests";

export const dynamic = "force-dynamic";

/** Lancer / arrêter un test de prix, changer son mot-clé de campagne ou son seuil. */
export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin" && session?.role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  try {
    const config = await updatePriceTest(body.id, body);
    const test = config.priceTests.find((row) => row.id === body.id);
    if (test && "startDate" in body) {
      await appendJournal({
        who: session.email,
        action: "note",
        level: null,
        objectId: null,
        objectName: test.name,
        campaignId: null,
        campaignName: test.campaignKeyword,
        accountId: null,
        before: null,
        after: test.startDate,
        currency: null,
        source: "manuel",
        note: test.startDate ? `Test lancé : ${test.name} à partir du ${test.startDate}` : `Test arrêté : ${test.name}`,
      });
    }
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enregistrement impossible" }, { status: 400 });
  }
}
