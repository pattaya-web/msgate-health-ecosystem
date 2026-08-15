import { NextResponse } from "next/server";
import { buildRoasDaily } from "@/lib/metrics/roas-daily";
import { parseBucketFilter } from "@/lib/meta/buckets";
import type { RefundAttribution } from "@/lib/shopify/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function defaultRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fallback = defaultRange();
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const data = await buildRoasDaily({
      start: isDate(start) ? start : fallback.start,
      end: isDate(end) ? end : fallback.end,
      attribution: (searchParams.get("attribution") === "order"
        ? "order"
        : "processed") as RefundAttribution,
      buckets: parseBucketFilter(searchParams.get("buckets")),
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ROAS build failed" },
      { status: 502 }
    );
  }
}
