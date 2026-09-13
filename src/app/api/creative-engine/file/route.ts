import { NextResponse } from "next/server";
import { readBatchFile } from "@/lib/creative-engine/store";

export const dynamic = "force-dynamic";

/** Sert une créa rapatriée d'un lot : elle survit à l'expiration des URL Kie. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const batch = params.get("batch");
  const file = params.get("file");
  if (!batch || !file) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  try {
    const data = await readBatchFile(batch, file);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `${params.get("download") ? "attachment" : "inline"}; filename="${params.get("name") || file}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }
}
