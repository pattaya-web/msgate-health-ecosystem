import { isApproved, isChargeback, isRefund } from "@/lib/phoenix/analytics";
import type { PhoenixSnapshot } from "@/lib/phoenix/snapshot";

/**
 * How long a subscriber lasts before the relationship ends badly.
 *
 * Three exits are tracked, and a customer is counted once, on whichever came
 * first: a dispute (chargeback), a refund, or a plain cancellation. Ties break
 * towards the most severe outcome. Subscribers still active are deliberately
 * excluded from the averages — their clock is still running, so folding them in
 * would drag every number down.
 */

export type ExitKind = "dispute" | "refund" | "cancel";

export const EXIT_LABELS: Record<ExitKind, string> = {
  dispute: "Litige",
  refund: "Remboursement",
  cancel: "Annulation",
};

export type LifetimePoint = {
  /** Bucket start, YYYY-MM-DD. */
  date: string;
  label: string;
  /** Average days lived, all exits confounded. */
  avgDays: number;
  medianDays: number;
  avgCancel: number | null;
  avgRefund: number | null;
  avgDispute: number | null;
  churned: number;
  cancels: number;
  refunds: number;
  disputes: number;
};

export type LifetimeBand = {
  label: string;
  min: number;
  max: number | null;
  count: number;
  share: number;
};

export type PhoenixRetention = {
  range: { start: string; end: string };
  granularity: "day" | "week" | "month";
  series: LifetimePoint[];
  bands: LifetimeBand[];
  totals: {
    churned: number;
    avgDays: number;
    medianDays: number;
    cancels: number;
    refunds: number;
    disputes: number;
    avgCancel: number | null;
    avgRefund: number | null;
    avgDispute: number | null;
    /** Tenure so far of subscribers who have not churned. */
    activeCount: number;
    activeAvgDays: number;
  };
  coverage: number;
  complete: boolean;
};

const DAY_MS = 86_400_000;

const dayKey = (iso: string | null | undefined) => (iso || "").replace(" ", "T").slice(0, 10);

