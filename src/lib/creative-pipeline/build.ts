import { buildAssociateOverview, getAssociateScope } from "@/lib/associate/scope";
import { fxRates } from "@/lib/fx";
import { graphGet, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import { buildAdsTree, restrictTreeToAccounts } from "@/lib/meta/tree";
import type { AdNode, AdsetNode, CampaignNode } from "@/lib/meta/types";
import { buildObjectivesBar } from "@/lib/metrics/objectives";
import { getSupplierGrids } from "@/lib/metrics/supplier-grid";
import { DEFAULT_FACTOR, cpaAtMargin, marginCosts, netMargin } from "@/lib/creative-pipeline/margin-model";
import { buildPilotage } from "@/lib/pilotage/build";
import { adDailyInsights, type AdDay } from "@/lib/pilotage/meta-daily";
import { reportToday } from "@/lib/report-tz";
import { readStore, updateStore, type Brief, type CreativeStatus, type StatusChange, type Thresholds, type WeekCheck } from "@/lib/creative-pipeline/store";
import { buildScalingRamp, type RampRow } from "@/lib/metrics/scaling-ramp";

/**
 * Le pipeline créa de l'Ads Manager : chaque créa (regroupée par post ID, et
 * par image + nom pour les réuploads) avec sa date de lancement, sa marge nette
 * sur 3 / 7 / 14 jours complets (jamais la journée en cours), où elle tourne
 * (TEST, MAIN, BIDCAP, COSTCAP, ancien SCALING, déduit de l'ad set ou forcé à
 * la main) et un seul verdict « À faire » dans le langage du framework
 * TEST (ABO) → MAIN (CBO) → BidCap / CostCap (onglet Process) :
 *  - vue 7 j (hebdo) : Valider → MAIN, Tenir dans MAIN, Couper, Laisser,
 *    Candidate BidCap / CostCap, Couper dans TEST ; plus la liste « À faire
 *    cette semaine » ;
 *  - vue 3 j (quotidien) : seulement Couper (urgence), Surveiller, Laisser.
 * Plus les KPI de la semaine (lundi → dimanche, heure de Paris) et le rappel du
 * jour. Les seuils sont dans les Réglages (store.settings.thresholds).
 *
 * Marge nette = CA − COGS − frais − dépense de la pub, avec :
 *  ventes corrigées = achats Meta × facteur réel (commandes ÷ achats Meta, même fenêtre, tous comptes) ;
 *  CA = ventes × prix (29,99 $ ou 39,99 $) + 9,99 $ × ventes × taux d'upsell ;
 *  COGS = ventes × coût grille à la moyenne de pièces par commande ; frais = 4 % du CA.
 */

export type WindowDays = 3 | 7 | 14;
/** 7 j (et 14 j) = lecture hebdo, 3 j = lecture quotidienne. */
export type ReadMode = "hebdo" | "quotidien";
export type Trend = "↑" | "↓" | "→" | null;
export type MarginBadge = "BEST" | "BONNE" | "CUT" | "DATA";
export type Margin = { spend: number; spendUsd: number; purchases: number; sales: number; revenue: number; value: number; margin: number; pct: number | null; badge: MarginBadge; roas: number | null; clicks: number; carts: number };
export type Todo = "Couper" | "Couper dans TEST" | "Valider → MAIN" | "Candidate BidCap" | "Candidate CostCap" | "Attendre" | "Surveiller" | "Tenir dans MAIN" | "Laisser" | "—";
/** Le produit lu sur l'URL de destination de la pub : « ? » quand elle ne le dit pas (calculé alors à 29,99 $). */
export type Product = "29,99 $" | "39,99 $" | "?";

/** Un emplacement d'une créa : l'ad set où elle tourne, avec sa marge et son verdict à lui. */
export type Placement = {
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  /** Le type de l'ad set (TEST, MAIN, SCALING, BIDCAP, COSTCAP), allumé ou non. */
  kind: CreativeStatus;
  /** OFF si la pub, l'ad set ou la campagne est coupé ; sinon le type (ou le statut forcé). */
  status: CreativeStatus;
  live: boolean;
  /** Ancien ad set « SCALING - », traité comme MAIN, à migrer. */
  legacy: boolean;
  adIds: string[];
  liveAdIds: string[];
  /** Arrivée de la créa dans cet ad set (sa pub la plus ancienne). */
  createdAt: string;
  product: Product;
  /** Le [PRODUIT] des noms de campagne (MAIN - NECKLACE…), lu sur le nom de la campagne. */
  productName: string;
  /** L'URL de destination des pubs de cet emplacement (d'où vient le produit). */
  links: string[];
  margins: Record<WindowDays, Margin>;
  /** Marge 3 j contre marge 7 j. */
  trend: Trend;
  todo: Todo;
  /** Le verdict en clair (« Valider → post ID dans MAIN - NECKLACE, ad set MAIN - S45 »…). */
  label: string;
  /** La phrase de justification, format unique. */
  why: string;
  /** « ancien ad set SCALING, migrer vers MAIN - … ». */
  note: string | null;
  /** Le bouton est remplacé par ce message (aucune campagne MAIN active…). */
  blocked: string | null;
  /** Candidate BidCap / CostCap : le CPA cible (en $ et dans la devise du compte). */
  cpaTarget: { pct: number; usd: number; local: number; currency: string } | null;
  warnings: string[];
};

export type CreativeRow = {
  key: string;
  name: string;
  accountId: string;
  accountName: string;
  currency: string;
  thumbnail: string | null;
  postId: string | null;
  product: Product;
  status: CreativeStatus;
  autoStatus: CreativeStatus;
  manual: boolean;
  /** TEST, MAIN, « les deux », « ancien SCALING »… */
  where: string;
  placements: Placement[];
  /** Date de lancement (created_time Meta, gardée en base) et âge en jours (J). */
  launchedAt: string;
  age: number;
  margins: Record<WindowDays, Margin>;
  trend: Trend;
  /** Le verdict le plus urgent de ses emplacements actifs (chacun a le sien). */
  todo: Todo;
  label: string;
  why: string;
  note: string | null;
  warnings: string[];
  liveAdIds: string[];
  history: StatusChange[];
};

export type GroupRow = {
  id: string;
  name: string;
  campaignName: string;
  level: "adset" | "campaign";
  live: boolean;
  margin: Margin;
  /** Le verdict de la rampe de scaling (ad sets TEST : +25 %, plafond, surf…), avec la dernière hausse. */
  ramp: { status: string; label: string; reason: string; budget: number; test: boolean; lastRiseAt: string | null } | null;
};

export type WeeklyKind = "cut" | "validate" | "cutTest" | "candidate" | "watch" | "brief";
/** Une ligne de « À faire cette semaine », avec sa case à cocher. */
export type WeeklyItem = {
  id: string;
  kind: WeeklyKind;
  title: string;
  detail: string;
  why: string;
  creativeKey: string | null;
  name: string;
  adsetId: string | null;
  adsetName: string;
  accountId: string;
  postId: string | null;
  liveAdIds: string[];
  /** Valider → MAIN : l'ad set de la semaine (MAIN - S45). */
  group: string | null;
  target: { adsetId: string; adsetName: string; campaignId: string; campaignName: string } | null;
  blocked: string | null;
  checked: WeekCheck | null;
};
export type Weekly = { week: string; weekStart: string; weekAdset: string; items: WeeklyItem[] };

export type PipelineReport = {
  window: WindowDays;
  mode: ReadMode;
  windows: Record<WindowDays, { start: string; end: string; factor: number; factorSource: "calculé" | "forcé" | "par défaut"; orders: number; metaPurchases: number }>;
  assumptions: { upsellRate: number; upsellDefault: boolean; pieces: number; piecesDefault: boolean; cogsPerOrder: number; feeRate: number };
  thresholds: Thresholds;
  creatives: CreativeRow[];
  archived: CreativeRow[];
  groups: GroupRow[];
  /** La liste « À faire cette semaine » (vue 7 j seulement). */
  weekly: Weekly | null;
  /** Les ad sets MAIN de la semaine (MAIN - S45) où passer les validées, par compte. */
  targets: Array<{ accountId: string; adsetId: string; adsetName: string; campaignId: string; campaignName: string; status: CreativeStatus }>;
  kpis: {
    weekStart: string;
    uploaded: number;
    briefed: number;
    iterationShare: number | null;
    winners: Array<{ name: string; from: CreativeStatus | null; to: CreativeStatus; at: string }>;
    cpa: Array<{ label: string; cpa: number | null; breakeven: number | null; low: number | null; high: number | null }>;
    badges: Record<MarginBadge, number>;
    cutActive: string[];
  };
  reminder: { title: string; lines: string[] } | null;
  briefs: Brief[];
  journal: Array<{ at: string; who: string; what: string }>;
  warnings: string[];
  builtAt: string;
};

const HOUR = 3_600_000;
const RANK: Record<CreativeStatus, number> = { OFF: 0, BRIEF: 0, "EN PROD": 0, "PRÊTE": 0, TEST: 1, SCALING: 2, MAIN: 3, COSTCAP: 4, BIDCAP: 5 };

const round2 = (value: number) => Math.round(value * 100) / 100;
const live = (row: { status: string; effectiveStatus?: string }) => row.status === "ACTIVE" && (!row.effectiveStatus || row.effectiveStatus === "ACTIVE");
const iso = (value: string) => new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString();

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const parisDay = (value: string | number) => PARIS_DAY.format(new Date(value));

/** 1.5 → « 1,50 ». */
const fr = (value: number | null | undefined, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));
/** 25.86 → « 25,9 % » (1 décimale) ou « 26 % » (0) ; null → « — ». */
/** Un seuil sans zéros inutiles : 7.5 → « 7,5 », 1.61 → « 1,61 ». */
const frs = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const pctLabel = (value: number | null, digits: number) => (value == null ? "—" : `${value.toFixed(digits).replace(".", ",")} %`);

