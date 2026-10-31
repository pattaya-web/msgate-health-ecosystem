import { NextResponse } from "next/server";
import { buildAssociateOverview } from "@/lib/associate/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function monthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Le seul endpoint que l'accès Associé peut appeler (voir src/lib/auth/guard.ts) :
 * le périmètre Straight Sale, calculé côté serveur, rien d'autre.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const fallback = monthRange();
  const start = DAY.test(params.get("start") || "") ? (params.get("start") as string) : fallback.start;
  const end = DAY.test(params.get("end") || "") ? (params.get("end") as string) : fallback.end;
  if (start > end) return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  try {
    // force=1 : le bouton Synchroniser relit Shopify et Meta tout de suite, sans cache.
    return NextResponse.json({ ok: true, overview: await buildAssociateOverview(start, end, { force: params.get("force") === "1" }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tableau de bord indisponible" }, { status: 502 });
  }
}
