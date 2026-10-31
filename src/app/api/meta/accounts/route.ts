import { NextResponse } from "next/server";
import { getMetaDailySpend, isMetaConfigured } from "@/lib/meta/client";
import { BUCKET_LABELS, parseBucketFilter } from "@/lib/meta/buckets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function defaultRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

import { associateAccountsFor } from "@/lib/associate/meta-access";
import { REPORT_CURRENCY } from "@/lib/fx";

export async function GET(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json(
      { error: "Meta not configured — set META_ACCESS_TOKENS in .env.local" },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const fallback = defaultRange();
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const data = await getMetaDailySpend({
      start: isDate(start) ? start : fallback.start,
      end: isDate(end) ? end : fallback.end,
      buckets: parseBucketFilter(searchParams.get("buckets")),
      force: searchParams.get("refresh") === "1",
      // Associé : ses comptes seulement ; montants convertis en dollars pour les mettre face aux ventes.
      onlyAccounts: (await associateAccountsFor(request)) ?? undefined,
      convertTo: searchParams.get("convert") === "0" ? undefined : REPORT_CURRENCY,
    });

    return NextResponse.json({
      ok: true,
      range: data.range,
      labels: BUCKET_LABELS,
      byBucket: data.byBucket,
      byDate: Object.fromEntries(data.byDate),
      accounts: data.accounts,
      campaigns: data.campaigns,
      currencies: data.currencies,
      conversion: data.conversion,
      tokensTotal: data.tokensTotal,
      tokensWorking: data.tokensWorking,
      errors: data.errors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Meta fetch failed" },
      { status: 502 }
    );
  }
}
