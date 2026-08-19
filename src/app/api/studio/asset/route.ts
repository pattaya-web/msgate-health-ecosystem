import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OK = /(aiquickdraw|kie\.ai|redpandaai\.co|amazonaws\.com|cloudfront\.net|aliyuncs\.com|googleapis\.com)/i;

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url || !/^https:\/\//i.test(url) || !OK.test(url)) {
    return NextResponse.json({ error: "URL refusée" }, { status: 400 });
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "Asset introuvable" }, { status: 502 });
  const type = res.headers.get("content-type") || "application/octet-stream";
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
