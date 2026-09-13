import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ROOT = path.join(process.cwd(), "data", "references");

/** Sert une image de référence (affiche de recette) depuis data/references/. */
export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get("file");
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  const target = path.normalize(path.join(ROOT, file));
  if (!target.startsWith(ROOT)) return NextResponse.json({ error: "Chemin refusé" }, { status: 400 });
  try {
    const data = await readFile(target);
    const type = /\.png$/i.test(target) ? "image/png" : /\.webp$/i.test(target) ? "image/webp" : "image/jpeg";
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Affiche introuvable" }, { status: 404 });
  }
}
