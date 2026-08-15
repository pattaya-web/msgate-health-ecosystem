import type { PhoenixSnapshot, SnapshotTransaction } from "@/lib/phoenix/snapshot";
import type {
  CategoryStats,
  DeclineRow,
  OrderCategory,
  PhoenixOverview,
  ProcessorRow,
  RevenuePoint,
  SubscriptionPoint,
} from "@/lib/phoenix/types";

export const ORDER_CATEGORIES: OrderCategory[] = [
  "direct",
  "initial",
  "recurring",
  "salvage",
  "upsell",
];

const APPROVED_CODE = "100";

/**
 * Phoenix bills vaulted subscriptions in two legs: a `Pre-Auth` (the actual
 * attempt) and, when it clears, a `Capture` carrying the same OrderId and
 * TransactionNo. Counting both would double every subscription order, so the
 * Pre-Auth is the attempt of record and the Capture is ignored.
 */
export function isAttempt(tx: SnapshotTransaction) {
  const leg = tx.leg.toLowerCase();
  return leg === "pre-auth" || leg.startsWith("direct sale");
}

export function isCapture(tx: SnapshotTransaction) {
  return tx.leg.toLowerCase() === "capture";
}

export function isRefund(tx: SnapshotTransaction) {
  return tx.leg.toLowerCase() === "refund";
}

export function isVoid(tx: SnapshotTransaction) {
  return tx.leg.toLowerCase() === "void";
}

export function isChargeback(tx: SnapshotTransaction) {
  return /charge ?back/i.test(tx.leg) || /charge ?back/i.test(tx.message);
}

export function isApproved(tx: SnapshotTransaction) {
  return tx.code === APPROVED_CODE;
}

/**
 * Maps the transaction `Type` ("Direct", "Vip Initial", "3 Month",
 * "Month 2 Salvage", …) onto the Order Summary buckets. Salvage and upsell are
 * checked first because their labels also contain "Initial" or "Month".
 */
export function classifyCategory(tx: SnapshotTransaction): OrderCategory | null {
  const type = tx.type.toLowerCase();
  if (!type) return null;
  if (type.includes("salvage")) return "salvage";
  if (type.includes("upsell")) return "upsell";
  if (type.includes("vip") || type.includes("initial")) return "initial";
  if (type.includes("month") || /^\d+\s*(m|mo|month)/.test(type)) return "recurring";
  if (type.includes("direct")) return "direct";
  return null;
}

function emptyStats(): CategoryStats {
  return { attempts: 0, approved: 0, approvalRate: 0, revenue: 0 };
}

/**
 * A declined checkout is retried several times against the same OrderId within
 * seconds. Phoenix reports those as a single direct-sale attempt (which is what
 * makes its approval rate land at 55.3% rather than 44.7% on the same data), so
 * collapse them to the approved row when there is one.
 */
function collapseDirectRetries(rows: SnapshotTransaction[]) {
  const byOrder = new Map<string, SnapshotTransaction>();
  const kept: SnapshotTransaction[] = [];

  for (const tx of rows) {
    const isDirectAttempt = classifyCategory(tx) === "direct" && isAttempt(tx);
    if (!isDirectAttempt) {
      kept.push(tx);
      continue;
    }
    const key = `${tx.customerId}:${tx.orderId ?? tx.date}`;
    const previous = byOrder.get(key);
    if (!previous || (!isApproved(previous) && isApproved(tx))) byOrder.set(key, tx);
  }

  return [...kept, ...byOrder.values()];
}

/**
 * The Phoenix month tile reports successful transactions for the calendar
 * month, with refunds expressed as a share of those (not of all attempts).
 */
function monthTotals(rows: SnapshotTransaction[]) {
  const collapsed = collapseDirectRetries(rows);
  let approved = 0;
  let attempts = 0;
  let refundCount = 0;
  let refundAmount = 0;
  let chargebackCount = 0;
  let chargebackAmount = 0;

  for (const tx of collapsed) {
    if (isRefund(tx)) {
      if (isApproved(tx)) {
        refundCount += 1;
        refundAmount += tx.amount;
      }
      continue;
    }
    if (isChargeback(tx)) {
      chargebackCount += 1;
      chargebackAmount += tx.amount;
      continue;
    }
    if (isCapture(tx) || !isAttempt(tx)) continue;
    attempts += 1;
    if (isApproved(tx)) approved += 1;
  }

  return {
    totalTransactions: approved,
    attempts,
    refunds: { count: refundCount, amount: refundAmount, rate: rate(refundCount, approved) },
    chargebacks: {
      count: chargebackCount,
      amount: chargebackAmount,
      rate: rate(chargebackCount, approved),
    },
  };
}

