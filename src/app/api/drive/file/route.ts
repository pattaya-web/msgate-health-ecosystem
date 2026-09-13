import { NextResponse } from "next/server";
import { cleanPath, contentTypeOf, readDriveFile } from "@/lib/drive/store";

export const dynamic = "force-dynamic";

/** Sert un fichier du Drive, en aperçu ou en téléchargement. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rel = cleanPath(params.get("path"));
  if (!rel) return NextResponse.json({ error: "Chemin manquant" }, { status: 400 });
  try {
    const { data, name } = await readDriveFile(rel);
    const disposition = params.get("download") ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeOf(name),
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }
}
