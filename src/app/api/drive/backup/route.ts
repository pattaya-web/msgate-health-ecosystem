import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { getBackupStatus, runBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** L'état de la copie de secours (OneDrive) : réservé à l'admin. */
export async function GET(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
  return NextResponse.json(await getBackupStatus());
}

/** Lance une sauvegarde tout de suite et attend qu'elle finisse. */
export async function POST(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
  return NextResponse.json(await runBackup());
}