/** Le numéro de semaine ISO (S45), celui des ad sets « TEST - S45 - MIX n » et « MAIN - S45 ». */
function isoWeek(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** Le [PRODUIT] d'un nom de campagne : « MAIN - NECKLACE » → NECKLACE ; « SCALING / TESTING - NECKLACE BROAD US » → NECKLACE. */
function productName(campaignName: string) {
  const name = campaignName.trim();
  const framed = /^(?:TEST|MAIN|BIDCAP|COSTCAP)\s*-\s*(.+)$/i.exec(name)?.[1];
  const tail = framed ?? name.split(/\s+-\s+/).slice(1).join(" ");
  const words = tail
    .toUpperCase()
    .split(/\s+/)
    .filter((word) => word && !/^(BROAD|US|USA|UK|FR|EU|CA|AU|CBO|ABO|ASC|ADV\+?|S\d+|MIX|\d+)$/.test(word));
  return words.join(" ") || "[PRODUIT]";
}

/** Le lundi de la semaine en cours (heure de Paris). */
function mondayOf(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/* ------------------------------------------------------------------ *
 * Identité des créas : post ID, image, lien (une lecture par compte, 15 min)
 * ------------------------------------------------------------------ */

type Identity = { postId: string | null; hash: string | null; link: string };
type RawAd = GraphError & {
  data?: Array<{
    id: string;
    creative?: {
      effective_object_story_id?: string;
      link_url?: string;
      object_url?: string;
      image_hash?: string;
      object_story_spec?: { link_data?: { link?: string; image_hash?: string }; video_data?: { video_id?: string; call_to_action?: { value?: { link?: string } } } };
      asset_feed_spec?: { link_urls?: Array<{ website_url?: string }>; images?: Array<{ hash?: string }>; videos?: Array<{ video_id?: string }> };
    };
  }>;
  paging?: { next?: string };
};

const identityCache = ((globalThis as typeof globalThis & { __msgatePipelineIds?: Map<string, { at: number; map: Map<string, Identity> }> }).__msgatePipelineIds ??= new Map());

async function identities(accountId: string): Promise<Map<string, Identity>> {
  const hit = identityCache.get(accountId);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.map;
  const map = new Map<string, Identity>(hit?.map ?? []);
  try {
    const act = `act_${accountId}`;
    const token = await resolveToken(act);
    const filtering = encodeURIComponent(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "PENDING_REVIEW", "IN_PROCESS", "WITH_ISSUES"] }]));
    let body = await graphGet<RawAd>(
      `${act}/ads?fields=id,creative{effective_object_story_id,link_url,object_url,image_hash,object_story_spec{link_data{link,image_hash},video_data{video_id,call_to_action}},asset_feed_spec{link_urls,images,videos}}&limit=300&filtering=${filtering}`,
      token
    );
    for (let page = 0; page < 6; page++) {
      if (body.error) throw new Error(body.error.message);
      for (const ad of body.data ?? []) {
        const creative = ad.creative ?? {};
        const spec = creative.object_story_spec;
        const feed = creative.asset_feed_spec;
        const hash = creative.image_hash || spec?.link_data?.image_hash || feed?.images?.[0]?.hash || null;
        const video = spec?.video_data?.video_id || feed?.videos?.[0]?.video_id || null;
        map.set(ad.id, {
          postId: creative.effective_object_story_id ?? null,
          hash: hash ? `img:${hash}` : video ? `vid:${video}` : null,
          link: spec?.link_data?.link || spec?.video_data?.call_to_action?.value?.link || feed?.link_urls?.[0]?.website_url || creative.link_url || creative.object_url || "",
        });
      }
      if (!body.paging?.next) break;
      body = (await (await fetch(body.paging.next, { cache: "no-store" })).json()) as RawAd;
    }
    identityCache.set(accountId, { at: Date.now(), map });
  } catch {
    // Meta indisponible : on garde la dernière lecture (ou on regroupe par pub).
  }
  return map;
}

