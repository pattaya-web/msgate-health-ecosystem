import { buildAssociateOverview, getAssociateScope, scopedDailySpend } from "@/lib/associate/scope";
import { REPORT_CURRENCY, fxRates } from "@/lib/fx";
import { buildAdsTree, restrictTreeToAccounts } from "@/lib/meta/tree";
import type { AdsetNode, CampaignNode, EntityLevel } from "@/lib/meta/types";
import { buildSalesBreakdown } from "@/lib/metrics/sales-breakdown";
import { getSupplierGrids, gridPicker, parcelCost } from "@/lib/metrics/supplier-grid";
import { classifyCategory, isApproved, isAttempt } from "@/lib/phoenix/analytics";
import { resolveSource } from "@/lib/phoenix/sources";
import { reportToday } from "@/lib/report-tz";
import { fetchShopifyTraffic, isShopifySalesConfigured } from "@/lib/shopify/sales-orders";
import { reportDay } from "@/lib/shopify/live-sales";
import { adDailyInsights, adHistory, type AdDay } from "@/lib/pilotage/meta-daily";
import { readJournal, type JournalEntry } from "@/lib/pilotage/journal";
import { getTestsConfig } from "@/lib/pilotage/tests";

/**
 * La page Pilotage : ce qu'il faut faire aujourd'hui sur Venom, à partir de la
 * data live. Tout est jugé sur les 3 derniers jours complets (jamais sur une
 * seule journée), avec les règles de Mady :
 *  - pub : 60 $ sans achat → couper (sauf historique de 20 achats ou plus, ou test de moins de 72 h) ;
 *  - ad set / campagne CBO : ROAS réel 3 j < 1,5 avec 150 $ → −30 % ; ≥ 2,0 → +25 % (jamais plus de 30 %) ;
 *  - une seule modification par campagne et par jour, jamais deux hausses à moins de 48 h ;
 *  - Hyper : +30 % toutes les 48 h si ≥ 2,0, retour au palier d'avant si < 1,6 deux jours de suite ;
 *  - compte : ROAS réel du jour < 1,4 partout → vérifier le site d'abord ;
 *  - dépense totale : 700 $/j tant que le ROAS réel 3 j < 2,0, 1 000 $/j tant qu'il est < 2,2.
 *
 * Le « ROAS réel » d'une campagne, d'un ad set ou d'une pub est estimé : son
 * ROAS Meta multiplié par le rapport ventes Shopify ÷ achats Meta du compte sur
 * les mêmes 3 jours (Shopify ne sait pas quelle pub a vendu).
 */

export type PilotageAction = {
  kind: "pause" | "budget";
  level: EntityLevel;
  id: string;
  /** Nouveau budget / jour, dans la devise du compte. */
  value?: number;
  currency?: string;
  label: string;
  reason: string;
};

export type Decision = {
  id: string;
  scope: "site" | "dépense" | "hyper" | "campagne" | "ad set" | "pub";
  /** action : à faire ; hold : ne pas toucher (avec la raison) ; info : à savoir. */
  kind: "action" | "hold" | "info";
  title: string;
  why: string;
  where: string;
  action?: PilotageAction;
  link?: { href: string; label: string };
};

export type Alert = { id: string; kind: "fatigue" | "conversion" | "realimenter" | "declin"; title: string; why: string; link?: { href: string; label: string } };

export type DayFigures = { date: string; revenue: number; orders: number; cogs: number; fees: number; spend: number; profit: number; roas: number | null };

export type SiteDay = { date: string; sessions: number; conversion: number; cartRate: number; checkoutRate: number } | null;

