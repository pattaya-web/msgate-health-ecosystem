import { NextResponse } from "next/server";
import { readPoster } from "@/lib/creative-library/store";

export const dynamic = "force-dynamic";

/** L'affiche d'un style : l'image de référence, ou la première image de la vidéo. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Identifiant manquant" }, { status: 400 });
  const poster = await readPoster(id);
  if (!poster) return NextResponse.json({ error: "Affiche introuvable" }, { status: 404 });
  return new NextResponse(new Uint8Array(poster.data), {
    headers: {
      "Content-Type": poster.type,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
