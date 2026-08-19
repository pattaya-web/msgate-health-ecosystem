import { NextResponse } from "next/server";
import { listStaticCreatives, saveStaticCreative } from "@/lib/studio/library";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const items = await listStaticCreatives();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      brief?: string;
      prompt?: string;
      ratio?: "1:1" | "9:16" | "3:4";
      resolution?: "1K" | "2K";
      resultUrls?: string[];
      referenceUrls?: string[];
    };
    const item = await saveStaticCreative({
      brief: body.brief,
      prompt: body.prompt || "",
      ratio: body.ratio,
      resolution: body.resolution,
      resultUrls: body.resultUrls || [],
      referenceUrls: body.referenceUrls,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sauvegarde impossible" },
      { status: 400 }
    );
  }
}
