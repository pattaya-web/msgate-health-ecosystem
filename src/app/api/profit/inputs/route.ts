import { reportToday } from "@/lib/report-tz";
import { NextResponse } from "next/server";
import { buildProfitInputs } from "@/lib/metrics/profit-inputs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

/** Les mêmes préréglages que le calculateur. */
function presetRange(days: number) {
  // Les N derniers jours, aujourd'hui compris, en jours de Paris (ceux de Shopify et Meta) :
  // une boutique qui démarre vend surtout aujourd'hui, l'exclure affichait 0 $.
  const today = reportToday();
  const end = new Date(`${today}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: today };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const days = Number(searchParams.get("days"));

    const range =
      isDate(start) && isDate(end)
        ? { start, end }
        : presetRange([7, 14, 30].includes(days) ? days : 30);

    const inputs = await buildProfitInputs(range);
    return NextResponse.json({ ok: true, ...inputs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Profit inputs failed" },
      { status: 502 }
    );
  }
}
