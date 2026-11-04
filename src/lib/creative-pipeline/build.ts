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
export type Margin = { spend: number; spendUsd: number; purchases: number; sales: number; revenue: number; margin: number; pct: number | null; badge: MarginBadge; roas: number | null; clicks: number; carts: number };
export type Todo = "Couper" | "Laisser" | "Laisser jusqu'à J7" | "Promouvoir en SCALING" | "Post ID dans le HYPER" | "Éligible COSTCAP" | "—";

export type Placement = { adId: string; adName: string; adsetId: string; adsetName: string; campaignId: string; campaignName: string; status: CreativeStatus; createdAt: string; live: boolean };

export type CreativeRow = {
  key: string;
  name: string;
  accountId: string;
  accountName: string;
  currency: string;
  thumbnail: string | null;
  postId: string | null;
  product: "29,99 $" | "39,99 $";
  status: CreativeStatus;
  autoStatus: CreativeStatus;
  manual: boolean;
  placements: Placement[];
  firstSeen: string;
  margins: Record<WindowDays, Margin>;
  todo: Todo;
  why: string;
  warnings: string[];
  /** Les pubs actives à mettre en pause pour « Couper ». */
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
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.map;
  const map = new Map<string, Identity>(hit?.map ?? []);
  try {
    const act = `act_${accountId}`;
    const token = await resolveToken(act);
    const filtering = encodeURIComponent(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "PENDING_REVIEW", "IN_PROCESS", "WITH_ISSUES"] }]));
    let body = await graphGet<RawAd>(
      `${act}/ads?fields=id,creative{effective_object_story_id,image_hash,object_story_spec{link_data{link,image_hash},video_data{video_id,call_to_action}},asset_feed_spec{link_urls,images,videos}}&limit=300&filtering=${filtering}`,
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
          link: spec?.link_data?.link || spec?.video_data?.call_to_action?.value?.link || feed?.link_urls?.[0]?.website_url || "",
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
  if (!force && hit && Date.now() - hit.at < 3 * 60_000) return hit.report;

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
    return { spend: round2(spend), spendUsd: round2(spendUsd), purchases, sales: round2(sales), revenue: round2(revenue), margin: round2(margin), pct: pct == null ? null : round2(pct * 100), badge, roas: spendUsd > 0 ? round2(value / spendUsd) : null, clicks, carts };
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
  const placementStatus = (ad: AdNode, adset: AdsetNode, campaign: CampaignNode): CreativeStatus =>
    !live(ad) || !live(adset) || !live(campaign) ? "OFF" : adsetStatus(adset, campaign);
  type Work = { key: string; name: string; account: (typeof tree.accounts)[number]; thumbnail: string | null; postId: string | null; hash: string | null; product: CreativeRow["product"]; placements: Array<Placement & { ad: AdNode; adset: AdsetNode; campaign: CampaignNode }> };
  const groups = new Map<string, Work>();
  const targets: PipelineReport["targets"] = [];
  for (const account of tree.accounts) {
    for (const campaign of account.campaigns) {
      for (const adset of campaign.adsets) {
        const adsetLive = live(adset) && live(campaign);
        if (adsetLive) {
          const status = adsetStatus(adset, campaign);
          if (status === "SCALING" || status === "HYPER") targets.push({ accountId: account.accountId, adsetId: adset.id, adsetName: adset.name, campaignId: campaign.id, campaignName: campaign.name, status });
        }
        for (const ad of adset.ads) {
          const identity = ids.get(ad.id);
          const key = identity?.postId ? `post:${identity.postId}` : `ad:${ad.id}`;
          const product = /venom39/i.test(identity?.link ?? "") || /39[.,]?99/.test(campaign.name) ? "39,99 $" : "29,99 $";
          const work = groups.get(key) ?? { key, name: ad.name, account, thumbnail: ad.thumbnailUrl, postId: identity?.postId ?? null, hash: identity?.hash ?? null, product, placements: [] };
          work.placements.push({ adId: ad.id, adName: ad.name, adsetId: adset.id, adsetName: adset.name, campaignId: campaign.id, campaignName: campaign.name, status: placementStatus(ad, adset, campaign), createdAt: iso(ad.createdTime), live: live(ad) && adsetLive, ad, adset, campaign });
          if (product === "39,99 $") work.product = product;
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
      first.placements.push(...work.placements);
      groups.delete(key);
    } else byImage.set(imageKey, work);
  }

  /* ---------------- Statut, marge et « À faire » ---------------- */
  const changes: Array<{ key: string; change: StatusChange; auto: CreativeStatus }> = [];
  const all: CreativeRow[] = [...groups.values()].map((work) => {
    const price = work.product === "39,99 $" ? 39.99 : 29.99;
    const best = work.placements.reduce((top, row) => (RANK[row.status] > RANK[top] ? row.status : top), "OFF" as CreativeStatus);
    const saved = store.creatives[work.key];
    const status = saved?.manual ?? best;
    const adRows = work.placements.flatMap((row) => rowsByAd.get(row.adId) ?? []);
    const margins = { 3: marginOf(inWindow(adRows, 3), 3, price), 7: marginOf(inWindow(adRows, 7), 7, price), 14: marginOf(inWindow(adRows, 14), 14, price) };
    const main = work.placements.filter((row) => row.status === status && row.live);
    const mainRows = main.flatMap((row) => rowsByAd.get(row.adId) ?? []).filter((row) => row.date <= d1);
    const firstSeen = work.placements.map((row) => row.createdAt).sort()[0] ?? new Date().toISOString();
    const warnings: string[] = [];
    let todo: Todo = "—";
    let why = "";

    if (status === "TEST" && main.length) {
      const started = main.map((row) => row.createdAt).sort()[0];
      const ageH = (nowMs - Date.parse(started)) / HOUR;
      const since = marginOf(mainRows, 14, price);
      const cpcUsd = since.clicks > 0 ? since.spendUsd / since.clicks : null;
      const adsetSpendUsd = [...new Set(main.map((row) => row.adsetId))].flatMap((id) => rowsByAdset.get(id) ?? []).filter((row) => row.date <= d1).reduce((sum, row) => sum + toUsd(row.spend, row.currency), 0);
      if (ageH < 24) {
        todo = "Laisser";
        why = "Lancée il y a moins de 24 h";
      } else if (ageH < 72) {
        if (cpcUsd != null && cpcUsd > 3.5) [todo, why] = ["Couper", `CPC ${cpcUsd.toFixed(2)} $ (> 3,50 $)`];
        else if (since.spendUsd >= 40 && since.carts === 0) [todo, why] = ["Couper", `0 ajout panier pour ${Math.round(since.spendUsd)} $`];
        else [todo, why] = ["Laisser", `J1 : CPC ${cpcUsd == null ? "—" : `${cpcUsd.toFixed(2)} $`}, ${since.carts} ajout${since.carts > 1 ? "s" : ""} panier`];
      } else if (ageH < 7 * 24) {
        if ((since.roas ?? 0) >= 2 && since.purchases >= 5) [todo, why] = ["Promouvoir en SCALING", `ROAS ${since.roas} et ${since.purchases} ventes`];
        else if (since.spendUsd >= 60 && since.purchases === 0) [todo, why] = ["Couper", `0 vente pour ${Math.round(since.spendUsd)} $`];
        else if ((since.roas ?? 0) < 1.2 && adsetSpendUsd >= 150) [todo, why] = ["Couper", `ROAS ${since.roas ?? 0} avec ${Math.round(adsetSpendUsd)} $ dans l'ad set`];
        else [todo, why] = ["Laisser jusqu'à J7", `ROAS ${since.roas ?? "—"}, ${since.purchases} vente${since.purchases > 1 ? "s" : ""}`];
      } else [todo, why] = ["Couper", "7 jours en test sans être promue"];
    } else if (status === "SCALING") {
      const m = marginOf(mainRows.filter((row) => row.date >= addDays(today, -7)), 7, price);
      if (m.badge === "BEST" && m.sales >= 20) [todo, why] = ["Post ID dans le HYPER", `Marge ${m.pct} % et ${Math.round(m.sales)} ventes sur 7 j`];
      else if (m.badge === "CUT") [todo, why] = ["Couper", `Marge ${m.pct} % sur 7 j (< 7,5 %)`];
      else [todo, why] = ["Laisser", m.badge === "DATA" ? "Moins de 5 ventes sur 7 j" : `Marge ${m.pct} % sur 7 j`];
    } else if (status === "HYPER") {
      const m = marginOf(mainRows, 14, price);
      const campaignSales = [...new Set(main.map((row) => row.campaignId))].flatMap((id) => rowsByCampaign.get(id) ?? []).filter((row) => row.date >= addDays(today, -7) && row.date <= d1).reduce((sum, row) => sum + row.purchases, 0) * windows[7].factor;
      if (m.badge === "BEST" && campaignSales >= 50) [todo, why] = ["Éligible COSTCAP", `Marge ${m.pct} % sur 14 j, campagne à ${Math.round(campaignSales)} ventes / semaine`];
      else if (m.badge === "CUT") [todo, why] = ["Couper", `Marge ${m.pct} % sur 14 j (< 7,5 %)`];
      else [todo, why] = ["Laisser", m.badge === "DATA" ? "Moins de 5 ventes sur 14 j" : `Marge ${m.pct} % sur 14 j`];
    } else if (status === "COSTCAP") [todo, why] = ["Laisser", "Campagne en cost cap"];

    for (const row of work.placements) {
      if (row.live && (row.status === "SCALING" || row.status === "HYPER") && nowMs - Date.parse(row.createdAt) < 7 * 24 * HOUR) {
        warnings.push(`Créa neuve (< 7 j) dans l'ad set ${row.status} « ${row.adsetName} » : une créa neuve passe d'abord en TEST`);
      }
    }

    if ((saved?.auto ?? null) !== best) {
      changes.push({ key: work.key, auto: best, change: { at: new Date().toISOString(), who: "auto", from: saved?.auto ?? null, to: best, note: saved ? "" : "première lecture" } });
    }

    return {
      key: work.key,
      name: work.name,
      accountId: work.account.accountId,
      accountName: work.account.name,
      currency: work.account.currency,
      thumbnail: work.thumbnail,
      postId: work.postId,
      product: work.product,
      status,
      autoStatus: best,
      manual: Boolean(saved?.manual),
      placements: work.placements.map((row) => ({ adId: row.adId, adName: row.adName, adsetId: row.adsetId, adsetName: row.adsetName, campaignId: row.campaignId, campaignName: row.campaignName, status: row.status, createdAt: row.createdAt, live: row.live })),
      firstSeen,
      margins,
      todo,
      why,
      warnings,
      liveAdIds: work.placements.filter((row) => row.live).map((row) => row.adId),
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
  const cutActive = creatives.filter((row) => row.margins[7].badge === "CUT").map((row) => row.name);

  /* ---------------- Le rappel du jour (heure de Paris) ---------------- */
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const briefedThisWeek = briefs.filter((brief) => thisWeek(brief.createdAt)).length;
  const ready = briefs.filter((brief) => brief.status === "PRÊTE");
  let reminder: PipelineReport["reminder"] = null;
  if (weekday === 1) reminder = { title: "Lundi : 15 à 20 briefs à écrire", lines: [`${briefedThisWeek} briefé${briefedThisWeek > 1 ? "s" : ""} cette semaine`, ...(cutActive.length ? [`À couper aujourd'hui (marge < 7,5 %) : ${cutActive.join(", ")}`] : [])] };
  else if (weekday === 3) {
    const late = briefs.filter((brief) => brief.status === "BRIEF" || brief.status === "EN PROD");
    reminder = { title: "Mercredi 18 h : briefs à valider", lines: late.length ? late.map((brief) => `${brief.creaId} · ${brief.status} · ${brief.assignee || "non assigné"}`) : ["Aucun brief en attente"] };
  } else if (weekday === 4) {
    reminder = { title: `Jeudi : upload de ${ready.length} créa${ready.length > 1 ? "s" : ""} prête${ready.length > 1 ? "s" : ""}, ${Math.ceil(ready.length / 3)} ad set${Math.ceil(ready.length / 3) > 1 ? "s" : ""} à créer (3 créas = 1 concept + 2 swaps)`, lines: ready.map((brief) => brief.creaId) };
  } else if (weekday === 5) {
    const j1 = creatives.filter((row) => row.status === "TEST" && nowMs - Date.parse(row.firstSeen) < 72 * HOUR);
    reminder = { title: "Vendredi : verdict des tests J1", lines: j1.length ? j1.map((row) => `${row.name} → ${row.todo} (${row.why})`) : ["Aucune créa en J1"] };
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
