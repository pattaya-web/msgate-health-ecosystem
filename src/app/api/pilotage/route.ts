import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { buildPilotage } from "@/lib/pilotage/build";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** La page Pilotage : objectifs, profit, site, décisions du jour, alertes, créas, tests et journal (Venom). */
export async function GET(request: Request) {
  const role = sessionFromRequest(request)?.role;
  if (role !== "admin" && role !== "associate") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    return NextResponse.json({ ok: true, ...(await buildPilotage(refresh)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pilotage indisponible" }, { status: 502 });
  }
}
