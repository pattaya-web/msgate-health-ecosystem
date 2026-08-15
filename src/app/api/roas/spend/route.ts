import { NextResponse } from "next/server";
import { getSpendRange, setSpend, setSpendBulk } from "@/lib/metrics/spend-store";

export const dynamic = "force-dynamic";

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!isDate(start) || !isDate(end)) {
    return NextResponse.json({ error: "start et end requis au format YYYY-MM-DD" }, { status: 400 });
  }
  const entries = await getSpendRange(start, end);
  return NextResponse.json({ ok: true, entries: Object.fromEntries(entries) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      date?: string;
      amount?: number;
      entries?: Array<{ date: string; amount: number }>;
    };

    if (Array.isArray(body.entries)) {
      const count = await setSpendBulk(body.entries);
      return NextResponse.json({ ok: true, stored: count });
    }

    if (!isDate(body.date) || typeof body.amount !== "number") {
      return NextResponse.json(
        { error: "Attendu { date: 'YYYY-MM-DD', amount: number } ou { entries: [...] }" },
        { status: 400 }
      );
    }

    const entry = await setSpend({ date: body.date, amount: body.amount });
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Spend save failed" },
      { status: 400 }
    );
  }
}
