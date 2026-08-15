import type { CampaignBucket } from "@/lib/meta/buckets";

export type EntityLevel = "campaign" | "adset" | "ad";

/** Only ACTIVE and PAUSED are writable; the rest are read-only states. */
export type EntityStatus = "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";

export type Metrics = {
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  ctr: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
};

export type AdNode = {
  id: string;
  name: string;
  status: EntityStatus;
  effectiveStatus: string;
  createdTime: string;
  adsetId: string;
  campaignId: string;
  creativeId: string | null;
  thumbnailUrl: string | null;
  /** Lifetime spend on this ad, independent of the selected window. */
  lifetimeSpend: number;
  metrics: Metrics;
};

export type AdsetNode = {
  id: string;
  name: string;
  status: EntityStatus;
  effectiveStatus: string;
  createdTime: string;
  campaignId: string;
  dailyBudget: number;
  lifetimeBudget: number;
  activeAds: number;
  metrics: Metrics;
  ads: AdNode[];
};

export type CampaignIssue = {
  type: string;
  summary: string;
  message: string;
};

export type CampaignNode = {
  id: string;
  name: string;
  status: EntityStatus;
  effectiveStatus: string;
  createdTime: string;
  objective: string;
  bucket: CampaignBucket;
  dailyBudget: number;
  lifetimeBudget: number;
  /** CBO holds the budget on the campaign, ABO on each ad set. */
  budgetLevel: "campaign" | "adset" | "none";
  issues: CampaignIssue[];
  metrics: Metrics;
  adsets: AdsetNode[];
};

export type AccountNode = {
  id: string;
  accountId: string;
  name: string;
  /** Business Manager that owns the account, shown as a chip next to its name. */
  business: string;
  currency: string;
  timezone: string;
  /** Meta codes: 1 = active, 2 = disabled, 3 = unsettled, 101 = closed. */
  accountStatus: number;
  /** Meta disable_reason code; 0 means none. */
  disableReason: number;
  /** Lifetime spend in the account currency — the warming gauge. */
  lifetimeSpend: number;
  /** True when the account appeared since the last acknowledge. */
  isNew: boolean;
  dailyBudget: number;
  metrics: Metrics;
  campaigns: CampaignNode[];
};

export type BucketGroup = {
  bucket: CampaignBucket;
  label: string;
  accounts: AccountNode[];
  accountCount: number;
  campaignCount: number;
  activeCampaigns: number;
  dailyBudget: number;
  metrics: Metrics;
};

export type AdsTree = {
  range: { start: string; end: string; preset: string };
  /** Every reachable account, unsplit — used by the warming / kill board. */
  accounts: AccountNode[];
  groups: BucketGroup[];
  totals: Metrics & { dailyBudget: number };
  stats: {
    accounts: number;
    running: number;
    empty: number;
    off: number;
    unreachable: number;
    /** Fresh accounts the registry has not acknowledged yet. */
    newAccounts: number;
  };
  currencies: string[];
  tokensTotal: number;
  tokensWorking: number;
  errors: string[];
  syncMs: number;
  fetchedAt: string;
};

export type CreativeAsset = {
  /** Video id or image hash — stable enough to dedupe on. */
  id: string;
  kind: "image" | "video";
  /**
   * Full-resolution file, proxied for download. Null when Meta refuses to hand
   * over the source (videos living outside the ad account library).
   */
  url: string | null;
  /** Poster, always present so the UI has something to show. */
  thumbnail: string | null;
  width: number | null;
  height: number | null;
};

export type CreativeDetail = {
  adId: string;
  adName: string;
  status: EntityStatus;
  effectiveStatus: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  creativeId: string | null;
  creativeName: string | null;
  /**
   * Dynamic creative ships several variants of each text; the first one is the
   * primary and the rest are what Meta rotates.
   */
  bodies: string[];
  titles: string[];
  descriptions: string[];
  callToAction: string | null;
  /** Destination the ad sends traffic to. */
  link: string | null;
  urlTags: string | null;
  /** effective_object_story_id — the post the ad renders from. */
  postId: string | null;
  permalink: string | null;
  instagramPermalink: string | null;
  /** Meta-hosted rendering of the ad, used when no source file is available. */
  previewLink: string | null;
  assets: CreativeAsset[];
};
