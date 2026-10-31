import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { fetchCreatives } from "@/lib/meta/creatives";
import { associateAccountsFor } from "@/lib/associate/meta-access";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Guard against a mis-click asking for a whole account at once. */
const MAX_IDS = 200;

async function handle(ids: string[], force: boolean, scoped: string[] | null = null) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }
  if (!ids.length) {
    return NextResponse.json({ error: "Aucun identifiant de publicité fourni." }, { status: 400 });
  }

  try {
    const { creatives, errors } = await fetchCreatives(ids.slice(0, MAX_IDS), { force });
    // Associé : seulement les pubs de ses comptes.
    const visible = scoped ? creatives.filter((creative) => scoped.includes(creative.accountId.replace(/^act_/, ""))) : creatives;
    return NextResponse.json({ ok: true, creatives: visible, errors: scoped ? [] : errors });
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
  return handle(ids, searchParams.get("refresh") === "1", await associateAccountsFor(request));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[]; refresh?: boolean };
  return handle(Array.isArray(body.ids) ? body.ids.map(String) : [], Boolean(body.refresh), await associateAccountsFor(request));
}
