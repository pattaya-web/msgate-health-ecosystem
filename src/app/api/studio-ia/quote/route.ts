import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/studio-ia/config";
import { quote } from "@/lib/studio-ia/costs";
import type { ProviderChoice, Resolution, TransformType } from "@/lib/studio-ia/types";

export const dynamic = "force-dynamic";

/** Devis serveur : le client ne calcule jamais un coût lui-même. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const provider = (q.get("provider") ?? "auto") as ProviderChoice;
  if (provider !== "auto" && !(provider in PROVIDERS)) {
    return NextResponse.json({ error: "Modèle inconnu." }, { status: 400 });
  }
  const resolution = (q.get("resolution") === "1080p" ? "1080p" : "720p") as Resolution;
  const transform = (q.get("transform") ?? "full") as TransformType;
  return NextResponse.json(
    quote({
      provider,
      transform,
      durationSec: Number(q.get("durationSec")) || 5,
      resolution,
      variants: Number(q.get("variants")) || 1,
      hasProduct: q.get("product") === "1",
    }),
  );
}
