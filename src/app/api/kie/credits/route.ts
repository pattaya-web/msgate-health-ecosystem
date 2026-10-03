import { NextResponse } from "next/server";
import { getCredits, KieError } from "@/lib/kie";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { creditUsdRate, usdToEur } = getSettings();
  try {
    const credits = await getCredits();
    return NextResponse.json({
      credits,
      usd: credits * creditUsdRate,
      eur: credits * creditUsdRate * usdToEur,
      rate: creditUsdRate,
    });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json(
      { error: err.message, credits: null, usd: null, eur: null, rate: creditUsdRate },
      { status: err.code === 401 ? 401 : 502 },
    );
  }
}
