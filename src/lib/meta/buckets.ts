export const CAMPAIGN_BUCKETS = ["hyperscaling", "scaling", "testing", "other"] as const;

export type CampaignBucket = (typeof CAMPAIGN_BUCKETS)[number];

/** Main cockpit tabs — excludes uncategorized. */
export const PHASE_TABS = ["hyperscaling", "scaling", "testing"] as const;
export type PhaseTab = (typeof PHASE_TABS)[number];

export const BUCKET_LABELS: Record<CampaignBucket, string> = {
  hyperscaling: "Hyper-scaling",
  scaling: "Scaling Testing",
  testing: "Testing",
  other: "Non catégorisé",
};

/**
 * Campaign names carry the phase in a bracketed prefix, e.g.
 * "[HYPER-SCALING] | SWIVEL BANGER | CBO". Spelling drifts across accounts
 * ("SCALLING" with two Ls, hyphen or not), so the name is normalised before
 * matching. Order matters: "HYPER-SCALING" also contains "SCALING", and
 * "SCALING-TESTING" also contains "TESTING".
 */
export function classifyCampaign(name: string): CampaignBucket {
  const normalised = name.toUpperCase().replace(/[^A-Z]/g, "").replace(/SCALLING/g, "SCALING");

  if (normalised.includes("HYPERSCALING")) return "hyperscaling";
  if (normalised.includes("SCALING")) return "scaling";
  if (normalised.includes("TESTING")) return "testing";
  return "other";
}

export function emptyBucketTotals(): Record<CampaignBucket, number> {
  return { hyperscaling: 0, scaling: 0, testing: 0, other: 0 };
}

export function parseBucketFilter(raw: string | null): CampaignBucket[] {
  if (!raw) return [];
  const wanted = raw
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/[^a-z]/g, ""))
    .map((value) => (value === "scallingtesting" || value === "scalingtesting" ? "scaling" : value));

  return CAMPAIGN_BUCKETS.filter((bucket) => wanted.includes(bucket));
}
