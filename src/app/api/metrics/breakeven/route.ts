import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { buildBreakeven } from "@/lib/metrics/breakeven";

export const dynamic = "force-dynamic";

const isDay = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** Le ROAS breakeven et le CPA max de la période (admin et associée : le Straight sale Venom). */
export async function GET(request: Request) {
  if (!sessionFromRequest(request)) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const start = params.get("start");
  const end = params.get("end");
  if (!isDay(start) || !isDay(end) || start > end) return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  try {
    const breakeven = await buildBreakeven(start, end);
    return NextResponse.json({ ok: true, breakeven });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Breakeven indisponible" }, { status: 502 });
  }
}
