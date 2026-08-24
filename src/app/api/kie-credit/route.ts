import { NextResponse } from "next/server";
import { getKieCredit } from "@/lib/studio/kie";

export const dynamic = "force-dynamic";

/**
 * Kie ne publie pas son taux de change via l'API : la conversion en dollars
 * n'est faite que si le tarif payé est renseigné dans .env.local, sinon on
 * affiche les crédits seuls plutôt qu'un montant inventé.
 */
function usdPerCredit() {
  const rate = Number(process.env.KIE_USD_PER_CREDIT);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function GET() {
  try {
    const credits = await getKieCredit();
    const rate = usdPerCredit();
    return NextResponse.json({ credits, usd: rate ? credits * rate : null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Solde Kie illisible" },
      { status: 502 }
    );
  }
}
