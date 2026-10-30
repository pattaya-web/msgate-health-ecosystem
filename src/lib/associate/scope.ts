import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { getKnownAccounts } from "@/lib/meta/registry";
import { buildAdsTree } from "@/lib/meta/tree";
import { getMetaConfig } from "@/lib/meta/client";
import { buildOverview } from "@/lib/phoenix/analytics";
import { focusIncludesToday, isStale } from "@/lib/phoenix/snapshot";
import { resolveSource } from "@/lib/phoenix/sources";
import type { SnapshotProgress } from "@/lib/phoenix/types";
import type { AccountNode } from "@/lib/meta/types";

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
  updatedAt: string;
};

export type AssociateOverview = {
  range: { start: string; end: string };
  straightSale: {
    attempts: number;
    approved: number;
    approvalRate: number;
    revenue: number;
    series: Array<{ date: string; revenue: number }>;
  };
  meta: {
    spend: number;
    currency: string | null;
    accounts: Array<{ id: string; name: string; spend: number; campaigns: number }>;
    configured: boolean;
    error: string | null;
  };
  roas: number | null;
  cpa: number | null;
  /** L'état de la source des ventes (Reign aujourd'hui) ; le nom du champ date de Phoenix. */
  phoenix: { configured: boolean; building: boolean; stale: boolean; progress: SnapshotProgress | null };
  scope: Pick<AssociateScope, "stores" | "metaAccountIds" | "campaignKeyword">;
};

const FILE = path.join(process.cwd(), ".msgate-cache", "associate-scope.json");

const state = ((globalThis as typeof globalThis & { __msgateAssociateScope?: { scope: AssociateScope | null } }).__msgateAssociateScope ??= { scope: null });

function empty(): AssociateScope {
  return { stores: [], metaAccountIds: [], campaignKeyword: "", updatedAt: "" };
}

export async function getAssociateScope(): Promise<AssociateScope> {
  if (state.scope) return state.scope;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<AssociateScope>;
    state.scope = {
      stores: Array.isArray(parsed.stores) ? parsed.stores.map(String) : [],
      metaAccountIds: Array.isArray(parsed.metaAccountIds) ? parsed.metaAccountIds.map(String) : [],
      campaignKeyword: typeof parsed.campaignKeyword === "string" ? parsed.campaignKeyword : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    state.scope = empty();
  }
  return state.scope;
}

export async function saveAssociateScope(patch: Partial<Pick<AssociateScope, "stores" | "metaAccountIds" | "campaignKeyword">>): Promise<AssociateScope> {
  const current = await getAssociateScope();
  const next: AssociateScope = {
    stores: (patch.stores ?? current.stores).map((value) => value.trim()).filter(Boolean).slice(0, 200),
    metaAccountIds: (patch.metaAccountIds ?? current.metaAccountIds).map((value) => value.trim()).filter((value) => /^\d+$/.test(value)).slice(0, 200),
    campaignKeyword: (patch.campaignKeyword ?? current.campaignKeyword).trim().slice(0, 60),
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
  if (whole) return { spend: account.metrics.spend, campaigns: account.campaigns.length };
  const picked = account.campaigns.filter((campaign) => matches(scope.campaignKeyword, campaign.name));
  return { spend: picked.reduce((sum, campaign) => sum + campaign.metrics.spend, 0), campaigns: picked.length };
}

/**
 * Le tableau de bord de l'associé, calculé ici et nulle part ailleurs.
 *
 * Phoenix : la même construction que l'écran Stats, réduite aux boutiques du
 * périmètre, dont on ne garde que la catégorie « direct ». Meta : l'arbre des
 * comptes de la fenêtre, dont on ne somme que ce qui entre dans le périmètre.
 * Tout ce qui n'est pas Straight Sale reste sur le serveur.
 */
export async function buildAssociateOverview(start: string, end: string): Promise<AssociateOverview> {
  const scope = await getAssociateScope();

  const billing = resolveSource(null);
  const { peekSnapshot, startSync, getProgress } = billing;
  const phoenixConfigured = billing.configured;
  let straightSale: AssociateOverview["straightSale"] = { attempts: 0, approved: 0, approvalRate: 0, revenue: 0, series: [] };
  let phoenix: AssociateOverview["phoenix"] = { configured: phoenixConfigured, building: false, stale: false, progress: null };
  if (phoenixConfigured) {
    const snapshot = await peekSnapshot();
    const needsSync = !snapshot || !snapshot.complete || isStale(snapshot) || (focusIncludesToday({ start, end }) && isStale(snapshot, 20 * 60 * 1000));
    if (needsSync) void startSync({ focus: { start, end } });
    if (snapshot) {
      const overview = buildOverview(snapshot, { start, end, stores: scope.stores });
      const direct = overview.orderSummary.direct;
      straightSale = {
        attempts: direct.attempts,
        approved: direct.approved,
        approvalRate: direct.approvalRate,
        revenue: direct.revenue,
        series: overview.revenue.series.map((point) => ({ date: point.date, revenue: point.direct })),
      };
      phoenix = { configured: true, building: !snapshot.complete, stale: isStale(snapshot), progress: getProgress() };
    } else {
      phoenix = { configured: true, building: true, stale: false, progress: getProgress() };
    }
  }

  let meta: AssociateOverview["meta"] = { spend: 0, currency: null, accounts: [], configured: Boolean(getMetaConfig()), error: null };
  const hasScope = scope.metaAccountIds.length > 0 || Boolean(scope.campaignKeyword);
  if (meta.configured && hasScope) {
    try {
      const tree = await buildAdsTree({ preset: "custom", start, end });
      const rows = tree.accounts
        .map((account) => ({ account, ...spendInScope(account, scope) }))
        .filter((row) => row.campaigns > 0 || scope.metaAccountIds.includes(row.account.accountId));
      const currencies = new Set(rows.map((row) => row.account.currency).filter(Boolean));
      meta = {
        spend: rows.reduce((sum, row) => sum + row.spend, 0),
        currency: currencies.size === 1 ? [...currencies][0] : null,
        accounts: rows.map((row) => ({ id: row.account.accountId, name: row.account.name, spend: row.spend, campaigns: row.campaigns })).sort((a, b) => b.spend - a.spend),
        configured: true,
        error: null,
      };
    } catch (error) {
      meta = { ...meta, error: error instanceof Error ? error.message : "Meta indisponible" };
    }
  }

  return {
    range: { start, end },
    straightSale,
    meta,
    roas: meta.spend > 0 ? straightSale.revenue / meta.spend : null,
    cpa: meta.spend > 0 && straightSale.approved > 0 ? meta.spend / straightSale.approved : null,
    phoenix,
    scope: { stores: scope.stores, metaAccountIds: scope.metaAccountIds, campaignKeyword: scope.campaignKeyword },
  };
}
