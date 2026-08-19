import { NextResponse } from "next/server";
import { generateAdCopyFromUrl } from "@/lib/meta/ad-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    if (!body.url?.trim()) return NextResponse.json({ error: "URL produit manquante" }, { status: 400 });
    const copy = await generateAdCopyFromUrl(body.url);
    return NextResponse.json(copy);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération copy impossible" },
      { status: 502 }
    );
  }
}
