import { NextResponse } from "next/server";
import { buildAssociateProfitInputs } from "@/lib/associate/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

/** Les mêmes préréglages que le calculateur : les N derniers jours complets, aujourd'hui exclu. */
function presetRange(days: number) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Le calcul de profit de l'accès Associé : Straight sale du périmètre seul
 * (src/lib/associate/scope.ts). Même forme que /api/profit/inputs, pour que le
 * même calculateur l'affiche.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const days = Number(searchParams.get("days"));
  const range = isDate(start) && isDate(end) && start <= end ? { start, end } : presetRange([7, 14, 30].includes(days) ? days : 30);
  try {
    return NextResponse.json({ ok: true, ...(await buildAssociateProfitInputs(range.start, range.end)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calcul de profit indisponible" }, { status: 502 });
  }
}
