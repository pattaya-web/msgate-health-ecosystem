import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { createAdsFromTemplate, listAccountStructure, listUploadAccounts, previewPost, readAdCopy } from "@/lib/meta/uploader";
import { REPORT_CURRENCY, fxRates } from "@/lib/fx";
import { OutOfScopeError, assertAccountInScope, assertObjectsInScope, associateAccountsFor } from "@/lib/associate/meta-access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }
  try {
    const params = new URL(request.url).searchParams;
    const accountId = params.get("accountId")?.trim();
    const scoped = await associateAccountsFor(request);
    // ?adId= : les textes d'une pub existante, pour s'en servir de modèle.
    const adId = params.get("adId")?.trim();
    if (adId) {
      if (scoped) await assertObjectsInScope([adId], scoped);
      return NextResponse.json({ copy: await readAdCopy(adId) });
    }
    // ?postId=&accountId= : l'aperçu Meta d'une publication existante, avant d'en faire une pub.
    const postId = params.get("postId")?.trim();
    if (postId) {
      if (!accountId) return NextResponse.json({ error: "Choisis d'abord un compte" }, { status: 400 });
      if (scoped) assertAccountInScope(accountId, scoped);
      try {
        return NextResponse.json({ preview: await previewPost(accountId, postId) });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Aperçu indisponible" }, { status: 404 });
      }
    }
    if (!accountId) {
      const all = await listUploadAccounts();
      const accounts = scoped ? all.filter((account) => scoped.includes(account.accountId)) : all;
      // Les taux vers le dollar : le budget se saisit en $, Meta le reçoit dans la devise du compte.
      const rates = await fxRates(new Set(accounts.map((account) => account.currency).filter(Boolean)), REPORT_CURRENCY).catch(() => null);
      const fx = rates ? Object.fromEntries([...rates.entries()].map(([currency, rate]) => [currency, rate.rate])) : {};
      return NextResponse.json({ accounts, fx });
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
