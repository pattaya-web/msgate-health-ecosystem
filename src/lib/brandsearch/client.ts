/**
 * Brandsearch : la base des marques DTC et de leurs pubs Meta / TikTok.
 *
 * On s'en sert pour deux choses dans SpyShop : découvrir des boutiques qui
 * scalent, et lire les pubs Meta actives d'une boutique suivie pour les ranger
 * en inspirations. La clé reste côté serveur (`BRANDSEARCH_API_KEY`), chaque
 * ligne renvoyée coûte un crédit : on demande peu, et seulement les champs
 * utiles. Les URL de médias expirent en trois jours — d'où l'import immédiat
 * dans le Drive plutôt qu'un lien gardé.
 */

const BASE = "https://api.brandsearch.co";

function key() {
  const value = process.env.BRANDSEARCH_API_KEY?.trim();
  if (!value) throw new Error("BRANDSEARCH_API_KEY manquante dans .env.local");
  return value;
}

export function isBrandsearchReady() {
  return Boolean(process.env.BRANDSEARCH_API_KEY?.trim());
}

async function getWithMeta<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<{ body: T; creditsCharged: number | null }> {
  const url = new URL(`${BASE}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
  }
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": key(), Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; detail?: string };
  if (!res.ok) {
    const message = body.message || body.detail || body.error || `Brandsearch HTTP ${res.status}`;
    throw new Error(String(message));
  }
  const credits = Number(res.headers.get("x-credits-used"));
  return { body, creditsCharged: Number.isFinite(credits) ? credits : null };
}

async function get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  return (await getWithMeta<T>(path, params)).body;
}

export type BsBrand = {
  id: string;
  name: string;
  description?: string;
  niche?: string;
  brand_type?: string;
  country_code?: string;
  platform?: string;
  monthly_visits?: number;
  last_meta_active_count?: number;
  last_meta_total_count?: number;
  product_count?: number;
  avg_price_usd?: number;
  interest_score?: number;
  growth_30d?: number;
  created_at?: string;
};

const BRAND_FIELDS =
  "id,name,description,niche,brand_type,country_code,platform,monthly_visits,last_meta_active_count,last_meta_total_count,product_count,avg_price_usd,interest_score,growth_30d,created_at";

export type DiscoverFilters = {
  limit?: number;
  seed?: string;
  niche?: string;
  monthly_visits_min?: number;
  meta_active_min?: number;
  product_count_min?: number;
  country_code?: string;
};

/** Un échantillon de marques qui scalent. Un crédit par ligne. */
export async function discoverBrands(filters: DiscoverFilters) {
  const body = await get<{ data: BsBrand[]; seed: string; count: number }>("/v1/brands/discover", {
    limit: Math.min(50, Math.max(1, filters.limit ?? 8)),
    seed: filters.seed,
    niche: filters.niche,
    monthly_visits_min: filters.monthly_visits_min,
    meta_active_min: filters.meta_active_min,
    meta_ads_active: filters.meta_active_min ? true : undefined,
    product_count_min: filters.product_count_min,
    country_code: filters.country_code,
    fields: BRAND_FIELDS,
  });
  return body;
}

/** La fiche d'une boutique, par son domaine. */
export async function brandByUrl(url: string) {
  const host = url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "");
  return get<BsBrand>(`/v1/brands/by-url/${encodeURIComponent(host)}`, { fields: BRAND_FIELDS });
}

export type BsMetaAd = {
  id: string;
  ad_id?: string;
  brand_id: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  is_video?: boolean;
  is_image?: boolean;
  duration?: number;
  creative?: { title?: string; description?: string; cta?: { text?: string; type?: string } };
  platforms?: string[];
  thumbnail_url?: string;
  image_url?: string;
  image_original_url?: string;
  video_sd_url?: string;
  video_hd_url?: string;
  eu_total_spend?: number;
  eu_total_reach?: number;
  funnel_type?: string;
  language?: string;
  total_active_time?: number;
  dashboard_url?: string;
};

const AD_FIELDS =
  "id,ad_id,brand_id,status,start_date,end_date,is_video,is_image,duration,creative,platforms,thumbnail_url,image_url,image_original_url,video_sd_url,video_hd_url,eu_total_spend,eu_total_reach,funnel_type,language,total_active_time,dashboard_url";

/** Les pubs Meta d'une marque, les plus dépensières d'abord. */
export async function brandMetaAds(brandId: string, options: { status?: "active" | "inactive"; pageSize?: number; page?: number; sortBy?: string } = {}) {
  return get<{ data: BsMetaAd[]; total?: number; page?: number; page_size?: number }>(`/v1/brands/${encodeURIComponent(brandId)}/ads`, {
    platform: "meta",
    status: options.status ?? "active",
    sort_by: options.sortBy ?? "eu_total_spend",
    sort_order: "desc",
    page: options.page ?? 1,
    page_size: Math.min(100, Math.max(1, options.pageSize ?? 12)),
    fields: AD_FIELDS,
  });
}

/**
 * Les octets d'un média, par l'endpoint de téléchargement officiel : il ne
 * dépend pas des liens signés qui expirent. 404 = le fichier n'est pas encore
 * chez Brandsearch (une vidéo fraîchement relevée), pas une erreur.
 */
export async function downloadAdMedia(adId: string, media: "image" | "video"): Promise<{ data: Buffer; contentType: string } | null> {
  const res = await fetch(`${BASE}/v1/meta-ads/${encodeURIComponent(adId)}/download?media=${media}`, {
    headers: { "X-API-Key": key() },
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Téléchargement Brandsearch HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.length) return null;
  return { data, contentType: res.headers.get("content-type") ?? "" };
}

/** Une pub a-t-elle quelque chose à montrer ou à ranger ? */
export function hasMedia(ad: BsMetaAd) {
  return Boolean(ad.video_hd_url || ad.video_sd_url || ad.image_original_url || ad.image_url || ad.thumbnail_url);
}

/** Le meilleur média d'une pub : vidéo HD, sinon SD, sinon l'image pleine. */
export function bestMedia(ad: BsMetaAd): { url: string; ext: string } | null {
  if (ad.video_hd_url) return { url: ad.video_hd_url, ext: "mp4" };
  if (ad.video_sd_url) return { url: ad.video_sd_url, ext: "mp4" };
  if (ad.image_original_url) return { url: ad.image_original_url, ext: "jpg" };
  if (ad.image_url) return { url: ad.image_url, ext: "jpg" };
  return null;
}


/* ------------------------------------------------------------------------- */
/* Recherche concurrente : les pubs statiques d'un domaine, filtres réels de   */
/* GET /v1/meta-ads/search (brand_ids, is_image, status, spend_min, dates,     */
/* platforms, eu_countries, languages, q, sort_by).                            */
/* ------------------------------------------------------------------------- */

export type BsStaticAd = BsMetaAd & {
  eu_daily_spend?: number;
  reach_rank?: number;
  is_duplicate?: boolean;
  duplicate_count?: number;
  copy_word_count?: number;
  cards_count?: number;
  categories?: string[];
  target_gender?: string;
  target_ages?: string[];
  created_at?: string;
};

const STATIC_AD_FIELDS =
  "id,ad_id,brand_id,status,start_date,end_date,total_active_time,creative,cards_count,is_video,is_image,is_duplicate,duplicate_count,platforms,eu_total_spend,eu_daily_spend,eu_total_reach,reach_rank,funnel_type,language,copy_word_count,image_url,image_original_url,thumbnail_url,dashboard_url";

const SORT_FIELD: Record<string, string> = { spend: "eu_total_spend", reach: "eu_total_reach", rank: "reach_rank", active: "total_active_time", recent: "start_date", scaler: "scaler" };

export type StaticAdSearchInput = {
  domain: string;
  limit?: number;
  page?: number;
  status?: "active" | "inactive" | "all";
  sort?: "spend" | "reach" | "rank" | "active" | "recent" | "scaler";
  minSpendEur?: number;
  startedFrom?: string;
  startedTo?: string;
  platforms?: string[];
  euCountries?: string[];
  languages?: string[];
  q?: string;
};

/** Les pubs image d'une marque, un crédit par ligne. Le rang de portée se trie en croissant (1 = meilleur). */
export async function searchStaticAds(input: StaticAdSearchInput) {
  const sort = SORT_FIELD[input.sort ?? "spend"] ?? "eu_total_spend";
  const { body, creditsCharged } = await getWithMeta<{ data: BsStaticAd[]; pagination?: { page: number; page_size: number; total: number; total_pages: number } }>("/v1/meta-ads/search", {
    brand_ids: input.domain,
    is_image: true,
    status: input.status && input.status !== "all" ? input.status : undefined,
    spend_min: input.minSpendEur,
    ad_started_from: input.startedFrom,
    ad_started_to: input.startedTo,
    platforms: input.platforms?.length ? input.platforms.join(",") : undefined,
    eu_countries: input.euCountries?.length ? input.euCountries.join(",") : undefined,
    languages: input.languages?.length ? input.languages.join(",") : undefined,
    q: input.q,
    sort_by: sort,
    sort_order: sort === "reach_rank" ? "asc" : "desc",
    page: Math.max(1, input.page ?? 1),
    page_size: Math.min(100, Math.max(1, input.limit ?? 20)),
    fields: STATIC_AD_FIELDS,
  });
  return { data: body.data ?? [], pagination: body.pagination, creditsCharged };
}

/** Compteurs de quota et de crédits (endpoint gratuit). */
export async function brandsearchUsage() {
  return get<{ daily_limit?: number; daily_used?: number; daily_remaining?: number; monthly_limit?: number; monthly_remaining?: number; credits_used_today?: number; credits_used_this_month?: number }>("/v1/usage");
}
