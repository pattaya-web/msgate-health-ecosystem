import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { scopedDailySpend } from "@/lib/associate/scope";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** La dépense Meta du périmètre Venom jour par jour, en dollars (tableau jour par jour de la page Profit). */
export async function GET(request: Request) {
  if (!sessionFromRequest(request)) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  if (!DAY.test(start) || !DAY.test(end) || start > end) return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await scopedDailySpend(start, end)) });
}
