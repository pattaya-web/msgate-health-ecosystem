import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { buildObjectivesBar } from "@/lib/metrics/objectives";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const isDay = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** La barre « Objectifs » de l'Ads Manager (admin et associée : le périmètre Venom). */
export async function GET(request: Request) {
  const role = sessionFromRequest(request)?.role;
  if (role !== "admin" && role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const start = params.get("start");
  const end = params.get("end");
  if (!isDay(start) || !isDay(end) || start > end) return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await buildObjectivesBar(start, end)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Objectifs indisponibles" }, { status: 502 });
  }
}
