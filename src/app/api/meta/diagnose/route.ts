import { NextResponse } from "next/server";
import { getMetaConfig } from "@/lib/meta/client";
import { listStoredTokens, getExtraTokens } from "@/lib/meta/registry";
import { sessionFromRequest } from "@/lib/auth/request";
import { resolveToken } from "@/lib/meta/token";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GRAPH = "https://graph.facebook.com";

type Row = { id?: string; account_id?: string; name?: string; account_status?: number; business?: { id?: string; name?: string } };
type Page = { data?: Row[]; paging?: { next?: string }; error?: { message: string; code?: number; error_subcode?: number } };

/** Une page Meta, réduite à ce qu'on peut montrer : jamais le jeton, jamais l'URL `next` (elle le contient). */
async function read(url: string): Promise<Page> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))) as Page;
}

async function allPages(firstUrl: string, maxPages = 10) {
  const pages: Array<{ count: number; hasNext: boolean; error?: Page["error"] }> = [];
  const rows: Row[] = [];
  let url: string | undefined = firstUrl;
  for (let i = 0; url && i < maxPages; i += 1) {
    const body = await read(url);
    pages.push({ count: body.data?.length ?? 0, hasNext: Boolean(body.paging?.next), error: body.error });
    if (body.error) break;
    rows.push(...(body.data ?? []));
    url = body.paging?.next;
  }
  return { pages, rows };
}

/**
 * Diagnostic de visibilité d'un compte publicitaire, admin seulement.
 *
 * Pour chaque jeton (env et registre), désigné par sa place et son libellé —
 * jamais par sa valeur — : ce que Meta renvoie sur /me/adaccounts (toutes les
 * pages), sur les comptes clients et possédés de chaque Business Manager du
 * jeton, et en lecture directe du compte. Plus le filtre META_AD_ACCOUNT_IDS.
 */
export async function GET(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Admin seulement" }, { status: 403 });
  const config = getMetaConfig();
  if (!config) return NextResponse.json({ error: "Meta non configuré" }, { status: 503 });

  /*
   * ?object=<id>&fields=<champs> : lecture brute d'un objet Meta (compte, ad
   * set, pixel…) avec le jeton qui l'ouvre — lecture seule, jeton jamais renvoyé.
   * ?object=act_123/adsets&fields=name,promoted_object pour une liste.
   */
  const params = new URL(request.url).searchParams;
  const object = params.get("object")?.trim();
  if (object) {
    if (!/^[A-Za-z0-9_]+(\/[a-z_]+)?$/.test(object)) return NextResponse.json({ error: "objet invalide" }, { status: 400 });
    const fields = (params.get("fields") ?? "id,name").replace(/[^A-Za-z0-9_,{}.()]/g, "");
    const token = await resolveToken(object.split("/")[0]);
    const body = await read(`${GRAPH}/${config.apiVersion}/${object}?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(token)}`);
    const clean = { ...body, paging: body.paging ? { hasNext: Boolean(body.paging.next) } : undefined };
    return NextResponse.json({ object, fields, result: clean });
  }

  const target = (params.get("account") ?? "").replace(/^act_/, "").trim();
  const stored = await listStoredTokens();
  const extra = await getExtraTokens();
  const tokens = [
    ...config.tokens.map((token, index) => ({ token, source: `env #${index + 1}` })),
    ...extra.map((token, index) => ({ token, source: `registre « ${stored[index]?.label ?? index + 1} »` })),
  ].filter((entry, index, all) => all.findIndex((other) => other.token === entry.token) === index);

  const v = config.apiVersion;
  const results = [];
  for (const { token, source } of tokens) {
    const auth = `access_token=${encodeURIComponent(token)}`;
    const me = await read(`${GRAPH}/${v}/me?fields=id,name&${auth}`);
    const mine = await allPages(`${GRAPH}/${v}/me/adaccounts?fields=id,name,account_status,business{id,name}&limit=200&${auth}`);
    const businesses = await allPages(`${GRAPH}/${v}/me/businesses?fields=id,name&limit=100&${auth}`, 3);
    const perBusiness = [];
    for (const business of businesses.rows.slice(0, 10)) {
      const client = await allPages(`${GRAPH}/${v}/${business.id}/client_ad_accounts?fields=id,name,account_status&limit=200&${auth}`, 5);
      const owned = await allPages(`${GRAPH}/${v}/${business.id}/owned_ad_accounts?fields=id,name,account_status&limit=200&${auth}`, 5);
      perBusiness.push({
        business: `${business.name} (${business.id})`,
        client: { pages: client.pages, count: client.rows.length, hasTarget: client.rows.some((row) => row.id === `act_${target}`) },
        owned: { pages: owned.pages, count: owned.rows.length, hasTarget: owned.rows.some((row) => row.id === `act_${target}`) },
      });
    }
    const direct = target ? await read(`${GRAPH}/${v}/act_${target}?fields=id,name,account_status,currency,business{id,name}&${auth}`) : null;
    results.push({
      token: source,
      me: me.error ? { error: me.error } : { id: (me as Row).id, name: (me as Row).name },
      adaccounts: {
        pages: mine.pages,
        count: mine.rows.length,
        hasTarget: mine.rows.some((row) => row.id === `act_${target}`),
        accounts: mine.rows.map((row) => `${row.id} · ${row.name} · status ${row.account_status} · BM ${row.business?.name ?? "—"} (${row.business?.id ?? "—"})`),
      },
      businesses: { pages: businesses.pages, list: perBusiness },
      directRead: direct,
    });
  }

  return NextResponse.json({
    target: target ? `act_${target}` : null,
    accountFilter: config.accountFilter,
    targetInFilter: target ? config.accountFilter.includes(target) : null,
    tokens: results,
  });
}
