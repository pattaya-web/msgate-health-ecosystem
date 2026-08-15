import {
  classifyCampaign,
  emptyBucketTotals,
  type CampaignBucket,
} from "@/lib/meta/buckets";

/**
 * Meta Marketing API — daily ad spend, split by campaign phase.
 *
 * One token per Business Manager: an account is only readable through the
 * token of the BM that owns it, so every token is probed and the discovered
 * accounts are deduplicated. Disabled accounts are kept — they still carry the
 * spend they made before being shut down.
 */

export type MetaAdAccount = {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  /** Meta codes: 1 = active, 2 = disabled, 3 = unsettled, 101 = closed. */
  status: number;
};

export type MetaCampaignRow = {
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  bucket: CampaignBucket;
  spend: number;
};

export type MetaAccountSummary = MetaAdAccount & {
  spend: number;
  buckets: Record<CampaignBucket, number>;
};

export type MetaSpendResult = {
  range: { start: string; end: string };
  /** Totals after the bucket filter is applied. */
  byDate: Map<string, number>;
  byDateBucket: Map<string, Record<CampaignBucket, number>>;
  byBucket: Record<CampaignBucket, number>;
  accounts: MetaAccountSummary[];
  campaigns: MetaCampaignRow[];
  currencies: string[];
  buckets: CampaignBucket[];
  errors: string[];
  tokensTotal: number;
  tokensWorking: number;
};

export type MetaConfig = {
  tokens: string[];
  apiVersion: string;
  accountFilter: string[];
};

export function getMetaConfig(): MetaConfig | null {
  const raw = process.env.META_ACCESS_TOKENS?.trim();
  if (!raw) return null;
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;

  return {
    tokens,
    apiVersion: process.env.META_API_VERSION?.trim() || "v23.0",
    accountFilter: (process.env.META_AD_ACCOUNT_IDS || "")
      .split(",")
      .map((id) => id.trim().replace(/^act_/, ""))
      .filter(Boolean),
  };
}

/** Env tokens plus any agency tokens pasted from the Ads board. */
export async function getMetaConfigWithExtras(): Promise<MetaConfig | null> {
  const base = getMetaConfig();
  if (!base) return null;
  const { getExtraTokens } = await import("@/lib/meta/registry");
  const extra = await getExtraTokens();
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of [...base.tokens, ...extra]) {
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return { ...base, tokens };
}

export function isMetaConfigured() {
  return Boolean(getMetaConfig());
}

const GRAPH = "https://graph.facebook.com";

type GraphError = { error?: { message: string; code?: number; type?: string } };
type Paged<T> = GraphError & { data?: T[]; paging?: { next?: string } };

async function graph<T extends GraphError>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json()) as T;
}

/** Follows Meta's cursor pagination; campaign × day rows add up quickly. */
async function graphAll<T>(firstUrl: string): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];
  let url: string | undefined = firstUrl;

  for (let page = 0; url && page < 40; page++) {
    const body: Paged<T> = await graph<Paged<T>>(url);
    if (body.error) return { rows, error: body.error.message };
    rows.push(...(body.data || []));
    url = body.paging?.next;
  }
  return { rows };
}

export async function discoverAdAccounts(config: MetaConfig) {
  const accounts = new Map<string, MetaAdAccount & { token: string }>();
  const errors: string[] = [];
  let working = 0;

  await Promise.all(
    config.tokens.map(async (token, index) => {
      const url =
        `${GRAPH}/${config.apiVersion}/me/adaccounts` +
        `?fields=account_id,name,currency,account_status&limit=200&access_token=${encodeURIComponent(token)}`;
      const body = await graph<
        GraphError & {
          data?: Array<{ account_id: string; name: string; currency: string; account_status: number }>;
        }
      >(url);

      if (body.error) {
        errors.push(`Token #${index + 1} : ${body.error.message}`);
        return;
      }
      working += 1;

      for (const row of body.data || []) {
        if (accounts.has(row.account_id)) continue;
        if (config.accountFilter.length && !config.accountFilter.includes(row.account_id)) continue;
        accounts.set(row.account_id, {
          id: `act_${row.account_id}`,
          accountId: row.account_id,
          name: row.name,
          currency: row.currency,
          status: row.account_status,
          token,
        });
      }
    })
  );

  return { accounts: [...accounts.values()], errors, working };
}

type RawInsight = {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
};

type CachedFetch = {
  rows: Array<RawInsight & { accountId: string; accountName: string }>;
  accounts: MetaAdAccount[];
  currencies: string[];
  errors: string[];
  tokensTotal: number;
  tokensWorking: number;
};

// Insights are several sequential calls; a short cache keeps the cockpit snappy
// without ever serving genuinely stale numbers.
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = ((globalThis as typeof globalThis & {
  __msgateMetaRaw?: Map<string, { at: number; value: CachedFetch }>;
}).__msgateMetaRaw ??= new Map());

