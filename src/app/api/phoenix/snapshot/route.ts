import { NextResponse } from "next/server";
import { resolveSource } from "@/lib/phoenix/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const source = resolveSource(new URL(request.url).searchParams.get("source"));
  const snapshot = await source.peekSnapshot();
  return NextResponse.json({
    ok: true,
    source: source.id,
    progress: source.getProgress(),
    rate: source.rate(),
    coverage: snapshot?.coverage ?? 0,
    complete: snapshot?.complete ?? false,
  });
}

/** Kicks off a sync and returns immediately; the client polls GET for progress. */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = resolveSource(searchParams.get("source"));
  if (!source.configured) return NextResponse.json({ error: source.notConfigured }, { status: 503 });
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  void source.startSync({
    focus: start && end ? { start, end } : undefined,
    force: searchParams.get("force") === "1",
  });
  return NextResponse.json({ ok: true, source: source.id, progress: source.getProgress() });
}
