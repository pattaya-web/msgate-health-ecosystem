import { NextResponse } from "next/server";
import { hostOf, isRebrandFile, readRebrandFile } from "@/lib/shopify-scraper/rebrand";

export const dynamic = "force-dynamic";

/** Sert un packaging rebrandé depuis le disque : vignettes de la page, et CSV quand Supabase n'est pas configuré. */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const host = hostOf(search.get("shop") || "");
  const name = search.get("name")?.trim() || "";
  if (!host || !isRebrandFile(name)) return NextResponse.json({ error: "Fichier refusé" }, { status: 400 });
  const data = await readRebrandFile(host, name);
  if (!data) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}
