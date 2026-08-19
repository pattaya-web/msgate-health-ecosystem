import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { uploadMediaFile } from "@/lib/meta/uploader";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }
  try {
    const form = await request.formData();
    const accountId = String(form.get("accountId") || "");
    const file = form.get("file");
    if (!accountId || !(file instanceof File)) {
      return NextResponse.json({ error: "accountId + file requis" }, { status: 400 });
    }
    const media = await uploadMediaFile(accountId, file);
    return NextResponse.json({ ok: true, media });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload média impossible" },
      { status: 502 }
    );
  }
}
