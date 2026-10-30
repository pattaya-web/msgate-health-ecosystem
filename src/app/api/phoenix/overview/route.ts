import { NextResponse } from "next/server";
import { buildOverview } from "@/lib/phoenix/analytics";
import { isStale, focusIncludesToday } from "@/lib/phoenix/snapshot";
import { resolveSource } from "@/lib/phoenix/sources";

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
    const { searchParams } = new URL(request.url);
    // Phoenix ou Reign : même instantané, même tableau de bord (src/lib/phoenix/sources.ts).
    const source = resolveSource(searchParams.get("source"));
    if (!source.configured) return NextResponse.json({ error: source.notConfigured }, { status: 503 });
    const { peekSnapshot, startSync, getProgress } = source;

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

    const overview = buildOverview(snapshot, {
      start,
      end,
      stores,
      processors,
      client: source.label,
      targetCac: source.targetCac,
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
