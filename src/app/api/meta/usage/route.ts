import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { metaUsageReport } from "@/lib/meta/usage-log";

export const dynamic = "force-dynamic";

/** Qui appelle Meta et combien (5, 15, 60 min), et la jauge de chaque compte pub. Admin seulement. */
export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  return NextResponse.json(metaUsageReport());
}
