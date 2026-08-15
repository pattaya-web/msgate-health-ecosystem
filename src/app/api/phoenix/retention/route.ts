import { NextResponse } from "next/server";
import { getPhoenixConfig } from "@/lib/phoenix/client";
import { getProgress, peekSnapshot } from "@/lib/phoenix/snapshot";
import { buildRetention } from "@/lib/phoenix/retention";

export const dynamic = "force-dynamic";

function defaultRange() {
  const now = new Date();
  // Churn is slow: a single month rarely holds enough exits to read a trend.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

export async function GET(request: Request) {
  try {
    if (!getPhoenixConfig()) {
      return NextResponse.json(
        { error: "Phoenix not configured — set PHOENIX_* in .env.local" },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fallback = defaultRange();
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const snapshot = await peekSnapshot();
    if (!snapshot) {
      return NextResponse.json({ ok: false, building: true, progress: getProgress() }, { status: 202 });
    }

    const retention = buildRetention(snapshot, {
      start: isDate(start) ? start : fallback.start,
      end: isDate(end) ? end : fallback.end,
    });

    return NextResponse.json({ ok: true, ...retention });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Retention failed" },
      { status: 502 }
    );
  }
}
