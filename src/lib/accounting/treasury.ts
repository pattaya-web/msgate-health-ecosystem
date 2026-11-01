import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { buildPartnershipReport, type PartnershipPeriod } from "@/lib/associate/partnership";
import { getAssociateScope } from "@/lib/associate/scope";
import { buildSalesBreakdown } from "@/lib/metrics/sales-breakdown";
import { buildOverview } from "@/lib/phoenix/analytics";
import { resolveSource } from "@/lib/phoenix/sources";
import { reportToday } from "@/lib/report-tz";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Trésorerie (admin) : où va l'argent, période par période.
 *
 *  - À Mady, 100 % : VIP Initial + Recurring + Salvage (+ Upsell), même quand
 *    il paie la pub ; Alison n'y touche jamais.
 *  - À Alison : la paie MoneyTalk sur le Straight sale (version 1 tant qu'elle
 *    avance la pub, version 2 en 50/50 dès que Mady la paie).
 *  - Les dépôts : Reign n'expose pas ses virements par l'API, Mady note chaque
 *    dépôt reçu en banque (date, montant, processeur). L'outil compare au
 *    chiffre encaissé par les processeurs Reign.
 *  - Ce qui est versé à Alison (montant, moyen, date) est rangé dans
 *    MoneyTalk : les deux pages lisent le même registre.
 */

export type Deposit = { id: string; date: string; amount: number; processor: string; note: string; addedAt: string };

export type TreasuryPeriod = {
  key: string;
  start: string;
  end: string;
  current: boolean;
  /** Ce qui est 100 % à Mady. */
  mine: { initial: number; recurring: number; salvage: number; upsell: number; total: number };
  /** Le Straight sale, partagé selon MoneyTalk. */
  straight: number;
  /** Ce que les processeurs Reign ont encaissé sur la période : c'est ce qui doit arriver en dépôts. */
  reignCollected: number;
  /** Les dépôts reçus en banque datés dans la période. */
  deposits: number;
  alison: {
    version: 1 | 2;
    owed: number;
    paid: PartnershipPeriod["paid"];
    due: number;
  };
  error: string | null;
};

export type TreasuryReport = {
  frequency: "weekly" | "monthly";
  periods: TreasuryPeriod[];
  deposits: Deposit[];
  /** Les processeurs Reign vus dans les ventes, pour la liste du formulaire. */
  processors: string[];
  totals: {
    mine: number;
    straight: number;
    reignCollected: number;
    deposits: number;
    /** Encaissé par Reign et pas encore arrivé en banque (frais et réserve du processeur compris). */
    toReceive: number;
    alisonOwed: number;
    alisonPaid: number;
    alisonDue: number;
  };
  builtAt: string;
};

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "treasury.json");

type Store = { deposits: Deposit[] };

type SalesPart = Omit<TreasuryPeriod, "deposits" | "alison"> & { processors: string[] };

const state = ((globalThis as typeof globalThis & {
  __msgateTreasury?: { store: Store | null; periods: Map<string, { at: number; value: SalesPart }> };
}).__msgateTreasury ??= { store: null, periods: new Map() });

const round2 = (value: number) => Math.round(value * 100) / 100;
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

async function readStore(): Promise<Store> {
  if (state.store) return state.store;
  let parsed: Partial<Store> = {};
  try {
    parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<Store>;
  } catch {
    // Pas encore de dépôt noté.
  }
  state.store = { deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [] };
  return state.store;
}

async function persist(next: Store) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, FILE);
  state.store = next;
}

export async function addDeposit(input: { date?: unknown; amount?: unknown; processor?: unknown; note?: unknown }) {
  const amount = Number(String(input.amount ?? "").replace(",", "."));
  if (!isDay(input.date)) throw new Error("Date du dépôt manquante");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Montant du dépôt invalide");
  const store = await readStore();
  const deposit: Deposit = {
    id: randomUUID(),
    date: input.date,
    amount: round2(amount),
    processor: String(input.processor ?? "").trim().slice(0, 80) || "Reign",
    note: String(input.note ?? "").trim().slice(0, 200),
    addedAt: new Date().toISOString(),
  };
  await persist({ deposits: [...store.deposits, deposit] });
}

