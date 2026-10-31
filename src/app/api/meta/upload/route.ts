import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { createAdsFromTemplate, listAccountStructure, listUploadAccounts } from "@/lib/meta/uploader";
import { OutOfScopeError, assertAccountInScope, assertObjectsInScope, associateAccountsFor } from "@/lib/associate/meta-access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }
  try {
    const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
    const scoped = await associateAccountsFor(request);
    if (!accountId) {
      const accounts = await listUploadAccounts();
      return NextResponse.json({ accounts: scoped ? accounts.filter((account) => scoped.includes(account.accountId)) : accounts });
    }
    if (scoped) assertAccountInScope(accountId, scoped);
    const tree = await listAccountStructure(accountId);
    return NextResponse.json(tree);
  } catch (error) {
    if (error instanceof OutOfScopeError) return NextResponse.json({ error: error.message }, { status: 403 });
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
    const scoped = await associateAccountsFor(request);
    if (scoped) {
      assertAccountInScope(String(body.accountId), scoped);
      // Les modèles (campagne, ad set, pub source) doivent eux aussi venir de ses comptes.
      await assertObjectsInScope([body.sourceCampaignId, body.sourceAdsetId, body.sourceAdId].filter((id): id is string => Boolean(id)), scoped);
    }
    const result = await createAdsFromTemplate(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OutOfScopeError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Création ads impossible" },
      { status: 502 }
    );
  }
}
