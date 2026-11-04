import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { setEntityBudget, setEntityName, setEntityStatus } from "@/lib/meta/write";
import { OutOfScopeError, assertObjectsInScope, associateAccountsFor } from "@/lib/associate/meta-access";
import type { EntityLevel } from "@/lib/meta/types";
import { sessionFromRequest } from "@/lib/auth/request";
import { appendJournal, snapshotEntity, type JournalAction } from "@/lib/pilotage/journal";
import { knownAccounts } from "@/lib/associate/meta-fast";

export const dynamic = "force-dynamic";

const LEVELS: EntityLevel[] = ["campaign", "adset", "ad"];

/** Note le changement dans le journal de la page Pilotage (sans jamais faire échouer la modification). */
async function journal(
  request: Request,
  body: { id: string; level: EntityLevel; source?: string; reason?: string },
  action: JournalAction,
  before: Awaited<ReturnType<typeof snapshotEntity>>,
  after: string | number
) {
  try {
    const accounts = await knownAccounts().then((known) => known.list).catch(() => []);
    const account = accounts.find((row) => row.accountId === before?.accountId);
    await appendJournal({
      who: sessionFromRequest(request)?.email ?? "?",
      action,
      level: body.level,
      objectId: body.id,
      objectName: before?.name ?? body.id,
      campaignId: before?.campaignId ?? null,
      campaignName: before?.campaignName ?? "",
      accountId: before?.accountId ?? null,
      before: action === "budget" ? (before?.dailyBudget ?? null) : action === "status" ? (before?.status ?? null) : (before?.name ?? null),
      after,
      currency: action === "budget" ? (account?.currency ?? null) : null,
      source: body.source === "pilotage" ? "pilotage" : body.source === "rampe" ? "rampe" : body.source === "pipeline" ? "pipeline" : "ads",
      note: typeof body.reason === "string" ? body.reason.slice(0, 300) : "",
    });
  } catch {
    // Le journal ne bloque jamais une modification déjà faite chez Meta.
  }
}

export async function POST(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      id?: string;
      level?: EntityLevel;
      status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
      dailyBudget?: number;
      name?: string;
      /** « pilotage » quand le changement vient d'un bouton de la page Pilotage. */
      source?: string;
      /** La règle qui a motivé le changement (affichée dans le journal). */
      reason?: string;
    };

    if (!body.id || !body.level || !LEVELS.includes(body.level)) {
      return NextResponse.json(
        { error: "Attendu { id, level: 'campaign'|'adset'|'ad', status?, dailyBudget?, name? }" },
        { status: 400 }
      );
    }

    // Associé : l'objet doit appartenir à un de ses comptes pub (vérifié auprès de Meta).
    const scoped = await associateAccountsFor(request);
    if (scoped) await assertObjectsInScope([body.id], scoped);

    const target = { id: body.id, level: body.level, source: body.source, reason: body.reason };
    const before = await snapshotEntity(body.id, body.level);

    if (typeof body.name === "string") {
      const result = await setEntityName({ id: body.id, level: body.level, name: body.name });
      await journal(request, target, "rename", before, body.name);
      return NextResponse.json({ ok: true, ...result });
    }

    if (body.status) {
      if (body.status !== "ACTIVE" && body.status !== "PAUSED" && body.status !== "ARCHIVED") {
        return NextResponse.json({ error: "status doit être ACTIVE, PAUSED ou ARCHIVED" }, { status: 400 });
      }
      const result = await setEntityStatus({ id: body.id, level: body.level, status: body.status });
      await journal(request, target, "status", before, body.status);
      return NextResponse.json({ ok: true, ...result });
    }

    if (typeof body.dailyBudget === "number") {
      if (body.level === "ad") {
        return NextResponse.json(
          { error: "Un budget se règle sur la campagne (CBO) ou l'ad set (ABO), pas sur une publicité." },
          { status: 400 }
        );
      }
      const result = await setEntityBudget({
        id: body.id,
        level: body.level,
        dailyBudget: body.dailyBudget,
      });
      await journal(request, target, "budget", before, body.dailyBudget);
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "Rien à modifier : fournis status, dailyBudget ou name." }, { status: 400 });
  } catch (error) {
    if (error instanceof OutOfScopeError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mise à jour impossible" },
      { status: 502 }
    );
  }
}
