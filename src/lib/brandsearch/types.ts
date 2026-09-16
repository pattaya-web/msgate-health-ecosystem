/**
 * Types purs de la recherche concurrente Brand Search, partagés navigateur /
 * serveur : ce qu'une pub statique concurrente est pour nous, les signaux que
 * Brand Search fournit réellement, et ce qu'Hermes en tire (ADN créatif,
 * motifs récurrents). Aucun accès réseau ici.
 */

/** Les seuls signaux de performance que Brand Search renvoie ; null = absent sur cette pub. */
export type CompetitorSignals = {
  /** Dépense totale estimée dans l'UE (EUR, Meta Ad Library). */
  euTotalSpend: number | null;
  euDailySpend: number | null;
  /** Portée totale estimée dans l'UE. */
  euTotalReach: number | null;
  /** Rang de portée chez Brand Search (1 = le plus vu de la marque). */
  reachRank: number | null;
  /** Durée de diffusion, en jours (depuis total_active_time). */
  activeDays: number | null;
  /** Variantes dupliquées de la même créa. */
  duplicateCount: number | null;
  isDuplicate: boolean | null;
  funnelType: string | null;
  language: string | null;
  copyWordCount: number | null;
  platforms: string[];
};

export type CompetitorCreative = {
  /** Identifiant Brand Search (à réutiliser sur les autres routes). */
  id: string;
  /** Identifiant Meta Ad Library, quand il est fourni. */
  adId: string | null;
  domain: string;
  status: "active" | "inactive" | "unknown";
  startDate: string | null;
  endDate: string | null;
  /** Image de la créa (URL Brand Search, expire 3 jours après la réponse). */
  imageUrl: string | null;
  imageOriginalUrl: string | null;
  thumbnailUrl: string | null;
  headline: string | null;
  primaryText: string | null;
  cta: { text: string | null; type: string | null } | null;
  /** Brand Search ne renvoie pas l'URL de la page d'atterrissage : toujours null, dit explicitement. */
  landingPage: null;
  dashboardUrl: string | null;
  signals: CompetitorSignals;
  source: { provider: "brandsearch"; fetchedAt: string; mediaUrlExpiresInDays: 3 };
};

export type CompetitorBrand = {
  domain: string;
  name: string | null;
  niche: string | null;
  countryCode: string | null;
  monthlyVisits: number | null;
  metaActiveCount: number | null;
  metaTotalCount: number | null;
  dashboardUrl: string | null;
};

export type StaticAdSort = "spend" | "reach" | "rank" | "active" | "recent" | "scaler";

export type StaticAdQuery = {
  domain: string;
  limit: number;
  page: number;
  status: "active" | "inactive" | "all";
  sort: StaticAdSort;
  minSpendEur?: number;
  startedFrom?: string;
  startedTo?: string;
  platforms?: string[];
  euCountries?: string[];
  languages?: string[];
  q?: string;
};

export type CompetitorResearch = {
  competitor: CompetitorBrand;
  query: StaticAdQuery;
  /** Nombre total de pubs statiques correspondantes chez Brand Search (toutes pages). */
  total: number | null;
  creatives: CompetitorCreative[];
  /** Ce que valent les signaux : jamais un « gagnant prouvé ». */
  signalsNote: string;
  creditsCharged: number | null;
  fetchedAt: string;
};

export const SIGNALS_NOTE =
  "Top creatives based on available Brand Search signals: EU spend and reach estimates from the Meta Ad Library (EU only), reach rank, active time and duplicate variants. Brand Search provides no ROAS, revenue, CTR or conversion data — a high signal means the advertiser kept spending on it, not that it is a proven winner.";

/** Ce qu'Hermes voit sur une pub sélectionnée. */
export type CreativeAnalysis = {
  id: string;
  archetype: string;
  angle: string;
  hookMechanism: string;
  layout: string;
  subject: string;
  productPlacement: string;
  elements: string[];
  proof: string;
  colorStrategy: string;
  /** Formulations propres au concurrent (marque, claims, garanties, origine, chiffres…) à ne jamais reprendre. */
  competitorFacts: string[];
};

export type CreativePattern = {
  name: string;
  description: string;
  mechanism: string;
  adIds: string[];
};

export type CompetitorAnalysis = {
  domain: string;
  analyzedIds: string[];
  creatives: CreativeAnalysis[];
  patterns: CreativePattern[];
  /** Ce qu'Hermes conseille de retenir ; l'opérateur reste libre. */
  recommended: Array<{ id: string; why: string }>;
  signalsNote: string;
  engine: "hermes";
  analyzedAt: string;
};

/** Ce que le planificateur reçoit quand l'opérateur a choisi des pubs concurrentes comme inspiration. */
export type CompetitorInspiration = {
  domain: string;
  patterns: CreativePattern[];
  creatives: Array<Pick<CreativeAnalysis, "id" | "archetype" | "angle" | "hookMechanism" | "layout" | "elements" | "proof" | "competitorFacts"> & { headline: string | null }>;
};

/** Jours de diffusion depuis les secondes de Brand Search, sinon depuis les dates. */
export function activeDaysOf(totalActiveTimeSeconds: number | undefined, startDate: string | undefined, endDate: string | undefined, now: Date): number | null {
  if (typeof totalActiveTimeSeconds === "number" && totalActiveTimeSeconds > 0) return Math.round(totalActiveTimeSeconds / 86_400);
  if (!startDate) return null;
  const start = new Date(startDate).getTime();
  const end = endDate ? new Date(endDate).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

/** Le nom de marque tel qu'un concurrent l'écrit, dérivé du domaine (« myhemios.com » → « myhemios »). */
export function brandWordOf(domain: string): string {
  return domain.replace(/^www\./i, "").split(".")[0] ?? domain;
}
