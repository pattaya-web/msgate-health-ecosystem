import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { SHARED_ROOT, cleanPath, contentTypeOf, readDriveFile } from "@/lib/drive/store";

export const dynamic = "force-dynamic";

/** Sert un fichier du Drive, en aperçu ou en téléchargement (l'associé, dans « Commun » seulement). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const asked = cleanPath(params.get("path"));
  if (!asked) return NextResponse.json({ error: "Chemin manquant" }, { status: 400 });
  const rel = sessionFromRequest(request)?.role === "associate" ? `${SHARED_ROOT}/${asked}` : asked;
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
