import { NextResponse } from "next/server";
import { buildOverview } from "@/lib/phoenix/analytics";
import { getPhoenixConfig } from "@/lib/phoenix/client";
import { getProgress, isStale, peekSnapshot, startSync, focusIncludesToday } from "@/lib/phoenix/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function defaultRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function GET(request: Request) {
  try {
    const config = getPhoenixConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Phoenix not configured — set PHOENIX_* in .env.local" },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fallback = defaultRange();
    const start = searchParams.get("start") || fallback.start;
    const end = searchParams.get("end") || fallback.end;
    const stores = (searchParams.get("stores") || "").split(",").filter(Boolean);
    const processors = (searchParams.get("processors") || "").split(",").filter(Boolean);
    const refresh = searchParams.get("refresh") === "1";

    // A full sync is rate-limited to ~40 minutes, so the request never waits on
    // it: it runs in the background while the client polls for progress and
    // renders whatever the cache already holds.
    const snapshot = await peekSnapshot();
    // Previously we only synced when the snapshot was incomplete — a "complete"
    // but hours-old cache hid same-day recurrings that Phoenix CRM already shows.
    const needsSync =
      refresh ||
      !snapshot ||
      !snapshot.complete ||
      isStale(snapshot) ||
      (focusIncludesToday({ start, end }) && isStale(snapshot, 20 * 60 * 1000));

    if (needsSync) {
      void startSync({ focus: { start, end }, force: refresh });
    }
    if (!snapshot) {
      return NextResponse.json(
        { ok: false, building: true, progress: getProgress() },
        { status: 202 }
      );
    }

    const targetCacRaw = process.env.PHOENIX_TARGET_CAC;
    const overview = buildOverview(snapshot, {
      start,
      end,
      stores,
      processors,
      client: config.clientLabel,
      targetCac: targetCacRaw ? Number(targetCacRaw) : null,
    });

    overview.meta.stale = isStale(snapshot);
    return NextResponse.json({ ok: true, overview, progress: getProgress() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Overview failed" },
      { status: 502 }
    );
  }
}
