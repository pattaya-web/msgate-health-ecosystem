import { getAssociateScope } from "@/lib/associate/scope";
import { fxRates } from "@/lib/fx";
import { buildAdsTree, restrictTreeToAccounts } from "@/lib/meta/tree";
import type { AdsetNode, CampaignNode } from "@/lib/meta/types";
import { buildObjectivesBar, type ProductObjectives } from "@/lib/metrics/objectives";
import { adDailyInsights } from "@/lib/pilotage/meta-daily";
import { readJournal, type JournalEntry } from "@/lib/pilotage/journal";
import { reportToday } from "@/lib/report-tz";

/**
 * La « rampe de scaling » de l'Ads Manager : pour chaque ad set actif (ABO) et
 * chaque campagne CBO active, le prochain palier de budget, quand il est
 * autorisé et le statut du jour, sur la vue 3 jours (J-3 à J-1, jamais la
 * journée en cours) :
 *  - MONTER (+30 %, arrondi à 5 €) : ROAS Meta 3 j ≥ seuil de montée, ≥ 10
 *    achats, ≥ 48 h depuis le dernier changement de budget, créé depuis ≥ 72 h,
 *    et le cap global le permet ;
 *  - REDESCENDRE au budget d'avant (la valeur exacte) : ROAS 3 j sous le
 *    minimum alors qu'un palier a été monté dans les 72 h ;
 *  - COUPER : ROAS 3 j < 1,2 avec ≥ 150 $ dépensés, ou 0 achat avec ≥ 100 $ ;
 *  - TEST (ne pas toucher) : ad set de moins de 72 h, CBO sous 400 € dépensés ;
 *  - TENIR sinon.
 * Le cap global vient du ROAS réel 3 jours (ventes ÷ toute la dépense Meta) :
 * il bloque les montées, jamais les descentes. L'historique des budgets est le
 * journal des modifications (Ads Manager, Pilotage, rampe), complété par
 * l'état de départ du 3 nov 2026.
 */

export type RampStatus = "MONTER" | "TENIR" | "REDESCENDRE" | "COUPER" | "TEST";

export type BudgetChange = { at: string; before: number | null; after: number | null; source: string; who: string; note: string };

export type RampRow = {
  id: string;
  level: "campaign" | "adset";
  name: string;
  campaignId: string;
  campaignName: string;
  accountName: string;
  currency: string;
  product: "29,99 $" | "39,99 $";
  budget: number;
  spend3: number;
  roas3: number | null;
  purchases3: number;
  activeAds: number;
  createdAt: string;
  lastChange: BudgetChange | null;
  status: RampStatus;
  reasons: string[];
  /** Budget visé aujourd'hui (égal au budget actuel pour TENIR / TEST, 0 pour COUPER). */
  nextBudget: number;
  /** Le prochain palier possible (+30 %) et à partir de quand. */
  nextStep: number;
  allowedAt: string | null;
  /** Le cap global a bloqué une montée : de combien elle aurait été. */
  blockedByCap: number | null;
  /** Ad set de test : les créas à couper (0 achat avec ≥ 60 $). */
  cutAds: Array<{ name: string; spend: number }>;
  thresholds: { minimum: number | null; rise: number | null };
};

export type ScalingRamp = {
  aggressive: boolean;
  window: { start: string; end: string };
  realRoas3: number | null;
  cap: { label: string; limit: number | null; frozen: boolean; thresholds: { breakeven: number | null; hold: number | null; scale: number | null } };
  currency: string;
  totals: { now: number; afterToday: number };
  rows: RampRow[];
  forecast: Array<{ day: number; total: number; capped: boolean }>;
  examples: number[][];
  journal: Array<BudgetChange & { objectId: string; objectName: string; level: string | null }>;
  undo: { id: string; level: "campaign" | "adset"; name: string; before: number; after: number; at: string } | null;
  warnings: string[];
  builtAt: string;
};

/** Arrondi à 5 € près, la moitié vers le bas (747,5 → 745, comme la rampe de référence). */
export const round5 = (value: number) => Math.ceil(value / 5 - 0.5) * 5;
export const stepUp = (budget: number) => round5(budget * 1.3);

