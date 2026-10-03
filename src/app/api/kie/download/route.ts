import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Hotes de resultats KIE. La liste est fermee : sans elle, la route relaierait
 * n'importe quelle URL fournie par le client, y compris des adresses internes.
 */
const ALLOWED = new Set([
  "file.aiquickdraw.com",
  "tempfile.aiquickdraw.com",
  "static.aiquickdraw.com",
  "tempfile.redpandaai.co",
  "kieai.redpandaai.co",
]);

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Telechargement d'un resultat.
 *
 * Les fichiers sont sur le CDN de KIE : un lien `download` vers un autre
 * domaine est ignore par le navigateur, qui se contente d'ouvrir l'onglet. On
 * relaie donc les octets pour poser un Content-Disposition.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "URL manquante." }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "URL invalide." }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED.has(target.hostname)) {
    return NextResponse.json({ error: "Domaine non autorisé." }, { status: 400 });
  }

  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Fichier indisponible (${upstream.status}).` }, { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  const base = req.nextUrl.searchParams.get("name")?.replace(/[/\?%*:|"<>\r\n]/g, "") || "generation";
  const ext = EXT[type.split(";")[0]] ?? target.pathname.split(".").pop() ?? "bin";

  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${base}.${ext}"`,
    "Cache-Control": "private, max-age=3600",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new NextResponse(upstream.body, { headers });
}
