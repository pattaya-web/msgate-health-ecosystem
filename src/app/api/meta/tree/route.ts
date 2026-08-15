import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { buildAdsTree, isDatePreset } from "@/lib/meta/tree";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

export async function GET(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json(
      { error: "Meta not configured — set META_ACCESS_TOKENS in .env.local" },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawPreset = searchParams.get("preset");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const preset = isDatePreset(rawPreset)
      ? rawPreset
      : isDate(start) && isDate(end)
        ? ("custom" as const)
        : ("today" as const);

    const tree = await buildAdsTree({
      preset,
      start: isDate(start) ? start : undefined,
      end: isDate(end) ? end : undefined,
      force: searchParams.get("refresh") === "1",
    });

    return NextResponse.json({ ok: true, ...tree });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Meta sync failed" },
      { status: 502 }
    );
  }
}
