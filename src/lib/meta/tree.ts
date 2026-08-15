import { BUCKET_LABELS, CAMPAIGN_BUCKETS, classifyCampaign } from "@/lib/meta/buckets";
import { getMetaConfigWithExtras } from "@/lib/meta/client";
import { centsToUnits, graphBatch, graphGet, type GraphError } from "@/lib/meta/graph";
import { rememberAccounts } from "@/lib/meta/registry";
import type {
  AccountNode,
  AdNode,
  AdsTree,
  AdsetNode,
  BucketGroup,
  CampaignNode,
  EntityStatus,
  Metrics,
} from "@/lib/meta/types";

/* ------------------------------------------------------------------ *
 * Date range
 * ------------------------------------------------------------------ */

export const DATE_PRESETS = {
  today: "today",
  yesterday: "yesterday",
  last_3d: "last_3d",
  last_7d: "last_7d",
  last_14d: "last_14d",
  last_30d: "last_30d",
  this_month: "this_month",
  last_month: "last_month",
} as const;

export type DatePreset = keyof typeof DATE_PRESETS | "custom";

export function isDatePreset(value: string | null): value is keyof typeof DATE_PRESETS {
  return Boolean(value && value in DATE_PRESETS);
}

/**
 * Meta resolves a preset in each account's own timezone, which is exactly what
 * Ads Manager displays. A custom range is sent verbatim instead.
 */
function dateParam(preset: DatePreset, start?: string, end?: string) {
  if (preset !== "custom") return `date_preset=${DATE_PRESETS[preset]}`;
  return `time_range=${encodeURIComponent(JSON.stringify({ since: start, until: end }))}`;
}

export function resolveRange(preset: DatePreset, start?: string, end?: string) {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (days: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  };

  switch (preset) {
    case "today":
      return { start: iso(today), end: iso(today) };
    case "yesterday":
      return { start: iso(shift(1)), end: iso(shift(1)) };
    case "last_3d":
      return { start: iso(shift(3)), end: iso(shift(1)) };
    case "last_7d":
      return { start: iso(shift(7)), end: iso(shift(1)) };
    case "last_14d":
      return { start: iso(shift(14)), end: iso(shift(1)) };
    case "last_30d":
      return { start: iso(shift(30)), end: iso(shift(1)) };
    case "this_month":
      return { start: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), end: iso(today) };
    case "last_month": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { start: iso(first), end: iso(last) };
    }
    default:
      return { start: start || iso(today), end: end || iso(today) };
  }
}

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

type ActionRow = { action_type: string; value: string };

