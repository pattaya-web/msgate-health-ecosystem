import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { getKnownAccounts } from "@/lib/meta/registry";
import { buildSalesBreakdown } from "@/lib/metrics/sales-breakdown";
import { reportToday } from "@/lib/report-tz";
import { MANUAL_AD_SPEND, getAssociateScope, scopedMetaSpend } from "@/lib/associate/scope";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * MoneyTalk : la paie d'Alison sur le Straight Sale de Venom.
 *
 * Bénéfice = ventes − remboursements − coût produit − frais de paiement −
 * toute la pub. Mady encaisse les ventes et verse à Alison :
 *   - version 1, tant qu'Alison paie la pub (aujourd'hui) : tout le bénéfice ;
 *   - version 2, dès que Mady paie la pub (son compte agence Meta) : la moitié
 *     du bénéfice, c'est-à-dire la moitié de (ventes − coût − frais) moins la
 *     moitié de la pub que Mady a avancée.
 * La version 2 démarre à la date réglée par l'admin (`madyPaysFrom`).
 *
 * Le calcul se fait par période (semaine du lundi au dimanche, ou mois), au
 * rythme de paiement choisi par Alison ; l'admin marque une période payée.
 */

export type Partner = "mady" | "alison";
export type Frequency = "weekly" | "monthly";

export type PartnershipSettings = {
  /** Premier jour compté dans le partage (jour de Paris). */
  startDate: string;
  frequency: Frequency;
  /** Premier jour où Mady paie la pub (version 2, 50/50) ; null = Alison paie encore tout (version 1). */
  madyPaysFrom: string | null;
  /** Qui paie chaque compte publicitaire Meta (account_id → partenaire). */
  payers: Record<string, Partner>;
  /** Les périodes réglées : clé « début_fin » → montant versé, moyen, date du versement. */
  paid: Record<string, PaidRecord>;
  updatedAt: string;
};

export type PaidRecord = {
  amount: number;
  /** Quand c'est noté dans l'outil. */
  at: string;
  /** Virement bancaire, espèces, PayPal… (absent sur les anciens paiements). */
  method?: string;
  /** Le jour du versement (YYYY-MM-DD). */
  date?: string;
  note?: string;
};

export type PartnershipPeriod = {
  key: string;
  start: string;
  end: string;
  /** La période contient aujourd'hui : ses chiffres bougent encore. */
  current: boolean;
  revenue: number;
  orders: number;
  refunds: number;
  cogs: number;
  /** Pièces vendues sans coût produit renseigné (comptées à 0). */
  cogsMissing: number;
  fees: number;
  adsMady: number;
  adsAlison: number;
  profit: number;
  /** 1 : Alison paie la pub, tout le bénéfice est à elle. 2 : Mady paie la pub, 50/50. */
  version: 1 | 2;
  /** La paie d'Alison selon chaque version, pour comparer. */
  payV1: number;
  payV2: number;
  /** Ce que Mady verse à Alison pour la période (selon sa version). Négatif : c'est elle qui doit. */
  owed: number;
  paid: PaidRecord | null;
  error: string | null;
};

export type PartnershipReport = {
  settings: PartnershipSettings;
  processingRate: number;
  accounts: Array<{ id: string; name: string; payer: Partner }>;
  periods: PartnershipPeriod[];
  totals: { revenue: number; profit: number; owed: number; paid: number; due: number };
  builtAt: string;
};

/** Aujourd'hui, c'est Alison qui paie la pub de ses deux comptes (BM Badgal Collection). Tout autre compte est à Mady. */
const DEFAULT_PAYERS: Record<string, Partner> = {
  "1172300475381112": "alison",
  "1043532936352398": "alison",
  // Les dépenses saisies à la main (compte banni) gardent leur payeur.
  ...Object.fromEntries(MANUAL_AD_SPEND.map((entry) => [entry.id, entry.payer])),
};
const DEFAULT_START = "2026-10-01";

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "associate-partnership.json");

const state = ((globalThis as typeof globalThis & {
  __msgatePartnershipV2?: { settings: PartnershipSettings | null; periods: Map<string, { at: number; period: PartnershipPeriod }> };
}).__msgatePartnershipV2 ??= { settings: null, periods: new Map() });

const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const round2 = (value: number) => Math.round(value * 100) / 100;

