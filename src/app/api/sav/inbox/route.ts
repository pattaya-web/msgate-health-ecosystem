import { NextResponse } from "next/server";
import { isSavConfigured } from "@/lib/sav/imap";
import { getSavInbox } from "@/lib/sav/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

/** Par défaut : les 14 derniers jours, aujourd'hui inclus. */
function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function GET(request: Request) {
  if (!isSavConfigured()) {
    return NextResponse.json(
      { error: "SAV non configuré — renseigne SAV_IMAP_HOST, SAV_IMAP_USER et SAV_IMAP_PASSWORD" },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const fallback = defaultRange();
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const data = await getSavInbox({
      start: isDate(start) ? start : fallback.start,
      end: isDate(end) ? end : fallback.end,
      force: searchParams.get("refresh") === "1",
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Boîte SAV indisponible" },
      { status: 502 }
    );
  }
}
