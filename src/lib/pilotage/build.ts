import { buildAssociateOverview, getAssociateScope, scopedDailySpend } from "@/lib/associate/scope";
import { REPORT_CURRENCY, fxRates } from "@/lib/fx";
import { buildAdsTree, restrictTreeToAccounts } from "@/lib/meta/tree";
import type { AdsetNode, CampaignNode } from "@/lib/meta/types";
import { buildSalesBreakdown } from "@/lib/metrics/sales-breakdown";
import { getSupplierGrids, gridPicker, parcelCost } from "@/lib/metrics/supplier-grid";
import { classifyCategory, isApproved, isAttempt } from "@/lib/phoenix/analytics";
import { resolveSource } from "@/lib/phoenix/sources";
import { getDashboardApproval, getReignConfig } from "@/lib/reign/client";
import { reportToday } from "@/lib/report-tz";
import { fetchShopifyTraffic, isShopifySalesConfigured } from "@/lib/shopify/sales-orders";
import { adDailyInsights, type AdDay } from "@/lib/pilotage/meta-daily";

/**
 * La page Pilotage (Venom) : les objectifs à tenir pour être rentable, le
 * profit d'hier et des 3 derniers jours, la conversion Reign et l'approbation
 * des MID, le profit par commande selon le nombre de colliers (grille
 * fournisseur) et les alertes.
 *
 * Objectifs (sur les 7 derniers jours complets) : marge avant pub par commande
 * = panier moyen − colliers − frais ; ROAS breakeven = panier ÷ marge ; CPA max
 * = marge ; CPA cible = marge × 0,75 (25 % de marge nette) ; ROAS cible = panier
 * ÷ CPA cible. Le ROAS réel = ventes ÷ toute la dépense Meta du périmètre.
 */

export type Alert = { id: string; kind: "fatigue" | "conversion" | "realimenter" | "declin" | "approbation"; title: string; why: string; link?: { href: string; label: string } };

export type DayFigures = { date: string; revenue: number; orders: number; cogs: number; fees: number; spend: number; profit: number; roas: number | null };

export type SiteDay = {
  date: string;
  label: string;
  /** Visites et ajouts au panier (Shopify) ; null sans Shopify. */
  sessions: number | null;
  cartRate: number | null;
  orders: number;
  /** Commandes ÷ visites, en %. */
  siteConversion: number | null;
  /** Reign : clients approuvés ÷ clients qui ont tenté de payer (vente directe), en %. */
  reignConversion: number | null;
  reignApproved: number | null;
  reignDeclined: number | null;
};

export type MidRow = { name: string; attempts: number; approved: number; approvalRate: number };

export type QuantityRow = {
  quantity: number;
  /** Coût du colis (grille en vigueur), livraison incluse. */
  parcelCost: number;
  orders: number;
  avgPrice: number | null;
  fees: number | null;
  marginBeforeAds: number | null;
  profitAfterAds: number | null;
};

