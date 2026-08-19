import { looksLikeRefund, normalizeSubject } from "@/lib/sav/imap";
import type { SavDayStat, SavMessage, SavMetrics, SavThread } from "@/lib/sav/types";

/**
 * Regroupement en fils.
 *
 * Les en-têtes de threading (References / In-Reply-To) sont peu fiables dès
 * qu'un webmail réécrit le sujet, donc la clé retenue est
 * « adresse du client + sujet normalisé » : sur une boîte SAV, un même client
 * n'a presque jamais deux sujets identiques ouverts en parallèle.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function threadKey(message: SavMessage) {
  return `${message.client}::${normalizeSubject(message.subject)}`;
}

export function buildThreads(messages: SavMessage[]): SavThread[] {
  const groups = new Map<string, SavMessage[]>();

  for (const message of messages) {
    const key = threadKey(message);
    const bucket = groups.get(key);
    if (bucket) bucket.push(message);
    else groups.set(key, [message]);
  }

  const now = Date.now();
  const threads: SavThread[] = [];

  for (const [key, group] of groups) {
    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const inbound = ordered.filter((m) => m.direction === "in");
    const outbound = ordered.filter((m) => m.direction === "out");

    const first = inbound[0] ?? ordered[0];
    const last = ordered[ordered.length - 1];

    // Première réponse postérieure au premier message client.
    const firstReply = outbound.find((m) => m.date > first.date);
    const firstReplyMinutes = firstReply
      ? Math.round((Date.parse(firstReply.date) - Date.parse(first.date)) / MINUTE_MS)
      : null;

    const awaitingReply = last.direction === "in";
    const waitingHours = awaitingReply
      ? Math.round(((now - Date.parse(last.date)) / HOUR_MS) * 10) / 10
      : null;

    const named = ordered.find((m) => m.clientName)?.clientName || "";
    const refundHint = ordered.some((m) =>
      looksLikeRefund(`${m.subject} ${m.preview || ""} ${m.body || ""}`)
    );

    threads.push({
      id: Buffer.from(key).toString("base64url"),
      client: first.client,
      clientName: named,
      subject: first.subject,
      messages: ordered,
      firstInboundAt: first.date,
      lastMessageAt: last.date,
      lastDirection: last.direction,
      inboundCount: inbound.length,
      outboundCount: outbound.length,
      firstReplyMinutes,
      awaitingReply,
      waitingHours,
      refundHint,
    });
  }

  return threads.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function eachDay(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (cursor <= stop) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function buildMetrics(
  threads: SavThread[],
  messages: SavMessage[],
  range: { start: string; end: string }
): SavMetrics {
  const byDay = new Map<string, SavDayStat>();
  for (const date of eachDay(range.start, range.end)) {
    byDay.set(date, { date, received: 0, sent: 0 });
  }

  for (const message of messages) {
    const day = message.date.slice(0, 10);
    const row = byDay.get(day);
    if (!row) continue;
    if (message.direction === "in") row.received += 1;
    else row.sent += 1;
  }

  const days = [...byDay.values()];
  const totalReceived = days.reduce((sum, day) => sum + day.received, 0);
  const totalSent = days.reduce((sum, day) => sum + day.sent, 0);
  const activeDays = days.filter((day) => day.sent > 0).length;

  const replyDelays = threads
    .map((thread) => thread.firstReplyMinutes)
    .filter((value): value is number => typeof value === "number" && value >= 0);

  return {
    range,
    totalReceived,
    totalSent,
    threads: threads.length,
    awaiting: threads.filter((thread) => thread.awaitingReply).length,
    medianFirstReplyMinutes: median(replyDelays),
    slowestFirstReplyMinutes: replyDelays.length ? Math.max(...replyDelays) : null,
    activeDays,
    avgSentPerActiveDay: activeDays ? Math.round((totalSent / activeDays) * 10) / 10 : 0,
    byDay: days,
  };
}
