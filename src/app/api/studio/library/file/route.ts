import { NextResponse } from "next/server";
import { isCreativeId, isLibraryFile, readCreativeFile } from "@/lib/studio/library";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const id = search.get("id")?.trim() || "";
  const file = search.get("file")?.trim() || "";
  if (!isCreativeId(id) || !isLibraryFile(file)) {
    return NextResponse.json({ error: "Fichier refusé" }, { status: 400 });
  }
  const buf = await readCreativeFile(id, file);
  if (!buf) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  const ext = file.split(".").pop()?.toLowerCase() || "png";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
