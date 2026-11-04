import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { buildMorning } from "@/lib/metrics/morning";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** L'onglet « Matin » de l'Ads Manager (admin et associée : le périmètre Venom). */
export async function GET(request: Request) {
  const role = sessionFromRequest(request)?.role;
  if (role !== "admin" && role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const aggressive = new URL(request.url).searchParams.get("aggressive") !== "0";
  try {
    return NextResponse.json({ ok: true, ...(await buildMorning({ aggressive })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Matin indisponible" }, { status: 502 });
  }
}
