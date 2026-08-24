import { NextResponse } from "next/server";
import { readBatchFile } from "@/lib/ugc/store";

export const dynamic = "force-dynamic";

/** Sert les mp4 rapatriés : ils survivent à l'expiration des URLs Kie. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const file = params.get("file");
  if (!id || !file) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });

  try {
    const data = await readBatchFile(id, file);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `inline; filename="${file}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }
}
