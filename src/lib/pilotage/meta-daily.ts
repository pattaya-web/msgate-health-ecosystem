import { knownAccounts } from "@/lib/associate/meta-fast";
import { guardedTtl, isMetaRateLimit } from "@/lib/meta/usage-log";

/**
 * Meta jour par jour, au niveau de chaque pub, pour la page Pilotage : un
 * appel d'insights par compte (time_increment=1) plutôt qu'un arbre complet
 * par jour.
 */

const GRAPH = "https://graph.facebook.com";
const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const LPV_ACTIONS = ["omni_landing_page_view", "landing_page_view"];
const CART_ACTIONS = ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];

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
  /** Ajouts au panier attribués à la pub. */
  carts: number;
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
  __msgatePilotageMeta?: { daily: Map<string, { at: number; rows: AdDay[] }>; inflight?: Map<string, Promise<AdDay[]>> };
}).__msgatePilotageMeta ??= { daily: new Map(), inflight: new Map() }) as { daily: Map<string, { at: number; rows: AdDay[] }>; inflight?: Map<string, Promise<AdDay[]>> };
state.inflight ??= new Map();

function minusDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function scopedAccounts(accountIds: string[]) {
  const { list, apiVersion } = await knownAccounts();
  return { apiVersion, accounts: list.filter((account) => accountIds.includes(account.accountId)) };
}

/**
 * Les chiffres de chaque pub, jour par jour, du `start` au `end` (fuseau du compte).
 * Une seule lecture Meta de 14 jours au moins sert tous les appels (Pilotage, rampe,
 * pipeline) : gardée 5 minutes, et deux appels simultanés attendent la même lecture.
 */
export async function adDailyInsights(accountIds: string[], start: string, end: string): Promise<AdDay[]> {
  const from = start < minusDays(end, 14) ? start : minusDays(end, 14);
  const rows = await readDaily(accountIds, from, end);
  return rows.filter((row) => row.date >= start && row.date <= end);
}

async function readDaily(accountIds: string[], start: string, end: string): Promise<AdDay[]> {
  const key = `${accountIds.join(",")}:${start}:${end}`;
  const hit = state.daily.get(key);
  if (hit && Date.now() - hit.at < guardedTtl(5 * 60_000, accountIds)) return hit.rows;
  const pending = state.inflight!.get(key);
  if (pending) return pending;
  const promise = fetchDaily(accountIds, start, end, key)
    // Meta freine : la dernière lecture plutôt qu'une erreur.
    .catch((error: unknown) => {
      if (hit && isMetaRateLimit(error instanceof Error ? error.message : "")) return hit.rows;
      throw error;
    })
    .finally(() => state.inflight!.delete(key));
  state.inflight!.set(key, promise);
  return promise;
}

async function fetchDaily(accountIds: string[], start: string, end: string, key: string): Promise<AdDay[]> {
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
          carts: pick(row.actions, CART_ACTIONS),
        })
      );
    })
  );
  const rows = perAccount.flat();
  state.daily.set(key, { at: Date.now(), rows });
  return rows;
}
