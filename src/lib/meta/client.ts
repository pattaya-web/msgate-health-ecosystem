import { describeConversion, fxRates } from "@/lib/fx";
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
  /** La conversion appliquée (« dépense EUR convertie en USD… »), ou null. */
  conversion: string | null;
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
  // META_EXTRA_TOKENS : les jetons d'agence collés dans l'outil (registre du PC), recopiés pour le site en ligne qui n'a pas ce registre.
  const raw = [process.env.META_ACCESS_TOKENS, process.env.META_EXTRA_TOKENS].map((value) => value?.trim()).filter(Boolean).join(",");
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

type DiscoveredRow = { account_id: string; name: string; currency: string; account_status: number };
type DiscoveryEntry = { at: number; rows?: DiscoveredRow[]; error?: string; pending?: Promise<DiscoveryEntry> };

/*
 * Les comptes de chaque jeton, gardés 10 min (une erreur : 2 min).
 *
 * Sans ce cache, chaque ouverture de l'uploader, du tableau associé ou du
 * cockpit relisait me/adaccounts avec tous les jetons : plus de 350 appels en
 * 5 min, et Meta (app en development_access) répondait « User request limit
 * reached » au compte suivant. Si Meta refuse une relecture, la dernière liste
 * connue du jeton reste servie.
 */
const discovery = ((globalThis as typeof globalThis & { __msgateDiscovery?: Map<string, DiscoveryEntry> }).__msgateDiscovery ??= new Map());
const DISCOVERY_TTL_MS = 10 * 60_000;
const DISCOVERY_ERROR_TTL_MS = 2 * 60_000;

async function accountsOfToken(token: string, apiVersion: string): Promise<DiscoveryEntry> {
  const hit = discovery.get(token);
  if (hit?.pending) return hit.pending;
  if (hit && Date.now() - hit.at < (hit.error ? DISCOVERY_ERROR_TTL_MS : DISCOVERY_TTL_MS)) return hit;
  const pending = (async (): Promise<DiscoveryEntry> => {
    const url = `${GRAPH}/${apiVersion}/me/adaccounts?fields=account_id,name,currency,account_status&limit=200&access_token=${encodeURIComponent(token)}`;
    const body = await graph<GraphError & { data?: DiscoveredRow[] }>(url).catch((error: unknown) => ({
      error: { message: error instanceof Error ? error.message : String(error) },
    }) as GraphError & { data?: DiscoveredRow[] });
    if (!body.error) return { at: Date.now(), rows: body.data || [] };
    // Refus passager : on garde la liste d'avant, réessayée dans 2 min.
    if (hit?.rows) return { at: Date.now() - DISCOVERY_TTL_MS + DISCOVERY_ERROR_TTL_MS, rows: hit.rows };
    return { at: Date.now(), error: body.error.message };
  })();
  discovery.set(token, { ...(hit ?? { at: 0 }), pending });
  const entry = await pending;
  discovery.set(token, entry);
  return entry;
}

export async function discoverAdAccounts(config: MetaConfig) {
  const accounts = new Map<string, MetaAdAccount & { token: string }>();
  const errors: string[] = [];
  let working = 0;

  const results = await Promise.all(config.tokens.map((token) => accountsOfToken(token, config.apiVersion)));
  config.tokens.forEach((token, index) => {
    const { rows, error } = results[index];
    if (error) {
      errors.push(`Token #${index + 1} : ${error}`);
      return;
    }
    working += 1;
    for (const row of rows || []) {
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
  });

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
/** Quand la période contient aujourd'hui, la dépense bouge en continu : 2 minutes. */
const CACHE_TTL_TODAY_MS = 2 * 60 * 1000;

/** Le jour en cours dans le fuseau des comptes Meta (Paris). */
function todayParis() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}


const cache = ((globalThis as typeof globalThis & {
  __msgateMetaRaw?: Map<string, { at: number; value: CachedFetch }>;
}).__msgateMetaRaw ??= new Map());

/** Vide le cache des dépenses, quand un jeton est ajouté ou retiré. */
export function invalidateSpendCache() {
  cache.clear();
}

async function fetchRaw(
  config: MetaConfig,
  start: string,
  end: string,
  force?: boolean
): Promise<CachedFetch> {
  const key = `${start}:${end}`;
  const hit = cache.get(key);
  const ttl = end >= todayParis() ? CACHE_TTL_TODAY_MS : CACHE_TTL_MS;
  if (!force && hit && Date.now() - hit.at < ttl) return hit.value;

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
  /** Convertit chaque compte dans cette devise (celle des ventes) avant d'additionner. */
  convertTo?: string;
  /** Ne garder que ces comptes (sans « act_ ») : l'accès Associé. */
  onlyAccounts?: string[];
}): Promise<MetaSpendResult> {
  const config = await getMetaConfigWithExtras();
  if (!config) throw new Error("Meta is not configured (missing META_ACCESS_TOKENS)");

  const fetched = await fetchRaw(config, params.start, params.end, params.force);
  const only = params.onlyAccounts ? new Set(params.onlyAccounts) : null;
  const raw = only
    ? {
        ...fetched,
        rows: fetched.rows.filter((row) => only.has(row.accountId)),
        accounts: fetched.accounts.filter((account) => only.has(account.accountId)),
        currencies: [...new Set(fetched.accounts.filter((account) => only.has(account.accountId)).map((account) => account.currency))],
        errors: [],
      }
    : fetched;
  const wanted = params.buckets?.length ? new Set(params.buckets) : null;
  // Un compte en euros et un compte en dollars ne s'additionnent qu'une fois convertis.
  const accountCurrency = new Map(raw.accounts.map((account) => [account.accountId, account.currency]));
  const rates = params.convertTo ? await fxRates(raw.currencies, params.convertTo) : null;
  const factor = (accountId: string) => (rates ? (rates.get((accountCurrency.get(accountId) || params.convertTo || "").toUpperCase())?.rate ?? 1) : 1);

  const byDate = new Map<string, number>();
  const byDateBucket = new Map<string, Record<CampaignBucket, number>>();
  const byBucket = emptyBucketTotals();
  const campaignTotals = new Map<string, MetaCampaignRow>();
  const accountTotals = new Map<string, { spend: number; buckets: Record<CampaignBucket, number> }>();

  for (const row of raw.rows) {
    const amount = (Number(row.spend) || 0) * factor(row.accountId);
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
    currencies: rates ? [params.convertTo as string] : raw.currencies,
    conversion: rates ? describeConversion(rates, params.convertTo) : null,
    buckets: params.buckets ?? [],
    errors: raw.errors,
    tokensTotal: raw.tokensTotal,
    tokensWorking: raw.tokensWorking,
  };
}
