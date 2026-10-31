import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { getKnownAccounts } from "@/lib/meta/registry";
import { buildAdsTree } from "@/lib/meta/tree";
import { getMetaConfig } from "@/lib/meta/client";
import { classifyCategory, isApproved, isAttempt } from "@/lib/phoenix/analytics";
import { focusIncludesToday, isStale } from "@/lib/phoenix/snapshot";
import { resolveSource } from "@/lib/phoenix/sources";
import type { SnapshotProgress } from "@/lib/phoenix/types";
import type { AccountNode } from "@/lib/meta/types";
import { buildSalesBreakdown } from "@/lib/metrics/sales-breakdown";
import type { ProfitInputs } from "@/lib/metrics/profit-inputs";
import { reportToday } from "@/lib/report-tz";
import { REPORT_CURRENCY, describeConversion, fxRates } from "@/lib/fx";
import { peekOrders, peekShopifyFeed, refreshShopifyNow } from "@/lib/reign/snapshot";
import { fetchShopifyTraffic, isShopifySalesConfigured } from "@/lib/shopify/sales-orders";
import { getLiveShopifySales, reportDay, shopifyDirectMode } from "@/lib/shopify/live-sales";

/**
 * Le périmètre « Straight Sale » de l'accès Associé.
 *
 * Un associé ne voit qu'une tranche de l'activité : les ventes directes
 * (catégorie Phoenix « direct », par opposition aux abonnements et à leurs
 * récurrences) et les dépenses Meta qui les financent. Ce périmètre est
 * fixé par l'admin, ici, et appliqué côté serveur : l'API de l'associé ne
 * sait rien calculer d'autre, quoi que demande le navigateur.
 */

export type AssociateScope = {
  /** Boutiques Phoenix retenues (domaines) ; vide = toutes. */
  stores: string[];
  /** Comptes publicitaires Meta retenus (account_id) ; vide = aucun, sauf mot-clé. */
  metaAccountIds: string[];
  /** Mot-clé (insensible à la casse) : un compte ou une campagne dont le nom le contient compte aussi. */
  campaignKeyword: string;
  /** Frais de paiement estimés, en % du chiffre d'affaires (Shopify Payments, Reign…). */
  processingRate: number;
  /** Marge nette visée après pub, en % : elle fixe le ROAS cible. */
  targetMargin: number;
  updatedAt: string;
};

const DEFAULT_PROCESSING_RATE = 4;
const DEFAULT_TARGET_MARGIN = 20;

export type AssociateOverview = {
  range: { start: string; end: string };
  /** La boutique, telle qu'on l'affiche (« Venom »), et ses domaines. */
  shop: { name: string; domains: string[] };
  sales: {
    revenue: number;
    orders: number;
    /** Panier moyen. */
    average: number | null;
    series: Array<{ date: string; revenue: number; orders: number }>;
    today: { revenue: number; orders: number };
  };
  meta: {
    spend: number;
    currency: string | null;
    accounts: Array<{ id: string; name: string; spend: number; campaigns: number }>;
    configured: boolean;
    error: string | null;
    /** La conversion appliquée (comptes en euros, ventes en dollars), ou null. */
    conversion: string | null;
    /** Achats et ROAS attribués par Meta (valeur des achats ÷ dépense, sur la période). */
    purchases: number;
    metaRoas: number | null;
    /** Les campagnes de la période, avec leur ROAS Meta. */
    campaigns: Array<{ id: string; name: string; status: string; spend: number; purchases: number; roas: number | null; account: string }>;
  };
  roas: number | null;
  cpa: number | null;
  /** Visites Shopify et conversion (commandes / visites) ; null sans Shopify branché. */
  conversion: { sessions: number; rate: number; cartRate: number; checkoutRate: number } | null;
  /** Les dernières ventes, toutes dates, pour le fil en temps réel. */
  live: { updatedAt: string | null; orders: Array<{ at: string; amount: number; number: string | null }> };
  profit: {
    revenue: number;
    refunds: number;
    cogs: number;
    cogsUnits: number;
    /** Unités vendues sans coût de revient renseigné. */
    cogsMissing: number;
    fees: number;
    ads: number;
    net: number;
    /** Marge nette après pub, en %. */
    margin: number | null;
    /** ROAS sous lequel on perd de l'argent, et ROAS qui donne la marge visée. */
    breakEvenRoas: number | null;
    targetRoas: number | null;
    processingRate: number;
    targetMargin: number;
  };
  /** L'état de la synchro des ventes. */
  phoenix: { configured: boolean; building: boolean; stale: boolean; progress: SnapshotProgress | null; error?: string };
  scope: Pick<AssociateScope, "stores" | "metaAccountIds" | "campaignKeyword">;
};

