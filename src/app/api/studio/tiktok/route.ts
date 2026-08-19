import { NextResponse } from "next/server";
import { fetchTikTokBuffer, isTikTokUrl, resolveTikTokMp4 } from "@/lib/studio/ssstik";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const url = body.url?.trim() || "";
    if (!isTikTokUrl(url)) {
      return NextResponse.json({ error: "Lien TikTok invalide" }, { status: 400 });
    }
    const mp4 = await resolveTikTokMp4(url);
    const buffer = await fetchTikTokBuffer(mp4);
    const id = url.match(/video\/(\d+)/)?.[1] || Date.now().toString();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="tiktok-${id}.mp4"`,
        "Cache-Control": "private, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download TikTok impossible" },
      { status: 502 }
    );
  }
}
