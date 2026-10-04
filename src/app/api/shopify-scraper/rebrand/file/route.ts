import { NextResponse } from "next/server";
import { hostOf, isRebrandFile, readRebrandFile, readRebrandThumb } from "@/lib/shopify-scraper/rebrand";

export const dynamic = "force-dynamic";

/** Sert un packaging rebrandé depuis le disque : vignettes de la page, et CSV quand Supabase n'est pas configuré. */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const host = hostOf(search.get("shop") || "");
  const name = search.get("name")?.trim() || "";
  if (!host || !isRebrandFile(name)) return NextResponse.json({ error: "Fichier refusé" }, { status: 400 });
  // `w=96|160|320` : une miniature JPEG, bien plus légère que le rendu PNG complet.
  const width = Number(search.get("w") || 0);
  const data = width ? await readRebrandThumb(host, name, width) : await readRebrandFile(host, name);
  if (!data) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  const isJpeg = data.length > 2 && data[0] === 0xff && data[1] === 0xd8;
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": isJpeg ? "image/jpeg" : "image/png", "Cache-Control": "private, max-age=86400" },
  });
}
