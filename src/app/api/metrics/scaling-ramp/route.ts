import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { buildScalingRamp } from "@/lib/metrics/scaling-ramp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** La rampe de scaling de l'Ads Manager (admin et associée : le périmètre Venom). `aggressive=0` monte au seuil « scaler ». */
export async function GET(request: Request) {
  const role = sessionFromRequest(request)?.role;
  if (role !== "admin" && role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const aggressive = new URL(request.url).searchParams.get("aggressive") !== "0";
  try {
    return NextResponse.json({ ok: true, ...(await buildScalingRamp({ aggressive })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rampe indisponible" }, { status: 502 });
  }
}