function toTime(iso: string | null | undefined) {
  const day = dayKey(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = new Date(`${day}T00:00:00.000Z`).getTime();
  return Number.isNaN(time) ? null : time;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Number(value.toFixed(1));
}

const avgOrNull = (values: number[]) => (values.length ? average(values) : null);

/** Buckets wide enough to stay readable whatever the range asked for. */
function pickGranularity(start: string, end: string): PhoenixRetention["granularity"] {
  const from = toTime(start);
  const to = toTime(end);
  if (from == null || to == null) return "week";
  const days = Math.round((to - from) / DAY_MS) + 1;
  if (days <= 21) return "day";
  if (days <= 120) return "week";
  return "month";
}

function bucketOf(day: string, granularity: PhoenixRetention["granularity"]) {
  if (granularity === "day") return day;
  if (granularity === "month") return `${day.slice(0, 7)}-01`;

  // Week buckets start on Monday.
  const date = new Date(`${day}T00:00:00.000Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function bucketLabel(bucket: string, granularity: PhoenixRetention["granularity"]) {
  if (granularity === "month") {
    return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" })
      .format(new Date(`${bucket}T00:00:00.000Z`))
      .replace(".", "");
  }
  const label = `${bucket.slice(8)}/${bucket.slice(5, 7)}`;
  return granularity === "week" ? `sem. ${label}` : label;
}

const BANDS: Array<{ label: string; min: number; max: number | null }> = [
  { label: "0 à 7 jours", min: 0, max: 7 },
  { label: "8 à 30 jours", min: 8, max: 30 },
  { label: "31 à 60 jours", min: 31, max: 60 },
  { label: "61 à 90 jours", min: 61, max: 90 },
  { label: "plus de 90 jours", min: 91, max: null },
];

type Exit = { kind: ExitKind; at: number; days: number };

export function buildRetention(
  snapshot: PhoenixSnapshot,
  filters: { start: string; end: string }
): PhoenixRetention {
  const { start, end } = filters;
  const granularity = pickGranularity(start, end);

  // Earliest refund and chargeback per customer, from the transaction history.
  const firstRefund = new Map<number, number>();
  const firstDispute = new Map<number, number>();

  for (const tx of snapshot.transactions) {
    const at = toTime(tx.date);
    if (at == null) continue;

    if (isChargeback(tx)) {
      const known = firstDispute.get(tx.customerId);
      if (known == null || at < known) firstDispute.set(tx.customerId, at);
      continue;
    }
    if (isRefund(tx) && isApproved(tx)) {
      const known = firstRefund.get(tx.customerId);
      if (known == null || at < known) firstRefund.set(tx.customerId, at);
    }
  }

  const startTime = toTime(start);
  const endTime = toTime(end);
  const now = Date.now();

  const byBucket = new Map<string, { cancel: number[]; refund: number[]; dispute: number[] }>();
  const allDays: number[] = [];
  const activeDays: number[] = [];
  const daysByKind: Record<ExitKind, number[]> = { cancel: [], refund: [], dispute: [] };
  const bandCounts = BANDS.map(() => 0);

  for (const customer of snapshot.customers) {
    // First payment is the truest start; enrolment is the fallback.
    const began = toTime(customer.firstTxAt) ?? toTime(customer.enrolledAt);
    if (began == null) continue;

    const candidates: Exit[] = [];
    const push = (kind: ExitKind, at: number | null | undefined) => {
      if (at == null || at < began) return;
      candidates.push({ kind, at, days: Math.round((at - began) / DAY_MS) });
    };

    push("dispute", firstDispute.get(customer.id));
    push("refund", firstRefund.get(customer.id));
    push("cancel", toTime(customer.cancelledAt));

    if (!candidates.length) {
      // Still running: tenure so far, reported separately from the averages.
      activeDays.push(Math.max(0, Math.round((now - began) / DAY_MS)));
      continue;
    }

    const severity: Record<ExitKind, number> = { dispute: 0, refund: 1, cancel: 2 };
    candidates.sort((a, b) => a.at - b.at || severity[a.kind] - severity[b.kind]);
    const exit = candidates[0];

    // The curve is read by exit date, so only exits inside the range count.
    if (startTime != null && exit.at < startTime) continue;
    if (endTime != null && exit.at > endTime) continue;

    const bucket = bucketOf(new Date(exit.at).toISOString().slice(0, 10), granularity);
    const entry = byBucket.get(bucket) ?? { cancel: [], refund: [], dispute: [] };
    entry[exit.kind].push(exit.days);
    byBucket.set(bucket, entry);

    allDays.push(exit.days);
    daysByKind[exit.kind].push(exit.days);

    const bandIndex = BANDS.findIndex(
      (band) => exit.days >= band.min && (band.max == null || exit.days <= band.max)
    );
    if (bandIndex >= 0) bandCounts[bandIndex] += 1;
  }

  const series: LifetimePoint[] = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, entry]) => {
      const combined = [...entry.cancel, ...entry.refund, ...entry.dispute];
      return {
        date: bucket,
        label: bucketLabel(bucket, granularity),
        avgDays: average(combined),
        medianDays: median(combined),
        avgCancel: avgOrNull(entry.cancel),
        avgRefund: avgOrNull(entry.refund),
        avgDispute: avgOrNull(entry.dispute),
        churned: combined.length,
        cancels: entry.cancel.length,
        refunds: entry.refund.length,
        disputes: entry.dispute.length,
      };
    });

  const churned = allDays.length;
  const bands: LifetimeBand[] = BANDS.map((band, index) => ({
    ...band,
    count: bandCounts[index],
    share: churned > 0 ? Number(((bandCounts[index] / churned) * 100).toFixed(1)) : 0,
  }));

  return {
    range: { start, end },
    granularity,
    series,
    bands,
    totals: {
      churned,
      avgDays: average(allDays),
      medianDays: median(allDays),
      cancels: daysByKind.cancel.length,
      refunds: daysByKind.refund.length,
      disputes: daysByKind.dispute.length,
      avgCancel: avgOrNull(daysByKind.cancel),
      avgRefund: avgOrNull(daysByKind.refund),
      avgDispute: avgOrNull(daysByKind.dispute),
      activeCount: activeDays.length,
      activeAvgDays: average(activeDays),
    },
    coverage: snapshot.coverage,
    complete: snapshot.complete,
  };
}