export async function deleteDeposit(id: unknown) {
  const store = await readStore();
  await persist({ deposits: store.deposits.filter((deposit) => deposit.id !== id) });
}

/** Les chiffres de vente d'une période (sans les dépôts ni la paie, qui bougent à chaque saisie). */
async function salesOf(start: string, end: string, today: string): Promise<SalesPart> {
  const key = `${start}_${end}`;
  const current = start <= today && today <= end;
  const cached = state.periods.get(key);
  if (cached && Date.now() - cached.at < (current ? 2 : 30) * 60_000) return cached.value;

  const scope = await getAssociateScope();
  const until = end > today ? today : end;
  const [breakdown, snapshot] = await Promise.all([
    buildSalesBreakdown({ start, end: until, stores: scope.stores }).catch(() => null),
    resolveSource(null).peekSnapshot().catch(() => null),
  ]);
  const revenue = breakdown?.revenue;
  const mine = {
    initial: round2(revenue?.initial ?? 0),
    recurring: round2(revenue?.recurring ?? 0),
    salvage: round2(revenue?.salvage ?? 0),
    upsell: round2(revenue?.upsell ?? 0),
    total: 0,
  };
  mine.total = round2(mine.initial + mine.recurring + mine.salvage + mine.upsell);
  let reignCollected = 0;
  const processors: string[] = [];
  if (snapshot) {
    const stats = buildOverview(snapshot, { start, end: until, stores: scope.stores });
    for (const row of stats.checkout.processors) {
      if (/shopify/i.test(row.name)) continue;
      reignCollected += row.revenue;
      if (row.attempts) processors.push(row.name);
    }
  }
  const value: SalesPart = {
    key,
    start,
    end,
    current,
    mine,
    straight: round2(revenue?.direct ?? 0),
    reignCollected: round2(reignCollected),
    processors,
    error: breakdown && snapshot ? null : "Ventes Reign en cours de synchronisation : les chiffres vont se compléter.",
  };
  if (!value.error) state.periods.set(key, { at: Date.now(), value });
  return value;
}

export async function buildTreasuryReport(): Promise<TreasuryReport> {
  const [partnership, store] = await Promise.all([buildPartnershipReport(), readStore()]);
  const today = reportToday();
  const periods: TreasuryPeriod[] = [];
  const processors = new Set<string>();
  // Mêmes périodes que MoneyTalk (le plus récent d'abord), trois à la fois pour ménager Reign.
  for (let index = 0; index < partnership.periods.length; index += 3) {
    const slice = partnership.periods.slice(index, index + 3);
    const sales = await Promise.all(slice.map((period) => salesOf(period.start, period.end, today)));
    slice.forEach((period, i) => {
      const { processors: names, ...rest } = sales[i];
      for (const name of names) processors.add(name);
      const deposits = store.deposits.filter((deposit) => deposit.date >= period.start && deposit.date <= period.end).reduce((sum, deposit) => sum + deposit.amount, 0);
      const paidAmount = period.paid?.amount ?? 0;
      periods.push({
        ...rest,
        straight: period.revenue || rest.straight,
        deposits: round2(deposits),
        alison: { version: period.version, owed: period.owed, paid: period.paid, due: round2(period.owed - paidAmount) },
        error: rest.error ?? period.error,
      });
    });
  }

  const sum = (pick: (period: TreasuryPeriod) => number) => round2(periods.reduce((total, period) => total + pick(period), 0));
  const reignCollected = sum((period) => period.reignCollected);
  const deposits = round2(store.deposits.reduce((total, deposit) => total + deposit.amount, 0));
  const alisonOwed = sum((period) => period.alison.owed);
  const alisonPaid = sum((period) => period.alison.paid?.amount ?? 0);
  return {
    frequency: partnership.settings.frequency,
    periods,
    deposits: [...store.deposits].sort((a, b) => b.date.localeCompare(a.date) || b.addedAt.localeCompare(a.addedAt)),
    processors: [...processors].sort(),
    totals: {
      mine: sum((period) => period.mine.total),
      straight: sum((period) => period.straight),
      reignCollected,
      deposits,
      toReceive: round2(reignCollected - deposits),
      alisonOwed,
      alisonPaid,
      alisonDue: round2(alisonOwed - alisonPaid),
    },
    builtAt: new Date().toISOString(),
  };
}