async function fetchRaw(
  config: MetaConfig,
  start: string,
  end: string,
  force?: boolean
): Promise<CachedFetch> {
  const key = `${start}:${end}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const { accounts, errors, working } = await discoverAdAccounts(config);
  const timeRange = encodeURIComponent(JSON.stringify({ since: start, until: end }));
  const rows: CachedFetch["rows"] = [];
  const currencies = new Set<string>();

  await Promise.all(
    accounts.map(async (account) => {
      const url =
        `${GRAPH}/${config.apiVersion}/act_${account.accountId}/insights` +
        `?fields=campaign_id,campaign_name,spend&level=campaign&time_increment=1&limit=500` +
        `&time_range=${timeRange}&access_token=${encodeURIComponent(account.token)}`;

      const { rows: raw, error } = await graphAll<RawInsight>(url);
      if (error) {
        errors.push(`${account.name} (${account.id}) : ${error}`);
        return;
      }
      currencies.add(account.currency);
      for (const row of raw) {
        rows.push({ ...row, accountId: account.accountId, accountName: account.name });
      }
    })
  );

  const value: CachedFetch = {
    rows,
    accounts: accounts.map(({ token: _t, ...rest }) => {
      void _t;
      return rest;
    }),
    currencies: [...currencies],
    errors,
    tokensTotal: config.tokens.length,
    tokensWorking: working,
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function getMetaDailySpend(params: {
  start: string;
  end: string;
  /** Empty means every bucket counts. */
  buckets?: CampaignBucket[];
  force?: boolean;
}): Promise<MetaSpendResult> {
  const config = await getMetaConfigWithExtras();
  if (!config) throw new Error("Meta is not configured (missing META_ACCESS_TOKENS)");

  const raw = await fetchRaw(config, params.start, params.end, params.force);
  const wanted = params.buckets?.length ? new Set(params.buckets) : null;

  const byDate = new Map<string, number>();
  const byDateBucket = new Map<string, Record<CampaignBucket, number>>();
  const byBucket = emptyBucketTotals();
  const campaignTotals = new Map<string, MetaCampaignRow>();
  const accountTotals = new Map<string, { spend: number; buckets: Record<CampaignBucket, number> }>();

  for (const row of raw.rows) {
    const amount = Number(row.spend) || 0;
    if (!amount) continue;

    const campaignName = row.campaign_name || "(sans nom)";
    const bucket = classifyCampaign(campaignName);

    // Per-campaign and per-account rollups always cover every bucket, so the
    // breakdown stays readable even when the caller filters the ROAS spend.
    const campaignKey = `${row.accountId}:${row.campaign_id || campaignName}`;
    const campaign = campaignTotals.get(campaignKey);
    if (campaign) {
      campaign.spend += amount;
    } else {
      campaignTotals.set(campaignKey, {
        accountId: row.accountId,
        accountName: row.accountName,
        campaignId: row.campaign_id || "",
        campaignName,
        bucket,
        spend: amount,
      });
    }

    const account = accountTotals.get(row.accountId) ?? { spend: 0, buckets: emptyBucketTotals() };
    account.spend += amount;
    account.buckets[bucket] += amount;
    accountTotals.set(row.accountId, account);

    byBucket[bucket] += amount;

    if (wanted && !wanted.has(bucket)) continue;

    byDate.set(row.date_start, (byDate.get(row.date_start) || 0) + amount);
    const dayBuckets = byDateBucket.get(row.date_start) ?? emptyBucketTotals();
    dayBuckets[bucket] += amount;
    byDateBucket.set(row.date_start, dayBuckets);
  }

  const round = (value: number) => Number(value.toFixed(2));

  for (const [date, amount] of byDate) byDate.set(date, round(amount));
  for (const key of Object.keys(byBucket) as CampaignBucket[]) byBucket[key] = round(byBucket[key]);

  const accounts: MetaAccountSummary[] = raw.accounts.map((account) => {
    const totals = accountTotals.get(account.accountId);
    return {
      ...account,
      spend: round(totals?.spend ?? 0),
      buckets: totals?.buckets ?? emptyBucketTotals(),
    };
  });

  return {
    range: { start: params.start, end: params.end },
    byDate,
    byDateBucket,
    byBucket,
    accounts: accounts.sort((a, b) => b.spend - a.spend),
    campaigns: [...campaignTotals.values()]
      .map((row) => ({ ...row, spend: round(row.spend) }))
      .sort((a, b) => b.spend - a.spend),
    currencies: raw.currencies,
    buckets: params.buckets ?? [],
    errors: raw.errors,
    tokensTotal: raw.tokensTotal,
    tokensWorking: raw.tokensWorking,
  };
}
