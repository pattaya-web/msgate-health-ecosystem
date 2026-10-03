import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { ensureThumb, thumbWidth } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".jpe": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  // Le nom est généré par /api/upload : tout ce qui sort de ce gabarit est rejeté,
  // ce qui ferme la porte aux remontées de répertoire.
  if (!/^[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(file)) {
    return NextResponse.json({ error: "Nom de fichier invalide" }, { status: 400 });
  }

  const full = path.join(MEDIA_DIR, file);
  if (!full.startsWith(MEDIA_DIR) || !fs.existsSync(full)) {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }

  /*
   * ?poster=1 : vignette JPEG (image fixe d'une video, image reduite), voir
   * lib/thumbs. Immuable comme le media. 404 si elle ne peut pas etre faite :
   * le composant retombe alors sur le media lui-meme.
   */
  if (req.nextUrl.searchParams.get("poster") === "1") {
    const thumb = await ensureThumb(file, thumbWidth(req.nextUrl.searchParams.get("w")));
    if (!thumb) return NextResponse.json({ error: "Pas de vignette" }, { status: 404 });
    const tstat = fs.statSync(thumb);
    return new NextResponse(fs.createReadStream(thumb) as unknown as ReadableStream, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(tstat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const stat = fs.statSync(full);
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");

  /**
   * ?download=1 force le telechargement au lieu de la lecture, et &name=
   * restitue le nom d'origine : le monteur recupere « hook-terrasse.mp4 » et
   * pas l'identifiant genere au stockage.
   */
  const wantsDownload = req.nextUrl.searchParams.get("download") === "1";
  const disposition = wantsDownload
    ? `attachment; filename*=UTF-8''${encodeURIComponent(
        req.nextUrl.searchParams.get("name")?.replace(/[\r\n"]/g, "") || file,
      )}`
    : "";

  // Le navigateur exige les requêtes Range pour pouvoir scrubber une vidéo.
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stat.size - 1;
    const chunk = fs.createReadStream(full, { start, end });
    return new NextResponse(chunk as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...(disposition ? { "Content-Disposition": disposition } : {}),
      },
    });
  }

  const stream = fs.createReadStream(full);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      // Le nom est un identifiant aleatoire jamais reutilise : le navigateur
      // (et un CDN) peuvent garder le fichier un an sans redemander.
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(disposition ? { "Content-Disposition": disposition } : {}),
    },
  });
}
