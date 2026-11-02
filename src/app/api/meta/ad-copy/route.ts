import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { OutOfScopeError, assertObjectsInScope, associateAccountsFor } from "@/lib/associate/meta-access";
import { updateAdCopy } from "@/lib/meta/edit-ad-copy";
import { appendJournal } from "@/lib/pilotage/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const list = (value: unknown) => (Array.isArray(value) ? value.filter((row): row is string => typeof row === "string") : []);

/** Modifier l'ad copy d'une pub (textes principaux, titres, descriptions). */
export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin" && session?.role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  let body: { adId?: unknown; headlines?: unknown; bodies?: unknown; descriptions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  const adId = typeof body.adId === "string" && /^\d+$/.test(body.adId) ? body.adId : null;
  if (!adId) return NextResponse.json({ error: "Pub manquante" }, { status: 400 });
  try {
    const scoped = await associateAccountsFor(request);
    if (scoped) await assertObjectsInScope([adId], scoped);
    const result = await updateAdCopy(adId, { headlines: list(body.headlines), bodies: list(body.bodies), descriptions: list(body.descriptions) });
    await appendJournal({
      who: session.email,
      action: "copy",
      level: "ad",
      objectId: adId,
      objectName: result.adName,
      campaignId: null,
      campaignName: "",
      accountId: result.accountId,
      before: result.previousCreativeId,
      after: result.creativeId,
      currency: null,
      source: "ads",
      note: "Ad copy modifié",
    }).catch(() => null);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OutOfScopeError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Modification impossible" }, { status: 400 });
  }
}