const FILE = path.join(process.cwd(), ".msgate-cache", "associate-scope.json");

const state = ((globalThis as typeof globalThis & { __msgateAssociateScope?: { scope: AssociateScope | null } }).__msgateAssociateScope ??= { scope: null });

/**
 * Le périmètre de Venom quand aucun réglage n'est enregistré : c'est le cas du
 * site en ligne (Vercel, sans disque). Sur le PC, le réglage de Settings prime.
 */
const VENOM_SCOPE = { stores: ["venom-necklace.com"], metaAccountIds: ["1172300475381112", "1043532936352398"], campaignKeyword: "venom" };

function empty(): AssociateScope {
  return { stores: [], metaAccountIds: [], campaignKeyword: "", processingRate: DEFAULT_PROCESSING_RATE, targetMargin: DEFAULT_TARGET_MARGIN, updatedAt: "" };
}

function rate(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 90 ? Math.round(number * 100) / 100 : fallback;
}

export async function getAssociateScope(): Promise<AssociateScope> {
  if (state.scope) return state.scope;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<AssociateScope>;
    state.scope = {
      stores: Array.isArray(parsed.stores) ? parsed.stores.map(String) : [],
      metaAccountIds: Array.isArray(parsed.metaAccountIds) ? parsed.metaAccountIds.map(String) : [],
      campaignKeyword: typeof parsed.campaignKeyword === "string" ? parsed.campaignKeyword : "",
      processingRate: rate(parsed.processingRate, DEFAULT_PROCESSING_RATE),
      targetMargin: rate(parsed.targetMargin, DEFAULT_TARGET_MARGIN),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    state.scope = { ...empty(), ...VENOM_SCOPE };
  }
  return state.scope;
}

export async function saveAssociateScope(
  patch: Partial<Pick<AssociateScope, "stores" | "metaAccountIds" | "campaignKeyword">> & { processingRate?: unknown; targetMargin?: unknown }
): Promise<AssociateScope> {
  const current = await getAssociateScope();
  const next: AssociateScope = {
    stores: (patch.stores ?? current.stores).map((value) => value.trim()).filter(Boolean).slice(0, 200),
    metaAccountIds: (patch.metaAccountIds ?? current.metaAccountIds).map((value) => value.trim()).filter((value) => /^\d+$/.test(value)).slice(0, 200),
    campaignKeyword: (patch.campaignKeyword ?? current.campaignKeyword).trim().slice(0, 60),
    processingRate: patch.processingRate === undefined ? current.processingRate : rate(patch.processingRate, current.processingRate),
    targetMargin: patch.targetMargin === undefined ? current.targetMargin : rate(patch.targetMargin, current.targetMargin),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, FILE);
  state.scope = next;
  return next;
}

/** Les choix offerts à l'admin : les boutiques vues dans Phoenix et les comptes Meta déjà rencontrés. */
export async function getAssociateScopeOptions() {
  const billing = resolveSource(null);
  const snapshot = billing.configured ? await billing.peekSnapshot() : null;
  const stores = new Set<string>();
  for (const tx of snapshot?.transactions ?? []) if (tx.domain) stores.add(tx.domain);
  const accounts = (await getKnownAccounts()).map((account) => ({ id: account.accountId, name: account.name, business: account.business }));
  return { stores: [...stores].sort(), accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)) };
}

