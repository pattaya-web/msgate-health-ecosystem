import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { ingestBooking, ingestLead } from "@/lib/closer/ingest";

export const dynamic = "force-dynamic";

/**
 * Réception des calls réservés et des leads d'IBOState (api/notify-lead.js du
 * projet ibostate, en même temps que le message Telegram).
 *
 * Route sans session : la clé partagée CLOSER_INGEST_KEY (en-tête
 * `x-closer-key`) fait foi. Sans clé configurée, rien n'entre.
 */
function keyOk(given: string | null) {
  const expected = process.env.CLOSER_INGEST_KEY?.trim() ?? "";
  if (expected.length < 24 || !given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!keyOk(request.headers.get("x-closer-key"))) return NextResponse.json({ error: "Clé refusée" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { type?: string; payload?: Record<string, unknown> } | null;
  if (!body?.payload || typeof body.payload !== "object") return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  try {
    if (body.type === "booking") {
      const call = await ingestBooking(body.payload);
      return NextResponse.json({ ok: true, call: call.id, assigned: Boolean(call.closerId) });
    }
    if (body.type === "lead") {
      const lead = await ingestLead(body.payload);
      return NextResponse.json({ ok: true, lead: lead.id });
    }
    return NextResponse.json({ ok: true, ignored: body.type ?? "?" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Réception impossible" }, { status: 400 });
  }
}
