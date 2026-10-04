import JSZip from "jszip";
import { NextResponse } from "next/server";
import { normalizeShopUrl } from "@/lib/shopify-scraper/client";
import { getRebrand, hostOf, readRebrandFile } from "@/lib/shopify-scraper/rebrand";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Toutes les images rebrandées d'une boutique dans une archive, nommées par
 * produit : les rendus sont sur le disque de l'outil, pas seulement dans une
 * URL temporaire, et on doit pouvoir les récupérer sans passer par le CSV.
 * `handles=a,b` limite aux produits cochés.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const shop = normalizeShopUrl(url.searchParams.get("shop") || "");
  if (!shop) return NextResponse.json({ error: "URL de boutique invalide" }, { status: 400 });
  const host = hostOf(shop);
  const wanted = new Set((url.searchParams.get("handles") || "").split(",").map((entry) => entry.trim()).filter(Boolean));

  const state = await getRebrand(host);
  const done = state.items.filter((item) => item.state === "done" && item.file && (!wanted.size || wanted.has(item.handle)));
  if (!done.length) return NextResponse.json({ error: "Aucun rendu prêt pour cette boutique" }, { status: 404 });

  const zip = new JSZip();
  const counts = new Map<string, number>();
  let added = 0;
  for (const item of done) {
    const data = await readRebrandFile(host, item.file as string);
    if (!data) continue;
    const base = item.kind === "product-only" ? `${item.handle}-produit` : item.handle;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    zip.file(`${base}${n > 1 ? `-${n}` : ""}.png`, data);
    added += 1;
  }
  if (!added) return NextResponse.json({ error: "Les fichiers des rendus sont introuvables sur le disque" }, { status: 404 });

  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${host}_packaging-rebrande.zip"`,
    },
  });
}