function monthBounds(day: string) {
  const start = `${day.slice(0, 7)}-01`;
  const date = new Date(`${start}T00:00:00.000Z`);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

function dayKey(iso: string) {
  return (iso || "").slice(0, 10);
}

function rate(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function eachDay(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return days;
  let guard = 0;
  while (cursor <= last && guard++ < 800) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function rangeLabel(start: string, end: string) {
  const s = new Date(`${start}T00:00:00.000Z`);
  const e = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${start} - ${end}`;
  const sameMonth = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return sameMonth ? fmt.format(s) : `${fmt.format(s)} – ${fmt.format(e)}`;
}

export type OverviewFilters = {
  start: string;
  end: string;
  stores?: string[];
  processors?: string[];
  client?: string;
  targetCac?: number | null;
};

export function buildOverview(
  snapshot: PhoenixSnapshot,
  filters: OverviewFilters
): PhoenixOverview {
  const { start, end } = filters;
  const stores = filters.stores?.filter(Boolean) ?? [];
  const processors = filters.processors?.filter(Boolean) ?? [];

  const storeSet = new Set(stores);
  const processorSet = new Set(processors);

  const allStores = new Set<string>();
  const allProcessors = new Set<string>();

  const month = monthBounds(start);
  const rawInRange: SnapshotTransaction[] = [];
  const rawInMonth: SnapshotTransaction[] = [];

  for (const tx of snapshot.transactions) {
    if (tx.domain) allStores.add(tx.domain);
    if (tx.processor) allProcessors.add(tx.processor);

    const day = dayKey(tx.date);
    if (!day) continue;
    if (storeSet.size && !storeSet.has(tx.domain)) continue;
    if (processorSet.size && !processorSet.has(tx.processor)) continue;

    if (day >= start && day <= end) rawInRange.push(tx);
    if (day >= month.start && day <= month.end) rawInMonth.push(tx);
  }

  const inRange = collapseDirectRetries(rawInRange);

  const orderSummary = {
    direct: emptyStats(),
    initial: emptyStats(),
    recurring: emptyStats(),
    salvage: emptyStats(),
    upsell: emptyStats(),
  } satisfies Record<OrderCategory, CategoryStats>;

  const revenueByDay = new Map<string, RevenuePoint>();
  const processorRows = new Map<string, ProcessorRow>();
  const storeRows = new Map<string, ProcessorRow>();
  const declines = new Map<string, DeclineRow>();
  const salvageSubscribers = new Set<number>();

  let totalTransactions = 0;
  let approvedCount = 0;
  let refundCount = 0;
  let refundAmount = 0;
  let chargebackCount = 0;
  let chargebackAmount = 0;
  let voidCount = 0;
  let voidAmount = 0;

  function row(map: Map<string, ProcessorRow>, name: string, processorId: string) {
    const key = name || "(unmapped)";
    if (!map.has(key)) {
      map.set(key, {
        name: key,
        processorId,
        attempts: 0,
        approved: 0,
        approvalRate: 0,
        revenue: 0,
        refunds: 0,
        refundAmount: 0,
      });
    }
    return map.get(key)!;
  }

  for (const tx of inRange) {
    const day = dayKey(tx.date);
    const procRow = row(processorRows, tx.processor, tx.processorId);
    const storeRow = row(storeRows, tx.domain, "");

    if (isRefund(tx)) {
      if (isApproved(tx)) {
        refundCount += 1;
        refundAmount += tx.amount;
        procRow.refunds += 1;
        procRow.refundAmount += tx.amount;
        storeRow.refunds += 1;
        storeRow.refundAmount += tx.amount;
      }
      continue;
    }

    if (isChargeback(tx)) {
      chargebackCount += 1;
      chargebackAmount += tx.amount;
      continue;
    }

    if (isVoid(tx)) {
      voidCount += 1;
      voidAmount += tx.amount;
      continue;
    }

    if (isCapture(tx) || !isAttempt(tx)) continue;

    totalTransactions += 1;
    procRow.attempts += 1;
    storeRow.attempts += 1;

    const category = classifyCategory(tx);
    const stats = category ? orderSummary[category] : null;
    if (stats) stats.attempts += 1;
    if (category === "salvage") salvageSubscribers.add(tx.customerId);

    if (isApproved(tx)) {
      approvedCount += 1;
      procRow.approved += 1;
      procRow.revenue += tx.amount;
      storeRow.approved += 1;
      storeRow.revenue += tx.amount;
      if (stats) {
        stats.approved += 1;
        stats.revenue += tx.amount;
      }
      if (!revenueByDay.has(day)) {
        revenueByDay.set(day, {
          date: day,
          total: 0,
          direct: 0,
          initial: 0,
          recurring: 0,
          salvage: 0,
          upsell: 0,
        });
      }
      const point = revenueByDay.get(day)!;
      point.total += tx.amount;
      if (category) point[category] += tx.amount;
    } else {
      const key = `${tx.code}|${tx.message}`;
      if (!declines.has(key)) {
        declines.set(key, { reason: tx.message || "Unknown", code: tx.code, count: 0, share: 0 });
      }
      declines.get(key)!.count += 1;
    }
  }

  for (const category of ORDER_CATEGORIES) {
    const stats = orderSummary[category];
    stats.approvalRate = rate(stats.approved, stats.attempts);
  }

  const days = eachDay(start, end);
  const revenueSeries: RevenuePoint[] = days.map(
    (date) =>
      revenueByDay.get(date) ?? {
        date,
        total: 0,
        direct: 0,
        initial: 0,
        recurring: 0,
        salvage: 0,
        upsell: 0,
      }
  );

  // Subscription lifecycle comes from the subscriber list, not transactions.
  const createdByDay = new Map<string, number>();
  const cancelledByDay = new Map<string, number>();
  let activeSubscriptions = 0;
  let cancelledSubscriptions = 0;
  let neverApproved = 0;

  for (const customer of snapshot.customers) {
    const status = (customer.status || "").toLowerCase();
    if (status === "active") activeSubscriptions += 1;
    else if (status === "canceled" || status === "cancelled") cancelledSubscriptions += 1;
    else if (status === "never approved") neverApproved += 1;

    const enrolled = dayKey(customer.enrolledAt || "");
    if (enrolled && enrolled >= start && enrolled <= end) {
      createdByDay.set(enrolled, (createdByDay.get(enrolled) || 0) + 1);
    }
    const cancelled = dayKey((customer.cancelledAt || "").replace(" ", "T"));
    if (cancelled && cancelled >= start && cancelled <= end) {
      cancelledByDay.set(cancelled, (cancelledByDay.get(cancelled) || 0) + 1);
    }
  }

  let running = 0;
  const subscriptionSeries: SubscriptionPoint[] = days.map((date) => {
    const created = createdByDay.get(date) || 0;
    const cancelled = cancelledByDay.get(date) || 0;
    running += created - cancelled;
    return { date, created, cancelled, net: created - cancelled, cumulative: running };
  });

  const createdTotal = subscriptionSeries.reduce((sum, p) => sum + p.created, 0);
  const cancelledTotal = subscriptionSeries.reduce((sum, p) => sum + p.cancelled, 0);

  const finish = (map: Map<string, ProcessorRow>) =>
    [...map.values()]
      .map((r) => ({ ...r, approvalRate: rate(r.approved, r.attempts) }))
      .filter((r) => r.attempts > 0 || r.refunds > 0)
      .sort((a, b) => b.attempts - a.attempts);

  const declineRows = [...declines.values()]
    .map((d) => ({ ...d, share: rate(d.count, totalTransactions - approvedCount) }))
    .sort((a, b) => b.count - a.count);

  const revenueTotals = revenueSeries.reduce(
    (acc, p) => ({
      total: acc.total + p.total,
      direct: acc.direct + p.direct,
      initial: acc.initial + p.initial,
      recurring: acc.recurring + p.recurring,
      salvage: acc.salvage + p.salvage,
      upsell: acc.upsell + p.upsell,
    }),
    { total: 0, direct: 0, initial: 0, recurring: 0, salvage: 0, upsell: 0 }
  );

  return {
    range: { start, end, label: rangeLabel(start, end) },
    client: filters.client || "Phoenix",
    filters: { stores, processors },
    orderSummary,
    targetCac: filters.targetCac ?? null,
    subscriptionsToMid: 0,
    period: {
      totalTransactions,
      refunds: { count: refundCount, amount: refundAmount, rate: rate(refundCount, approvedCount) },
      chargebacks: {
        count: chargebackCount,
        amount: chargebackAmount,
        rate: rate(chargebackCount, approvedCount),
      },
      voids: { count: voidCount, amount: voidAmount },
      approved: approvedCount,
      approvalRate: rate(approvedCount, totalTransactions),
    },
    month: {
      label: rangeLabel(month.start, month.start),
      start: month.start,
      end: month.end,
      ...monthTotals(rawInMonth),
    },
    lifetime: {
      activeSubscriptions,
      pausedSubscriptions: null,
      subscribersInSalvage: salvageSubscribers.size,
      cancelledSubscriptions,
      neverApproved,
      totalCustomers: snapshot.customers.length,
    },
    revenue: { ...revenueTotals, series: revenueSeries },
    subscriptions: {
      created: createdTotal,
      cancelled: cancelledTotal,
      net: createdTotal - cancelledTotal,
      series: subscriptionSeries,
    },
    checkout: {
      processors: finish(processorRows),
      stores: finish(storeRows),
      declines: declineRows,
    },
    options: {
      stores: [...allStores].sort(),
      processors: [...allProcessors].sort(),
    },
    meta: {
      builtAt: snapshot.builtAt,
      customers: snapshot.customers.length,
      transactions: snapshot.transactions.length,
      durationMs: snapshot.durationMs,
      stale: false,
      coverage: snapshot.coverage,
      complete: snapshot.complete,
    },
  };
}
