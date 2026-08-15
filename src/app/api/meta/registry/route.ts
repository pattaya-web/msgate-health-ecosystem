import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { invalidateTreeCache } from "@/lib/meta/tree";
import {
  acknowledgeAccounts,
  addStoredToken,
  getAutoDetect,
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

      // Smoke-check the token before storing it so a typo does not pollute the board.
      const probe = await graphGet<GraphError & { data?: unknown[] }>(
        "me/adaccounts?fields=account_id&limit=1",
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
      return NextResponse.json({
        ok: true,
        ...result,
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
