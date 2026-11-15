import { NextResponse } from "next/server";
import { isMetaConfigured, invalidateSpendCache, invalidateAccountDiscovery } from "@/lib/meta/client";
import { invalidateTreeCache } from "@/lib/meta/tree";
import {
  acknowledgeAccounts,
  addStoredToken,
  getAutoDetect,
  listRetiredTokens,
  listStoredTokens,
  removeStoredToken,
  setAutoDetect,
} from "@/lib/meta/registry";
import { graphGet, type GraphError } from "@/lib/meta/graph";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    autoDetect: await getAutoDetect(),
    tokens: await listStoredTokens(),
    // Jetons écartés automatiquement (morts chez Meta) : empreinte, raison, date — jamais la valeur.
    retired: await listRetiredTokens(),
  });
}

export async function POST(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      action?: "add-token" | "remove-token" | "auto-detect" | "acknowledge";
      token?: string;
      label?: string;
      id?: string;
      enabled?: boolean;
      accountIds?: string[];
    };

    if (body.action === "add-token") {
      if (!body.token?.trim()) {
        return NextResponse.json({ error: "Colle le token Meta envoyé par l'agence." }, { status: 400 });
      }

      // Vérifié avant d'être gardé : une faute de frappe ne pollue pas le tableau. La réponse
      // liste les comptes publicitaires que le jeton voit, pour confirmer le bon branchement.
      const probe = await graphGet<GraphError & { data?: Array<{ account_id: string; name: string; account_status: number; currency?: string; business?: { name?: string } }> }>(
        "me/adaccounts?fields=account_id,name,account_status,currency,business{name}&limit=200",
        body.token.trim()
      );
      if (probe.error) {
        return NextResponse.json(
          { error: `Token refusé par Meta : ${probe.error.message}` },
          { status: 400 }
        );
      }

      const result = await addStoredToken(body.label || "Agence Meta", body.token);
      invalidateTreeCache();
      invalidateAccountDiscovery();
      invalidateSpendCache();
      return NextResponse.json({
        ok: true,
        ...result,
        accounts: (probe.data ?? []).map((row) => ({
          accountId: row.account_id,
          name: row.name,
          status: row.account_status,
          currency: row.currency ?? "",
          business: row.business?.name ?? "",
        })),
        tokens: await listStoredTokens(),
      });
    }

    if (body.action === "remove-token") {
      if (!body.id) {
        return NextResponse.json({ error: "id manquant" }, { status: 400 });
      }
      await removeStoredToken(body.id);
      invalidateTreeCache();
      return NextResponse.json({ ok: true, tokens: await listStoredTokens() });
    }

    if (body.action === "auto-detect") {
      const enabled = await setAutoDetect(Boolean(body.enabled));
      return NextResponse.json({ ok: true, autoDetect: enabled });
    }

    if (body.action === "acknowledge") {
      await acknowledgeAccounts(body.accountIds);
      invalidateTreeCache();
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action inconnue" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Registry impossible" },
      { status: 502 }
    );
  }
}
