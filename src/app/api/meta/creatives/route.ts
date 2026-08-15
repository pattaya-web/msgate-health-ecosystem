import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { fetchCreatives } from "@/lib/meta/creatives";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Guard against a mis-click asking for a whole account at once. */
const MAX_IDS = 200;

async function handle(ids: string[], force: boolean) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }
  if (!ids.length) {
    return NextResponse.json({ error: "Aucun identifiant de publicité fourni." }, { status: 400 });
  }

  try {
    const { creatives, errors } = await fetchCreatives(ids.slice(0, MAX_IDS), { force });
    return NextResponse.json({ ok: true, creatives, errors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Créatifs indisponibles" },
      { status: 502 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = (searchParams.get("ids") || "").split(",").map((id) => id.trim()).filter(Boolean);
  return handle(ids, searchParams.get("refresh") === "1");
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[]; refresh?: boolean };
  return handle(Array.isArray(body.ids) ? body.ids.map(String) : [], Boolean(body.refresh));
}
