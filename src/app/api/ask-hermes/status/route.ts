import { NextResponse } from "next/server";
import { hermesChatConfig } from "@/lib/ask-hermes/config";
import type { HermesStatus } from "@/lib/ask-hermes/types";
import { hermesReachable } from "@/lib/ask-hermes/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ask-hermes/status — l'instance Hermes est-elle configurée et joignable ? Rien d'autre ne sort (ni URL ni clé). */

const CACHE_MS = 20_000;
let cached: { at: number; status: HermesStatus } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) return NextResponse.json(cached.status);
  const config = hermesChatConfig();
  const status: HermesStatus = {
    configured: Boolean(config),
    reachable: config ? await hermesReachable(config) : null,
    checkedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), status };
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
