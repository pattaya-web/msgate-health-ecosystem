import { NextResponse } from "next/server";
import { getPhoenixConfig, getRateBudget } from "@/lib/phoenix/client";
import { getProgress, peekSnapshot, startSync } from "@/lib/phoenix/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const snapshot = await peekSnapshot();
  return NextResponse.json({
    ok: true,
    progress: getProgress(),
    rate: getRateBudget(),
    coverage: snapshot?.coverage ?? 0,
    complete: snapshot?.complete ?? false,
  });
}

/** Kicks off a sync and returns immediately; the client polls GET for progress. */
export async function POST(request: Request) {
  if (!getPhoenixConfig()) {
    return NextResponse.json(
      { error: "Phoenix not configured — set PHOENIX_* in .env.local" },
      { status: 503 }
    );
  }
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  void startSync({
    focus: start && end ? { start, end } : undefined,
    force: searchParams.get("force") === "1",
  });
  return NextResponse.json({ ok: true, progress: getProgress() });
}
