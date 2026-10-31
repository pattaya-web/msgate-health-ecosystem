import { discoverAdAccounts, getMetaConfigWithExtras } from "@/lib/meta/client";

/**
 * La dépense Meta du périmètre associé, lue directement sur ses comptes.
 *
 * L'arbre complet de l'Ads Manager (src/lib/meta/tree.ts) parcourt tous les
 * BM, toutes les campagnes, ad sets et pubs : 10 s et plus. Le tableau de bord
 * d'Alison n'a besoin que des campagnes de deux comptes : deux appels par
 * compte (insights par campagne + statut des campagnes), en parallèle, ~1 s.
 */

const GRAPH = "https://graph.facebook.com";
/** Quel jeton ouvre quel compte : ça ne bouge presque jamais, relu toutes les 30 min. */
const ACCOUNTS_TTL_MS = 30 * 60_000;
/** La dépense d'une période qui contient aujourd'hui bouge en continu : relue chaque minute. */
const SPEND_TTL_MS = 60_000;

const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
type ActionRow = { action_type: string; value: string };

function pickAction(rows: ActionRow[] | undefined) {
  if (!rows?.length) return 0;
  for (const type of PURCHASE_ACTIONS) {
    const hit = rows.find((row) => row.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export type FastAccount = { accountId: string; name: string; currency: string; token: string };
export type FastCampaign = { id: string; name: string; status: string; spend: number; purchases: number; purchaseValue: number };
export type FastAccountSpend = { account: FastAccount; spend: number; campaigns: FastCampaign[] };

const state = ((globalThis as typeof globalThis & {
  __msgateMetaFast?: {
    accounts: { at: number; list: FastAccount[]; apiVersion: string } | null;
    spend: Map<string, { at: number; rows: FastAccountSpend[] }>;
  };
}).__msgateMetaFast ??= { accounts: null, spend: new Map() });

async function graphJson<T>(url: string): Promise<T & { error?: { message: string } }> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  return (await res.json()) as T & { error?: { message: string } };
}

/** Les comptes publicitaires visibles et le jeton qui ouvre chacun. */
export async function knownAccounts(force = false) {
  if (!force && state.accounts && Date.now() - state.accounts.at < ACCOUNTS_TTL_MS) return state.accounts;
  const config = await getMetaConfigWithExtras();
  if (!config) throw new Error("Meta n'est pas branché (META_ACCESS_TOKENS)");
  const { accounts, errors } = await discoverAdAccounts(config);
  if (!accounts.length && errors.length) throw new Error(errors[0]);
  state.accounts = {
    at: Date.now(),
    apiVersion: config.apiVersion,
    list: accounts.map((account) => ({ accountId: account.accountId, name: account.name, currency: account.currency, token: account.token })),
  };
  return state.accounts;
}

type InsightRow = { campaign_id?: string; campaign_name?: string; spend?: string; actions?: ActionRow[]; action_values?: ActionRow[] };
type CampaignRow = { id: string; name: string; effective_status?: string };

async function accountSpend(account: FastAccount, apiVersion: string, start: string, end: string): Promise<FastAccountSpend> {
  const token = `access_token=${encodeURIComponent(account.token)}`;
  const range = `time_range=${encodeURIComponent(JSON.stringify({ since: start, until: end }))}`;
  const [insights, campaigns] = await Promise.all([
    graphJson<{ data?: InsightRow[] }>(
      `${GRAPH}/${apiVersion}/act_${account.accountId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,actions,action_values&limit=500&${range}&${token}`
    ),
    graphJson<{ data?: CampaignRow[] }>(`${GRAPH}/${apiVersion}/act_${account.accountId}/campaigns?fields=id,name,effective_status&limit=500&${token}`),
  ]);
  if (insights.error) throw new Error(`Meta (${account.name}) : ${insights.error.message}`);
  const status = new Map((campaigns.data ?? []).map((row) => [row.id, row.effective_status ?? ""]));
  const rows: FastCampaign[] = (insights.data ?? []).map((row) => ({
    id: row.campaign_id ?? "",
    name: row.campaign_name ?? "",
    status: status.get(row.campaign_id ?? "") ?? "",
    spend: Number(row.spend) || 0,
    purchases: pickAction(row.actions),
    purchaseValue: pickAction(row.action_values),
  }));
  return { account, spend: rows.reduce((sum, row) => sum + row.spend, 0), campaigns: rows };
}

/**
 * La dépense des comptes retenus (et de ceux dont le nom contient le mot-clé)
 * sur la période, par campagne. Gardée une minute ; `force` relit tout de suite.
 */
export async function fastScopedSpend(params: { start: string; end: string; accountIds: string[]; keyword: string; force?: boolean }): Promise<FastAccountSpend[]> {
  const key = `${params.start}:${params.end}:${params.accountIds.join(",")}:${params.keyword}`;
  const hit = state.spend.get(key);
  if (!params.force && hit && Date.now() - hit.at < SPEND_TTL_MS) return hit.rows;
  const { list, apiVersion } = await knownAccounts();
  const keyword = params.keyword.trim().toLowerCase();
  const picked = list.filter((account) => params.accountIds.includes(account.accountId) || (keyword && account.name.toLowerCase().includes(keyword)));
  const rows = await Promise.all(picked.map((account) => accountSpend(account, apiVersion, params.start, params.end)));
  state.spend.set(key, { at: Date.now(), rows });
  return rows;
}
