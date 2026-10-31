import { after, NextResponse } from "next/server";
import { buildAssociateOverview, type AssociateOverview } from "@/lib/associate/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Sous 15 s, la réponse gardée est servie telle quelle ; au-delà, servie aussitôt et recalculée derrière. */
const FRESH_MS = 15_000;

const state = ((globalThis as typeof globalThis & {
  __msgateAssociateOverview?: { cache: Map<string, { at: number; overview: AssociateOverview }>; inflight: Map<string, Promise<AssociateOverview>> };
}).__msgateAssociateOverview ??= { cache: new Map(), inflight: new Map() });

function rebuild(key: string, start: string, end: string, force: boolean) {
  const running = state.inflight.get(key);
  if (running && !force) return running;
  const run = buildAssociateOverview(start, end, { force })
    .then((overview) => {
      state.cache.set(key, { at: Date.now(), overview });
      return overview;
    })
    .finally(() => state.inflight.delete(key));
  state.inflight.set(key, run);
  return run;
}

function monthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Le seul endpoint que l'accès Associé peut appeler (voir src/lib/auth/guard.ts) :
 * le périmètre Straight Sale, calculé côté serveur, rien d'autre.
 *
 * Rapide d'abord : une réponse déjà calculée part tout de suite (et se
 * recalcule après coup si elle a plus de 15 s). `force=1` (bouton
 * Synchroniser) attend une relecture complète de Shopify et Meta, sans cache.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const fallback = monthRange();
  const start = DAY.test(params.get("start") || "") ? (params.get("start") as string) : fallback.start;
  const end = DAY.test(params.get("end") || "") ? (params.get("end") as string) : fallback.end;
  if (start > end) return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  const key = `${start}:${end}`;
  const force = params.get("force") === "1";
  try {
    const cached = state.cache.get(key);
    if (!force && cached) {
      if (Date.now() - cached.at > FRESH_MS) after(() => rebuild(key, start, end, false).catch(() => undefined));
      return NextResponse.json({ ok: true, overview: cached.overview, cachedAt: new Date(cached.at).toISOString() });
    }
    return NextResponse.json({ ok: true, overview: await rebuild(key, start, end, force) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tableau de bord indisponible" }, { status: 502 });
  }
}
