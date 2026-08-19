import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { createAdsFromTemplate, listAccountStructure, listUploadAccounts } from "@/lib/meta/uploader";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }
  try {
    const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
    if (!accountId) {
      const accounts = await listUploadAccounts();
      return NextResponse.json({ accounts });
    }
    const tree = await listAccountStructure(accountId);
    return NextResponse.json(tree);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Structure Meta indisponible" },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }
  try {
    const body = (await request.json()) as Parameters<typeof createAdsFromTemplate>[0];
    if (!body?.accountId) {
      return NextResponse.json({ error: "accountId manquant" }, { status: 400 });
    }
    const result = await createAdsFromTemplate(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Création ads impossible" },
      { status: 502 }
    );
  }
}
