import { NextResponse } from "next/server";
import {
  contentDisposition,
  extensionFor,
  isAllowedAssetUrl,
  safeFileName,
} from "@/lib/meta/download";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url") || "";
  const name = searchParams.get("name") || "creative";
  const kind = searchParams.get("kind") === "video" ? "video" : "image";
  const inline = searchParams.get("inline") === "1";

  if (!isAllowedAssetUrl(url)) {
    return NextResponse.json({ error: "URL de média non autorisée." }, { status: 400 });
  }

  const upstream = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      // Some Meta permalinks refuse empty / foreign Referer.
      "User-Agent": "Mozilla/5.0 (compatible; MSGATE/1.0)",
    },
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Meta a refusé le fichier (${upstream.status}).` },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type");
  const filename = `${safeFileName(name)}.${extensionFor(url, contentType, kind)}`;
  const length = upstream.headers.get("content-length");
  const disposition = inline
    ? `inline; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    : contentDisposition(filename);

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Content-Disposition": disposition,
      ...(length ? { "Content-Length": length } : {}),
      "Cache-Control": "private, max-age=300",
    },
  });
}