function matches(keyword: string, name: string) {
  return Boolean(keyword) && name.toLowerCase().includes(keyword.toLowerCase());
}

/** La part des dépenses d'un compte qui relève du périmètre : tout le compte s'il est retenu, sinon ses campagnes au mot-clé. */
function spendInScope(account: AccountNode, scope: AssociateScope) {
  const whole = scope.metaAccountIds.includes(account.accountId) || matches(scope.campaignKeyword, account.name);
  const picked = whole ? account.campaigns : account.campaigns.filter((campaign) => matches(scope.campaignKeyword, campaign.name));
  return {
    spend: whole ? account.metrics.spend : picked.reduce((sum, campaign) => sum + campaign.metrics.spend, 0),
    campaigns: picked.length,
    picked,
  };
}

/** La dépense Meta du périmètre : comptes retenus en entier, plus les campagnes au mot-clé des autres comptes. */
export async function scopedMetaSpend(start: string, end: string, scope: AssociateScope, force = false): Promise<AssociateOverview["meta"]> {
  let meta: AssociateOverview["meta"] = {
    spend: 0,
    currency: null,
    accounts: [],
    configured: Boolean(getMetaConfig()),
    error: null,
    conversion: null,
    purchases: 0,
    metaRoas: null,
    campaigns: [],
  };
  const hasScope = scope.metaAccountIds.length > 0 || Boolean(scope.campaignKeyword);
  if (meta.configured && hasScope) {
    try {
      const tree = await buildAdsTree({ preset: "custom", start, end, force });
      const rows = tree.accounts
        .map((account) => ({ account, ...spendInScope(account, scope) }))
        .filter((row) => row.campaigns > 0 || scope.metaAccountIds.includes(row.account.accountId));
      // Tout en dollars, la devise des ventes : les comptes de Badgal Collection sont en euros.
      const rates = await fxRates(rows.map((row) => row.account.currency), REPORT_CURRENCY);
      const inUsd = (row: (typeof rows)[number]) => row.spend * (rates.get((row.account.currency || REPORT_CURRENCY).toUpperCase())?.rate ?? 1);
      // Le ROAS de Meta se calcule dans la devise du compte (valeur des achats et dépense sont toutes deux en euros) : pas de conversion.
      const rate = (currency: string) => rates.get((currency || REPORT_CURRENCY).toUpperCase())?.rate ?? 1;
      const campaigns = rows
        .flatMap((row) => row.picked.map((campaign) => ({ campaign, currency: row.account.currency, account: row.account.name })))
        .filter(({ campaign }) => campaign.metrics.spend > 0)
        .map(({ campaign, currency, account }) => ({
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          spend: campaign.metrics.spend * rate(currency),
          purchases: campaign.metrics.purchases,
          roas: campaign.metrics.spend > 0 ? campaign.metrics.purchaseValue / campaign.metrics.spend : null,
          value: campaign.metrics.purchaseValue * rate(currency),
          account,
        }))
        .sort((a, b) => b.spend - a.spend);
      const spendUsd = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
      const valueUsd = campaigns.reduce((sum, campaign) => sum + campaign.value, 0);
      meta = {
        spend: rows.reduce((sum, row) => sum + inUsd(row), 0),
        currency: REPORT_CURRENCY,
        accounts: rows.map((row) => ({ id: row.account.accountId, name: row.account.name, spend: inUsd(row), campaigns: row.campaigns })).sort((a, b) => b.spend - a.spend),
        configured: true,
        error: null,
        conversion: describeConversion(rates, REPORT_CURRENCY),
        purchases: campaigns.reduce((sum, campaign) => sum + campaign.purchases, 0),
        metaRoas: spendUsd > 0 ? valueUsd / spendUsd : null,
        campaigns: campaigns.map(({ value: _value, ...rest }) => {
          void _value;
          return rest;
        }),
      };
    } catch (error) {
      meta = { ...meta, error: error instanceof Error ? error.message : "Meta indisponible" };
    }
  }
  return meta;
}