export async function getPartnershipSettings(): Promise<PartnershipSettings> {
  if (state.settings) return state.settings;
  let parsed: Partial<PartnershipSettings> = {};
  try {
    parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<PartnershipSettings>;
  } catch {
    // Pas encore de réglage : les valeurs par défaut.
  }
  state.settings = {
    startDate: isDay(parsed.startDate) ? parsed.startDate : DEFAULT_START,
    frequency: parsed.frequency === "monthly" ? "monthly" : "weekly",
    madyPaysFrom: isDay(parsed.madyPaysFrom) ? parsed.madyPaysFrom : null,
    payers: { ...DEFAULT_PAYERS, ...(parsed.payers ?? {}) },
    paid: parsed.paid ?? {},
    updatedAt: parsed.updatedAt ?? "",
  };
  return state.settings;
}

async function persist(next: PartnershipSettings) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, FILE);
  state.settings = next;
}

export type PartnershipPatch = {
  frequency?: unknown;
  startDate?: unknown;
  /** Une date (« YYYY-MM-DD ») ou null pour revenir à la version 1. */
  madyPaysFrom?: unknown;
  payers?: unknown;
  /** Marquer une période payée (avec le montant versé) ou la rouvrir. */
  markPaid?: { key?: unknown; amount?: unknown; paid?: unknown; method?: unknown; date?: unknown; note?: unknown };
};