export type CreativeRow = {
  adId: string;
  name: string;
  account: string;
  campaign: string;
  bucket: string;
  postId: string | null;
  purchases7: number;
  purchasesLifetime: number;
  roas7: number | null;
  roas3: number | null;
  trend: Array<number | null>;
  ageHours: number;
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
    /** Le recalage Meta → réel : ventes Shopify ÷ achats Meta sur 3 jours. */
    metaToReal: number | null;
    spendCap: number | null;
    budgetsTotal: number;
  };
  profit: { today: DayFigures; yesterday: DayFigures; last3: DayFigures; byDay: DayFigures[] };
  site: { today: SiteDay; yesterday: SiteDay; dayBefore: SiteDay; last7: SiteDay };
  decisions: Decision[];
  alerts: Alert[];
  creatives: {
    weekStart: string;
    perAccount: Array<{ account: string; newThisWeek: number; target: number; testingBudgets: Array<{ name: string; budgetUsd: number }> }>;
    inTest: CreativeRow[];
    promote: CreativeRow[];
    hyperCandidates: CreativeRow[];
    winners: CreativeRow[];
  };
  tests: {
    basePrice: number;
    baseConversion: number | null;
    priceTests: Array<{
      id: string;
      name: string;
      price: number;
      campaignKeyword: string;
      startDate: string | null;
      endDate: string | null;
      days: number;
      dailyBudget: number;
      minSpend: number;
      thresholdConversion: number;
      autoThreshold: number | null;
      spend: number;
      visits: number;
      orders: number;
      conversion: number | null;
      profitPerVisit: number | null;
      baseProfitPerVisit: number | null;
      status: "à lancer" | "en cours" | "gagne" | "perd" | "pas assez de data";
      daysElapsed: number;
    }>;
    upsell: { label: string; price: number; extraCost: number; orders: number; accepted: number; rate: number | null; revenue: number; profitAdded: number; profitPerOrder: number | null };
  };
  journal: { yesterday: JournalEntry[]; recent: JournalEntry[] };
  warnings: string[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(day: string) {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

type Agg = { spend: number; value: number; purchases: number; clicks: number; lpv: number };
const emptyAgg = (): Agg => ({ spend: 0, value: 0, purchases: 0, clicks: 0, lpv: 0 });

const cache = ((globalThis as typeof globalThis & { __msgatePilotage?: { at: number; report: PilotageReport } | null }).__msgatePilotage ??= null);
let lastReport: { at: number; report: PilotageReport } | null = cache;

export async function buildPilotage(force = false): Promise<PilotageReport> {
  if (!force && lastReport && Date.now() - lastReport.at < 2 * 60_000) return lastReport.report;

  const warnings: string[] = [];
  const scope = await getAssociateScope();
  const accountIds = scope.metaAccountIds.map((id) => id.replace(/^act_/, ""));
  const today = reportToday();
  const d1 = addDays(today, -1);
  const d2 = addDays(today, -2);
  const d3 = addDays(today, -3);
  const from7 = addDays(today, -7);
  const weekStart = mondayOf(today);
  const rate = scope.processingRate / 100;

  const traffic = (start: string, end: string) =>
    isShopifySalesConfigured() ? fetchShopifyTraffic(start, end).catch(() => null) : Promise.resolve(null);

  const [overview, spendDaily, daily, history, fullTree, grids, journal, testsConfig, tToday, tD1, tD2, t7, sales7] = await Promise.all([
    buildAssociateOverview(from7, today).catch((error) => {
      warnings.push(`Ventes : ${error instanceof Error ? error.message : "indisponibles"}`);
      return null;
    }),
    scopedDailySpend(from7, today),
    adDailyInsights(accountIds, from7, today).catch((error) => {
      warnings.push(`Meta (jour par jour) : ${error instanceof Error ? error.message : "indisponible"}`);
      return [] as AdDay[];
    }),
    adHistory(accountIds).catch(() => new Map()),
    buildAdsTree({ preset: "today" }).catch((error) => {
      warnings.push(`Meta (structure) : ${error instanceof Error ? error.message : "indisponible"}`);
      return null;
    }),
    getSupplierGrids(),
    readJournal(),
    getTestsConfig(),
    traffic(today, today),
    traffic(d1, d1),
    traffic(d2, d2),
    traffic(from7, d1),
    buildSalesBreakdown({ start: from7, end: d1, stores: scope.stores, categories: ["direct", "upsell"] }).catch(() => null),
  ]);
  if (spendDaily.error) warnings.push(`Dépense Meta : ${spendDaily.error}`);
  const tree = fullTree ? restrictTreeToAccounts(fullTree, accountIds) : null;

  // Les taux vers le dollar (comptes en euros).
  const currencies = new Set<string>([...(tree?.accounts ?? []).map((account) => account.currency), ...daily.map((row) => row.currency)].filter(Boolean));
  const rates = await fxRates(currencies, REPORT_CURRENCY);
  const usd = (amount: number, currency: string) => amount * (rates.get((currency || REPORT_CURRENCY).toUpperCase())?.rate ?? 1);

  /* ---------------- Profit jour par jour ---------------- */
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
    const rows = dates.map(dayFigures);
    const total = rows.reduce(
      (acc, row) => ({ ...acc, revenue: acc.revenue + row.revenue, orders: acc.orders + row.orders, cogs: acc.cogs + row.cogs, fees: acc.fees + row.fees, spend: acc.spend + row.spend, profit: acc.profit + row.profit }),
      { date: label, revenue: 0, orders: 0, cogs: 0, fees: 0, spend: 0, profit: 0, roas: null as number | null }
    );
    return { ...total, revenue: round2(total.revenue), cogs: round2(total.cogs), fees: round2(total.fees), spend: round2(total.spend), profit: round2(total.profit), roas: total.spend > 0 ? round2(total.revenue / total.spend) : null };
  };
  const last7Dates = Array.from({ length: 7 }, (_, i) => addDays(from7, i));
  const byDay = [...last7Dates, today].map(dayFigures).reverse();
  const yesterday = dayFigures(d1);
  const todayFig = dayFigures(today);
  const last3 = sumDays([d3, d2, d1], `${d3}_${d1}`);
  const last7 = sumDays(last7Dates, `${from7}_${d1}`);

  /* ---------------- Objectifs ---------------- */
  const orders7 = last7.orders;
  const aov = orders7 ? last7.revenue / orders7 : 0;
  const cogsPerOrder = orders7 ? last7.cogs / orders7 : 0;
  const feesPerOrder = aov * rate;
  const margin = aov - cogsPerOrder - feesPerOrder;
  const roasBreakeven = margin > 0 && aov > 0 ? aov / margin : null;
  const cpaMax = margin > 0 ? margin : null;
  const cpaTarget = margin > 0 ? margin * 0.75 : null;
  const roasTarget = cpaTarget ? aov / cpaTarget : null;
  const units = overview?.profit.cogsUnits ?? 0;
  const ordersAll = overview?.sales.orders ?? 0;

  /* ---------------- Meta par pub, ad set, campagne ---------------- */
  const window3 = new Set([d3, d2, d1]);
  const window7 = new Set(last7Dates);
  const agg = (map: Map<string, Agg>, key: string, row: AdDay) => {
    const current = map.get(key) ?? emptyAgg();
    current.spend += usd(row.spend, row.currency);
    current.value += usd(row.value, row.currency);
    current.purchases += row.purchases;
    current.clicks += row.clicks;
    current.lpv += row.lpv;
    map.set(key, current);
  };
  const ad3 = new Map<string, Agg>();
  const adset3 = new Map<string, Agg>();
  const camp3 = new Map<string, Agg>();
  const ad7 = new Map<string, Agg>();
  const camp7 = new Map<string, Agg>();
  const campDay = new Map<string, Agg>(); // clé : campagne|jour
  const adDay = new Map<string, Agg>(); // clé : pub|jour
  const adsetDay = new Map<string, Agg>(); // clé : ad set|jour
  let metaValue3 = 0;
  for (const row of daily) {
    if (window3.has(row.date)) {
      agg(ad3, row.adId, row);
      agg(adset3, row.adsetId, row);
      agg(camp3, row.campaignId, row);
      metaValue3 += usd(row.value, row.currency);
    }
    if (window7.has(row.date)) {
      agg(ad7, row.adId, row);
      agg(camp7, row.campaignId, row);
    }
    agg(campDay, `${row.campaignId}|${row.date}`, row);
    agg(adDay, `${row.adId}|${row.date}`, row);
    agg(adsetDay, `${row.adsetId}|${row.date}`, row);
  }
  const metaToReal = metaValue3 > 0 && last3.revenue > 0 ? Math.min(3, Math.max(0.3, last3.revenue / metaValue3)) : null;
  const k = metaToReal ?? 1;
  const realRoas = (a: Agg | undefined) => (a && a.spend > 0 ? (a.value / a.spend) * k : null);
  const metaRoas = (a: Agg | undefined) => (a && a.spend > 0 ? a.value / a.spend : null);
  const fmt = (value: number | null, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));
  const money = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} $`;

  /* ---------------- Journal ---------------- */
  const now = Date.now();
  const entriesFor = (ids: string[]) => journal.filter((entry) => entry.objectId && ids.includes(entry.objectId));
  const budgetEntries = (ids: string[]) => entriesFor(ids).filter((entry) => entry.action === "budget" || entry.action === "status");
  const changedToday = (ids: string[]) => budgetEntries(ids).find((entry) => reportDay(entry.at) === today) ?? null;
  const lastRaise = (ids: string[]) =>
    entriesFor(ids)
      .filter((entry) => entry.action === "budget" && Number(entry.after) > Number(entry.before))
      .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const hoursSince = (iso: string) => (now - Date.parse(iso)) / 3_600_000;
  const whoWhen = (entry: JournalEntry) =>
    `${entry.who} à ${new Date(entry.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`;

  /* ---------------- Décisions ---------------- */
  const decisions: Decision[] = [];
  const accountName = new Map((tree?.accounts ?? []).map((account) => [account.accountId, account.name]));
  const accountCurrency = new Map((tree?.accounts ?? []).map((account) => [account.accountId, account.currency]));
  const campaigns: Array<{ campaign: CampaignNode; accountId: string; currency: string }> = (tree?.accounts ?? []).flatMap((account) =>
    account.campaigns.map((campaign) => ({ campaign, accountId: account.accountId, currency: account.currency }))
  );
  const live = (status: string, effective: string) => status === "ACTIVE" && effective === "ACTIVE";
  // Un ad set de test : la campagne est en Testing, ou l'ad set s'appelle « TESTING - … » (rangé dans « SCALING / TESTING »).
  const isTesting = (campaign: CampaignNode, adset: AdsetNode) => campaign.bucket === "testing" || /^\W*test/i.test(adset.name);

  // Budgets cumulés en dollars, et plafond de dépense selon le ROAS réel 3 jours.
  let budgetsTotal = 0;
  for (const { campaign, currency } of campaigns) {
    if (!live(campaign.status, campaign.effectiveStatus)) continue;
    if (campaign.budgetLevel === "campaign") budgetsTotal += usd(campaign.dailyBudget, currency);
    else for (const adset of campaign.adsets) if (live(adset.status, adset.effectiveStatus)) budgetsTotal += usd(adset.dailyBudget, currency);
  }
  const roas3 = last3.roas;
  const spendCap = roas3 != null && roas3 >= 2.2 ? null : roas3 != null && roas3 >= 2.0 ? 1000 : 700;

  // 1. Le compte : tout s'effondre en même temps → le site d'abord.
  // Conversion = nos commandes ÷ visites Shopify (le compteur « checkout terminé » de Shopify retarde de plusieurs jours).
  const convOf = (traffic: typeof tD1, orders: number) => (traffic && traffic.sessions > 0 ? orders / traffic.sessions : null);
  const d2Fig = dayFigures(d2);
  const checkDay =
    todayFig.spend >= 300
      ? { fig: todayFig, label: "aujourd'hui (journée en cours)", site: tToday, before: tD1, beforeOrders: yesterday.orders }
      : { fig: yesterday, label: "hier", site: tD1, before: tD2, beforeOrders: d2Fig.orders };
  const dayKey = checkDay.fig.date;
  const campaignsWithSpend = campaigns.filter(({ campaign }) => (campDay.get(`${campaign.id}|${dayKey}`)?.spend ?? 0) > 20);
  const allLow =
    checkDay.fig.roas != null &&
    checkDay.fig.roas < 1.4 &&
    campaignsWithSpend.length > 0 &&
    campaignsWithSpend.every(({ campaign }) => (realRoas(campDay.get(`${campaign.id}|${dayKey}`)) ?? 0) < 1.4);
  let siteFirst = false;
  if (allLow) {
    siteFirst = true;
    const conv = convOf(checkDay.site, checkDay.fig.orders);
    const convBefore = convOf(checkDay.before, checkDay.beforeOrders);
    const cart = checkDay.site && checkDay.site.sessions ? checkDay.site.cart / checkDay.site.sessions : null;
    const cartBefore = checkDay.before && checkDay.before.sessions ? checkDay.before.cart / checkDay.before.sessions : null;
    const convDrop = conv != null && convBefore ? (convBefore - conv) / convBefore : null;
    const cartDrop = cart != null && cartBefore ? (cartBefore - cart) / cartBefore : null;
    const verdict =
      convDrop != null && cartDrop != null
        ? convDrop >= 0.2 && cartDrop < 0.1
          ? "La conversion chute mais pas l'ajout panier : c'est le checkout (paiement, prix livraison, page de paiement). À vérifier tout de suite."
          : convDrop >= 0.2 && cartDrop >= 0.1
            ? "Conversion et ajout panier baissent ensemble : page produit, vitesse du site ou trafic de moins bonne qualité."
            : "Le site tient (conversion stable) : c'est le trafic des pubs, pas le site."
        : "Données Shopify indisponibles : ouvre le site et passe une commande test.";
    decisions.push({
      id: "site-first",
      scope: "site",
      kind: "action",
      title: "Vérifier le site avant de toucher aux pubs",
      why: `ROAS réel ${checkDay.label} ${fmt(checkDay.fig.roas)} et toutes les campagnes sous 1,4. Conversion ${conv != null ? `${fmt(conv * 100, 1)} %` : "—"} (veille ${convBefore != null ? `${fmt(convBefore * 100, 1)} %` : "—"}), ajout panier ${cart != null ? `${fmt(cart * 100, 1)} %` : "—"} (veille ${cartBefore != null ? `${fmt(cartBefore * 100, 1)} %` : "—"}). ${verdict}`,
      where: "venom-necklace.com",
      link: { href: "https://venom-necklace.com", label: "Ouvrir le site" },
    });
  }

  // 2. La dépense totale.
  if (spendCap != null && budgetsTotal > spendCap + 1) {
    decisions.push({
      id: "spend-cap",
      scope: "dépense",
      kind: "action",
      title: `Baisser les budgets de ${money(budgetsTotal - spendCap)} au total`,
      why: `Budgets cumulés ${money(budgetsTotal)}/j pour un plafond de ${money(spendCap)}/j : ROAS réel 3 j ${fmt(roas3)} (${spendCap === 700 ? "< 2,0" : "< 2,2"}). Commence par les ad sets les moins rentables.`,
      where: "Tous les comptes",
      link: { href: "/ads", label: "Ouvrir l'Ads Manager" },
    });
  }
  let headroom = spendCap == null ? Infinity : Math.max(0, spendCap - budgetsTotal);

  // 3. Budgets : Hyper, campagnes CBO et ad sets ABO. Une seule modification par campagne et par jour.
  type BudgetCandidate = Decision & { campaignId: string; priority: number; deltaUsd: number };
  const candidates: BudgetCandidate[] = [];
  for (const { campaign, accountId, currency } of campaigns) {
    if (!live(campaign.status, campaign.effectiveStatus)) continue;
    const hyper = campaign.bucket === "hyperscaling";
    const units: Array<{ level: EntityLevel; id: string; name: string; budget: number; agg: Agg | undefined; adset?: AdsetNode }> =
      campaign.budgetLevel === "campaign"
        ? [{ level: "campaign", id: campaign.id, name: campaign.name, budget: campaign.dailyBudget, agg: camp3.get(campaign.id) }]
        : campaign.adsets
            .filter((adset) => live(adset.status, adset.effectiveStatus) && adset.dailyBudget > 0)
            .map((adset) => ({ level: "adset" as EntityLevel, id: adset.id, name: adset.name, budget: adset.dailyBudget, agg: adset3.get(adset.id), adset }));
    const ids = [campaign.id, ...campaign.adsets.map((adset) => adset.id)];
    const doneToday = changedToday(ids);
    for (const unit of units) {
      const r = realRoas(unit.agg);
      const spend = unit.agg?.spend ?? 0;
      const budgetUsd = usd(unit.budget, currency);
      const where = `${accountName.get(accountId) ?? accountId} › ${campaign.name}${unit.level === "adset" ? ` › ${unit.name}` : ""}`;
      const sym = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency;
      const budgetText = (value: number) => `${Math.round(value)} ${sym}`;
      const raise = lastRaise([unit.id, campaign.id]);
      const raisedRecently = raise ? hoursSince(raise.at) < 48 : false;
      const base: Omit<BudgetCandidate, "kind" | "title" | "why" | "action" | "priority" | "deltaUsd"> = { id: `budget-${unit.id}`, scope: hyper ? "hyper" : unit.level === "campaign" ? "campagne" : "ad set", where, campaignId: campaign.id, link: { href: "/ads", label: "Voir dans l'Ads Manager" } };
      const rText = `ROAS réel 3 j ${fmt(r)} sur ${money(spend)} dépensés`;

      if (hyper) {
        const d1r = realRoas(unit.level === "campaign" ? campDay.get(`${campaign.id}|${d1}`) : adsetDay.get(`${unit.id}|${d1}`));
        const d2r = realRoas(unit.level === "campaign" ? campDay.get(`${campaign.id}|${d2}`) : adsetDay.get(`${unit.id}|${d2}`));
        if (d1r != null && d2r != null && d1r < 1.6 && d2r < 1.6) {
          const previous = raise && Number(raise.before) > 0 ? Number(raise.before) : unit.budget / 1.3;
          const next = Math.max(1, Math.round(previous));
          candidates.push({ ...base, kind: "action", title: `Revenir au palier d'avant : ${budgetText(unit.budget)} → ${budgetText(next)}`, why: `Hyper sous 1,6 deux jours de suite (hier ${fmt(d1r)}, avant-hier ${fmt(d2r)}). Les originaux restent allumés.`, action: { kind: "budget", level: unit.level, id: unit.id, value: next, currency, label: `Mettre ${budgetText(next)}`, reason: "Hyper < 1,6 deux jours de suite : palier précédent" }, priority: 3, deltaUsd: usd(next - unit.budget, currency) });
        } else if (r != null && r >= 2.0 && spend >= 50) {
          if (raisedRecently && raise) {
            candidates.push({ ...base, kind: "hold", title: "Hyper : attendre avant la prochaine hausse", why: `${rText}, mais dernière hausse il y a ${Math.round(hoursSince(raise.at))} h (${whoWhen(raise)}) : prochaine dans ${Math.max(1, Math.round(48 - hoursSince(raise.at)))} h.`, priority: 0, deltaUsd: 0 });
          } else {
            const next = Math.round(unit.budget * 1.3);
            candidates.push({ ...base, kind: "action", title: `Hyper +30 % : ${budgetText(unit.budget)} → ${budgetText(next)}`, why: `${rText} (≥ 2,0). Palier suivant ; les originaux restent allumés.`, action: { kind: "budget", level: unit.level, id: unit.id, value: next, currency, label: `Passer à ${budgetText(next)}`, reason: "Hyper ≥ 2,0 sur 3 j : +30 %" }, priority: 1, deltaUsd: usd(next - unit.budget, currency) });
          }
        } else if (budgetUsd < 150 && spend < 50) {
          candidates.push({ ...base, kind: "info", title: "Hyper : palier de départ 150 $", why: `Budget actuel ${budgetText(unit.budget)} (≈ ${money(budgetUsd)}) : un post ID en Hyper démarre à 150 $/j.`, priority: 0, deltaUsd: 0 });
        } else {
          candidates.push({ ...base, kind: "hold", title: "Hyper : ne rien toucher", why: `${rText} : sous 2,0 on ne monte pas ; retour au palier d'avant seulement après deux jours de suite sous 1,6.`, priority: 0, deltaUsd: 0 });
        }
        continue;
      }

      if (r != null && r < 1.5 && spend >= 150) {
        const next = Math.max(1, Math.round(unit.budget * 0.7));
        candidates.push({ ...base, kind: "action", title: `Baisser de 30 % : ${budgetText(unit.budget)} → ${budgetText(next)}`, why: `${rText} (< 1,5). On baisse, on ne coupe pas.`, action: { kind: "budget", level: unit.level, id: unit.id, value: next, currency, label: `Baisser à ${budgetText(next)}`, reason: "ROAS réel 3 j < 1,5 avec 150 $ : −30 %" }, priority: 3, deltaUsd: usd(next - unit.budget, currency) });
      } else if (r != null && r >= 2.0 && spend >= 50) {
        if (raisedRecently && raise) {
          candidates.push({ ...base, kind: "hold", title: "Bon ROAS, mais pas de nouvelle hausse avant 48 h", why: `${rText}. Dernière hausse ${whoWhen(raise)} il y a ${Math.round(hoursSince(raise.at))} h : prochaine possible dans ${Math.max(1, Math.round(48 - hoursSince(raise.at)))} h.`, priority: 0, deltaUsd: 0 });
        } else {
          const next = Math.round(unit.budget * 1.25);
          candidates.push({ ...base, kind: "action", title: `Monter de 25 % : ${budgetText(unit.budget)} → ${budgetText(next)}`, why: `${rText} (≥ 2,0). Jamais plus de +30 % d'un coup.`, action: { kind: "budget", level: unit.level, id: unit.id, value: next, currency, label: `Monter à ${budgetText(next)}`, reason: "ROAS réel 3 j ≥ 2,0 : +25 %" }, priority: 1, deltaUsd: usd(next - unit.budget, currency) });
        }
      } else if (r != null && r < 1.5 && spend >= 30) {
        candidates.push({ ...base, kind: "hold", title: "Trop tôt pour juger", why: `${rText} : sous 1,5 mais moins de 150 $ dépensés sur 3 j. On attend d'avoir 150 $.`, priority: 0, deltaUsd: 0 });
      } else if (r != null && spend >= 50) {
        const zone = roasBreakeven && r < roasBreakeven ? `entre 1,5 et le breakeven (${fmt(roasBreakeven)}) : pas rentable mais pas assez bas pour baisser` : "rentable mais sous 2,0 : on ne monte pas encore";
        candidates.push({ ...base, kind: "hold", title: "Ne rien toucher", why: `${rText} : ${zone}.`, priority: 0, deltaUsd: 0 });
      }
    }
    // Une seule modification par campagne et par jour (et aucune si elle a déjà bougé aujourd'hui).
    const mine = candidates.filter((candidate) => candidate.campaignId === campaign.id && candidate.kind === "action");
    if (doneToday) {
      for (const candidate of mine) {
        candidate.kind = "hold";
        candidate.why = `${candidate.why} Déjà modifiée aujourd'hui (${whoWhen(doneToday)}) : une seule modification par campagne et par jour, on revoit demain.`;
        candidate.action = undefined;
      }
    } else if (mine.length > 1) {
      const keep = [...mine].sort((a, b) => b.priority - a.priority || Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd))[0];
      for (const candidate of mine) {
        if (candidate === keep) continue;
        candidate.kind = "hold";
        candidate.why = `${candidate.why} Une seule modification par campagne et par jour : à faire demain si c'est toujours vrai.`;
        candidate.action = undefined;
      }
    }
  }
  // Le plafond de dépense : les hausses passent dans l'ordre du meilleur ROAS tant qu'il reste de la marge.
  for (const candidate of candidates.filter((item) => item.kind === "action" && item.deltaUsd > 0).sort((a, b) => b.deltaUsd - a.deltaUsd)) {
    if (candidate.deltaUsd <= headroom) {
      headroom -= candidate.deltaUsd;
      continue;
    }
    candidate.kind = "hold";
    candidate.title = `Bon ROAS, mais plafond de dépense atteint (${candidate.title.toLowerCase()})`;
    candidate.why = `${candidate.why} Bloqué par le plafond de dépense (${spendCap ? money(spendCap) : "—"}/j tant que le ROAS réel 3 j est à ${fmt(roas3)}).`;
    candidate.action = undefined;
  }
  // Site d'abord : aucune décision de budget tant que le site n'est pas vérifié.
  if (siteFirst) {
    for (const candidate of candidates) {
      if (candidate.kind !== "action") continue;
      candidate.kind = "hold";
      candidate.why = `${candidate.why} En attente : vérifier le site d'abord.`;
      candidate.action = undefined;
    }
  }
  decisions.push(...candidates.map(({ campaignId: _c, priority: _p, deltaUsd: _d, ...decision }) => { void _c; void _p; void _d; return decision; }));

  // 4. Les pubs : 60 $ sans achat.
  const history3 = history as Map<string, { purchases: number; spend: number; postId: string | null }>;
  for (const { campaign, accountId } of campaigns) {
    if (!live(campaign.status, campaign.effectiveStatus)) continue;
    for (const adset of campaign.adsets) {
      if (!live(adset.status, adset.effectiveStatus)) continue;
      for (const ad of adset.ads) {
        if (!live(ad.status, ad.effectiveStatus)) continue;
        const a = ad3.get(ad.id);
        if (!a || a.spend < 60 || a.purchases > 0) continue;
        const lifetime = history3.get(ad.id)?.purchases ?? 0;
        const ageHours = hoursSince(ad.createdTime);
        const where = `${accountName.get(accountId) ?? accountId} › ${campaign.name} › ${adset.name}`;
        if (lifetime >= 20) {
          decisions.push({ id: `ad-${ad.id}`, scope: "pub", kind: "hold", title: `Ne pas couper « ${ad.name} »`, why: `${money(a.spend)} sans achat sur 3 j, mais ${lifetime} achats d'historique : on ne coupe pas une créa qui a fait ses preuves sur une mauvaise passe.`, where });
        } else if (isTesting(campaign, adset) && ageHours < 72) {
          decisions.push({ id: `ad-${ad.id}`, scope: "pub", kind: "hold", title: `« ${ad.name} » en test : attendre`, why: `${money(a.spend)} sans achat, mais en ligne depuis ${Math.round(ageHours)} h : 72 h sans toucher (encore ${Math.round(72 - ageHours)} h).`, where });
        } else {
          decisions.push({
            id: `ad-${ad.id}`,
            scope: "pub",
            kind: siteFirst ? "hold" : "action",
            title: `Couper « ${ad.name} »`,
            why: `${money(a.spend)} dépensés sur 3 j, 0 achat${lifetime ? ` (${lifetime} achat(s) d'historique)` : ""}.${siteFirst ? " En attente : vérifier le site d'abord." : ""}`,
            where,
            action: siteFirst ? undefined : { kind: "pause", level: "ad", id: ad.id, label: "Couper la pub", reason: "60 $ sans achat sur 3 j" },
          });
        }
      }
    }
  }

  const order = { action: 0, info: 1, hold: 2 } as const;
  const scopeOrder = ["site", "dépense", "hyper", "campagne", "ad set", "pub"];
  decisions.sort((a, b) => order[a.kind] - order[b.kind] || scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope));

  /* ---------------- Alertes ---------------- */
  const alerts: Alert[] = [];
  for (const { campaign, accountId } of campaigns) {
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
        alerts.push({ id: `feed-${adset.id}`, kind: "realimenter", title: `À réalimenter : ${adset.name}`, why: `${adset.activeAds} créa(s) active(s) dans ${accountName.get(accountId) ?? ""} › ${campaign.name} (minimum 3).`, link: { href: "/ads-uploader", label: "Ajouter des créas" } });
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
  const convYesterday = convOf(tD1, yesterday.orders);
  if (tD1 && tD1.sessions > 50 && convYesterday != null && convYesterday < 0.07) {
    alerts.unshift({ id: "conv", kind: "conversion", title: "Conversion du site sous 7 %", why: `Hier : ${fmt(convYesterday * 100, 1)} % (${yesterday.orders} commandes pour ${tD1.sessions} visites). Vérifier le checkout (paiement, livraison, page de paiement).`, link: { href: "https://venom-necklace.com", label: "Ouvrir le site" } });
  }

  /* ---------------- Créas ---------------- */
  const rows: CreativeRow[] = [];
  for (const { campaign, accountId } of campaigns) {
    for (const adset of campaign.adsets) {
      for (const ad of adset.ads) {
        const a7 = ad7.get(ad.id);
        rows.push({
          adId: ad.id,
          name: ad.name,
          account: accountName.get(accountId) ?? accountId,
          campaign: campaign.name,
          bucket: isTesting(campaign, adset) ? "testing" : campaign.bucket,
          postId: history3.get(ad.id)?.postId ?? null,
          purchases7: a7?.purchases ?? 0,
          purchasesLifetime: history3.get(ad.id)?.purchases ?? 0,
          roas7: metaRoas(a7),
          roas3: realRoas(ad3.get(ad.id)),
          trend: [d3, d2, d1].map((date) => metaRoas(adDay.get(`${ad.id}|${date}`))),
          ageHours: Math.round(hoursSince(ad.createdTime)),
        });
      }
    }
  }
  const liveIds = new Set(
    campaigns.flatMap(({ campaign }) => (live(campaign.status, campaign.effectiveStatus) ? campaign.adsets.filter((adset) => live(adset.status, adset.effectiveStatus)).flatMap((adset) => adset.ads.filter((ad) => live(ad.status, ad.effectiveStatus)).map((ad) => ad.id)) : []))
  );
  const liveRows = rows.filter((row) => liveIds.has(row.adId));
  const perAccount = (tree?.accounts ?? []).map((account) => {
    const testingAdsets = account.campaigns.flatMap((campaign) => campaign.adsets.filter((adset) => isTesting(campaign, adset)).map((adset) => ({ campaign, adset })));
    const newThisWeek = testingAdsets.flatMap(({ adset }) => adset.ads).filter((ad) => ad.createdTime && reportDay(ad.createdTime) >= weekStart).length;
    return {
      account: account.name,
      newThisWeek,
      target: 5,
      testingBudgets: testingAdsets
        .filter(({ campaign, adset }) => live(campaign.status, campaign.effectiveStatus) && live(adset.status, adset.effectiveStatus))
        .map(({ campaign, adset }) => ({
          name: adset.name,
          // En CBO l'ad set n'a pas de budget propre : on montre celui de la campagne.
          budgetUsd: round2(usd(campaign.budgetLevel === "campaign" ? campaign.dailyBudget : adset.dailyBudget, account.currency)),
        })),
    };
  });
  const inTest = liveRows.filter((row) => row.bucket === "testing" && row.ageHours < 72).sort((a, b) => a.ageHours - b.ageHours);
  const promote = liveRows.filter((row) => row.bucket === "testing" && row.ageHours >= 72 && row.purchasesLifetime >= 5 && (row.roas7 ?? 0) >= 2.5);
  const hyperCandidates = liveRows.filter((row) => row.bucket !== "hyperscaling" && row.purchasesLifetime >= 30);
  const winners = liveRows
    .filter((row) => row.purchases7 >= 5 && (row.roas7 ?? 0) >= 2)
    .sort((a, b) => b.purchases7 - a.purchases7)
    .slice(0, 12);

  /* ---------------- Tests ---------------- */
  const pickGrid = gridPicker(grids, () => null);
  const grid = pickGrid({ number: Number.MAX_SAFE_INTEGER, day: today });
  const cost2 = parcelCost(grid, 2);
  const extraCost = round2(parcelCost(grid, 3) - cost2);
  const baseConversion = convOf(t7, last7.orders);
  const marginAt = (price: number) => price - cost2 - price * rate;
  const baseProfitPerVisit = baseConversion != null ? baseConversion * marginAt(testsConfig.basePrice) : null;
  const snapshot = await resolveSource(null).peekSnapshot().catch(() => null);
  const priceTests = await Promise.all(
    testsConfig.priceTests.map(async (test) => {
      const endDate = test.startDate ? addDays(test.startDate, test.days - 1) : null;
      const autoThreshold = baseProfitPerVisit != null && marginAt(test.price) > 0 ? round2((baseProfitPerVisit / marginAt(test.price)) * 100) : null;
      const base = { ...test, endDate, autoThreshold, spend: 0, visits: 0, orders: 0, conversion: null as number | null, profitPerVisit: null as number | null, baseProfitPerVisit: baseProfitPerVisit != null ? round2(baseProfitPerVisit) : null, daysElapsed: 0 };
      if (!test.startDate || !endDate) return { ...base, status: "à lancer" as const };
      const until = endDate < today ? endDate : today;
      const testRows = await adDailyInsights(accountIds, test.startDate, until).catch(() => [] as AdDay[]);
      const keyword = test.campaignKeyword.toLowerCase();
      let spend = 0;
      let visits = 0;
      for (const row of testRows) {
        if (!row.campaignName.toLowerCase().includes(keyword)) continue;
        spend += usd(row.spend, row.currency);
        visits += row.lpv;
      }
      let orders = 0;
      for (const tx of snapshot?.transactions ?? []) {
        const day = (tx.date || "").slice(0, 10);
        if (day < test.startDate || day > until) continue;
        if (scope.stores.length && !scope.stores.includes(tx.domain)) continue;
        if (!isAttempt(tx) || !isApproved(tx) || classifyCategory(tx) !== "direct") continue;
        if (Math.abs(tx.amount - test.price) < 0.02) orders += 1;
      }
      const conversion = visits > 0 ? orders / visits : null;
      const daysElapsed = Math.min(test.days, Math.max(0, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${test.startDate}T00:00:00Z`)) / 86_400_000) + 1));
      const done = endDate < today;
      const status = !done ? ("en cours" as const) : spend < test.minSpend || conversion == null ? ("pas assez de data" as const) : conversion * 100 >= test.thresholdConversion ? ("gagne" as const) : ("perd" as const);
      return { ...base, spend: round2(spend), visits, orders, conversion: conversion != null ? round2(conversion * 100) : null, profitPerVisit: conversion != null ? round2(conversion * marginAt(test.price)) : null, daysElapsed, status };
    })
  );
  const upsellAccepted = sales7?.approved.upsell ?? 0;
  const upsellOrders = sales7?.approved.direct ?? 0;
  const upsellRevenue = sales7?.revenue.upsell ?? 0;
  const upsellPrice = upsellAccepted ? upsellRevenue / upsellAccepted : testsConfig.upsell.price;
  const profitPerUpsell = upsellPrice - extraCost - upsellPrice * rate;

  /* ---------------- Journal ---------------- */
  const recent = [...journal].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  const journalYesterday = recent.filter((entry) => reportDay(entry.at) === d1);

  const report: PilotageReport = {
    builtAt: new Date().toISOString(),
    today,
    days: { d1, d2, d3, from7 },
    objectives: {
      aov: round2(aov),
      collarsPerOrder: ordersAll ? round2(units / ordersAll) : 0,
      cogsPerOrder: round2(cogsPerOrder),
      feesPerOrder: round2(feesPerOrder),
      marginBeforeAds: round2(margin),
      roasBreakeven: roasBreakeven != null ? round2(roasBreakeven) : null,
      cpaMax: cpaMax != null ? round2(cpaMax) : null,
      cpaTarget: cpaTarget != null ? round2(cpaTarget) : null,
      roasTarget: roasTarget != null ? round2(roasTarget) : null,
      processingRate: scope.processingRate,
      realRoas: { today: todayFig.roas, yesterday: yesterday.roas, last3: last3.roas, last7: last7.roas },
      cpa: { yesterday: ratio(yesterday.spend, yesterday.orders), last3: ratio(last3.spend, last3.orders) },
      metaToReal: metaToReal != null ? round2(metaToReal) : null,
      spendCap,
      budgetsTotal: round2(budgetsTotal),
    },
    profit: { today: todayFig, yesterday, last3, byDay },
    site: {
      today: siteDay(today, tToday, todayFig.orders),
      yesterday: siteDay(d1, tD1, yesterday.orders),
      dayBefore: siteDay(d2, tD2, d2Fig.orders),
      last7: siteDay(`${from7}_${d1}`, t7, last7.orders),
    },
    decisions,
    alerts,
    creatives: { weekStart, perAccount, inTest, promote, hyperCandidates, winners },
    tests: {
      basePrice: testsConfig.basePrice,
      baseConversion: baseConversion != null ? round2(baseConversion * 100) : null,
      priceTests,
      upsell: {
        label: testsConfig.upsell.label,
        price: round2(upsellPrice),
        extraCost,
        orders: upsellOrders,
        accepted: upsellAccepted,
        rate: upsellOrders ? round2((upsellAccepted / upsellOrders) * 100) : null,
        revenue: round2(upsellRevenue),
        profitAdded: round2(upsellAccepted * profitPerUpsell),
        profitPerOrder: upsellOrders ? round2((upsellAccepted * profitPerUpsell) / upsellOrders) : null,
      },
    },
    journal: { yesterday: journalYesterday, recent },
    warnings,
  };
  void accountCurrency;
  lastReport = { at: Date.now(), report };
  (globalThis as typeof globalThis & { __msgatePilotage?: { at: number; report: PilotageReport } | null }).__msgatePilotage = lastReport;
  return report;
}

function siteDay(date: string, traffic: Awaited<ReturnType<typeof fetchShopifyTraffic>> | null, orders: number): SiteDay {
  if (!traffic || !traffic.sessions) return null;
  return {
    date,
    sessions: traffic.sessions,
    // Nos commandes ÷ visites : le « checkout terminé » de Shopify retarde.
    conversion: round2((orders / traffic.sessions) * 100),
    cartRate: round2((traffic.cart / traffic.sessions) * 100),
    checkoutRate: round2((traffic.checkout / traffic.sessions) * 100),
  };
}

/** Oublie le rapport gardé : après une action, la page se recalcule tout de suite. */
export function invalidatePilotage() {
  lastReport = null;
  (globalThis as typeof globalThis & { __msgatePilotage?: { at: number; report: PilotageReport } | null }).__msgatePilotage = null;
}
