import { NextResponse } from "next/server";
import { fetchAlerts, fetchMerchants, parseTypes } from "@/lib/disputifier/client";
import { NO_MID, sumTotals, summarizeByMid, type AlertsResponse } from "@/lib/disputifier/types";

export const dynamic = "force-dynamic";

const MAX_ROWS = 1500;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get("start") || undefined;
  const end = url.searchParams.get("end") || undefined;
  const merchantFilter = url.searchParams.get("merchant");
  const midFilter = url.searchParams.get("mid");
  const types = parseTypes(url.searchParams.get("type"));
  // Par défaut on n'affiche que l'attribution de Disputifier, pour rester réconciliable
  // avec ce que le portail affiche MID par MID.
  const inferMids = url.searchParams.get("infer") === "1";

  try {
    const { merchants, errors } = await fetchMerchants(url.searchParams.get("refresh") === "1");
    const scoped =
      merchantFilter && merchantFilter !== "all"
        ? merchants.filter((merchant) => merchant.merchantId === merchantFilter)
        : merchants;

    const result = await fetchAlerts({
      merchants: scoped,
      types,
      startdate: start,
      enddate: end,
      inferMids,
    });

    // Le MID n'est pas un paramètre de l'API Disputifier : le tri se fait après coup.
    const filtered =
      midFilter && midFilter !== "all"
        ? result.alerts.filter((alert) =>
            midFilter === NO_MID ? !alert.midId : alert.midId === midFilter
          )
        : result.alerts;

    // Les totaux se calculent sur l'intégralité des alertes, la table est plafonnée.
    const body: AlertsResponse = {
      alerts: filtered.slice(0, MAX_ROWS),
      totals: sumTotals(filtered),
      byMid: summarizeByMid(filtered),
      merchants,
      errors: [...errors, ...result.errors],
      truncated: result.truncated || filtered.length > MAX_ROWS,
    };

    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Disputifier injoignable" },
      { status: 502 }
    );
  }
}