export type PilotageReport = {
  builtAt: string;
  today: string;
  days: { d1: string; d2: string; d3: string; from7: string };
  objectives: {
    aov: number;
    collarsPerOrder: number;
    cogsPerOrder: number;
    feesPerOrder: number;
    marginBeforeAds: number;
    roasBreakeven: number | null;
    cpaMax: number | null;
    cpaTarget: number | null;
    roasTarget: number | null;
    processingRate: number;
    realRoas: { today: number | null; yesterday: number | null; last3: number | null; last7: number | null };
    cpa: { yesterday: number | null; last3: number | null };
    spendCap: number | null;
    budgetsTotal: number;
  };
  profit: { today: DayFigures; yesterday: DayFigures; last3: DayFigures };
  site: SiteDay[];
  mids: { yesterday: MidRow[]; last3: MidRow[] };
  perQuantity: { grid: string; cpa7: number | null; rows: QuantityRow[] };
  /**
   * Les seuils de ROAS, recalculés depuis la grille, le panier moyen et les frais :
   * breakeven = panier ÷ marge avant pub ; « hold » et « scale » gardent le même
   * écart relatif au breakeven (1,80 et 2,00 pour un breakeven de 1,62). Les
   * seuils « meta » sont les mêmes, ramenés au ROAS Meta attribué (qui s'écarte
   * du réel de `metaFactor`) : c'est eux qui jugent une campagne ou un ad set.
   */
  thresholds: {
    breakeven: number | null;
    hold: number | null;
    scale: number | null;
    /** ROAS Meta ÷ ROAS réel sur 7 jours (0,95 = Meta voit 5 % de moins). */
    metaFactor: number | null;
    meta: { breakeven: number | null; hold: number | null; scale: number | null };
    conversionGoal: number;
    cartGoal: number;
  };
  ads: { spendToday: number; cpcToday: number | null; cpc7: number | null };
  alerts: Alert[];
  warnings: string[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? round2(a / b) : null);

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type Agg = { spend: number; value: number; clicks: number };

const state = ((globalThis as typeof globalThis & { __msgatePilotageV2?: { last: { at: number; report: PilotageReport } | null } }).__msgatePilotageV2 ??= { last: null });

export async function buildPilotage(force = false): Promise<PilotageReport> {
  if (!force && state.last && Date.now() - state.last.at < 2 * 60_000) return state.last.report;

  const warnings: string[] = [];
  const scope = await getAssociateScope();
  const accountIds = scope.metaAccountIds.map((id) => id.replace(/^act_/, ""));
  const today = reportToday();
  const d1 = addDays(today, -1);
  const d2 = addDays(today, -2);
  const d3 = addDays(today, -3);
  const from7 = addDays(today, -7);
  const rate = scope.processingRate / 100;
  const reign = Boolean(getReignConfig());

  const traffic = (start: string, end: string) => (isShopifySalesConfigured() ? fetchShopifyTraffic(start, end).catch(() => null) : Promise.resolve(null));
  const approval = (start: string, end: string) => (reign ? getDashboardApproval(start, end).catch(() => null) : Promise.resolve(null));

  const [overview, spendDaily, daily, fullTree, grids, snapshot, sales7, tToday, tD1, tD2, t7, aToday, aD1, aD2, a7] = await Promise.all([
    buildAssociateOverview(from7, today).catch((error) => {
      warnings.push(`Ventes : ${error instanceof Error ? error.message : "indisponibles"}`);
      return null;
    }),
    scopedDailySpend(from7, today),
    adDailyInsights(accountIds, from7, today).catch((error) => {
      warnings.push(`Meta (jour par jour) : ${error instanceof Error ? error.message : "indisponible"}`);
      return [] as AdDay[];
    }),
    buildAdsTree({ preset: "today" }).catch(() => null),
    getSupplierGrids(),
    resolveSource(null).peekSnapshot().catch(() => null),
    buildSalesBreakdown({ start: from7, end: d1, stores: scope.stores, categories: ["direct"] }).catch(() => null),
    traffic(today, today),
    traffic(d1, d1),
    traffic(d2, d2),
    traffic(from7, d1),
    approval(today, today),
    approval(d1, d1),
    approval(d2, d2),
    approval(from7, d1),
  ]);
  if (spendDaily.error) warnings.push(`Dépense Meta : ${spendDaily.error}`);
  const tree = fullTree ? restrictTreeToAccounts(fullTree, accountIds) : null;

  const currencies = new Set<string>([...(tree?.accounts ?? []).map((account) => account.currency), ...daily.map((row) => row.currency)].filter(Boolean));
  const rates = await fxRates(currencies, REPORT_CURRENCY);
  const usd = (amount: number, currency: string) => amount * (rates.get((currency || REPORT_CURRENCY).toUpperCase())?.rate ?? 1);

  /* ---------------- Profit ---------------- */
  const dayFigures = (date: string): DayFigures => {
    const point = overview?.sales.series.find((row) => row.date === date);
    const revenue = point?.revenue ?? 0;
    const orders = point?.orders ?? 0;
    const cogs = overview?.profit.cogsByDay[date] ?? 0;
    const fees = revenue * rate;
    const spend = spendDaily.days[date] ?? 0;
    return { date, revenue: round2(revenue), orders, cogs: round2(cogs), fees: round2(fees), spend: round2(spend), profit: round2(revenue - cogs - fees - spend), roas: spend > 0 ? round2(revenue / spend) : null };
  };
  const sumDays = (dates: string[], label: string): DayFigures => {
    const total = dates.map(dayFigures).reduce(
      (acc, row) => ({ revenue: acc.revenue + row.revenue, orders: acc.orders + row.orders, cogs: acc.cogs + row.cogs, fees: acc.fees + row.fees, spend: acc.spend + row.spend, profit: acc.profit + row.profit }),
      { revenue: 0, orders: 0, cogs: 0, fees: 0, spend: 0, profit: 0 }
    );
    return { date: label, revenue: round2(total.revenue), orders: total.orders, cogs: round2(total.cogs), fees: round2(total.fees), spend: round2(total.spend), profit: round2(total.profit), roas: total.spend > 0 ? round2(total.revenue / total.spend) : null };
  };
  const last7Dates = Array.from({ length: 7 }, (_, i) => addDays(from7, i));
  const yesterday = dayFigures(d1);
  const dayBefore = dayFigures(d2);
  const todayFig = dayFigures(today);
  const last3 = sumDays([d3, d2, d1], `${d3}_${d1}`);
  const last7 = sumDays(last7Dates, `${from7}_${d1}`);

  /* ---------------- Objectifs ---------------- */
  const aov = last7.orders ? last7.revenue / last7.orders : 0;
  const cogsPerOrder = last7.orders ? last7.cogs / last7.orders : 0;
  const feesPerOrder = aov * rate;
  const margin = aov - cogsPerOrder - feesPerOrder;
  const roasBreakeven = margin > 0 && aov > 0 ? aov / margin : null;
  const cpaTarget = margin > 0 ? margin * 0.75 : null;

  // Budgets actifs (en $) et plafond de dépense selon le ROAS réel 3 jours.
  const live = (status: string, effective: string) => status === "ACTIVE" && effective === "ACTIVE";
  const campaigns: Array<{ campaign: CampaignNode; accountName: string; currency: string }> = (tree?.accounts ?? []).flatMap((account) =>
    account.campaigns.map((campaign) => ({ campaign, accountName: account.name, currency: account.currency }))
  );
  let budgetsTotal = 0;
  for (const { campaign, currency } of campaigns) {
    if (!live(campaign.status, campaign.effectiveStatus)) continue;
    if (campaign.budgetLevel === "campaign") budgetsTotal += usd(campaign.dailyBudget, currency);
    else for (const adset of campaign.adsets) if (live(adset.status, adset.effectiveStatus)) budgetsTotal += usd(adset.dailyBudget, currency);
  }
  // Les paliers : 1,80 et 2,00 pour un breakeven de 1,62, recalculés avec lui (test de prix, nouvelle grille…).
  const holdRoas = roasBreakeven != null ? roasBreakeven * (1.8 / 1.62) : null;
  const scaleRoas = roasBreakeven != null ? roasBreakeven * (2.0 / 1.62) : null;
  // Plafond de dépense / jour selon le ROAS réel 3 jours : 500 $ sous le palier « hold », 700 $ jusqu'au palier « scale », 1 000 $ au-delà.
  const spendCap = last3.roas == null || holdRoas == null || last3.roas < holdRoas ? 500 : scaleRoas != null && last3.roas < scaleRoas ? 700 : 1000;

  /* ---------------- Site : Shopify (visites, panier) et Reign (conversion, MID) ---------------- */
  const siteDay = (date: string, label: string, t: typeof tD1, a: typeof aD1, orders: number): SiteDay => ({
    date,
    label,
    sessions: t?.sessions ?? null,
    cartRate: t && t.sessions ? round2((t.cart / t.sessions) * 100) : null,
    orders,
    // Nos commandes ÷ visites : depuis le 31/10/2026 le paiement se fait hors du checkout Shopify.
    siteConversion: t && t.sessions ? round2((orders / t.sessions) * 100) : null,
    reignConversion: a && a.approvedCount + a.declinedCount > 0 ? round2(a.approvalRate * 100) : null,
    reignApproved: a?.approvedCount ?? null,
    reignDeclined: a?.declinedCount ?? null,
  });
  const site = [
    siteDay(d1, "Hier", tD1, aD1, yesterday.orders),
    siteDay(d2, "Avant-hier", tD2, aD2, dayBefore.orders),
    siteDay(today, "Aujourd'hui (en cours)", tToday, aToday, todayFig.orders),
    siteDay(`${from7}_${d1}`, "Moyenne 7 jours", t7, a7, last7.orders),
  ];
  /*
   * L'approbation Reign, par commande (une commande refusée puis payée compte
   * une tentative approuvée). L'API Reign ne donne pas le MID de chaque
   * paiement (processorId vide) : on la découpe par réseau de carte.
   */
  const midsOf = (start: string, end: string): MidRow[] => {
    if (!snapshot) return [];
    const orders = new Map<string, { brand: string; approved: boolean }>();
    for (const tx of snapshot.transactions) {
      const day = (tx.date || "").slice(0, 10);
      if (day < start || day > end || /shopify/i.test(tx.processor) || !isAttempt(tx) || classifyCategory(tx) !== "direct") continue;
      if (scope.stores.length && !scope.stores.includes(tx.domain)) continue;
      const key = tx.orderId != null ? String(tx.orderId) : `${tx.customerId}:${tx.date}`;
      const current = orders.get(key) ?? { brand: tx.merchant || "Autre", approved: false };
      if (isApproved(tx)) current.approved = true;
      if (tx.merchant) current.brand = tx.merchant;
      orders.set(key, current);
    }
    const rows = new Map<string, MidRow>();
    const bump = (name: string, approved: boolean) => {
      const row = rows.get(name) ?? { name, attempts: 0, approved: 0, approvalRate: 0 };
      row.attempts += 1;
      if (approved) row.approved += 1;
      rows.set(name, row);
    };
    for (const order of orders.values()) {
      bump("Reign · toutes cartes", order.approved);
      bump(order.brand === "MasterCard" ? "Mastercard" : order.brand, order.approved);
    }
    return [...rows.values()]
      .map((row) => ({ ...row, approvalRate: row.attempts ? round2((row.approved / row.attempts) * 100) : 0 }))
      .sort((a, b) => (a.name.startsWith("Reign") ? -1 : b.name.startsWith("Reign") ? 1 : b.attempts - a.attempts));
  };
  const mids = { yesterday: midsOf(d1, d1), last3: midsOf(d3, d1) };

  /* ---------------- Profit par commande selon le nombre de colliers ---------------- */
  const pickGrid = gridPicker(grids, () => null);
  const grid = pickGrid({ number: Number.MAX_SAFE_INTEGER, day: today });
  const cpa7 = last7.orders ? last7.spend / last7.orders : null;
  const byQuantity = new Map<number, { orders: number; revenue: number }>();
  for (const row of sales7?.cogs?.grid?.rows ?? []) {
    const current = byQuantity.get(row.quantity) ?? { orders: 0, revenue: 0 };
    current.orders += row.orders;
    current.revenue += row.revenue;
    byQuantity.set(row.quantity, current);
  }
  const quantities = [...new Set([1, 2, 3, 4, ...byQuantity.keys()])].sort((a, b) => a - b);
  const perQuantity = {
    grid: grid.label,
    cpa7: cpa7 != null ? round2(cpa7) : null,
    rows: quantities.map((quantity): QuantityRow => {
      const seen = byQuantity.get(quantity);
      const cost = parcelCost(grid, quantity);
      const avgPrice = seen && seen.orders ? seen.revenue / seen.orders : null;
      const fees = avgPrice != null ? avgPrice * rate : null;
      const marginBefore = avgPrice != null && fees != null ? avgPrice - cost - fees : null;
      return {
        quantity,
        parcelCost: cost,
        orders: seen?.orders ?? 0,
        avgPrice: avgPrice != null ? round2(avgPrice) : null,
        fees: fees != null ? round2(fees) : null,
        marginBeforeAds: marginBefore != null ? round2(marginBefore) : null,
        profitAfterAds: marginBefore != null && cpa7 != null ? round2(marginBefore - cpa7) : null,
      };
    }),
  };

  /* ---------------- Alertes ---------------- */
  const window7 = new Set(last7Dates);
  const camp7 = new Map<string, Agg>();
  const campDay = new Map<string, Agg>();
  const adDay = new Map<string, Agg>();
  const add = (map: Map<string, Agg>, key: string, row: AdDay) => {
    const current = map.get(key) ?? { spend: 0, value: 0, clicks: 0 };
    current.spend += usd(row.spend, row.currency);
    current.value += usd(row.value, row.currency);
    current.clicks += row.clicks;
    map.set(key, current);
  };
  for (const row of daily) {
    if (window7.has(row.date)) add(camp7, row.campaignId, row);
    add(campDay, `${row.campaignId}|${row.date}`, row);
    add(adDay, `${row.adId}|${row.date}`, row);
  }
  const metaRoas = (a: Agg | undefined) => (a && a.spend > 0 ? a.value / a.spend : null);
  // Le ROAS Meta attribué contre le ROAS réel, sur 7 jours ; et le CPC du jour contre sa moyenne 7 jours.
  let metaValue7 = 0;
  let spend7Meta = 0;
  let clicks7 = 0;
  let spendTodayMeta = 0;
  let clicksToday = 0;
  for (const row of daily) {
    if (window7.has(row.date)) {
      metaValue7 += usd(row.value, row.currency);
      spend7Meta += usd(row.spend, row.currency);
      clicks7 += row.clicks;
    }
    if (row.date === today) {
      spendTodayMeta += usd(row.spend, row.currency);
      clicksToday += row.clicks;
    }
  }
  const metaFactor = last7.revenue > 0 && metaValue7 > 0 ? Math.min(2, Math.max(0.5, metaValue7 / last7.revenue)) : null;
  const toMeta = (value: number | null) => (value != null && metaFactor != null ? round2(value * metaFactor) : value != null ? round2(value) : null);
  const fmt = (value: number | null, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));

  const alerts: Alert[] = [];
  const conv = site[0].siteConversion;
  if (conv != null && (site[0].sessions ?? 0) > 50 && conv < 7) {
    alerts.push({ id: "conv", kind: "conversion", title: "Conversion du site sous 7 %", why: `Hier : ${fmt(conv, 1)} % (${yesterday.orders} commandes pour ${site[0].sessions} visites). Vérifier le checkout (paiement, livraison, page de paiement).`, link: { href: "https://venom-necklace.com", label: "Ouvrir le site" } });
  }
  const reignConv = site[0].reignConversion;
  const reignConv7 = site[3].reignConversion;
  if (reignConv != null && reignConv7 != null && reignConv < reignConv7 - 10) {
    alerts.push({ id: "reign", kind: "approbation", title: "Conversion Reign en baisse", why: `Hier ${fmt(reignConv, 1)} % des clients qui ont tenté de payer sont passés, contre ${fmt(reignConv7, 1)} % sur 7 jours. Regarder les MID qui refusent.` });
  }
  for (const mid of mids.yesterday) {
    if (mid.attempts >= 10 && mid.approvalRate < 70) {
      alerts.push({ id: `mid-${mid.name}`, kind: "approbation", title: `MID ${mid.name} : approbation basse`, why: `Hier ${fmt(mid.approvalRate, 1)} % (${mid.approved} sur ${mid.attempts} tentatives).` });
    }
  }
  const isTesting = (campaign: CampaignNode, adset: AdsetNode) => campaign.bucket === "testing" || /^\W*test/i.test(adset.name);
  for (const { campaign, accountName } of campaigns) {
    if (!live(campaign.status, campaign.effectiveStatus)) continue;
    const y = campDay.get(`${campaign.id}|${d1}`);
    const w = camp7.get(campaign.id);
    const cpcY = y && y.clicks >= 20 ? y.spend / y.clicks : null;
    const cpc7 = w && w.clicks > 0 ? w.spend / w.clicks : null;
    if (cpcY != null && cpc7 != null && cpcY > cpc7 * 1.2) {
      alerts.push({ id: `cpc-${campaign.id}`, kind: "fatigue", title: `Fatigue créa : ${campaign.name}`, why: `CPC hier ${fmt(cpcY)} $ contre ${fmt(cpc7)} $ en moyenne sur 7 j (+${Math.round((cpcY / cpc7 - 1) * 100)} %). Prévoir de nouvelles créas.`, link: { href: "/ads-uploader", label: "Ads uploader" } });
    }
    for (const adset of campaign.adsets) {
      if (!live(adset.status, adset.effectiveStatus)) continue;
      if (adset.activeAds < 3) {
        alerts.push({ id: `feed-${adset.id}`, kind: "realimenter", title: `À réalimenter : ${adset.name}`, why: `${adset.activeAds} créa(s) active(s) dans ${accountName} › ${campaign.name} (minimum 3)${isTesting(campaign, adset) ? ", ad set de test" : ""}.`, link: { href: "/ads-uploader", label: "Ajouter des créas" } });
      }
      for (const ad of adset.ads) {
        if (!live(ad.status, ad.effectiveStatus)) continue;
        const series = [d3, d2, d1].map((date) => adDay.get(`${ad.id}|${date}`));
        if (series.some((day) => !day || day.spend < 10)) continue;
        const roasDays = series.map((day) => metaRoas(day) ?? 0);
        if (roasDays[0] > roasDays[1] && roasDays[1] > roasDays[2]) {
          alerts.push({ id: `declin-${ad.id}`, kind: "declin", title: `Créa en baisse 3 jours de suite : ${ad.name}`, why: `ROAS Meta ${roasDays.map((value) => fmt(value)).join(" → ")} (${campaign.name}). Candidate à la coupe si ça continue.`, link: { href: "/ads", label: "Voir la créa" } });
        }
      }
    }
  }

  const report: PilotageReport = {
    builtAt: new Date().toISOString(),
    today,
    days: { d1, d2, d3, from7 },
    objectives: {
      aov: round2(aov),
      collarsPerOrder: overview?.sales.orders ? round2((overview.profit.cogsUnits ?? 0) / overview.sales.orders) : 0,
      cogsPerOrder: round2(cogsPerOrder),
      feesPerOrder: round2(feesPerOrder),
      marginBeforeAds: round2(margin),
      roasBreakeven: roasBreakeven != null ? round2(roasBreakeven) : null,
      cpaMax: margin > 0 ? round2(margin) : null,
      cpaTarget: cpaTarget != null ? round2(cpaTarget) : null,
      roasTarget: cpaTarget ? round2(aov / cpaTarget) : null,
      processingRate: scope.processingRate,
      realRoas: { today: todayFig.roas, yesterday: yesterday.roas, last3: last3.roas, last7: last7.roas },
      cpa: { yesterday: ratio(yesterday.spend, yesterday.orders), last3: ratio(last3.spend, last3.orders) },
      spendCap,
      budgetsTotal: round2(budgetsTotal),
    },
    profit: { today: todayFig, yesterday, last3 },
    site,
    mids,
    perQuantity,
    thresholds: {
      breakeven: roasBreakeven != null ? round2(roasBreakeven) : null,
      hold: holdRoas != null ? round2(holdRoas) : null,
      scale: scaleRoas != null ? round2(scaleRoas) : null,
      metaFactor: metaFactor != null ? round2(metaFactor) : null,
      meta: { breakeven: toMeta(roasBreakeven), hold: toMeta(holdRoas), scale: toMeta(scaleRoas) },
      conversionGoal: 7.5,
      cartGoal: 19,
    },
    ads: {
      spendToday: round2(spendTodayMeta),
      cpcToday: clicksToday >= 20 ? round2(spendTodayMeta / clicksToday) : null,
      cpc7: clicks7 > 0 ? round2(spend7Meta / clicks7) : null,
    },
    alerts,
    warnings,
  };
  state.last = { at: Date.now(), report };
  return report;
}