/** L'associée ne règle que son rythme de paiement ; le reste est à l'admin. */
export async function updatePartnership(patch: PartnershipPatch, role: "admin" | "associate"): Promise<PartnershipSettings> {
  const current = await getPartnershipSettings();
  const next: PartnershipSettings = { ...current, payers: { ...current.payers }, paid: { ...current.paid }, updatedAt: new Date().toISOString() };
  if (patch.frequency === "weekly" || patch.frequency === "monthly") next.frequency = patch.frequency;
  if (role === "admin") {
    if (isDay(patch.startDate)) next.startDate = patch.startDate;
    if (patch.madyPaysFrom === null || patch.madyPaysFrom === "") next.madyPaysFrom = null;
    else if (isDay(patch.madyPaysFrom)) next.madyPaysFrom = patch.madyPaysFrom;
    if (patch.payers && typeof patch.payers === "object") {
      for (const [id, payer] of Object.entries(patch.payers as Record<string, unknown>)) {
        if (/^\d+$/.test(id) && (payer === "mady" || payer === "alison")) next.payers[id] = payer;
      }
    }
    const mark = patch.markPaid;
    if (mark && typeof mark.key === "string" && /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(mark.key)) {
      if (mark.paid === false) delete next.paid[mark.key];
      else {
        const amount = Number(mark.amount);
        const method = typeof mark.method === "string" ? mark.method.trim().slice(0, 40) : "";
        const note = typeof mark.note === "string" ? mark.note.trim().slice(0, 200) : "";
        next.paid[mark.key] = {
          amount: Number.isFinite(amount) ? round2(amount) : 0,
          at: new Date().toISOString(),
          ...(method ? { method } : {}),
          ...(isDay(mark.date) ? { date: mark.date } : {}),
          ...(note ? { note } : {}),
        };
      }
    }
  }
  await persist(next);
  // Les payeurs changent la répartition : on recalcule tout.
  state.periods.clear();
  return next;
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Les périodes du début du partage à aujourd'hui : semaines du lundi au dimanche, ou mois civils. */
export function periodsBetween(startDate: string, today: string, frequency: Frequency) {
  const periods: Array<{ start: string; end: string }> = [];
  let cursor = startDate;
  while (cursor <= today && periods.length < 200) {
    let end: string;
    if (frequency === "monthly") {
      const date = new Date(`${cursor}T00:00:00Z`);
      end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    } else {
      const weekday = (new Date(`${cursor}T00:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0
      end = addDays(cursor, 6 - weekday);
    }
    periods.push({ start: cursor, end });
    cursor = addDays(end, 1);
  }
  return periods;
}

async function computePeriod(start: string, end: string, today: string, settings: PartnershipSettings): Promise<PartnershipPeriod> {
  const key = `${start}_${end}`;
  const current = start <= today && today <= end;
  // Une période close bouge peu (remboursements tardifs) : 30 min ; celle en cours : 2 min.
  const cached = state.periods.get(key);
  if (cached && Date.now() - cached.at < (current ? 2 : 30) * 60_000) return { ...cached.period, paid: settings.paid[key] ?? null };

  const scope = await getAssociateScope();
  const until = end > today ? today : end;
  const [sales, meta] = await Promise.all([
    buildSalesBreakdown({ start, end: until, stores: scope.stores, categories: ["direct"] }).catch(() => null),
    scopedMetaSpend(start, until, scope),
  ]);
  const revenue = sales?.revenue.direct ?? 0;
  const refunds = sales?.refunds.amount ?? 0;
  // La grille fournisseur ne compte pas ici : Mady règle le coût des colliers à part avec Alison (décision du 02/11/2026).
  const cogs = (sales?.cogs?.total ?? 0) - (sales?.cogs?.grid?.total ?? 0);
  const fees = (revenue * scope.processingRate) / 100;
  let adsMady = 0;
  let adsAlison = 0;
  for (const account of meta.accounts) {
    if ((settings.payers[account.id] ?? "mady") === "alison") adsAlison += account.spend;
    else adsMady += account.spend;
  }
  const profit = revenue - refunds - cogs - fees - adsMady - adsAlison;
  const version: 1 | 2 = settings.madyPaysFrom && start >= settings.madyPaysFrom ? 2 : 1;
  const period: PartnershipPeriod = {
    key,
    start,
    end,
    current,
    revenue: round2(revenue),
    orders: sales?.approved.direct ?? 0,
    refunds: round2(refunds),
    cogs: round2(cogs),
    cogsMissing: sales?.cogs && sales.cogs.defaultUnitCost === 0 ? sales.cogs.unitsAtDefault : 0,
    fees: round2(fees),
    adsMady: round2(adsMady),
    adsAlison: round2(adsAlison),
    profit: round2(profit),
    version,
    payV1: round2(profit),
    payV2: round2(profit / 2),
    owed: round2(version === 2 ? profit / 2 : profit),
    paid: settings.paid[key] ?? null,
    error: meta.error ?? (sales ? null : "Ventes en cours de synchronisation : les chiffres vont se compléter."),
  };
  // Un calcul incomplet (ventes pas encore synchronisées, Meta en panne) n'est pas gardé.
  if (!period.error) state.periods.set(key, { at: Date.now(), period });
  return period;
}

export async function buildPartnershipReport(): Promise<PartnershipReport> {
  const settings = await getPartnershipSettings();
  const scope = await getAssociateScope();
  const today = reportToday();
  const ranges = periodsBetween(settings.startDate, today, settings.frequency);
  const periods: PartnershipPeriod[] = [];
  // Trois à la fois : Meta et Reign n'aiment pas les rafales.
  for (let index = 0; index < ranges.length; index += 3) {
    periods.push(...(await Promise.all(ranges.slice(index, index + 3).map((range) => computePeriod(range.start, range.end, today, settings)))));
  }
  periods.reverse();
  // Les périodes d'avant la première vente (ni vente, ni pub, ni paiement) n'apprennent rien : on les retire.
  const empty = (period: PartnershipPeriod) => !period.revenue && !period.adsMady && !period.adsAlison && !period.paid && !period.current && !period.error;
  while (periods.length > 1 && empty(periods[periods.length - 1])) periods.pop();

  const known = await getKnownAccounts().catch(() => []);
  const ids = new Set([...scope.metaAccountIds, ...Object.keys(settings.payers)]);
  const accounts = [...ids].map((id) => ({
    id,
    name: known.find((account) => account.accountId === id)?.name ?? MANUAL_AD_SPEND.find((entry) => entry.id === id)?.name ?? id,
    payer: settings.payers[id] ?? ("mady" as Partner),
  }));

  const sum = (pick: (period: PartnershipPeriod) => number) => round2(periods.reduce((total, period) => total + pick(period), 0));
  const owed = sum((period) => period.owed);
  const paid = sum((period) => period.paid?.amount ?? 0);
  return {
    settings,
    processingRate: scope.processingRate,
    accounts,
    periods,
    totals: { revenue: sum((period) => period.revenue), profit: sum((period) => period.profit), owed, paid, due: round2(owed - paid) },
    builtAt: new Date().toISOString(),
  };
}
