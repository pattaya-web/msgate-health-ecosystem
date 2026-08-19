import { NextResponse } from "next/server";
import { DEFAULT_ALERT_HOURS, buildDigest, recentThreads } from "@/lib/sav/digest";
import { isSavConfigured } from "@/lib/sav/imap";
import { isReviewable, reviewMany } from "@/lib/sav/review";
import { getSavInbox } from "@/lib/sav/store";
import { isTelegramConfigured, sendTelegram } from "@/lib/sav/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Digest quotidien — appelé par le cron Vercel (cf. vercel.json).
 *
 * Personne n'est devant l'écran quand il tourne : il lit la boîte, fait juger
 * les échanges de la journée, et pousse le résultat sur Telegram.
 */

/** Deux jours UTC pour couvrir 24 h glissantes quelle que soit l'heure de tir. */
function digestRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Plafond d'analyses par digest : une journée de SAV tient largement dedans. */
const MAX_REVIEWS = 30;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Sans secret, l'URL serait publique et déclencherait des appels Claude.
    return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 503 });
  }
  const offered =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-cron-secret")?.trim();
  if (offered !== secret) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!isSavConfigured()) {
    return NextResponse.json({ error: "SAV non configuré" }, { status: 503 });
  }
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "Telegram non configuré" }, { status: 503 });
  }

  const windowHours = positiveNumber(process.env.SAV_DIGEST_WINDOW_HOURS, 24);
  const alertHours = positiveNumber(process.env.SAV_ALERT_HOURS, DEFAULT_ALERT_HOURS);
  const onlyAlerts = process.env.SAV_DIGEST_ONLY_ALERTS === "1";

  try {
    const range = digestRange();
    const payload = await getSavInbox({ ...range, force: true });
    const threads = recentThreads(payload.threads, windowHours);

    const { reviews, failed } = await reviewMany(
      threads.filter(isReviewable).slice(0, MAX_REVIEWS)
    );

    const digest = buildDigest({ payload, threads, reviews, alertHours, windowHours });
    const sent = digest.hasAlerts || !onlyAlerts;
    if (sent) await sendTelegram(digest.html);

    return NextResponse.json({
      sent,
      threads: threads.length,
      reviewed: reviews.length,
      failed,
      hasAlerts: digest.hasAlerts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Digest indisponible" },
      { status: 502 }
    );
  }
}