/* ------------------------------------------------------------------ */

const reportCache = ((globalThis as typeof globalThis & { __msgatePipeline?: Map<WindowDays, { at: number; report: PipelineReport }> }).__msgatePipeline ??= new Map());

export function invalidatePipeline() {
  reportCache.clear();
}

export async function buildPipeline(window: WindowDays, force = false): Promise<PipelineReport> {
  const hit = reportCache.get(window);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.report;

  const warnings: string[] = [];
  const scope = await getAssociateScope();
  const accountIds = scope.metaAccountIds.map((id) => id.replace(/^act_/, ""));
  const today = reportToday();
  const d1 = addDays(today, -1);
  const from14 = addDays(today, -14);
  const from7 = addDays(today, -7);

  const [fullTree, daily, overview, pilotage, objectives7, grids, store] = await Promise.all([
    buildAdsTree({ preset: "today" }),
    adDailyInsights(accountIds, from14, today).catch((error) => {
      warnings.push(`Meta (jour par jour) : ${error instanceof Error ? error.message : "indisponible"}`);
      return [] as AdDay[];
    }),
    buildAssociateOverview(from14, d1).catch(() => null),
    buildPilotage().catch(() => null),
    buildObjectivesBar(from7, d1).catch(() => null),
    getSupplierGrids(),
    readStore(),
  ]);
  // La rampe de scaling passe d'abord : un ad set dont le budget vient de bouger n'est pas jugé sur ses pubs.
  const ramp = await buildScalingRamp({ aggressive: true }).catch(() => null);
  const rampById = new Map<string, RampRow>((ramp?.rows ?? []).map((row) => [row.id, row]));
  const T = store.settings.thresholds;
  const mode: ReadMode = window === 3 ? "quotidien" : "hebdo";
  const tree = restrictTreeToAccounts(fullTree, accountIds);
  const ids = new Map<string, Identity>();
  for (const map of await Promise.all(tree.accounts.map((account) => identities(account.accountId)))) for (const [id, value] of map) ids.set(id, value);

  const currencies = new Set([...tree.accounts.map((account) => account.currency), ...daily.map((row) => row.currency)].filter(Boolean));
  const usdRates = await fxRates(currencies, "USD");
  const toUsd = (amount: number, currency: string) => amount * (usdRates.get((currency || "USD").toUpperCase())?.rate ?? 1);

  /* ---------------- Hypothèses : facteur réel, upsell, pièces, coût ---------------- */
  const windowRange = (days: WindowDays) => ({ start: addDays(today, -days), end: d1 });
  const windows = {} as PipelineReport["windows"];
  for (const days of [3, 7, 14] as WindowDays[]) {
    const range = windowRange(days);
    const orders = (overview?.sales.series ?? []).filter((row) => row.date >= range.start && row.date <= range.end).reduce((sum, row) => sum + row.orders, 0);
    const metaPurchases = daily.filter((row) => row.date >= range.start && row.date <= range.end).reduce((sum, row) => sum + row.purchases, 0);
    const forced = store.settings.factor;
    windows[days] = forced
      ? { ...range, factor: forced, factorSource: "forcé", orders, metaPurchases }
      : orders > 0 && metaPurchases > 0
        ? { ...range, factor: round2(orders / metaPurchases), factorSource: "calculé", orders, metaPurchases }
        : { ...range, factor: DEFAULT_FACTOR, factorSource: "par défaut", orders, metaPurchases };
  }
  const costs = marginCosts({ grids, today, collarsPerOrder: pilotage?.objectives.collarsPerOrder, processingRate: pilotage?.objectives.processingRate, upsellRate: store.settings.upsellRate });
  const { upsellRate, cogsPerOrder, feeRate, pieces, piecesDefault } = costs;

  /** BEST / BONNE / CUT sur la marge en %, DATA sous le seuil de ventes (Réglages). */
  const badgeOf = (sales: number, pct: number | null): MarginBadge => (sales < T.minSales ? "DATA" : (pct ?? -Infinity) >= T.bestMargin ? "BEST" : (pct ?? -Infinity) >= T.cutMargin ? "BONNE" : "CUT");
  /** La marge nette d'un ensemble de lignes Meta sur une fenêtre. */
  const marginOf = (rows: AdDay[], days: WindowDays, price: number): Margin => {
    let spend = 0;
    let spendUsd = 0;
    let purchases = 0;
    let value = 0;
    let clicks = 0;
    let carts = 0;
    for (const row of rows) {
      spend += row.spend;
      spendUsd += toUsd(row.spend, row.currency);
      purchases += row.purchases;
      value += toUsd(row.value, row.currency);
      clicks += row.clicks;
      carts += row.carts ?? 0;
    }
    const { sales, revenue, margin, pct } = netMargin({ purchases, spendUsd, factor: windows[days].factor, price }, costs);
    return { spend: round2(spend), spendUsd: round2(spendUsd), purchases, sales: round2(sales), revenue: round2(revenue), value: round2(value), margin: round2(margin), pct, badge: badgeOf(sales, pct), roas: spendUsd > 0 ? round2(value / spendUsd) : null, clicks, carts };
  };
  /** Le total de plusieurs emplacements (prix différents possibles). */
  const sumMargins = (list: Margin[]): Margin => {
    const t = list.reduce(
      (acc, m) => ({ spend: acc.spend + m.spend, spendUsd: acc.spendUsd + m.spendUsd, purchases: acc.purchases + m.purchases, sales: acc.sales + m.sales, revenue: acc.revenue + m.revenue, value: acc.value + m.value, margin: acc.margin + m.margin, clicks: acc.clicks + m.clicks, carts: acc.carts + m.carts }),
      { spend: 0, spendUsd: 0, purchases: 0, sales: 0, revenue: 0, value: 0, margin: 0, clicks: 0, carts: 0 }
    );
    const pct = t.revenue > 0 ? t.margin / t.revenue : null;
    const badge = badgeOf(t.sales, pct == null ? null : pct * 100);
    return { spend: round2(t.spend), spendUsd: round2(t.spendUsd), purchases: t.purchases, sales: round2(t.sales), revenue: round2(t.revenue), value: round2(t.value), margin: round2(t.margin), pct: pct == null ? null : round2(pct * 100), badge, roas: t.spendUsd > 0 ? round2(t.value / t.spendUsd) : null, clicks: t.clicks, carts: t.carts };
  };
  const inWindow = (rows: AdDay[], days: WindowDays) => {
    const { start, end } = windowRange(days);
    return rows.filter((row) => row.date >= start && row.date <= end);
  };
  const rowsByAd = new Map<string, AdDay[]>();
  const rowsByAdset = new Map<string, AdDay[]>();
  const rowsByCampaign = new Map<string, AdDay[]>();
  for (const row of daily) {
    for (const [map, key] of [[rowsByAd, row.adId], [rowsByAdset, row.adsetId], [rowsByCampaign, row.campaignId]] as const) {
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
  }

  /* ---------------- Placements et regroupement ---------------- */
  const nowMs = Date.now();
  /**
   * Où tourne un ad set : BIDCAP / COSTCAP (campagne), MAIN (campagne ou ad set « MAIN - »), TEST (« TEST - »),
   * puis les anciens noms : SCALING (« SCALING », STATIC 3:4, MIX 2 à 4) ou l'âge (≥ 7 j), sinon TEST.
   */
  const adsetStatus = (adset: AdsetNode, campaign: CampaignNode): CreativeStatus => {
    if (/BIDCAP/i.test(campaign.name) || /^\s*BIDCAP\b/i.test(adset.name)) return "BIDCAP";
    if (/COSTCAP/i.test(campaign.name) || /^\s*COSTCAP\b/i.test(adset.name)) return "COSTCAP";
    if (/^\s*MAIN\b/i.test(adset.name) || /^\s*MAIN\s*-/i.test(campaign.name)) return "MAIN";
    if (/^\s*TEST\b/i.test(adset.name) || /^\s*TEST\s*-/i.test(campaign.name)) return "TEST";
    // Les anciennes CBO de scaling comptent comme MAIN.
    if (campaign.budgetLevel === "campaign" && /ULTRA|HYPER/i.test(campaign.name)) return "MAIN";
    if (/SCALING|STATIC\s*-?\s*3:4|MIX\s*[234]/i.test(adset.name)) return "SCALING";
    return nowMs - Date.parse(iso(adset.createdTime)) < 7 * 24 * HOUR ? "TEST" : "SCALING";
  };
  const MAINS: CreativeStatus[] = ["MAIN", "SCALING", "BIDCAP", "COSTCAP"];
  const week = isoWeek(today);
  const weekAdset = `MAIN - S${week}`;
  type RawPlacement = { ad: AdNode; adset: AdsetNode; campaign: CampaignNode; link: string };
  type Work = { key: string; name: string; account: (typeof tree.accounts)[number]; thumbnail: string | null; postId: string | null; hash: string | null; ads: RawPlacement[] };
  const groups = new Map<string, Work>();
  const targets: PipelineReport["targets"] = [];
  /** Les campagnes MAIN actives de chaque compte. */
  const mainCampaigns = new Map<string, CampaignNode[]>();
  for (const account of tree.accounts) {
    for (const campaign of account.campaigns) {
      if (/^\s*MAIN\s*-/i.test(campaign.name) && live(campaign)) mainCampaigns.set(account.accountId, [...(mainCampaigns.get(account.accountId) ?? []), campaign]);
      for (const adset of campaign.adsets) {
        // L'ad set MAIN de la semaine (même en brouillon / en pause) : c'est là que vont les validées.
        if (/^\s*MAIN\s*-/i.test(campaign.name) && new RegExp(`^\\s*MAIN\\s*-\\s*S0*${week}\\b`, "i").test(adset.name)) {
          targets.push({ accountId: account.accountId, adsetId: adset.id, adsetName: adset.name, campaignId: campaign.id, campaignName: campaign.name, status: "MAIN" });
        }
        for (const ad of adset.ads) {
          const identity = ids.get(ad.id);
          const key = identity?.postId ? `post:${identity.postId}` : `ad:${ad.id}`;
          const work = groups.get(key) ?? { key, name: ad.name, account, thumbnail: ad.thumbnailUrl, postId: identity?.postId ?? null, hash: identity?.hash ?? null, ads: [] };
          work.ads.push({ ad, adset, campaign, link: identity?.link ?? "" });
          groups.set(key, work);
        }
      }
    }
  }
  // Les réuploads : même image et même nom = la même créa.
  const byImage = new Map<string, Work>();
  for (const [key, work] of [...groups]) {
    if (!work.hash) continue;
    const imageKey = `${work.account.accountId}|${work.hash}|${work.name.trim().toLowerCase()}`;
    const first = byImage.get(imageKey);
    if (first && first !== work) {
      first.ads.push(...work.ads);
      groups.delete(key);
    } else byImage.set(imageKey, work);
  }

  // Le nom du produit dans l'URL (/products/…) : necklace-snake = 29,99 $, snakelace-venom39 = 39,99 $, sinon on ne devine pas.
  const productOfLink = (link: string): Product => {
    const handle = /\/products\/([^/?#]+)/i.exec(link)?.[1]?.toLowerCase() ?? "";
    if (handle === "necklace-snake" || (!handle && /necklace-snake/i.test(link))) return "29,99 $";
    if (handle === "snakelace-venom39" || (!handle && /snakelace-venom39/i.test(link))) return "39,99 $";
    return "?";
  };
  const priceOf = (product: Product) => (product === "39,99 $" ? 39.99 : 29.99);
  const shortDate = (value: number | string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const dayLabel = (value: string) => new Date(value).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });
  const TODO_RANK: Record<Todo, number> = { Couper: 1, "Couper dans TEST": 2, "Valider → MAIN": 3, "Candidate BidCap": 4, "Candidate CostCap": 5, Attendre: 6, Surveiller: 7, "Tenir dans MAIN": 8, Laisser: 9, "—": 10 };
  const daily$ = mode === "quotidien";

  /** La flèche de tendance : marge 3 j contre marge 7 j, à ± trendPts points. */
  const trendOf = (m7: Margin, m3: Margin): Trend => {
    if (m7.pct == null) return null;
    if (m3.pct == null) return m3.spendUsd > 0 ? "↓" : null;
    return m3.pct > m7.pct + T.trendPts ? "↑" : m3.pct < m7.pct - T.trendPts ? "↓" : "→";
  };
  /** La phrase de justification, format unique. */
  const sentence = (m7: Margin, m3: Margin, launchedAt: string, age: number, trend: Trend) =>
    `${m7.badge} · 7 j : ${Math.round(m7.sales)} vente${Math.round(m7.sales) > 1 ? "s" : ""}, ${pctLabel(m7.pct, 1)} de marge, ROAS ${fr(m7.roas)} · 3 j : marge ${pctLabel(m3.pct, 0)}, ROAS ${fr(m3.roas)} · lancée le ${dayLabel(launchedAt)} (J${age}) · tendance ${trend ?? "—"}`;

  type VerdictInput = {
    kind: CreativeStatus;
    status: CreativeStatus;
    ads: RawPlacement[];
    margins: Record<WindowDays, Margin>;
    price: number;
    currency: string;
    /** Arrivée dans cet ad set (sa pub la plus ancienne). */
    since: string;
    age: number;
    productName: string;
    accountId: string;
    /** Dépense sur 3 j de la même créa dans MAIN (null si elle n'y est pas). */
    mainSpend3: number | null;
  };
  type Verdict = { todo: Todo; label: string; blocked: string | null; cpaTarget: Placement["cpaTarget"] };
  const plain = (todo: Todo, label: string = todo): Verdict => ({ todo, label, blocked: null, cpaTarget: null });
  const money = (usd: number, currency: string) => {
    const rate = usdRates.get((currency || "USD").toUpperCase())?.rate ?? 1;
    const local = currency && currency.toUpperCase() !== "USD" ? usd / rate : usd;
    const symbol = !currency || currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase() === "EUR" ? "€" : currency.toUpperCase();
    return { local: round2(local), label: `${local.toFixed(2).replace(".", ",")} ${symbol}` };
  };

  /** Le verdict d'un emplacement : vue 7 j (hebdo) ou 3 j (quotidien), premier qui matche gagne. */
  const verdict = (input: VerdictInput): Verdict => {
    const { kind, status, ads, margins, price } = input;
    const liveAds = ads.filter((row) => live(row.ad) && live(row.adset) && live(row.campaign));
    if (status === "OFF" || !liveAds.length) return plain("—");
    const cutWord = daily$ ? "Couper (urgence)" : "Couper";

    // Les tests qui ne démarrent pas (J1, J2) : 0 vente et pas d'ajout panier, CPC hors de prix.
    if (kind === "TEST") {
      const started = liveAds.map((row) => iso(row.ad.createdTime)).sort()[0];
      const rows = liveAds.flatMap((row) => rowsByAd.get(row.ad.id) ?? []).filter((row) => row.date <= d1);
      const since = marginOf(rows, 14, price);
      const cpcUsd = since.clicks > 0 ? since.spendUsd / since.clicks : null;
      if (since.purchases === 0 && nowMs - Date.parse(started) >= 24 * HOUR) {
        if (cpcUsd != null && cpcUsd > 3.5) return plain("Couper", `${cutWord} · CPC ${fr(cpcUsd)} $ (> 3,50 $), 0 vente`);
        if (since.spendUsd >= 40 && since.carts === 0) return plain("Couper", `${cutWord} · 0 vente, 0 ajout panier pour ${Math.round(since.spendUsd)} $`);
        if (since.spendUsd >= 60) return plain("Couper", `${cutWord} · 0 vente pour ${Math.round(since.spendUsd)} $`);
      }
    }

    const m7 = margins[7];
    const m3 = margins[3];
    const sales7 = Math.round(m7.sales);
    // DATA : pas de verdict de scaling sous le seuil de ventes.
    if (m7.badge === "DATA") return plain("Laisser", `Laisser · ${input.age < 7 ? `7 j (J${input.age})` : "7 j"} · ${sales7} vente${sales7 > 1 ? "s" : ""} / ${T.minSales}`);
    // CUT : on coupe, sauf si le ROAS 3 j sauve la créa.
    if (m7.badge === "CUT") {
      if (m3.roas != null && m3.roas >= T.rescueRoas) return plain("Surveiller", `Surveiller · CUT sur 7 j, mais ROAS 3 j ${fr(m3.roas)} (≥ ${frs(T.rescueRoas)})`);
      return plain("Couper", `${cutWord} · marge 7 j ${pctLabel(m7.pct, 1)} (< ${frs(T.cutMargin)} %) et ROAS 3 j ${fr(m3.roas)} (< ${frs(T.rescueRoas)})`);
    }

    // BEST / BONNE.
    const falling = m3.spendUsd > 0 && (m3.pct == null || m3.pct < T.cutMargin);
    const trend = trendOf(m7, m3);
    if (daily$) {
      if (falling) return plain("Surveiller", "Surveiller · ↓ en baisse");
      return plain("Laisser", trend === "↓" ? "Laisser · ↓ en baisse" : "Laisser");
    }
    const best = m7.badge === "BEST";
    if (kind === "TEST") {
      // Déjà dupliquée en MAIN : on coupe la copie TEST seulement si la MAIN la fait dépenser.
      if (input.mainSpend3 != null) {
        if (input.mainSpend3 >= T.testCutSpend) return plain("Couper dans TEST", `Couper dans TEST (elle tourne dans MAIN : ${Math.round(input.mainSpend3)} $ sur 3 j)`);
        return plain("Laisser", `Laisser dans TEST (${Math.round(input.mainSpend3)} $ sur 3 j dans MAIN, moins de ${T.testCutSpend} $)`);
      }
      if (falling) return plain("Surveiller", "⚠ en baisse sur 3 j · Surveiller (pas de MAIN cette semaine)");
      if (best && input.age < 7 && m7.sales < T.mainSales) return plain("Laisser", `BEST · encore J${input.age}, attendre J7`);
      if (!best && m7.sales < T.mainSales) return plain("Laisser", `Laisser tourner en TEST (${sales7} ventes / ${T.mainSales} pour la MAIN)`);
      const mains = mainCampaigns.get(input.accountId) ?? [];
      const main = mains.find((campaign) => productName(campaign.name) === input.productName) ?? mains[0];
      const mainName = main?.name.trim() ?? `MAIN - ${input.productName}`;
      const target = targets.find((row) => row.accountId === input.accountId && (!main || row.campaignId === main.id));
      return {
        todo: "Valider → MAIN",
        label: `Valider → post ID dans ${mainName}, ad set ${weekAdset}`,
        blocked: !main ? `Crée ${mainName} en CBO d'abord` : !target ? `Crée l'ad set ${weekAdset} dans « ${mainName} » (Alison le prépare en brouillon)` : null,
        cpaTarget: null,
      };
    }
    if (kind === "MAIN" || kind === "SCALING") {
      if (falling) return plain("Surveiller", "⚠ en baisse sur 3 j · Surveiller");
      const days = (nowMs - Date.parse(input.since)) / (24 * HOUR);
      const factor = windows[7].factor;
      if (best && days >= 7 && m7.sales >= T.bidcapSales) {
        const usd = cpaAtMargin(20, { factor, price }, costs);
        const shown = money(usd, input.currency);
        return { todo: "Candidate BidCap", label: `Candidate BidCap · CPA cible = ${shown.label} (CPA à 20 % de marge)`, blocked: null, cpaTarget: { pct: 20, usd, local: shown.local, currency: input.currency } };
      }
      if (!best && days >= 7) {
        const usd = cpaAtMargin(15, { factor, price }, costs);
        const shown = money(usd, input.currency);
        return { todo: "Candidate CostCap", label: `Candidate CostCap · CPA cible = ${shown.label} (CPA à 15 % de marge)`, blocked: null, cpaTarget: { pct: 15, usd, local: shown.local, currency: input.currency } };
      }
      return plain("Tenir dans MAIN");
    }
    // BIDCAP / COSTCAP.
    if (falling) return plain("Surveiller", "⚠ en baisse sur 3 j · Surveiller");
    return plain("Laisser", `Laisser (${kind})`);
  };

  const changes: Array<{ key: string; change: StatusChange; auto: CreativeStatus }> = [];
  const launches: Array<{ key: string; at: string }> = [];
  const all: CreativeRow[] = [...groups.values()].map((work) => {
    const saved = store.creatives[work.key];
    // La date de lancement : created_time de la pub Meta la plus ancienne, sinon le premier jour avec impressions ; gardée en base, elle ne fait que reculer.
    const created = work.ads.map((row) => row.ad.createdTime).filter(Boolean).map(iso).sort()[0];
    const firstDay = work.ads.flatMap((row) => rowsByAd.get(row.ad.id) ?? []).filter((row) => row.impressions > 0).map((row) => row.date).sort()[0];
    const found = created ?? (firstDay ? `${firstDay}T12:00:00.000Z` : null);
    const launchedAt = [saved?.launchedAt, found].filter((value): value is string => Boolean(value)).sort()[0] ?? new Date(nowMs).toISOString();
    if (launchedAt !== saved?.launchedAt) launches.push({ key: work.key, at: launchedAt });
    const age = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${parisDay(launchedAt)}T00:00:00Z`)) / (24 * HOUR)));

    // Les emplacements : un par ad set.
    const byAdset = new Map<string, RawPlacement[]>();
    for (const row of work.ads) byAdset.set(row.adset.id, [...(byAdset.get(row.adset.id) ?? []), row]);
    const totalSales14 = [...byAdset.values()].reduce((sum, ads) => sum + ads.flatMap((row) => rowsByAd.get(row.ad.id) ?? []).filter((row) => row.date >= addDays(today, -14) && row.date <= d1).reduce((acc, row) => acc + row.purchases, 0), 0) * windows[14].factor;

    // 1er passage : les chiffres de chaque emplacement.
    const raw = [...byAdset.values()].map((ads) => {
      const { adset, campaign } = ads[0];
      const kind = adsetStatus(adset, campaign);
      const liveAds = ads.filter((row) => live(row.ad) && live(row.adset) && live(row.campaign));
      const isLive = liveAds.length > 0;
      const status: CreativeStatus = isLive ? (saved?.manual ?? kind) : "OFF";
      const products = [...new Set(ads.map((row) => productOfLink(row.link)))];
      const product: Product = products.length === 1 ? products[0] : products.filter((item) => item !== "?").length === 1 ? products.filter((item) => item !== "?")[0] : "?";
      const price = priceOf(product);
      const adRows = ads.flatMap((row) => rowsByAd.get(row.ad.id) ?? []);
      const margins = { 3: marginOf(inWindow(adRows, 3), 3, price), 7: marginOf(inWindow(adRows, 7), 7, price), 14: marginOf(inWindow(adRows, 14), 14, price) };
      return { ads, adset, campaign, kind, liveAds, isLive, status, product, price, margins, since: ads.map((row) => iso(row.ad.createdTime)).sort()[0] };
    });

    // 2e passage : le verdict, qui regarde aussi les autres emplacements (une créa TEST déjà en MAIN).
    const placements: Placement[] = raw.map((item) => {
      const { ads, adset, campaign, kind, liveAds, isLive, status, product, price, margins, since } = item;
      const mains = raw.filter((other) => other !== item && other.isLive && MAINS.includes(other.kind));
      const name = productName(campaign.name);
      const judged = verdict({
        kind,
        status,
        ads,
        margins,
        price,
        currency: work.account.currency,
        since,
        age,
        productName: name,
        accountId: work.account.accountId,
        mainSpend3: mains.length ? mains.reduce((sum, other) => sum + other.margins[3].spendUsd, 0) : null,
      });
      let { todo, label, blocked } = judged;
      const { cpaTarget } = judged;

      // La rampe passe d'abord : pas de coupe dans les 48 h qui suivent une HAUSSE de budget.
      // Après une baisse ou un retour au palier précédent, la coupe s'applique tout de suite.
      const rampRow = rampById.get(adset.id) ?? rampById.get(campaign.id);
      const change = rampRow?.lastChange;
      const recentRise = change && change.before != null && change.after != null && change.after > change.before && nowMs - Date.parse(change.at) < 48 * HOUR;
      if (todo === "Couper" && rampRow && (rampRow.status === "REDESCENDRE" || recentRise)) {
        todo = "Attendre";
        label =
          rampRow.status === "REDESCENDRE"
            ? `Attendre · la rampe dit de revenir à ${rampRow.nextBudget} € : fais-le d'abord, la coupe se juge ensuite tout de suite`
            : `Attendre · budget monté le ${shortDate(change!.at)} (${change!.before} → ${change!.after} €), re-jugée le ${shortDate(Date.parse(change!.at) + 48 * HOUR)}`;
        blocked = null;
      }

      // Une pub ajoutée dans un ad set MAIN qui tournait déjà : une semaine = un ad set neuf.
      const warnings: string[] = [];
      if (isLive && (kind === "MAIN" || kind === "SCALING")) {
        const late = liveAds.filter((row) => nowMs - Date.parse(iso(row.ad.createdTime)) < 7 * 24 * HOUR && Date.parse(iso(row.ad.createdTime)) - Date.parse(iso(adset.createdTime)) > 48 * HOUR);
        if (late.length && !(work.postId && totalSales14 >= 10)) warnings.push(`Pub ajoutée dans « ${adset.name} » qui tournait déjà : une créa neuve passe d'abord en TEST, et une semaine = un ad set MAIN neuf`);
      }

      return {
        adsetId: adset.id,
        adsetName: adset.name,
        campaignId: campaign.id,
        campaignName: campaign.name,
        kind,
        status,
        live: isLive,
        legacy: kind === "SCALING",
        adIds: ads.map((row) => row.ad.id),
        liveAdIds: liveAds.map((row) => row.ad.id),
        createdAt: since,
        product,
        productName: name,
        links: [...new Set(ads.map((row) => row.link).filter(Boolean))],
        margins,
        trend: trendOf(margins[7], margins[3]),
        todo,
        label,
        why: isLive ? sentence(margins[7], margins[3], launchedAt, age, trendOf(margins[7], margins[3])) : "",
        note: isLive && kind === "SCALING" ? `ancien ad set SCALING, migrer vers MAIN - ${name} à la prochaine semaine` : null,
        blocked,
        cpaTarget,
        warnings,
      };
    });
    placements.sort((a, b) => Number(b.live) - Number(a.live) || b.margins[window].spend - a.margins[window].spend);

    const livePlacements = placements.filter((row) => row.live);
    const autoBest = livePlacements.reduce((top, row) => (RANK[row.kind] > RANK[top] ? row.kind : top), "OFF" as CreativeStatus);
    const status = livePlacements.length ? (saved?.manual ?? autoBest) : "OFF";
    const margins = { 3: sumMargins(placements.map((row) => row.margins[3])), 7: sumMargins(placements.map((row) => row.margins[7])), 14: sumMargins(placements.map((row) => row.margins[14])) };
    const top = [...livePlacements].sort((a, b) => TODO_RANK[a.todo] - TODO_RANK[b.todo])[0];
    const liveProducts = [...new Set(livePlacements.map((row) => row.product))];
    const kinds = new Set(livePlacements.map((row) => row.kind));
    const where =
      kinds.has("TEST") && (kinds.has("MAIN") || kinds.has("SCALING"))
        ? "les deux"
        : [...kinds].map((kind) => (kind === "SCALING" ? "ancien SCALING" : kind)).join(" + ") || "—";

    if ((saved?.auto ?? null) !== autoBest) {
      changes.push({ key: work.key, auto: autoBest, change: { at: new Date().toISOString(), who: "auto", from: saved?.auto ?? null, to: autoBest, note: saved ? "" : "première lecture" } });
    }

    return {
      key: work.key,
      name: work.name,
      accountId: work.account.accountId,
      accountName: work.account.name,
      currency: work.account.currency,
      thumbnail: work.thumbnail,
      postId: work.postId,
      product: liveProducts.length === 1 ? liveProducts[0] : liveProducts.length ? "?" : (placements[0]?.product ?? "?"),
      status,
      autoStatus: autoBest,
      manual: Boolean(saved?.manual),
      where,
      placements,
      launchedAt,
      age,
      margins,
      trend: trendOf(margins[7], margins[3]),
      todo: top?.todo ?? "—",
      label: top ? (livePlacements.length > 1 ? `${top.adsetName} : ${top.label}` : top.label) : "",
      why: top?.why ?? "",
      note: top?.note ?? null,
      warnings: livePlacements.flatMap((row) => row.warnings),
      liveAdIds: livePlacements.flatMap((row) => row.liveAdIds),
      history: saved?.history ?? [],
    };
  });

  // L'historique des statuts (chaque changement automatique, daté, auteur « auto ») et les dates de lancement.
  if (changes.length || launches.length) {
    await updateStore((data) => {
      for (const { key, auto, change } of changes) {
        const current = data.creatives[key] ?? { auto: null, manual: null, history: [] };
        current.auto = auto;
        if (change.note !== "première lecture") current.history.push(change);
        data.creatives[key] = current;
      }
      for (const { key, at } of launches) {
        const current = data.creatives[key] ?? { auto: null, manual: null, history: [] };
        current.launchedAt = at;
        data.creatives[key] = current;
      }
    });
    for (const row of all) {
      const saved = store.creatives[row.key];
      if (saved) row.history = saved.history;
    }
  }

  const creatives = all.filter((row) => row.status !== "OFF").sort((a, b) => RANK[b.status] - RANK[a.status] || b.margins[window].spend - a.margins[window].spend);
  const archived = all.filter((row) => row.status === "OFF" && row.margins[14].spend > 0).sort((a, b) => b.margins[14].spend - a.margins[14].spend);

  /* ---------------- Agrégats par ad set et par campagne (avec le verdict de la rampe) ---------------- */
  const rampOf = (id: string): GroupRow["ramp"] => {
    const row = rampById.get(id);
    if (!row) return null;
    const label =
      row.verdict ??
      (row.status === "MONTER" ? `Monter à ${row.nextBudget} €` : row.status === "REDESCENDRE" ? `Revenir à ${row.nextBudget} €` : row.status === "COUPER" ? "Couper" : row.status === "TEST" ? "En test : ne pas toucher" : "Tenir");
    return { status: row.status, label, reason: row.reasons[0] ?? "", budget: row.budget, test: row.testAdset, lastRiseAt: row.lastRiseAt };
  };
  const groupsOut: GroupRow[] = [];
  for (const account of tree.accounts) {
    for (const campaign of account.campaigns) {
      const price = /39[.,]?99/.test(campaign.name) ? 39.99 : 29.99;
      const campaignRows = inWindow(rowsByCampaign.get(campaign.id) ?? [], window);
      if (!campaignRows.length) continue;
      groupsOut.push({ id: campaign.id, name: campaign.name, campaignName: account.name, level: "campaign", live: live(campaign), margin: marginOf(campaignRows, window, price), ramp: rampOf(campaign.id) });
      for (const adset of campaign.adsets) {
        const adsetRows = inWindow(rowsByAdset.get(adset.id) ?? [], window);
        if (adsetRows.length) groupsOut.push({ id: adset.id, name: adset.name, campaignName: campaign.name, level: "adset", live: live(adset) && live(campaign), margin: marginOf(adsetRows, window, price), ramp: rampOf(adset.id) });
      }
    }
  }

  /* ---------------- KPI de la semaine ---------------- */
  const weekStart = mondayOf(today);
  const thisWeek = (value: string | undefined) => Boolean(value && parisDay(value) >= weekStart);
  const uploaded = all.filter((row) => parisDay(row.launchedAt) >= weekStart).length;
  const briefs = store.briefs;
  const uploadedBriefs = briefs.filter((brief) => thisWeek(brief.statusAt["UPLOADÉE"]));
  const ratioBase = uploadedBriefs.length ? uploadedBriefs : briefs.filter((brief) => thisWeek(brief.createdAt));
  const iterationShare = ratioBase.length ? Math.round((ratioBase.filter((brief) => brief.type === "Itération").length / ratioBase.length) * 100) : null;
  const winners = all.flatMap((row) =>
    row.history
      .filter((change) => thisWeek(change.at) && ((change.from === "TEST" && (change.to === "MAIN" || change.to === "SCALING")) || ((change.to === "BIDCAP" || change.to === "COSTCAP") && change.from !== change.to)))
      .map((change) => ({ name: row.name, from: change.from, to: change.to, at: change.at }))
  );
  const products = objectives7?.products ?? [];
  const cpa: PipelineReport["kpis"]["cpa"] = [];
  const be29 = products[0]?.cpaMax ?? null;
  cpa.push({ label: "29,99 $", cpa: objectives7?.period.cpa ?? null, breakeven: be29, low: be29 != null ? round2(be29 * 0.6) : null, high: be29 != null ? round2(be29 * 0.7) : null });
  const live39 = creatives.filter((row) => row.product === "39,99 $");
  if (live39.length) {
    const spend = live39.reduce((sum, row) => sum + row.margins[7].spendUsd, 0);
    const sales = live39.reduce((sum, row) => sum + row.margins[7].sales, 0);
    const be39 = products[1]?.cpaMax ?? null;
    cpa.push({ label: "39,99 $", cpa: sales > 0 ? round2(spend / sales) : null, breakeven: be39, low: be39 != null ? round2(be39 * 0.6) : null, high: be39 != null ? round2(be39 * 0.7) : null });
  }
  const badges: Record<MarginBadge, number> = { BEST: 0, BONNE: 0, CUT: 0, DATA: 0 };
  for (const row of creatives) badges[row.margins[7].badge] += 1;
  const cutActive = creatives.flatMap((row) => row.placements.filter((place) => place.live && place.todo === "Couper").map((place) => `${row.name} (${place.adsetName})`));

  /* ---------------- « À faire cette semaine » (vue 7 j) ---------------- */
  let weekly: Weekly | null = null;
  if (!daily$) {
    const items: WeeklyItem[] = [];
    const checked = (id: string) => store.checks[`${weekStart}|${id}`] ?? null;
    const ORDER: Array<[WeeklyKind, Todo[]]> = [
      ["cut", ["Couper"]],
      ["validate", ["Valider → MAIN"]],
      ["cutTest", ["Couper dans TEST"]],
      ["candidate", ["Candidate BidCap", "Candidate CostCap"]],
      ["watch", ["Surveiller"]],
    ];
    for (const [kind, todos] of ORDER) {
      for (const row of creatives) {
        for (const place of row.placements) {
          if (!place.live || !todos.includes(place.todo)) continue;
          const id = `${kind}|${row.key}|${place.adsetId}`;
          const target = kind === "validate" ? (targets.find((item) => item.accountId === row.accountId && place.label.includes(item.campaignName.trim())) ?? targets.find((item) => item.accountId === row.accountId) ?? null) : null;
          items.push({
            id,
            kind,
            title: kind === "validate" ? `${row.name} (post ID${row.postId ? ` ${row.postId.split("_").pop()}` : " introuvable"})` : `${row.name} · ${place.adsetName}`,
            detail: place.label,
            why: place.why,
            creativeKey: row.key,
            name: row.name,
            adsetId: place.adsetId,
            adsetName: place.adsetName,
            accountId: row.accountId,
            postId: row.postId,
            liveAdIds: place.liveAdIds,
            group: kind === "validate" ? weekAdset : null,
            target: target ? { adsetId: target.adsetId, adsetName: target.adsetName, campaignId: target.campaignId, campaignName: target.campaignName } : null,
            blocked: place.blocked ?? (kind === "validate" && !row.postId ? "Post ID introuvable" : null),
            checked: checked(id),
          });
        }
      }
    }
    // Le brief du jeudi : de quoi rester dans la cible de 15 à 20 créas par semaine, 80 % d'itérations des BEST.
    const ready = briefs.filter((brief) => brief.status === "PRÊTE").length;
    const low = Math.max(0, 15 - uploaded);
    const high = Math.max(0, 20 - uploaded);
    const iterations = Math.round(high * 0.8);
    const sources = creatives.filter((row) => row.margins[7].badge === "BEST").map((row) => row.name);
    const briefId = `brief|${weekStart}`;
    items.push({
      id: briefId,
      kind: "brief",
      title: high ? `Brief du jeudi : ${low === high ? high : `${low} à ${high}`} créa${high > 1 ? "s" : ""} à uploader` : "Brief du jeudi : cible de la semaine déjà atteinte",
      detail: `${uploaded} uploadée${uploaded > 1 ? "s" : ""} cette semaine, ${ready} prête${ready > 1 ? "s" : ""} · ${iterations} itération${iterations > 1 ? "s" : ""} des BEST (80 %) et ${high - iterations} nouveau${high - iterations > 1 ? "x" : ""} concept${high - iterations > 1 ? "s" : ""} (20 %)`,
      why: sources.length ? `BEST à itérer : ${sources.join(", ")}` : "Aucune BEST sur 7 j : itère les BONNE, ou plus de nouveaux concepts",
      creativeKey: null,
      name: "Brief du jeudi",
      adsetId: null,
      adsetName: "",
      accountId: "",
      postId: null,
      liveAdIds: [],
      group: null,
      target: null,
      blocked: null,
      checked: checked(briefId),
    });
    weekly = { week: `S${week}`, weekStart, weekAdset, items };
  }

  /* ---------------- Le rappel du jour (heure de Paris) ---------------- */
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const briefedThisWeek = briefs.filter((brief) => thisWeek(brief.createdAt)).length;
  const ready = briefs.filter((brief) => brief.status === "PRÊTE");
  let reminder: PipelineReport["reminder"] = null;
  if (weekday === 1) reminder = { title: "Lundi : 15 à 20 briefs à écrire", lines: [`${briefedThisWeek} briefé${briefedThisWeek > 1 ? "s" : ""} cette semaine`, ...(cutActive.length ? [`À couper aujourd'hui : ${cutActive.join(", ")}`] : [])] };
  else if (weekday === 3) {
    const late = briefs.filter((brief) => brief.status === "BRIEF" || brief.status === "EN PROD");
    reminder = { title: "Mercredi 18 h : briefs à valider", lines: late.length ? late.map((brief) => `${brief.creaId} · ${brief.status} · ${brief.assignee || "non assigné"}`) : ["Aucun brief en attente"] };
  } else if (weekday === 4) {
    reminder = { title: `Jeudi : upload de ${ready.length} créa${ready.length > 1 ? "s" : ""} prête${ready.length > 1 ? "s" : ""}, ${Math.ceil(ready.length / 3)} ad set${Math.ceil(ready.length / 3) > 1 ? "s" : ""} TEST - S${week} à créer (3 à 5 créas par ad set)`, lines: ready.map((brief) => brief.creaId) };
  } else if (weekday === 5) {
    const j1 = creatives.flatMap((row) => row.placements.filter((place) => place.live && place.kind === "TEST" && nowMs - Date.parse(place.createdAt) < 72 * HOUR).map((place) => `${row.name} (${place.adsetName}) → ${place.label}`));
    reminder = { title: "Vendredi : verdict des tests J1", lines: j1.length ? j1 : ["Aucune créa en J1"] };
  } else if (weekday === 0) reminder = { title: "Dimanche : les 5 KPI de la semaine", lines: ["Lis le bloc KPI juste au-dessus."] };

  const journal = [
    ...store.journal.map((line) => ({ at: line.at, who: line.who, what: line.what })),
    ...all.flatMap((row) => row.history.map((change) => ({ at: change.at, who: change.who, what: `${row.name} : ${change.from ?? "—"} → ${change.to}${change.note ? ` (${change.note})` : ""}` }))),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 60);

  const report: PipelineReport = {
    window,
    mode,
    windows,
    assumptions: { upsellRate, upsellDefault: store.settings.upsellRate == null, pieces: round2(pieces), piecesDefault, cogsPerOrder, feeRate },
    thresholds: T,
    creatives,
    archived,
    groups: groupsOut,
    targets,
    weekly,
    kpis: { weekStart, uploaded, briefed: briefedThisWeek, iterationShare, winners, cpa, badges, cutActive },
    reminder,
    briefs: [...briefs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    journal,
    warnings,
    builtAt: new Date().toISOString(),
  };
  reportCache.set(window, { at: Date.now(), report });
  return report;
}