/**
 * Le tableau de bord de l'associé, calculé ici et nulle part ailleurs.
 *
 * Ventes : les ventes directes des boutiques du périmètre,
 * Shopify compris, jour par jour à l'heure de Paris. Meta : la dépense des
 * comptes et campagnes du périmètre. Conversion : les visites Shopify. Profit :
 * remboursements, COGS au coût de base, frais de paiement estimés et pub.
 * Aucun nom de processeur ni rien des abonnements ne sort d'ici.
 */
export async function buildAssociateOverview(start: string, end: string, options: { force?: boolean } = {}): Promise<AssociateOverview> {
  const force = Boolean(options.force);
  const scope = await getAssociateScope();
  const storeSet = new Set(scope.stores);
  const inScope = (domain: string) => !storeSet.size || storeSet.has(domain);

  const billing = resolveSource(null);
  const { peekSnapshot, startSync, getProgress } = billing;
  const today = reportToday();
  const byDay = new Map<string, { revenue: number; orders: number }>();
  let revenue = 0;
  let orders = 0;
  const todayTotals = { revenue: 0, orders: 0 };
  const latest: Array<{ at: string; amount: number; orderId: string | null }> = [];
  let phoenix: AssociateOverview["phoenix"] = { configured: billing.configured, building: false, stale: false, progress: null };

  // Site en ligne (pas de Reign) : les ventes viennent de Shopify en direct, relues toutes les 45 s.
  const direct = shopifyDirectMode();
  let shopifyError: string | null = null;
  let directFeed: Awaited<ReturnType<typeof getLiveShopifySales>> | null = null;
  if (direct) {
    // Une panne Shopify ne doit pas cacher la dépense Meta : les ventes restent à zéro, l'erreur est signalée.
    directFeed = await getLiveShopifySales(start < today ? start : today, force).catch((error) => {
      shopifyError = error instanceof Error ? error.message : "Shopify indisponible";
      return null;
    });
    if (directFeed && inScope(directFeed.domain)) {
      for (const order of directFeed.orders) {
        const day = reportDay(order.createdAt);
        latest.push({ at: order.createdAt, amount: order.total, orderId: order.name });
        if (day === today) {
          todayTotals.revenue += order.total;
          todayTotals.orders += 1;
        }
        if (day < start || day > end) continue;
        revenue += order.total;
        orders += 1;
        const point = byDay.get(day) ?? { revenue: 0, orders: 0 };
        point.revenue += order.total;
        point.orders += 1;
        byDay.set(day, point);
      }
    }
    phoenix = { configured: true, building: false, stale: false, progress: null, ...(shopifyError ? { error: shopifyError } : {}) };
  } else if (billing.configured) {
    // Le bouton Synchroniser : les ventes Shopify sont relues tout de suite, avant de lire l'instantané.
    // Sinon, relecture en arrière-plan à chaque appel (au plus toutes les 30 s), même quand Reign est à jour.
    if (force) await refreshShopifyNow({ focus: { start, end }, force: true });
    else void refreshShopifyNow({ focus: { start, end } });
    const snapshot = await peekSnapshot();
    const needsSync = !snapshot || !snapshot.complete || isStale(snapshot) || (focusIncludesToday({ start, end }) && isStale(snapshot, billing.todayMaxAgeMs));
    if (needsSync) void startSync({ focus: { start, end } });
    if (snapshot) {
      // Une vente directe approuvée par commande : une relance refusée puis acceptée ne compte qu'une fois.
      const seen = new Set<string>();
      for (const tx of snapshot.transactions) {
        if (!inScope(tx.domain) || !isAttempt(tx) || !isApproved(tx) || classifyCategory(tx) !== "direct") continue;
        const key = tx.orderId != null ? String(tx.orderId) : `${tx.customerId}:${tx.date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        latest.push({ at: tx.date, amount: tx.amount, orderId: tx.orderId != null ? String(tx.orderId) : null });
        const day = tx.date.slice(0, 10);
        if (day === today) {
          todayTotals.revenue += tx.amount;
          todayTotals.orders += 1;
        }
        if (day < start || day > end) continue;
        revenue += tx.amount;
        orders += 1;
        const point = byDay.get(day) ?? { revenue: 0, orders: 0 };
        point.revenue += tx.amount;
        point.orders += 1;
        byDay.set(day, point);
      }
      phoenix = { configured: true, building: !snapshot.complete, stale: isStale(snapshot), progress: getProgress() };
    } else {
      phoenix = { configured: true, building: true, stale: false, progress: getProgress() };
    }
  }

  const days: string[] = [];
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`) && days.length < 400; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  const series = days.map((date) => ({ date, revenue: round2(byDay.get(date)?.revenue ?? 0), orders: byDay.get(date)?.orders ?? 0 }));

  const [meta, sales, peekedFeed, orderMap] = await Promise.all([
    scopedMetaSpend(start, end, scope, force),
    buildSalesBreakdown({ start, end, stores: scope.stores, categories: ["direct"] }).catch(() => null),
    direct ? Promise.resolve(null) : peekShopifyFeed(),
    direct ? Promise.resolve(new Map<string, { shopifyName?: string | null }>()) : peekOrders(),
  ]);
  const feed = directFeed ? { name: directFeed.name, domain: directFeed.domain, fetchedAt: directFeed.fetchedAt } : peekedFeed;

  // Conversion : seulement si la boutique Shopify branchée est dans le périmètre.
  let conversion: AssociateOverview["conversion"] = null;
  if (isShopifySalesConfigured() && feed?.domain && inScope(feed.domain)) {
    try {
      const traffic = await fetchShopifyTraffic(start, end);
      conversion = {
        sessions: traffic.sessions,
        rate: traffic.sessions ? orders / traffic.sessions : 0,
        cartRate: traffic.sessions ? traffic.cart / traffic.sessions : 0,
        checkoutRate: traffic.sessions ? traffic.checkout / traffic.sessions : 0,
      };
    } catch {
      conversion = null;
    }
  }

  latest.sort((a, b) => b.at.localeCompare(a.at));
  const live = {
    updatedAt: feed?.fetchedAt ?? null,
    orders: latest.slice(0, 8).map((sale) => ({
      at: sale.at,
      amount: round2(sale.amount),
      number: direct ? sale.orderId : (sale.orderId && orderMap.get(sale.orderId)?.shopifyName) || null,
    })),
  };

  const refunds = sales?.refunds.amount ?? 0;
  const cogs = sales?.cogs?.total ?? 0;
  const fees = (revenue * scope.processingRate) / 100;
  const contribution = revenue - refunds - cogs - fees;
  const net = contribution - meta.spend;
  const marginBeforeAds = revenue > 0 ? contribution / revenue : null;
  const targetShare = marginBeforeAds != null ? marginBeforeAds - scope.targetMargin / 100 : null;

  const shopName = feed?.domain && inScope(feed.domain) && feed.name ? feed.name : scope.stores[0] ?? "Toutes les boutiques";

  return {
    range: { start, end },
    shop: { name: shopName, domains: scope.stores },
    sales: {
      revenue: round2(revenue),
      orders,
      average: orders ? round2(revenue / orders) : null,
      series,
      today: { revenue: round2(todayTotals.revenue), orders: todayTotals.orders },
    },
    meta,
    roas: meta.spend > 0 ? revenue / meta.spend : null,
    cpa: meta.spend > 0 && orders > 0 ? meta.spend / orders : null,
    conversion,
    live,
    profit: {
      revenue: round2(revenue),
      refunds: round2(refunds),
      cogs: round2(cogs),
      cogsUnits: sales?.cogs?.units ?? 0,
      cogsMissing: sales?.cogs && sales.cogs.defaultUnitCost === 0 ? sales.cogs.unitsAtDefault : 0,
      fees: round2(fees),
      ads: round2(meta.spend),
      net: round2(net),
      margin: revenue > 0 ? (net / revenue) * 100 : null,
      breakEvenRoas: marginBeforeAds && marginBeforeAds > 0 ? 1 / marginBeforeAds : null,
      targetRoas: targetShare && targetShare > 0 ? 1 / targetShare : null,
      processingRate: scope.processingRate,
      targetMargin: scope.targetMargin,
    },
    phoenix,
    scope: { stores: scope.stores, metaAccountIds: scope.metaAccountIds, campaignKeyword: scope.campaignKeyword },
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Le calculateur de profit de l'associé : le Straight sale du périmètre seul.
 *
 * Revenu, remboursements et chargebacks des seules ventes directes des
 * boutiques retenues ; COGS de leurs articles au coût de base ; dépense Meta
 * du périmètre. Rien des abonnements (VIP Initial, Recurring, Salvage) ni des
 * autres boutiques ne sort d'ici.
 */
export async function buildAssociateProfitInputs(start: string, end: string): Promise<ProfitInputs> {
  const scope = await getAssociateScope();
  const [sales, meta] = await Promise.all([
    buildSalesBreakdown({ start, end, stores: scope.stores, categories: ["direct"] }).catch(() => null),
    scopedMetaSpend(start, end, scope),
  ]);
  const round = (value: number) => Math.round(value * 100) / 100;
  const revenue = sales?.revenue.direct ?? 0;
  const approved = sales?.approved.direct ?? 0;
  const warnings: string[] = [];
  if (!sales) warnings.push("Ventes en cours de synchronisation : les chiffres vont se compléter.");
  if (meta.error) warnings.push(`Meta indisponible : ${meta.error}`);
  else if (!meta.configured) warnings.push("Meta n'est pas branché : dépense publicitaire à zéro.");
  if (sales?.cogs && sales.cogs.unitsAtDefault > 0 && sales.cogs.defaultUnitCost === 0) {
    warnings.push(`${sales.cogs.unitsAtDefault} unité(s) vendue(s) sans coût de revient renseigné.`);
  }
  if (sales?.cogs && sales.cogs.ordersWithoutLines > 0) {
    warnings.push(`${sales.cogs.ordersWithoutLines} commande(s) dont les articles ne sont pas encore synchronisés : COGS incomplet.`);
  }
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  return {
    range: { start, end, days },
    scope: "straight",
    label: "Straight Sale",
    currency: meta.currency ?? "USD",
    cogs: sales?.cogs ? sales.cogs.total : null,
    cogsDetail: sales?.cogs ?? null,
    categories: { direct: round(revenue), initial: 0, recurring: 0, salvage: 0, upsell: 0, directSales: approved },
    roasCombined: meta.spend > 0 ? round(revenue / meta.spend) : null,
    revenue: round(revenue),
    refunds: sales?.refunds.amount ?? 0,
    transactions: approved,
    chargebacks: sales?.chargebacks.count ?? 0,
    chargebackValue: sales?.chargebacks.amount ?? 0,
    ads: round(meta.spend),
    breakdown: {
      shopifyProcessed: round(revenue),
      shopifyReturns: 0,
      shopifyOrders: approved,
      phoenixInitial: 0,
      phoenixRecurring: 0,
      phoenixSalvage: 0,
      phoenixRebill: 0,
      phoenixRefunds: sales?.refunds.amount ?? 0,
      phoenixSubscriptionPayments: 0,
      metaSpend: round(meta.spend),
    },
    breakEven: {
      adSpend: round(meta.spend),
      frontRevenueVip: 0,
      frontRevenueAll: round(revenue),
      salesVip: 0,
      salesAll: approved,
      membershipPrice: 0,
      observedApprovalRate: 0,
      recurringApproved: 0,
      recurringAttempts: 0,
    },
    retention: { avgLifetimeDays: 0, medianLifetimeDays: 0, churned: 0, windowDays: 0 },
    sources: { shopify: "unavailable", phoenix: sales ? "live" : "building", spend: meta.spend > 0 ? "meta" : "missing" },
    warnings,
  };
}
