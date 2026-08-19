import { NextResponse } from "next/server";
import { isSavConfigured } from "@/lib/sav/imap";
import { findCachedReview, isReviewable, reviewMany, reviewThread } from "@/lib/sav/review";
import { findCachedThread, getSavInbox } from "@/lib/sav/store";
import type { SavThreadReview } from "@/lib/sav/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Analyse à la demande : un fil précis, ou tous les fils de la période affichée. */

/** Plafond par lot — au-delà, l'analyse dépasserait la durée de la requête. */
const MAX_BATCH = 20;

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function POST(request: Request) {
  if (!isSavConfigured()) {
    return NextResponse.json({ error: "SAV non configuré" }, { status: 503 });
  }

  let body: { threadId?: string; start?: string; end?: string; force?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  try {
    if (body.threadId) {
      const thread = findCachedThread(body.threadId);
      if (!thread) {
        return NextResponse.json(
          { error: "Fil introuvable — recharge la boîte SAV." },
          { status: 404 }
        );
      }
      return NextResponse.json({ reviews: [await reviewThread(thread, { force: body.force })] });
    }

    if (!isDate(body.start) || !isDate(body.end)) {
      return NextResponse.json({ error: "Période manquante ou invalide" }, { status: 400 });
    }

    const inbox = await getSavInbox({ start: body.start, end: body.end });
    const candidates = inbox.threads.filter(isReviewable);
    // Les fils déjà jugés et inchangés ne consomment pas de place dans le lot.
    const pending = body.force
      ? candidates
      : candidates.filter((thread) => !findCachedReview(thread));

    const { reviews, failed } = await reviewMany(pending.slice(0, MAX_BATCH), {
      force: body.force,
    });
    const cached = body.force
      ? []
      : candidates
          .map((thread) => findCachedReview(thread))
          .filter((review): review is SavThreadReview => Boolean(review));

    // Un même fil ne peut pas être à la fois relu et servi depuis le cache.
    const seen = new Set(reviews.map((review) => review.threadId));
    return NextResponse.json({
      reviews: [...reviews, ...cached.filter((review) => !seen.has(review.threadId))],
      remaining: Math.max(0, pending.length - MAX_BATCH),
      failed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analyse indisponible" },
      { status: 502 }
    );
  }
}