const HOUR = 3_600_000;
const FREEZE = "GEL : ROAS réel sous le minimum";

/**
 * L'état de départ (3 nov 2026) : les paliers faits ce jour-là avant que la
 * rampe existe. Une vraie ligne du journal pour le même objet, le même jour ou
 * après, passe devant.
 */
const SEED: Array<{ id: string; at: string; before: number; after: number }> = [
  // Hyper ULTRA-SCALING PURCHASE/ROAS (Badgal, CBO) : 150 → 210.
  { id: "120250759123500061", at: "2026-11-03T10:00:00+01:00", before: 150, after: 210 },
  // Venom STATIC - 3:4 : 150 → 210.
  { id: "120256985183510051", at: "2026-11-03T10:00:00+01:00", before: 150, after: 210 },
  // Venom STATIC 3:4 MIX 3 : baissé 75 → 50.
  { id: "120256985880690051", at: "2026-11-03T10:00:00+01:00", before: 75, after: 50 },
  // Badgal TESTING - STATIC 3:4 MIX 2 : baissé 120 → 75.
  { id: "120250705561510061", at: "2026-11-03T10:00:00+01:00", before: 120, after: 75 },
];

const iso = (value: string) => new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString();
const round2 = (value: number) => Math.round(value * 100) / 100;
/** 1.35 → « 1,35 », pour les phrases affichées. */
const fr = (value: number | null) => (value == null ? "—" : value.toFixed(2).replace(".", ","));
const shortDate = (value: string | number) => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const live = (row: { status: string; effectiveStatus?: string }) => row.status === "ACTIVE" && (!row.effectiveStatus || row.effectiveStatus === "ACTIVE");

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Minuit (heure de Paris) du jour donné, en date absolue. */
function parisMidnight(day: string) {
  const guess = new Date(`${day}T00:00:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime())).toISOString();
}

/** Le jour de Paris d'une date absolue. */
const parisDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

/** Les changements de budget de chaque objet, du plus ancien au plus récent (journal + état de départ). */
function budgetHistory(entries: JournalEntry[]) {
  const byObject = new Map<string, BudgetChange[]>();
  const push = (id: string, change: BudgetChange) => {
    const list = byObject.get(id) ?? [];
    list.push(change);
    byObject.set(id, list);
  };
  for (const entry of entries) {
    if (entry.action !== "budget" || !entry.objectId) continue;
    push(entry.objectId, { at: entry.at, before: entry.before == null ? null : Number(entry.before), after: entry.after == null ? null : Number(entry.after), source: entry.source, who: entry.who, note: entry.note });
  }
  for (const seed of SEED) {
    const known = byObject.get(seed.id) ?? [];
    if (known.some((change) => change.at >= iso(seed.at).slice(0, 10))) continue;
    push(seed.id, { at: iso(seed.at), before: seed.before, after: seed.after, source: "état de départ", who: "mady", note: "État de départ du 3 nov 2026" });
  }
  for (const list of byObject.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return byObject;
}

const productOf = (campaignName: string, products: ProductObjectives[]) => {
  const hit = products.find((product) => product.pattern && new RegExp(product.pattern, "i").test(campaignName));
  return hit ?? products[0];
};

export async function buildScalingRamp(options: { aggressive: boolean }): Promise<ScalingRamp> {
  const warnings: string[] = [];
  const scope = await getAssociateScope();
  const accountIds = scope.metaAccountIds.map((id) => id.replace(/^act_/, ""));
  const today = reportToday();
  const d1 = addDays(today, -1);
  const d3 = addDays(today, -3);
  const from7 = addDays(today, -7);

  const [objectives, fullTree, daily, entries] = await Promise.all([
    buildObjectivesBar(d3, d1),
    buildAdsTree({ preset: "today" }),
    // La même fenêtre que la page Pilotage : la lecture Meta est partagée (2 min de cache).
    adDailyInsights(accountIds, from7, today).catch((error) => {
      warnings.push(`Meta (jour par jour) : ${error instanceof Error ? error.message : "indisponible"}`);
      return [];
    }),
    readJournal(),
  ]);
  const tree = restrictTreeToAccounts(fullTree, accountIds);
  if (tree.errors.some((error) => /adsets|campaigns/.test(error))) warnings.push("Meta n'a pas tout renvoyé : certains ad sets peuvent manquer.");

  const currencies = new Set([...tree.accounts.map((account) => account.currency), ...daily.map((row) => row.currency)].filter(Boolean));
  const usdRates = await fxRates(currencies, "USD");
  const eurRates = await fxRates(currencies, "EUR");
  const toUsd = (amount: number, currency: string) => amount * (usdRates.get(currency.toUpperCase())?.rate ?? 1);
  const toEur = (amount: number, currency: string) => amount * (eurRates.get(currency.toUpperCase())?.rate ?? 1);

  // Les 3 jours complets (J-3 à J-1) par ad set, par campagne et par pub ; et les pubs depuis J-3 jusqu'à maintenant (tests).
  type Agg = { spend: number; value: number; purchases: number };
  const add = (map: Map<string, Agg>, key: string, row: Agg) => {
    const agg = map.get(key) ?? { spend: 0, value: 0, purchases: 0 };
    agg.spend += row.spend;
    agg.value += row.value;
    agg.purchases += row.purchases;
    map.set(key, agg);
  };
  const byAdset = new Map<string, Agg>();
  const byCampaign = new Map<string, Agg>();
  const adsRecent = new Map<string, Agg & { currency: string }>();
  for (const row of daily) {
    if (row.date >= d3 && row.date <= d1) {
      add(byAdset, row.adsetId, row);
      add(byCampaign, row.campaignId, row);
    }
    if (row.date >= d3) {
      const agg = adsRecent.get(row.adId) ?? { spend: 0, value: 0, purchases: 0, currency: row.currency };
      agg.spend += row.spend;
      agg.value += row.value;
      agg.purchases += row.purchases;
      adsRecent.set(row.adId, agg);
    }
  }

  const history = budgetHistory(entries);
  const products = objectives.products;
  const base = products[0];
  const now = Date.now();

  // Cap global : ROAS réel 3 j contre les seuils réels du produit à 29,99 $.
  const realRoas3 = objectives.last3.roas;
  const capThresholds = { breakeven: base?.breakeven ?? null, hold: base?.hold ?? null, scale: base?.scale ?? null };
  const cap =
    realRoas3 == null || capThresholds.breakeven == null || realRoas3 < capThresholds.breakeven
      ? { label: FREEZE, limit: 0, frozen: true }
      : capThresholds.hold != null && realRoas3 < capThresholds.hold
        ? { label: "Budget total plafonné à 1 200 €/j", limit: 1200, frozen: false }
        : capThresholds.scale != null && realRoas3 < capThresholds.scale
          ? { label: "Budget total plafonné à 1 800 €/j", limit: 1800, frozen: false }
          : { label: "Pas de plafond", limit: null, frozen: false };

  // Les lignes : ad sets actifs des campagnes ABO actives, et les campagnes CBO actives.
  type Source = { level: "campaign" | "adset"; node: CampaignNode | AdsetNode; campaign: CampaignNode; accountName: string; currency: string };
  const sources: Source[] = [];
  for (const account of tree.accounts) {
    for (const campaign of account.campaigns) {
      if (!live(campaign)) continue;
      if (campaign.budgetLevel === "campaign") sources.push({ level: "campaign", node: campaign, campaign, accountName: account.name, currency: account.currency });
      else for (const adset of campaign.adsets) if (live(adset) && adset.dailyBudget > 0) sources.push({ level: "adset", node: adset, campaign, accountName: account.name, currency: account.currency });
    }
  }

  const changedToday = new Set<string>();
  for (const [id, list] of history) {
    const last = list[list.length - 1];
    if (last && parisDay(last.at) === today) changedToday.add(id);
  }
  // Un changement par campagne et par jour : une campagne dont un ad set a déjà bougé aujourd'hui.
  const campaignChangedToday = new Set<string>();
  for (const entry of entries) if (entry.action === "budget" && entry.campaignId && parisDay(entry.at) === today) campaignChangedToday.add(entry.campaignId);
  for (const seed of SEED) if (parisDay(iso(seed.at)) === today) {
    const source = sources.find((row) => row.node.id === seed.id);
    if (source) campaignChangedToday.add(source.campaign.id);
  }

  const rows: RampRow[] = sources.map(({ level, node, campaign, accountName, currency }) => {
    const agg = (level === "campaign" ? byCampaign.get(node.id) : byAdset.get(node.id)) ?? { spend: 0, value: 0, purchases: 0 };
    const roas3 = agg.spend > 0 ? round2(agg.value / agg.spend) : null;
    const spendUsd = toUsd(agg.spend, currency);
    const product = productOf(campaign.name, products);
    const minimum = product?.meta.breakeven ?? product?.breakeven ?? null;
    const rise = (options.aggressive ? (product?.meta.hold ?? product?.hold) : (product?.meta.scale ?? product?.scale)) ?? null;
    const changes = history.get(node.id) ?? [];
    const lastChange = changes[changes.length - 1] ?? null;
    const createdAt = iso(node.createdTime);
    const hoursSinceCreate = (now - Date.parse(createdAt)) / HOUR;
    const hoursSinceChange = lastChange ? (now - Date.parse(lastChange.at)) / HOUR : Infinity;
    const adsets = level === "campaign" ? (node as CampaignNode).adsets : [node as AdsetNode];
    const ads = adsets.flatMap((adset) => adset.ads).filter(live);
    const lifetimeSpend = adsets.flatMap((adset) => adset.ads).reduce((sum, ad) => sum + ad.lifetimeSpend, 0);
    const budget = node.dailyBudget;
    const reasons: string[] = [];
    const nextStep = stepUp(budget);
    const allowedTimes = [Date.parse(createdAt) + 72 * HOUR, lastChange ? Date.parse(lastChange.at) + 48 * HOUR : 0];
    let allowedAt: string | null = new Date(Math.max(now, ...allowedTimes)).toISOString();
    let status: RampStatus = "TENIR";
    let nextBudget = budget;
    let cutAds: RampRow["cutAds"] = [];

    const isTest = level === "campaign" ? toEur(lifetimeSpend, currency) < 400 : hoursSinceCreate < 72;
    if (isTest) {
      status = "TEST";
      if (level === "campaign") {
        reasons.push(`Nouvelle CBO : on la juge à 400 € dépensés (${Math.round(toEur(lifetimeSpend, currency))} € pour l'instant)`);
        allowedAt = null;
      } else {
        reasons.push(`Nouveau : on le laisse tourner 72 h, jusqu'au ${shortDate(Date.parse(createdAt) + 72 * HOUR)}`);
      }
      cutAds = ads
        .map((ad) => ({ ad, agg: adsRecent.get(ad.id) }))
        .filter(({ agg }) => agg && agg.purchases === 0 && toUsd(agg.spend, agg.currency) >= 60)
        .map(({ ad, agg }) => ({ name: ad.name, spend: round2(agg?.spend ?? 0) }));
      if (cutAds.length) reasons.push(`Mais coupe ces créas (0 vente pour 60 $ et plus) : ${cutAds.map((ad) => ad.name).join(", ")}`);
    } else if ((roas3 ?? 0) < 1.2 && spendUsd >= 150) {
      status = "COUPER";
      nextBudget = 0;
      reasons.push(`ROAS ${fr(roas3 ?? 0)} sur 3 jours pour ${Math.round(spendUsd)} $ dépensés : il perd de l'argent`);
    } else if (agg.purchases === 0 && spendUsd >= 100) {
      status = "COUPER";
      nextBudget = 0;
      reasons.push(`Aucune vente en 3 jours pour ${Math.round(spendUsd)} $ dépensés`);
    } else if (minimum != null && roas3 != null && roas3 < minimum && lastChange && hoursSinceChange < 72 && lastChange.before != null && lastChange.after != null && lastChange.after > lastChange.before) {
      status = "REDESCENDRE";
      nextBudget = lastChange.before;
      reasons.push(`ROAS retombé à ${fr(roas3)} (minimum ${fr(minimum)}) depuis la hausse du ${shortDate(lastChange.at)} : on revient à ${lastChange.before} €`);
    } else {
      const okRoas = rise != null && roas3 != null && roas3 >= rise;
      const okPurchases = agg.purchases >= 10;
      const okDelay = hoursSinceChange >= 48;
      if (!okDelay && lastChange) reasons.push(`Budget changé il y a ${Math.round(hoursSinceChange)} h : on attend 48 h, jusqu'au ${shortDate(Date.parse(lastChange.at) + 48 * HOUR)}`);
      if (!okRoas) reasons.push(roas3 == null ? "Pas encore de dépense sur 3 jours" : minimum != null && roas3 < minimum ? `ROAS ${fr(roas3)} sous le minimum ${fr(minimum)} : à surveiller` : `ROAS ${fr(roas3)} correct, mais il faut ${fr(rise)} pour monter`);
      if (!okPurchases) reasons.push(`Pas assez de ventes : ${agg.purchases} sur 3 jours, il en faut 10`);
      if (okRoas && okPurchases && okDelay) {
        if (campaignChangedToday.has(campaign.id)) {
          reasons.push(
            cap.frozen
              ? `Bon ROAS (${fr(roas3)}), mais pas de hausse tant que le ROAS global est trop bas`
              : "Bon ROAS, mais un budget de cette campagne a déjà bougé aujourd'hui : on monte demain"
          );
          allowedAt = parisMidnight(addDays(today, 1));
        }
        else {
          status = "MONTER";
          nextBudget = nextStep;
          allowedAt = new Date(now).toISOString();
          reasons.push(`ROAS ${fr(roas3)} et ${agg.purchases} ventes sur 3 jours : on monte de 30 %`);
        }
      }
    }
    if (status === "COUPER" || status === "REDESCENDRE") allowedAt = new Date(now).toISOString();

    return {
      id: node.id,
      level,
      name: node.name,
      campaignId: campaign.id,
      campaignName: campaign.name,
      accountName,
      currency,
      product: product?.price === 39.99 ? "39,99 $" : "29,99 $",
      budget,
      spend3: round2(agg.spend),
      roas3,
      purchases3: agg.purchases,
      activeAds: ads.length,
      createdAt,
      lastChange,
      status,
      reasons,
      nextBudget,
      nextStep,
      allowedAt,
      blockedByCap: null,
      cutAds,
      thresholds: { minimum, rise },
    };
  });

  // Un seul palier par campagne et par jour : le meilleur ROAS monte, les autres attendent demain.
  const risers = rows.filter((row) => row.status === "MONTER").sort((a, b) => (b.roas3 ?? 0) - (a.roas3 ?? 0));
  const campaignsRising = new Set<string>();
  for (const row of risers) {
    if (campaignsRising.has(row.campaignId)) {
      row.status = "TENIR";
      row.nextBudget = row.budget;
      row.allowedAt = parisMidnight(addDays(today, 1));
      row.reasons = ["Bon ROAS, mais un autre ad set de cette campagne monte aujourd'hui : celui-ci demain", ...row.reasons.slice(1)];
    } else campaignsRising.add(row.campaignId);
  }

  // Le cap global : les montées passent tant que le total reste sous le plafond (descentes et coupes d'abord).
  const eur = (row: RampRow, amount: number) => toEur(amount, row.currency);
  const totalNow = rows.reduce((sum, row) => sum + eur(row, row.budget), 0);
  let running = rows.reduce((sum, row) => sum + eur(row, row.status === "MONTER" ? row.budget : row.nextBudget), 0);
  for (const row of rows.filter((item) => item.status === "MONTER").sort((a, b) => (b.roas3 ?? 0) - (a.roas3 ?? 0))) {
    const delta = eur(row, row.nextBudget - row.budget);
    if (cap.frozen || (cap.limit != null && running + delta > cap.limit)) {
      row.blockedByCap = row.nextBudget - row.budget;
      row.status = "TENIR";
      row.nextBudget = row.budget;
      row.reasons = [
        cap.frozen
          ? `Bon ROAS (${fr(row.roas3)}), mais pas de hausse tant que le ROAS global est trop bas (aurait monté de ${row.blockedByCap} €)`
          : `Bon ROAS (${fr(row.roas3)}), mais le budget total est au plafond de ${cap.limit} €/j (aurait monté de ${row.blockedByCap} €)`,
      ];
    } else running += delta;
  }
  const afterToday = running;

  // La rampe prévisionnelle : les ad sets qui montent (ou qu'un cap a bloqués) gardent leur ROAS, +30 % toutes les 48 h.
  const risingRows = rows.filter((row) => row.status === "MONTER" || row.blockedByCap != null);
  const steady = rows.filter((row) => !risingRows.includes(row)).reduce((sum, row) => sum + eur(row, row.nextBudget), 0);
  let budgets = risingRows.map((row) => (row.status === "MONTER" ? row.nextBudget : row.budget));
  const forecast: ScalingRamp["forecast"] = [];
  for (let day = 0; day <= 10; day += 2) {
    if (day > 0) budgets = budgets.map(stepUp);
    const total = steady + budgets.reduce((sum, budget, index) => sum + eur(risingRows[index], budget), 0);
    const limit = cap.frozen ? afterToday : cap.limit;
    forecast.push({ day, total: Math.round(limit != null ? Math.min(total, Math.max(limit, afterToday)) : total), capped: limit != null && total > Math.max(limit, afterToday) });
  }

  const examples = [150, 120, 200].map((start) => {
    const ramp = [start];
    while (ramp.length < 8) ramp.push(stepUp(ramp[ramp.length - 1]));
    return ramp;
  });

  // Le journal : les 20 derniers changements de budget (toutes sources), état de départ compris.
  const names = new Map<string, { name: string; level: string }>();
  for (const account of tree.accounts) for (const campaign of account.campaigns) {
    names.set(campaign.id, { name: campaign.name, level: "campaign" });
    for (const adset of campaign.adsets) names.set(adset.id, { name: adset.name, level: "adset" });
  }
  const journal = [...history.entries()]
    .flatMap(([objectId, list]) =>
      list.map((change) => {
        const fromJournal = entries.find((entry) => entry.objectId === objectId && entry.at === change.at);
        return { ...change, objectId, objectName: fromJournal?.objectName || names.get(objectId)?.name || objectId, level: fromJournal?.level ?? names.get(objectId)?.level ?? null };
      })
    )
    .filter((change) => change.level !== "ad")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  // « Annuler le dernier palier » : le dernier changement fait depuis la rampe, si le budget n'a pas bougé depuis.
  let undo: ScalingRamp["undo"] = null;
  const lastRamp = [...entries].reverse().find((entry) => entry.action === "budget" && entry.source === "rampe" && entry.objectId && !/^Annulation/.test(entry.note));
  if (lastRamp?.objectId && lastRamp.before != null && lastRamp.after != null) {
    const current = rows.find((row) => row.id === lastRamp.objectId);
    const latest = history.get(lastRamp.objectId)?.at(-1);
    if (current && Number(current.budget) === Number(lastRamp.after) && latest?.at === lastRamp.at) {
      undo = { id: lastRamp.objectId, level: current.level, name: current.name, before: Number(lastRamp.before), after: Number(lastRamp.after), at: lastRamp.at };
    }
  }

  const order: Record<RampStatus, number> = { COUPER: 0, REDESCENDRE: 1, MONTER: 2, TENIR: 3, TEST: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.budget - a.budget);

  return {
    aggressive: options.aggressive,
    window: { start: d3, end: d1 },
    realRoas3,
    cap: { ...cap, thresholds: capThresholds },
    currency: "EUR",
    totals: { now: Math.round(totalNow), afterToday: Math.round(afterToday) },
    rows,
    forecast,
    examples,
    journal,
    undo,
    warnings,
    builtAt: new Date().toISOString(),
  };
}
