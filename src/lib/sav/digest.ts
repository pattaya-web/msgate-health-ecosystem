import { escapeHtml } from "@/lib/sav/telegram";
import type { SavInboxPayload, SavThread, SavThreadReview } from "@/lib/sav/types";

/**
 * Résumé quotidien poussé sur Telegram.
 *
 * Le message ne recopie pas le board : il ne remonte que ce sur quoi il faut
 * agir — les clients qui attendent encore, et les réponses qui sont passées
 * à côté de la question.
 */

/** Un fil sans réponse au-delà de ce délai remonte dans l'alerte. */
export const DEFAULT_ALERT_HOURS = 12;
/** Nombre de lignes par section : au-delà, le message devient illisible. */
const MAX_LINES = 6;

const VERDICT_LABEL = { ok: "OK", partial: "incomplète", off: "à côté" } as const;

export function formatDelay(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} j`;
}

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

function who(thread: { clientName: string; client: string }) {
  return escapeHtml(thread.clientName || thread.client);
}

/** Les fils touchés depuis moins de `hours` heures : le périmètre du digest. */
export function recentThreads(threads: SavThread[], hours: number, now = Date.now()) {
  const floor = now - hours * 60 * 60 * 1000;
  return threads.filter((thread) => Date.parse(thread.lastMessageAt) >= floor);
}

export type DigestInput = {
  payload: SavInboxPayload;
  threads: SavThread[];
  reviews: SavThreadReview[];
  alertHours: number;
  windowHours: number;
  now?: number;
};

export type Digest = { html: string; hasAlerts: boolean };

export function buildDigest({
  payload,
  threads,
  reviews,
  alertHours,
  windowHours,
  now = Date.now(),
}: DigestInput): Digest {
  // Un fil actif aujourd'hui peut traîner des messages plus anciens : le volume
  // se compte message par message, pas fil par fil.
  const floor = now - windowHours * 60 * 60 * 1000;
  const fresh = threads.flatMap((thread) =>
    thread.messages.filter((message) => Date.parse(message.date) >= floor)
  );
  const received = fresh.filter((message) => message.direction === "in").length;
  const sent = fresh.length - received;

  const delays = threads
    .map((thread) => thread.firstReplyMinutes)
    .filter((value): value is number => typeof value === "number" && value >= 0)
    .sort((a, b) => a - b);
  const median = delays.length ? delays[Math.floor(delays.length / 2)] : null;

  const waiting = threads
    .filter((thread) => thread.awaitingReply && (thread.waitingHours ?? 0) >= alertHours)
    .sort((a, b) => (b.waitingHours ?? 0) - (a.waitingHours ?? 0));

  // Les réponses franchement à côté passent devant les réponses incomplètes.
  const flagged = reviews
    .filter((review) => review.worst === "off" || review.worst === "partial")
    .sort((a, b) => Number(b.worst === "off") - Number(a.worst === "off"));

  const lines: string[] = [
    `<b>SAV · ${windowHours} dernières heures</b>`,
    "",
    `📥 ${plural(received, "reçu")} · 📤 ${plural(sent, "envoyé")} · ${plural(threads.length, "fil")} actif${threads.length > 1 ? "s" : ""}`,
    `⏱ 1re réponse (médiane) : ${formatDelay(median)}`,
  ];

  if (waiting.length) {
    lines.push("", `<b>⚠️ Sans réponse depuis plus de ${alertHours} h</b>`);
    for (const thread of waiting.slice(0, MAX_LINES)) {
      lines.push(`• ${who(thread)} — ${thread.waitingHours} h — ${escapeHtml(thread.subject)}`);
    }
    if (waiting.length > MAX_LINES) {
      lines.push(`… et ${plural(waiting.length - MAX_LINES, "autre")}`);
    }
  }

  if (flagged.length) {
    lines.push("", "<b>🔎 Réponses à revoir</b>");
    for (const review of flagged.slice(0, MAX_LINES)) {
      const worst = review.exchanges.find((exchange) => exchange.verdict === review.worst);
      const label = review.worst ? VERDICT_LABEL[review.worst] : "";
      lines.push(
        `• ${who(review)} (${label}) — ${escapeHtml(worst?.reason || review.subject)}`
      );
    }
    if (flagged.length > MAX_LINES) {
      lines.push(`… et ${plural(flagged.length - MAX_LINES, "autre")}`);
    }
  }

  if (!waiting.length && !flagged.length) {
    lines.push("", "✅ Rien à signaler : tout le monde a eu une réponse cohérente.");
  }

  if (payload.warnings.length) {
    lines.push("", ...payload.warnings.map((warning) => `⚙️ ${escapeHtml(warning)}`));
  }

  return {
    html: lines.join("\n"),
    hasAlerts: waiting.length > 0 || flagged.length > 0,
  };
}
