import { knownAccounts } from "@/lib/associate/meta-fast";

/**
 * Meta jour par jour, au niveau de chaque pub, pour la page Pilotage : un
 * appel d'insights par compte (time_increment=1) plutôt qu'un arbre complet
 * par jour.
 */

const GRAPH = "https://graph.facebook.com";
const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const LPV_ACTIONS = ["omni_landing_page_view", "landing_page_view"];

type ActionRow = { action_type: string; value: string };

function pick(rows: ActionRow[] | undefined, types: string[]) {
  if (!rows?.length) return 0;
  for (const type of types) {
    const hit = rows.find((row) => row.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export type AdDay = {
  date: string;
  accountId: string;
  currency: string;
  adId: string;
  adsetId: string;
  campaignId: string;
  campaignName: string;
  /** Dans la devise du compte. */
  spend: number;
  value: number;
  impressions: number;
  clicks: number;
  purchases: number;
  /** Vues de la page de destination : les « visites » venues de la pub. */
  lpv: number;
};

type Paged<T> = { data?: T[]; paging?: { next?: string }; error?: { message: string } };

async function pages<T>(url: string): Promise<T[]> {
  const rows: T[] = [];
  let next: string | undefined = url;
  for (let i = 0; next && i < 20; i++) {
    const res = await fetch(next, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const body = (await res.json()) as Paged<T>;
    if (body.error) throw new Error(body.error.message);
    rows.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  return rows;
}

const state = ((globalThis as typeof globalThis & {
  __msgatePilotageMeta?: { daily: Map<string, { at: number; rows: AdDay[] }> };
}).__msgatePilotageMeta ??= { daily: new Map() });

async function scopedAccounts(accountIds: string[]) {
  const { list, apiVersion } = await knownAccounts();
  return { apiVersion, accounts: list.filter((account) => accountIds.includes(account.accountId)) };
}

/** Les chiffres de chaque pub, jour par jour, du `start` au `end` (fuseau du compte). Gardés 2 minutes. */
export async function adDailyInsights(accountIds: string[], start: string, end: string): Promise<AdDay[]> {
  const key = `${accountIds.join(",")}:${start}:${end}`;
  const hit = state.daily.get(key);
  if (hit && Date.now() - hit.at < 2 * 60_000) return hit.rows;
  const { apiVersion, accounts } = await scopedAccounts(accountIds);
  const range = encodeURIComponent(JSON.stringify({ since: start, until: end }));
  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      const rows = await pages<{
        date_start?: string;
        ad_id?: string;
        adset_id?: string;
        campaign_id?: string;
        campaign_name?: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        actions?: ActionRow[];
        action_values?: ActionRow[];
      }>(
        `${GRAPH}/${apiVersion}/act_${account.accountId}/insights?level=ad&time_increment=1&fields=ad_id,adset_id,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values&limit=500&time_range=${range}&access_token=${encodeURIComponent(account.token)}`
      );
      return rows.map(
        (row): AdDay => ({
          date: row.date_start ?? "",
          accountId: account.accountId,
          currency: account.currency,
          adId: row.ad_id ?? "",
          adsetId: row.adset_id ?? "",
          campaignId: row.campaign_id ?? "",
          campaignName: row.campaign_name ?? "",
          spend: Number(row.spend) || 0,
          value: pick(row.action_values, PURCHASE_ACTIONS),
          impressions: Number(row.impressions) || 0,
          clicks: Number(row.clicks) || 0,
          purchases: pick(row.actions, PURCHASE_ACTIONS),
          lpv: pick(row.actions, LPV_ACTIONS),
        })
      );
    })
  );
  const rows = perAccount.flat();
  state.daily.set(key, { at: Date.now(), rows });
  return rows;
}
