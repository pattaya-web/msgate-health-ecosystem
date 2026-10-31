import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { buildAdsTree, isDatePreset, restrictTreeToAccounts } from "@/lib/meta/tree";
import { associateAccountsFor } from "@/lib/associate/meta-access";
import { REPORT_CURRENCY, fxRates } from "@/lib/fx";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

export async function GET(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json(
      { error: "Meta not configured — set META_ACCESS_TOKENS in .env.local" },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawPreset = searchParams.get("preset");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const preset = isDatePreset(rawPreset)
      ? rawPreset
      : isDate(start) && isDate(end)
        ? ("custom" as const)
        : ("today" as const);

    const full = await buildAdsTree({
      preset,
      start: isDate(start) ? start : undefined,
      end: isDate(end) ? end : undefined,
      force: searchParams.get("refresh") === "1",
    });

    // Associé : ses comptes seulement, rien des autres Business Managers.
    const scoped = await associateAccountsFor(request);
    const tree = scoped ? restrictTreeToAccounts(full, scoped) : full;
    // Les taux vers le dollar, pour comparer la dépense (souvent en euros) aux ventes Shopify.
    const rates = await fxRates(tree.currencies, REPORT_CURRENCY);
    const fx = Object.fromEntries([...rates.entries()].map(([currency, rate]) => [currency, rate.rate]));
    return NextResponse.json({ ok: true, ...tree, fx, reportCurrency: REPORT_CURRENCY });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Meta sync failed" },
      { status: 502 }
    );
  }
}
