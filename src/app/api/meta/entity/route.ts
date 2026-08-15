import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { setEntityBudget, setEntityStatus } from "@/lib/meta/write";
import type { EntityLevel } from "@/lib/meta/types";

export const dynamic = "force-dynamic";

const LEVELS: EntityLevel[] = ["campaign", "adset", "ad"];

export async function POST(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      id?: string;
      level?: EntityLevel;
      status?: "ACTIVE" | "PAUSED";
      dailyBudget?: number;
    };

    if (!body.id || !body.level || !LEVELS.includes(body.level)) {
      return NextResponse.json(
        { error: "Attendu { id, level: 'campaign'|'adset'|'ad', status? , dailyBudget? }" },
        { status: 400 }
      );
    }

    if (body.status) {
      if (body.status !== "ACTIVE" && body.status !== "PAUSED") {
        return NextResponse.json({ error: "status doit être ACTIVE ou PAUSED" }, { status: 400 });
      }
      const result = await setEntityStatus({ id: body.id, level: body.level, status: body.status });
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
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "Rien à modifier : fournis status ou dailyBudget." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mise à jour impossible" },
      { status: 502 }
    );
  }
}
