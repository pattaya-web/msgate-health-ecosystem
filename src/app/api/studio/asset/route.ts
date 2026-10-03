import { NextResponse } from "next/server";
import { readReferenceByUrl } from "@/lib/creative-engine/store";
import { isProxiedAsset } from "@/lib/studio/asset-hosts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url || !isProxiedAsset(url)) {
    return NextResponse.json({ error: "URL refusée" }, { status: 400 });
  }
  const res = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) {
    // Une photo de référence dont l'hôte Kie a expiré se sert depuis sa copie locale.
    const local = await readReferenceByUrl(url).catch(() => null);
    if (local) {
      return new NextResponse(new Uint8Array(local.data), {
        headers: { "Content-Type": local.type, "Cache-Control": "private, max-age=3600" },
      });
    }
    return NextResponse.json({ error: "Asset introuvable" }, { status: 502 });
  }
  const type = res.headers.get("content-type") || "application/octet-stream";
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