/** Meta reports the same conversion under several aliases; take the richest. */
const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function pickAction(rows: ActionRow[] | undefined) {
  if (!rows?.length) return 0;
  for (const type of PURCHASE_ACTIONS) {
    const hit = rows.find((row) => row.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export function emptyMetrics(): Metrics {
  return { spend: 0, impressions: 0, clicks: 0, cpc: 0, ctr: 0, purchases: 0, purchaseValue: 0, roas: 0 };
}

/** CPC, CTR and ROAS are ratios: they must be recomputed, never averaged. */
function derive(metrics: Metrics): Metrics {
  const round = (value: number, digits = 2) => Number(value.toFixed(digits));
  return {
    spend: round(metrics.spend),
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    cpc: metrics.clicks > 0 ? round(metrics.spend / metrics.clicks) : 0,
    ctr: metrics.impressions > 0 ? round((metrics.clicks / metrics.impressions) * 100) : 0,
    purchases: metrics.purchases,
    purchaseValue: round(metrics.purchaseValue),
    roas: metrics.spend > 0 ? round(metrics.purchaseValue / metrics.spend) : 0,
  };
}

function accumulate(target: Metrics, source: Metrics) {
  target.spend += source.spend;
  target.impressions += source.impressions;
  target.clicks += source.clicks;
  target.purchases += source.purchases;
  target.purchaseValue += source.purchaseValue;
}

/* ------------------------------------------------------------------ *
 * Raw Graph shapes
 * ------------------------------------------------------------------ */

type Paged<T> = GraphError & { data?: T[]; paging?: { next?: string } };

type RawInsight = {
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: ActionRow[];
  action_values?: ActionRow[];
};

type RawCampaign = {
  id: string;
  name: string;
  status: EntityStatus;
  effective_status: string;
  created_time?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  issues_info?: Array<{
    error_type?: string;
    error_summary?: string;
    error_message?: string;
  }>;
};

type RawAdset = {
  id: string;
  name: string;
  status: EntityStatus;
  effective_status: string;
  created_time?: string;
  campaign_id: string;
  daily_budget?: string;
  lifetime_budget?: string;
};

type RawAd = {
  id: string;
  name: string;
  status: EntityStatus;
  effective_status: string;
  created_time?: string;
  adset_id: string;
  campaign_id: string;
  creative?: { id?: string; thumbnail_url?: string };
};

type RawAccount = {
  account_id: string;
  name: string;
  currency: string;
  account_status: number;
  disable_reason?: number | string;
  amount_spent?: string;
  timezone_name?: string;
  business?: { id: string; name: string };
};

// Archived and deleted objects would multiply the payload for no benefit.
const LIVE_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "IN_PROCESS",
  "WITH_ISSUES",
];

const liveFilter = encodeURIComponent(
  JSON.stringify([{ field: "effective_status", operator: "IN", value: LIVE_STATUSES }])
);

const INSIGHT_FIELDS = "campaign_id,adset_id,ad_id,spend,impressions,clicks,actions,action_values";

/** Absolute cursor URLs already carry their token and query string. */
async function followPages<T>(first: Paged<T>, max = 6): Promise<T[]> {
  const rows = [...(first.data || [])];
  let next = first.paging?.next;
  for (let page = 0; next && page < max; page++) {
    const res = await fetch(next, { cache: "no-store" });
    const body = (await res.json()) as Paged<T>;
    if (body.error) break;
    rows.push(...(body.data || []));
    next = body.paging?.next;
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * Tree
 * ------------------------------------------------------------------ */

type SyncMaps = {
  /** Which token can write to a given object; never sent to the client. */
  tokenByAccount: Map<string, string>;
  tokenByObject: Map<string, string>;
};

type MetaTreeState = {
  cache: Map<string, { at: number; tree: AdsTree }>;
  /** Ad-level lifetime spend changes slowly — reuse across soft syncs. */
  lifetime: Map<string, { at: number; rows: RawInsight[] }>;
  /** Campaigns / adsets / ads — independent of the date window. */
  structure: Map<
    string,
    { at: number; campaigns: RawCampaign[]; adsets: RawAdset[]; ads: RawAd[] }
  >;
  /** Token → ad accounts discovery. */
  owned: {
    at: number;
    accounts: Array<RawAccount & { token: string }>;
    tokensWorking: number;
    errors: string[];
  } | null;
  maps: SyncMaps;
};

const globalRef = globalThis as typeof globalThis & { __msgateMetaTree?: MetaTreeState };

const state: MetaTreeState = (globalRef.__msgateMetaTree ??= {
  cache: new Map(),
  lifetime: new Map(),
  structure: new Map(),
  owned: null,
  maps: { tokenByAccount: new Map(), tokenByObject: new Map() },
});

// Soft refreshes hit cache; Sync forces a rebuild.
// Historical ranges barely move — keep them warm so date toggles feel instant.
const ttlFor = (preset: DatePreset) => (preset === "today" ? 60_000 : 20 * 60_000);
const LIFETIME_TTL_MS = 30 * 60_000;
const STRUCTURE_TTL_MS = 12 * 60_000;
const OWNED_TTL_MS = 12 * 60_000;

export function getTokenForObject(objectId: string) {
  return state.maps.tokenByObject.get(objectId) || null;
}

export function rememberObjectToken(objectId: string, token: string) {
  state.maps.tokenByObject.set(objectId, token);
}

export function getTokenForAccount(accountId: string) {
  return state.maps.tokenByAccount.get(accountId.replace(/^act_/, "")) || null;
}

export function invalidateTreeCache() {
  state.cache.clear();
  state.lifetime.clear();
  state.structure.clear();
  state.owned = null;
}

export async function buildAdsTree(params: {
  preset: DatePreset;
  start?: string;
  end?: string;
  force?: boolean;
}): Promise<AdsTree> {
  const config = await getMetaConfigWithExtras();
  if (!config) throw new Error("Meta is not configured (missing META_ACCESS_TOKENS)");
  const range = resolveRange(params.preset, params.start, params.end);
  const cacheKey = `${params.preset}:${range.start}:${range.end}`;

  const hit = state.cache.get(cacheKey);
  if (!params.force && hit && Date.now() - hit.at < ttlFor(params.preset)) return hit.tree;

  const started = Date.now();
  const errors: string[] = [];
  const dates = dateParam(params.preset, range.start, range.end);
  const now = Date.now();

  // 1. Discover accounts (cached — does not depend on the date window).
  let owned = new Map<string, RawAccount & { token: string }>();
  let tokensWorking = 0;

  const ownedHit =
    !params.force && state.owned && now - state.owned.at < OWNED_TTL_MS ? state.owned : null;

  if (ownedHit) {
    tokensWorking = ownedHit.tokensWorking;
    errors.push(...ownedHit.errors);
    for (const account of ownedHit.accounts) {
      owned.set(account.account_id, account);
      state.maps.tokenByAccount.set(account.account_id, account.token);
    }
  } else {
    const discoverErrors: string[] = [];
    await Promise.all(
      config.tokens.map(async (token, index) => {
        const body = await graphGet<Paged<RawAccount>>(
          "me/adaccounts?fields=account_id,name,currency,account_status,disable_reason,amount_spent,timezone_name,business{id,name}&limit=200",
          token
        );
        if (body.error) {
          discoverErrors.push(`Token #${index + 1} : ${body.error.message}`);
          return;
        }
        tokensWorking += 1;
        for (const account of body.data || []) {
          if (owned.has(account.account_id)) continue;
          if (config.accountFilter.length && !config.accountFilter.includes(account.account_id)) {
            continue;
          }
          owned.set(account.account_id, { ...account, token });
          state.maps.tokenByAccount.set(account.account_id, token);
        }
      })
    );
    errors.push(...discoverErrors);
    state.owned = {
      at: Date.now(),
      accounts: [...owned.values()],
      tokensWorking,
      errors: discoverErrors,
    };
  }

  // 2. Insights per date + structure (campaigns/adsets/ads) when warm.
  const byToken = new Map<string, Array<RawAccount & { token: string }>>();
  for (const account of owned.values()) {
    const list = byToken.get(account.token) ?? [];
    list.push(account);
    byToken.set(account.token, list);
  }

  const insightsByAccount = new Map<string, RawInsight[]>();
  const lifetimeByAccount = new Map<string, RawInsight[]>();
  const campaignsByAccount = new Map<string, RawCampaign[]>();
  const adsetsByAccount = new Map<string, RawAdset[]>();
  const adsByAccount = new Map<string, RawAd[]>();

  await Promise.all(
    [...byToken.entries()].map(async ([token, accounts]) => {
      const tick = Date.now();
      const requests = accounts.flatMap((account) => {
        const act = `act_${account.account_id}`;
        const id = account.account_id;
        const list: Array<{ key: string; relativeUrl: string }> = [
          {
            key: `insights:${id}`,
            relativeUrl: `${act}/insights?level=ad&fields=${INSIGHT_FIELDS}&limit=500&${dates}`,
          },
        ];

        const struct = state.structure.get(id);
        const structFresh =
          !params.force && struct && tick - struct.at < STRUCTURE_TTL_MS;

        if (structFresh && struct) {
          campaignsByAccount.set(id, struct.campaigns);
          adsetsByAccount.set(id, struct.adsets);
          adsByAccount.set(id, struct.ads);
        } else {
          list.push(
            {
              key: `campaigns:${id}`,
              relativeUrl: `${act}/campaigns?fields=id,name,status,effective_status,created_time,objective,daily_budget,lifetime_budget,issues_info&limit=200&filtering=${liveFilter}`,
            },
            {
              key: `adsets:${id}`,
              relativeUrl: `${act}/adsets?fields=id,name,status,effective_status,created_time,campaign_id,daily_budget,lifetime_budget&limit=300&filtering=${liveFilter}`,
            },
            {
              key: `ads:${id}`,
              relativeUrl: `${act}/ads?fields=id,name,status,effective_status,created_time,adset_id,campaign_id,creative{id,thumbnail_url}&limit=500&filtering=${liveFilter}`,
            }
          );
        }

        const cachedLife = state.lifetime.get(id);
        const lifeFresh =
          !params.force && cachedLife && tick - cachedLife.at < LIFETIME_TTL_MS;

        if (lifeFresh && cachedLife) {
          lifetimeByAccount.set(id, cachedLife.rows);
        } else {
          list.push({
            key: `lifetime:${id}`,
            relativeUrl: `${act}/insights?level=ad&fields=ad_id,spend&limit=500&date_preset=maximum`,
          });
        }

        return list;
      });

      const results = await graphBatch<Paged<unknown>>(token, requests);

      await Promise.all(
        results.map(async (result) => {
          const [kind, accountId] = result.key.split(":");
          if (result.error || !result.body) {
            if (result.error) errors.push(`${accountId} (${kind}) : ${result.error}`);
            return;
          }
          const rows = await followPages(result.body);
          if (kind === "insights") insightsByAccount.set(accountId, rows as RawInsight[]);
          if (kind === "lifetime") {
            lifetimeByAccount.set(accountId, rows as RawInsight[]);
            state.lifetime.set(accountId, { at: Date.now(), rows: rows as RawInsight[] });
          }
          if (kind === "campaigns") campaignsByAccount.set(accountId, rows as RawCampaign[]);
          if (kind === "adsets") adsetsByAccount.set(accountId, rows as RawAdset[]);
          if (kind === "ads") adsByAccount.set(accountId, rows as RawAd[]);
        })
      );

      // Persist freshly fetched structure for the next date switch.
      for (const account of accounts) {
        const id = account.account_id;
        if (campaignsByAccount.has(id) && adsetsByAccount.has(id) && adsByAccount.has(id)) {
          state.structure.set(id, {
            at: Date.now(),
            campaigns: campaignsByAccount.get(id) || [],
            adsets: adsetsByAccount.get(id) || [],
            ads: adsByAccount.get(id) || [],
          });
        }
      }
    })
  );

  // 3. Assemble the tree.
  const accountNodes: AccountNode[] = [];
  const currencies = new Set<string>();

  for (const account of owned.values()) {
    const token = account.token;
    currencies.add(account.currency);

    const metricsByAd = new Map<string, Metrics>();
    for (const row of insightsByAccount.get(account.account_id) || []) {
      if (!row.ad_id) continue;
      metricsByAd.set(row.ad_id, {
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        cpc: 0,
        ctr: 0,
        purchases: pickAction(row.actions),
        purchaseValue: pickAction(row.action_values),
        roas: 0,
      });
    }

    const lifetimeByAd = new Map<string, number>();
    for (const row of lifetimeByAccount.get(account.account_id) || []) {
      if (row.ad_id) lifetimeByAd.set(row.ad_id, Number(row.spend) || 0);
    }

    const adsByAdset = new Map<string, AdNode[]>();
    for (const ad of adsByAccount.get(account.account_id) || []) {
      state.maps.tokenByObject.set(ad.id, token);
      const node: AdNode = {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        effectiveStatus: ad.effective_status,
        createdTime: ad.created_time || "",
        adsetId: ad.adset_id,
        campaignId: ad.campaign_id,
        creativeId: ad.creative?.id ?? null,
        thumbnailUrl: ad.creative?.thumbnail_url ?? null,
        lifetimeSpend: lifetimeByAd.get(ad.id) ?? 0,
        metrics: derive(metricsByAd.get(ad.id) ?? emptyMetrics()),
      };
      const list = adsByAdset.get(ad.adset_id) ?? [];
      list.push(node);
      adsByAdset.set(ad.adset_id, list);
    }

    const adsetsByCampaign = new Map<string, AdsetNode[]>();
    for (const adset of adsetsByAccount.get(account.account_id) || []) {
      state.maps.tokenByObject.set(adset.id, token);
      const ads = (adsByAdset.get(adset.id) ?? []).sort((a, b) => b.metrics.spend - a.metrics.spend);
      const totals = emptyMetrics();
      for (const ad of ads) accumulate(totals, ad.metrics);

      const node: AdsetNode = {
        id: adset.id,
        name: adset.name,
        status: adset.status,
        effectiveStatus: adset.effective_status,
        createdTime: adset.created_time || "",
        campaignId: adset.campaign_id,
        dailyBudget: centsToUnits(adset.daily_budget),
        lifetimeBudget: centsToUnits(adset.lifetime_budget),
        activeAds: ads.filter((ad) => ad.status === "ACTIVE").length,
        metrics: derive(totals),
        ads,
      };
      const list = adsetsByCampaign.get(adset.campaign_id) ?? [];
      list.push(node);
      adsetsByCampaign.set(adset.campaign_id, list);
    }

    const campaigns: CampaignNode[] = [];
    for (const campaign of campaignsByAccount.get(account.account_id) || []) {
      state.maps.tokenByObject.set(campaign.id, token);
      const adsets = (adsetsByCampaign.get(campaign.id) ?? []).sort(
        (a, b) => b.metrics.spend - a.metrics.spend
      );
      const totals = emptyMetrics();
      for (const adset of adsets) accumulate(totals, adset.metrics);

      const campaignDaily = centsToUnits(campaign.daily_budget);
      const adsetDaily = adsets
        .filter((adset) => adset.status === "ACTIVE" && adset.effectiveStatus === "ACTIVE")
        .reduce((sum, adset) => sum + adset.dailyBudget, 0);

      campaigns.push({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        effectiveStatus: campaign.effective_status,
        createdTime: campaign.created_time || "",
        objective: campaign.objective || "",
        bucket: classifyCampaign(campaign.name),
        dailyBudget: campaignDaily || adsetDaily,
        lifetimeBudget: centsToUnits(campaign.lifetime_budget),
        budgetLevel: campaignDaily > 0 ? "campaign" : adsetDaily > 0 ? "adset" : "none",
        issues: (campaign.issues_info || [])
          .map((issue) => ({
            type: issue.error_type || "",
            summary: issue.error_summary || "",
            message: issue.error_message || "",
          }))
          .filter((issue) => issue.summary || issue.message || issue.type),
        metrics: derive(totals),
        adsets,
      });
    }

    const accountTotals = emptyMetrics();
    for (const campaign of campaigns) accumulate(accountTotals, campaign.metrics);

    accountNodes.push({
      id: `act_${account.account_id}`,
      accountId: account.account_id,
      name: account.name,
      business: account.business?.name || "",
      currency: account.currency,
      timezone: account.timezone_name || "",
      accountStatus: account.account_status,
      disableReason: Number(account.disable_reason) || 0,
      lifetimeSpend: centsToUnits(account.amount_spent),
      isNew: false,
      dailyBudget: campaigns
        .filter((campaign) => campaign.status === "ACTIVE" && campaign.effectiveStatus === "ACTIVE")
        .reduce((sum, campaign) => sum + campaign.dailyBudget, 0),
      metrics: derive(accountTotals),
      campaigns: campaigns.sort((a, b) => b.metrics.spend - a.metrics.spend),
    });
  }

  const { unacknowledged } = await rememberAccounts(
    accountNodes.map((account) => ({
      accountId: account.accountId,
      name: account.name,
      business: account.business,
    }))
  );
  const newIds = new Set(unacknowledged);
  for (const account of accountNodes) {
    account.isNew = newIds.has(account.accountId);
  }

  // 4. Group by phase. An account shows up under every phase it runs, carrying
  //    only that phase's campaigns so the numbers add up per group.
  const groups: BucketGroup[] = CAMPAIGN_BUCKETS.map((bucket) => {
    const accounts = accountNodes
      .map((account) => ({
        ...account,
        campaigns: account.campaigns.filter((campaign) => campaign.bucket === bucket),
      }))
      .filter((account) => account.campaigns.length > 0)
      .map((account) => {
        const totals = emptyMetrics();
        for (const campaign of account.campaigns) accumulate(totals, campaign.metrics);
        return {
          ...account,
          metrics: derive(totals),
          dailyBudget: account.campaigns
            .filter((campaign) => campaign.status === "ACTIVE" && campaign.effectiveStatus === "ACTIVE")
            .reduce((sum, campaign) => sum + campaign.dailyBudget, 0),
        };
      })
      .sort((a, b) => b.metrics.spend - a.metrics.spend);

    const totals = emptyMetrics();
    for (const account of accounts) accumulate(totals, account.metrics);

    const campaigns = accounts.flatMap((account) => account.campaigns);
    const liveCampaigns = campaigns.filter(
      (campaign) => campaign.status === "ACTIVE" && campaign.effectiveStatus === "ACTIVE"
    );

    return {
      bucket,
      label: BUCKET_LABELS[bucket],
      accounts,
      accountCount: accounts.length,
      campaignCount: campaigns.length,
      activeCampaigns: liveCampaigns.length,
      dailyBudget: liveCampaigns.reduce((sum, campaign) => sum + campaign.dailyBudget, 0),
      metrics: derive(totals),
    };
  }).filter((group) => group.accountCount > 0);

  const grandTotals = emptyMetrics();
  for (const account of accountNodes) accumulate(grandTotals, account.metrics);

  const tree: AdsTree = {
    range: { ...range, preset: params.preset },
    accounts: accountNodes.sort((a, b) => b.lifetimeSpend - a.lifetimeSpend),
    groups,
    totals: {
      ...derive(grandTotals),
      dailyBudget: accountNodes.reduce((sum, account) => sum + account.dailyBudget, 0),
    },
    stats: {
      accounts: accountNodes.length,
      running: accountNodes.filter((a) => a.campaigns.some((c) => c.status === "ACTIVE")).length,
      empty: accountNodes.filter((a) => a.campaigns.length === 0).length,
      off: accountNodes.filter(
        (a) => a.campaigns.length > 0 && !a.campaigns.some((c) => c.status === "ACTIVE")
      ).length,
      unreachable: config.tokens.length - tokensWorking,
      newAccounts: accountNodes.filter((a) => a.isNew).length,
    },
    currencies: [...currencies],
    tokensTotal: config.tokens.length,
    tokensWorking,
    errors,
    syncMs: Date.now() - started,
    fetchedAt: new Date().toISOString(),
  };

  state.cache.set(cacheKey, { at: Date.now(), tree });
  return tree;
}
