import { brandByUrl, searchStaticAds, type BsStaticAd } from "@/lib/brandsearch/client";
import { activeDaysOf, SIGNALS_NOTE, type CompetitorBrand, type CompetitorCreative, type CompetitorResearch, type StaticAdQuery } from "@/lib/brandsearch/types";

/**
 * La recherche de créas statiques d'un concurrent : la fiche de la marque,
 * puis ses pubs image chez Brand Search, ramenées à ce dont Hermes et la
 * galerie ont besoin. Lecture seule ; un crédit par ligne, d'où des limites
 * serrées.
 */

export function cleanDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

export function toCompetitorCreative(ad: BsStaticAd, fetchedAt: string, now = new Date()): CompetitorCreative {
  const status = typeof ad.status === "string" ? (ad.status.toLowerCase() === "active" ? "active" : ad.status.toLowerCase() === "inactive" ? "inactive" : "unknown") : "unknown";
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    id: String(ad.id),
    adId: str(ad.ad_id),
    domain: String(ad.brand_id ?? ""),
    status,
    startDate: str(ad.start_date),
    endDate: str(ad.end_date),
    imageUrl: str(ad.image_url),
    imageOriginalUrl: str(ad.image_original_url),
    thumbnailUrl: str(ad.thumbnail_url),
    headline: str(ad.creative?.title),
    primaryText: str(ad.creative?.description),
    cta: ad.creative?.cta ? { text: str(ad.creative.cta.text), type: str(ad.creative.cta.type) } : null,
    landingPage: null,
    dashboardUrl: str(ad.dashboard_url),
    signals: {
      euTotalSpend: num(ad.eu_total_spend),
      euDailySpend: num(ad.eu_daily_spend),
      euTotalReach: num(ad.eu_total_reach),
      reachRank: num(ad.reach_rank),
      activeDays: activeDaysOf(num(ad.total_active_time) ?? undefined, ad.start_date, ad.end_date, now),
      duplicateCount: num(ad.duplicate_count),
      isDuplicate: typeof ad.is_duplicate === "boolean" ? ad.is_duplicate : null,
      funnelType: str(ad.funnel_type),
      language: str(ad.language),
      copyWordCount: num(ad.copy_word_count),
      platforms: Array.isArray(ad.platforms) ? ad.platforms.map((entry) => String(entry).toLowerCase()) : [],
    },
    source: { provider: "brandsearch", fetchedAt, mediaUrlExpiresInDays: 3 },
  };
}

export function toCompetitorBrand(domain: string, brand: Awaited<ReturnType<typeof brandByUrl>> | null): CompetitorBrand {
  return {
    domain,
    name: brand?.name ?? null,
    niche: brand?.niche ?? null,
    countryCode: brand?.country_code ?? null,
    monthlyVisits: brand?.monthly_visits ?? null,
    metaActiveCount: brand?.last_meta_active_count ?? null,
    metaTotalCount: brand?.last_meta_total_count ?? null,
    dashboardUrl: (brand as { dashboard_url?: string } | null)?.dashboard_url ?? null,
  };
}

/** Recherche complète : fiche de marque (1 crédit) + pubs statiques (1 crédit par ligne). */
export async function researchCompetitorCreatives(query: StaticAdQuery): Promise<CompetitorResearch> {
  const domain = cleanDomain(query.domain);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error(`Domaine illisible : « ${query.domain} »`);
  const fetchedAt = new Date().toISOString();
  const brand = await brandByUrl(domain).catch(() => null);
  const result = await searchStaticAds({ ...query, domain });
  const now = new Date();
  return {
    competitor: toCompetitorBrand(domain, brand),
    query: { ...query, domain },
    total: result.pagination?.total ?? null,
    creatives: result.data.filter((ad) => ad.is_image !== false && (ad.image_url || ad.image_original_url)).map((ad) => toCompetitorCreative(ad, fetchedAt, now)),
    signalsNote: SIGNALS_NOTE,
    creditsCharged: result.creditsCharged,
    fetchedAt,
  };
}
