import { NextResponse } from "next/server";
import { resolveSource } from "@/lib/phoenix/sources";
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
    const { searchParams } = new URL(request.url);
    const source = resolveSource(searchParams.get("source"));
    if (!source.configured) return NextResponse.json({ error: source.notConfigured }, { status: 503 });
    const { peekSnapshot, getProgress } = source;
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
