import { buildAssociateOverview, getAssociateScope } from "@/lib/associate/scope";
import { fxRates } from "@/lib/fx";
import { graphGet, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import { buildAdsTree, restrictTreeToAccounts } from "@/lib/meta/tree";
import type { AdNode, AdsetNode, CampaignNode } from "@/lib/meta/types";
import { buildObjectivesBar } from "@/lib/metrics/objectives";
import { getSupplierGrids, gridPicker, parcelCost } from "@/lib/metrics/supplier-grid";
import { buildPilotage } from "@/lib/pilotage/build";
import { adDailyInsights, type AdDay } from "@/lib/pilotage/meta-daily";
import { reportToday } from "@/lib/report-tz";
import { readStore, updateStore, type Brief, type CreativeStatus, type StatusChange } from "@/lib/creative-pipeline/store";
import { buildScalingRamp, type RampRow } from "@/lib/metrics/scaling-ramp";

/**
 * Le pipeline créa de l'Ads Manager : chaque créa (regroupée par post ID, et
 * par image + nom pour les réuploads) avec sa marge nette sur 3 / 7 / 14 jours
 * complets (jamais la journée en cours), son statut (TEST, SCALING, HYPER,
 * COSTCAP, OFF, déduit de l'ad set où elle tourne ou forcé à la main) et un
 * seul verbe « À faire ». Plus les KPI de la semaine (lundi → dimanche, heure
 * de Paris) et le rappel du jour.
 *
 * Marge nette = CA − COGS − frais − dépense de la pub, avec :
 *  ventes corrigées = achats Meta × facteur réel (commandes ÷ achats Meta, même fenêtre, tous comptes) ;
 *  CA = ventes × prix (29,99 $ ou 39,99 $) + 9,99 $ × ventes × taux d'upsell ;
 *  COGS = ventes × coût grille à la moyenne de pièces par commande ; frais = 4 % du CA.
 */

export type WindowDays = 3 | 7 | 14;
export type MarginBadge = "BEST" | "BONNE" | "CUT" | "DATA";
export type Margin = { spend: number; spendUsd: number; purchases: number; sales: number; revenue: number; value: number; margin: number; pct: number | null; badge: MarginBadge; roas: number | null; clicks: number; carts: number };
export type Todo = "Couper" | "Attendre" | "Surveiller" | "Laisser" | "Laisser jusqu'à J7" | "Promouvoir en SCALING" | "Post ID dans le HYPER" | "Éligible COSTCAP" | "—";
/** Le produit lu sur l'URL de destination de la pub : « ? » quand elle ne le dit pas (calculé alors à 29,99 $). */
export type Product = "29,99 $" | "39,99 $" | "?";

/** Un emplacement d'une créa : l'ad set où elle tourne, avec sa marge et son verdict à lui. */
export type Placement = {
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  /** Le type de l'ad set (TEST, SCALING, HYPER, COSTCAP), allumé ou non. */
  kind: CreativeStatus;
  /** OFF si la pub, l'ad set ou la campagne est coupé ; sinon le type (ou le statut forcé). */
  status: CreativeStatus;
  live: boolean;
  adIds: string[];
  liveAdIds: string[];
  createdAt: string;
  product: Product;
  /** L'URL de destination des pubs de cet emplacement (d'où vient le produit). */
  links: string[];
  margins: Record<WindowDays, Margin>;
  todo: Todo;
  why: string;
  /** Le bouton est remplacé par ce message (déjà dans le HYPER, aucune campagne HYPER active…). */
  blocked: string | null;
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
  placements: Placement[];
  firstSeen: string;
  margins: Record<WindowDays, Margin>;
  /** Le verdict le plus urgent de ses emplacements actifs (chacun a le sien). */
  todo: Todo;
  why: string;
  warnings: string[];
  liveAdIds: string[];
  history: StatusChange[];
};

export type GroupRow = { id: string; name: string; campaignName: string; level: "adset" | "campaign"; live: boolean; margin: Margin };

export type PipelineReport = {
  window: WindowDays;
  windows: Record<WindowDays, { start: string; end: string; factor: number; factorSource: "calculé" | "forcé" | "par défaut"; orders: number; metaPurchases: number }>;
  assumptions: { upsellRate: number; upsellDefault: boolean; pieces: number; piecesDefault: boolean; cogsPerOrder: number; feeRate: number };
  creatives: CreativeRow[];
  archived: CreativeRow[];
  groups: GroupRow[];
  /** Ad sets actifs où promouvoir une créa (SCALING / HYPER), par compte. */
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
const DEFAULT_UPSELL = 0.1;
const DEFAULT_FACTOR = 1.1;
const UPSELL_PRICE = 9.99;
const RANK: Record<CreativeStatus, number> = { OFF: 0, BRIEF: 0, "EN PROD": 0, "PRÊTE": 0, TEST: 1, SCALING: 2, HYPER: 3, COSTCAP: 4 };

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
  // Les seuils de ROAS du 29,99 $ (minimum et « à tenir »), ceux de la barre Objectifs.
  const ROAS_MIN = ramp?.cap.thresholds.breakeven ?? 1.61;
  const ROAS_HOLD = ramp?.cap.thresholds.hold ?? 1.8;
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
  const upsellRate = store.settings.upsellRate ?? DEFAULT_UPSELL;
  const piecesRaw = pilotage?.objectives.collarsPerOrder ?? 0;
  const pieces = piecesRaw >= 1 ? piecesRaw : 2;
  const grid = gridPicker(grids, () => null)({ number: Number.MAX_SAFE_INTEGER, day: today });
  const low = Math.max(1, Math.floor(pieces));
  const cogsPerOrder = round2(parcelCost(grid, low) + (pieces - low) * (parcelCost(grid, low + 1) - parcelCost(grid, low)));
  const feeRate = (pilotage?.objectives.processingRate ?? 4) / 100;

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
    const sales = purchases * windows[days].factor;
    const revenue = sales * price + UPSELL_PRICE * sales * upsellRate;
    const margin = revenue - sales * cogsPerOrder - revenue * feeRate - spendUsd;
    const pct = revenue > 0 ? margin / revenue : null;
    const badge: MarginBadge = sales < 5 ? "DATA" : (pct ?? -1) >= 0.15 ? "BEST" : (pct ?? -1) >= 0.075 ? "BONNE" : "CUT";
    return { spend: round2(spend), spendUsd: round2(spendUsd), purchases, sales: round2(sales), revenue: round2(revenue), value: round2(value), margin: round2(margin), pct: pct == null ? null : round2(pct * 100), badge, roas: spendUsd > 0 ? round2(value / spendUsd) : null, clicks, carts };
  };
  /** Le total de plusieurs emplacements (prix différents possibles). */
  const sumMargins = (list: Margin[]): Margin => {
    const t = list.reduce(
      (acc, m) => ({ spend: acc.spend + m.spend, spendUsd: acc.spendUsd + m.spendUsd, purchases: acc.purchases + m.purchases, sales: acc.sales + m.sales, revenue: acc.revenue + m.revenue, value: acc.value + m.value, margin: acc.margin + m.margin, clicks: acc.clicks + m.clicks, carts: acc.carts + m.carts }),
      { spend: 0, spendUsd: 0, purchases: 0, sales: 0, revenue: 0, value: 0, margin: 0, clicks: 0, carts: 0 }
    );
    const pct = t.revenue > 0 ? t.margin / t.revenue : null;
    const badge: MarginBadge = t.sales < 5 ? "DATA" : (pct ?? -1) >= 0.15 ? "BEST" : (pct ?? -1) >= 0.075 ? "BONNE" : "CUT";
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
  /** Le statut d'un ad set : COSTCAP, HYPER, puis SCALING par son nom (STATIC 3:4, MIX 2 à 4, « SCALING ») ou son âge (≥ 7 j), sinon TEST. */
  const adsetStatus = (adset: AdsetNode, campaign: CampaignNode): CreativeStatus => {
    if (/COSTCAP|BIDCAP/i.test(campaign.name)) return "COSTCAP";
    if (campaign.budgetLevel === "campaign" && /ULTRA|HYPER/i.test(campaign.name)) return "HYPER";
    if (/SCALING|STATIC\s*-?\s*3:4|MIX\s*[234]/i.test(adset.name)) return "SCALING";
    return nowMs - Date.parse(iso(adset.createdTime)) < 7 * 24 * HOUR ? "TEST" : "SCALING";
  };
  type RawPlacement = { ad: AdNode; adset: AdsetNode; campaign: CampaignNode; link: string };
  type Work = { key: string; name: string; account: (typeof tree.accounts)[number]; thumbnail: string | null; postId: string | null; hash: string | null; ads: RawPlacement[] };
  const groups = new Map<string, Work>();
  const targets: PipelineReport["targets"] = [];
  for (const account of tree.accounts) {
    for (const campaign of account.campaigns) {
      for (const adset of campaign.adsets) {
        if (live(adset) && live(campaign)) {
          const status = adsetStatus(adset, campaign);
          if (status === "SCALING" || status === "HYPER") targets.push({ accountId: account.accountId, adsetId: adset.id, adsetName: adset.name, campaignId: campaign.id, campaignName: campaign.name, status });
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
  const TODO_RANK: Record<Todo, number> = { Couper: 1, "Promouvoir en SCALING": 2, "Post ID dans le HYPER": 3, "Éligible COSTCAP": 4, Attendre: 5, Surveiller: 6, "Laisser jusqu'à J7": 7, Laisser: 8, "—": 9 };

  /** Le verdict d'un emplacement, sur ses propres chiffres (jours complets). */
  const verdict = (status: CreativeStatus, ads: RawPlacement[], price: number): { todo: Todo; why: string } => {
    const liveAds = ads.filter((row) => live(row.ad) && live(row.adset) && live(row.campaign));
    if (status === "OFF" || !liveAds.length) return { todo: "—", why: "" };
    const rows = liveAds.flatMap((row) => rowsByAd.get(row.ad.id) ?? []).filter((row) => row.date <= d1);
    if (status === "TEST") {
      const started = liveAds.map((row) => iso(row.ad.createdTime)).sort()[0];
      const ageH = (nowMs - Date.parse(started)) / HOUR;
      const since = marginOf(rows, 14, price);
      const cpcUsd = since.clicks > 0 ? since.spendUsd / since.clicks : null;
      const adsetSpendUsd = (rowsByAdset.get(liveAds[0].adset.id) ?? []).filter((row) => row.date <= d1).reduce((sum, row) => sum + toUsd(row.spend, row.currency), 0);
      if (ageH < 24) return { todo: "Laisser", why: "Lancée il y a moins de 24 h" };
      if (ageH < 72) {
        if (cpcUsd != null && cpcUsd > 3.5) return { todo: "Couper", why: `CPC ${cpcUsd.toFixed(2)} $ (> 3,50 $)` };
        if (since.spendUsd >= 40 && since.carts === 0) return { todo: "Couper", why: `0 ajout panier pour ${Math.round(since.spendUsd)} $` };
        return { todo: "Laisser", why: `J1 : CPC ${cpcUsd == null ? "—" : `${cpcUsd.toFixed(2)} $`}, ${since.carts} ajout${since.carts > 1 ? "s" : ""} panier` };
      }
      if (ageH < 7 * 24) {
        if ((since.roas ?? 0) >= 2 && since.purchases >= 5) return { todo: "Promouvoir en SCALING", why: `ROAS ${since.roas} et ${since.purchases} ventes` };
        if (since.spendUsd >= 60 && since.purchases === 0) return { todo: "Couper", why: `0 vente pour ${Math.round(since.spendUsd)} $` };
        if ((since.roas ?? 0) < 1.2 && adsetSpendUsd >= 150) return { todo: "Couper", why: `ROAS ${since.roas ?? 0} avec ${Math.round(adsetSpendUsd)} $ dans l'ad set` };
        return { todo: "Laisser jusqu'à J7", why: `ROAS ${since.roas ?? "—"}, ${since.purchases} vente${since.purchases > 1 ? "s" : ""}` };
      }
      return { todo: "Couper", why: "7 jours en test sans être promue" };
    }
    if (status === "SCALING") {
      // Deux conditions : la marge 7 j ET le ROAS Meta 3 j de la créa (minimum 1,61, « à tenir » 1,80).
      const m = marginOf(rows.filter((row) => row.date >= addDays(today, -7)), 7, price);
      const roas3 = marginOf(rows.filter((row) => row.date >= addDays(today, -3)), 3, price).roas;
      const r3 = roas3 == null ? "—" : roas3.toFixed(2);
      if (m.badge === "BEST" && m.sales >= 20) {
        if ((roas3 ?? 0) >= ROAS_HOLD) return { todo: "Post ID dans le HYPER", why: `Marge ${m.pct} % et ${Math.round(m.sales)} ventes sur 7 j, ROAS 3 j ${r3}` };
        return { todo: "Surveiller", why: `Marge ${m.pct} % sur 7 j, mais ROAS 3 j ${r3} (< ${ROAS_HOLD.toFixed(2)}) : pas encore pour le HYPER` };
      }
      if (m.badge === "CUT") {
        if (roas3 != null && roas3 < ROAS_MIN) return { todo: "Couper", why: `Marge ${m.pct} % sur 7 j (< 7,5 %) et ROAS 3 j ${r3} (< ${ROAS_MIN.toFixed(2)})` };
        return { todo: "Surveiller", why: `Marge ${m.pct} % sur 7 j (< 7,5 %), mais ROAS 3 j ${r3} (≥ ${ROAS_MIN.toFixed(2)})` };
      }
      return { todo: "Laisser", why: m.badge === "DATA" ? "Moins de 5 ventes sur 7 j : pas encore de verdict" : `Marge ${m.pct} % sur 7 j` };
    }
    if (status === "HYPER") {
      const m = marginOf(rows, 14, price);
      const campaignSales = (rowsByCampaign.get(liveAds[0].campaign.id) ?? []).filter((row) => row.date >= addDays(today, -7) && row.date <= d1).reduce((sum, row) => sum + row.purchases, 0) * windows[7].factor;
      if (m.badge === "BEST" && campaignSales >= 50) return { todo: "Éligible COSTCAP", why: `Marge ${m.pct} % sur 14 j, campagne à ${Math.round(campaignSales)} ventes / semaine` };
      if (m.badge === "CUT") return { todo: "Couper", why: `Marge ${m.pct} % sur 14 j (< 7,5 %)` };
      return { todo: "Laisser", why: m.badge === "DATA" ? "Moins de 5 ventes sur 14 j : pas encore de verdict" : `Marge ${m.pct} % sur 14 j` };
    }
    return { todo: "Laisser", why: "Campagne en cost cap" };
  };

  const changes: Array<{ key: string; change: StatusChange; auto: CreativeStatus }> = [];
  const all: CreativeRow[] = [...groups.values()].map((work) => {
    const saved = store.creatives[work.key];
    // Les emplacements : un par ad set.
    const byAdset = new Map<string, RawPlacement[]>();
    for (const row of work.ads) byAdset.set(row.adset.id, [...(byAdset.get(row.adset.id) ?? []), row]);
    const totalSales14 = [...byAdset.values()].reduce((sum, ads) => sum + ads.flatMap((row) => rowsByAd.get(row.ad.id) ?? []).filter((row) => row.date >= addDays(today, -14) && row.date <= d1).reduce((acc, row) => acc + row.purchases, 0), 0) * windows[14].factor;

    const placements: Placement[] = [...byAdset.values()].map((ads) => {
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
      let { todo, why } = verdict(status, ads, price);
      let blocked: string | null = null;

      // 1. La rampe passe d'abord : pas de coupe sur un ad set dont le budget vient de bouger.
      const rampRow = rampById.get(adset.id) ?? rampById.get(campaign.id);
      const change = rampRow?.lastChange;
      if (todo === "Couper" && rampRow && (rampRow.status === "REDESCENDRE" || (change && nowMs - Date.parse(change.at) < 72 * HOUR))) {
        todo = "Attendre";
        why =
          rampRow.status === "REDESCENDRE"
            ? `La rampe dit de revenir à ${rampRow.nextBudget} € : fais-le d'abord, puis attendre J+3 avant de juger cette pub`
            : `Budget changé le ${shortDate(change!.at)} (${change!.before ?? "?"} → ${change!.after ?? "?"} €) : attendre J+3, re-jugée le ${shortDate(Date.parse(change!.at) + 72 * HOUR)}`;
      }

      // 4. Promouvoir / HYPER : seulement si c'est possible.
      const otherKinds = [...byAdset.values()].map((list) => ({ kind: adsetStatus(list[0].adset, list[0].campaign), name: list[0].adset.name }));
      if (todo === "Post ID dans le HYPER" || todo === "Promouvoir en SCALING") {
        const want: CreativeStatus = todo === "Post ID dans le HYPER" ? "HYPER" : "SCALING";
        const already = otherKinds.find((item) => item.kind === want);
        if (already) blocked = `Déjà dans un ad set ${want} (« ${already.name} »)`;
        else if (!targets.some((target) => target.accountId === work.account.accountId && target.status === want)) blocked = want === "HYPER" ? "Aucune campagne HYPER active sur ce compte : rallume-la ou crée-la d'abord" : "Aucun ad set SCALING actif sur ce compte";
      }

      // 2. Créa neuve dans un ad set de scaling : seulement si ajoutée plus de 48 h après l'ad set, et pas un post ID qui a déjà fait ses preuves.
      const warnings: string[] = [];
      if (isLive && (kind === "SCALING" || kind === "HYPER")) {
        const late = liveAds.filter((row) => nowMs - Date.parse(iso(row.ad.createdTime)) < 7 * 24 * HOUR && Date.parse(iso(row.ad.createdTime)) - Date.parse(iso(adset.createdTime)) > 48 * HOUR);
        if (late.length && !(work.postId && totalSales14 >= 10)) warnings.push(`Créa neuve ajoutée dans l'ad set ${kind} « ${adset.name} » : une créa neuve passe d'abord en TEST`);
      }

      return {
        adsetId: adset.id,
        adsetName: adset.name,
        campaignId: campaign.id,
        campaignName: campaign.name,
        kind,
        status,
        live: isLive,
        adIds: ads.map((row) => row.ad.id),
        liveAdIds: liveAds.map((row) => row.ad.id),
        createdAt: ads.map((row) => iso(row.ad.createdTime)).sort()[0],
        product,
        links: [...new Set(ads.map((row) => row.link).filter(Boolean))],
        margins,
        todo,
        why,
        blocked,
        warnings,
      };
    });
    placements.sort((a, b) => Number(b.live) - Number(a.live) || b.margins[window].spend - a.margins[window].spend);

    const livePlacements = placements.filter((row) => row.live);
    const autoBest = placements.filter((row) => row.live).reduce((top, row) => (RANK[row.kind] > RANK[top] ? row.kind : top), "OFF" as CreativeStatus);
    const status = livePlacements.length ? (saved?.manual ?? autoBest) : "OFF";
    const margins = { 3: sumMargins(placements.map((row) => row.margins[3])), 7: sumMargins(placements.map((row) => row.margins[7])), 14: sumMargins(placements.map((row) => row.margins[14])) };
    const top = [...livePlacements].sort((a, b) => TODO_RANK[a.todo] - TODO_RANK[b.todo])[0];
    const liveProducts = [...new Set(livePlacements.map((row) => row.product))];

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
      placements,
      firstSeen: placements.map((row) => row.createdAt).sort()[0] ?? new Date().toISOString(),
      margins,
      todo: top?.todo ?? "—",
      why: top ? (livePlacements.length > 1 ? `${top.adsetName} : ${top.why}` : top.why) : "",
      warnings: livePlacements.flatMap((row) => row.warnings),
      liveAdIds: livePlacements.flatMap((row) => row.liveAdIds),
      history: saved?.history ?? [],
    };
  });

  // L'historique des statuts : chaque changement automatique est noté (daté, auteur « auto »).
  if (changes.length) {
    await updateStore((data) => {
      for (const { key, auto, change } of changes) {
        const current = data.creatives[key] ?? { auto: null, manual: null, history: [] };
        current.auto = auto;
        if (change.note !== "première lecture") current.history.push(change);
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

  /* ---------------- Agrégats par ad set et par campagne ---------------- */
  const groupsOut: GroupRow[] = [];
  for (const account of tree.accounts) {
    for (const campaign of account.campaigns) {
      const price = /39[.,]?99/.test(campaign.name) ? 39.99 : 29.99;
      const campaignRows = inWindow(rowsByCampaign.get(campaign.id) ?? [], window);
      if (!campaignRows.length) continue;
      groupsOut.push({ id: campaign.id, name: campaign.name, campaignName: account.name, level: "campaign", live: live(campaign), margin: marginOf(campaignRows, window, price) });
      for (const adset of campaign.adsets) {
        const adsetRows = inWindow(rowsByAdset.get(adset.id) ?? [], window);
        if (adsetRows.length) groupsOut.push({ id: adset.id, name: adset.name, campaignName: campaign.name, level: "adset", live: live(adset) && live(campaign), margin: marginOf(adsetRows, window, price) });
      }
    }
  }

  /* ---------------- KPI de la semaine ---------------- */
  const weekStart = mondayOf(today);
  const thisWeek = (value: string | undefined) => Boolean(value && parisDay(value) >= weekStart);
  const uploaded = all.filter((row) => parisDay(row.firstSeen) >= weekStart).length;
  const briefs = store.briefs;
  const uploadedBriefs = briefs.filter((brief) => thisWeek(brief.statusAt["UPLOADÉE"]));
  const ratioBase = uploadedBriefs.length ? uploadedBriefs : briefs.filter((brief) => thisWeek(brief.createdAt));
  const iterationShare = ratioBase.length ? Math.round((ratioBase.filter((brief) => brief.type === "Itération").length / ratioBase.length) * 100) : null;
  const winners = all.flatMap((row) =>
    row.history
      .filter((change) => thisWeek(change.at) && ((change.from === "TEST" && change.to === "SCALING") || (change.to === "HYPER" && (change.from === "SCALING" || change.from === "TEST"))))
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
    reminder = { title: `Jeudi : upload de ${ready.length} créa${ready.length > 1 ? "s" : ""} prête${ready.length > 1 ? "s" : ""}, ${Math.ceil(ready.length / 3)} ad set${Math.ceil(ready.length / 3) > 1 ? "s" : ""} à créer (3 créas = 1 concept + 2 swaps)`, lines: ready.map((brief) => brief.creaId) };
  } else if (weekday === 5) {
    const j1 = creatives.flatMap((row) => row.placements.filter((place) => place.live && place.status === "TEST" && nowMs - Date.parse(place.createdAt) < 72 * HOUR).map((place) => `${row.name} (${place.adsetName}) → ${place.todo} (${place.why})`));
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
    windows,
    assumptions: { upsellRate, upsellDefault: store.settings.upsellRate == null, pieces: round2(pieces), piecesDefault: piecesRaw < 1, cogsPerOrder, feeRate },
    creatives,
    archived,
    groups: groupsOut,
    targets,
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
