import { NextResponse } from "next/server";
import { listSources } from "@/lib/phoenix/sources";

export const dynamic = "force-dynamic";

/** Les sources de stats disponibles sur ce serveur (Phoenix, Reign) et leur état de configuration. */
export async function GET() {
  return NextResponse.json({ ok: true, sources: listSources() });
}
