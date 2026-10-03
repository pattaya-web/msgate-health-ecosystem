import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { onProviderCallback } from "@/lib/studio-ia/jobs";
import { warmThumb } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

/**
 * Callback KIE. Utilisé seulement si PUBLIC_BASE_URL pointe vers une URL publique.
 * En local, le Studio fait du polling à la place.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    data?: { taskId?: string; state?: string; resultJson?: string; failMsg?: string; creditsConsumed?: number };
  };
  const data = body.data;
  if (!data?.taskId) return NextResponse.json({ ok: false }, { status: 400 });

  const db = readDB();
  const gen = db.generations.find((g) => g.taskId === data.taskId);
  if (!gen) {
    // Pas une generation classique : peut-etre un job du Swap video.
    const handled = await onProviderCallback(data.taskId).catch(() => false);
    return NextResponse.json({ ok: true, ignored: !handled });
  }

  let urls: string[] = [];
  if (data.resultJson) {
    try {
      urls = (JSON.parse(data.resultJson) as { resultUrls?: string[] }).resultUrls ?? [];
    } catch {
      urls = [];
    }
  }

  gen.state = (data.state as typeof gen.state) ?? "success";
  gen.resultUrls = urls;
  for (const u of urls) warmThumb(u);
  gen.failMsg = data.failMsg ?? "";
  gen.creditsConsumed = Number(data.creditsConsumed ?? gen.creditsConsumed);
  gen.updatedAt = new Date().toISOString();
  writeDB(db);

  return NextResponse.json({ ok: true });
}
