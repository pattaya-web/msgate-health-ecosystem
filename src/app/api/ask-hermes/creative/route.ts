import { NextResponse, type NextRequest } from "next/server";
import { loadCreativeRecord } from "@/lib/ask-hermes/creative";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ask-hermes/creative?batch=…&item=… — les métadonnées stockées d'une
 * créa du Creative Engine, prompt exact compris. Sert au bouton « Original
 * Prompt » : le prompt est affiché tel quel, sans passer par un modèle.
 */
export async function GET(request: NextRequest) {
  const batch = request.nextUrl.searchParams.get("batch") ?? "";
  const item = request.nextUrl.searchParams.get("item") ?? "";
  if (!batch || !item) return NextResponse.json({ error: "batch et item requis" }, { status: 400 });
  const record = await loadCreativeRecord(batch, item);
  if (!record) return NextResponse.json({ error: "Créa introuvable" }, { status: 404 });
  return NextResponse.json({ record }, { headers: { "cache-control": "no-store" } });
}
