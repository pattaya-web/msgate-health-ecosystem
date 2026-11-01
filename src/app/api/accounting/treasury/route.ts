import { NextResponse } from "next/server";
import { addDeposit, buildTreasuryReport, deleteDeposit } from "@/lib/accounting/treasury";
import { updatePartnership } from "@/lib/associate/partnership";
import { sessionFromRequest } from "@/lib/auth/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Trésorerie : réservée à l'admin (l'associée ne voit ni les abonnements ni les dépôts). */
export async function GET(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await buildTreasuryReport()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trésorerie indisponible" }, { status: 502 });
  }
}

type Body = {
  action?: string;
  id?: unknown;
  date?: unknown;
  amount?: unknown;
  processor?: unknown;
  note?: unknown;
  key?: unknown;
  method?: unknown;
};

/** Noter / retirer un dépôt Reign, enregistrer / annuler un versement à Alison (rangé dans MoneyTalk). */
export async function POST(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  try {
    if (body.action === "addDeposit") await addDeposit(body);
    else if (body.action === "deleteDeposit") await deleteDeposit(body.id);
    else if (body.action === "payAlison") {
      const amount = Number(String(body.amount ?? "").replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Montant du versement invalide");
      await updatePartnership({ markPaid: { key: body.key, amount, method: body.method, date: body.date, note: body.note } }, "admin");
    } else if (body.action === "unpayAlison") await updatePartnership({ markPaid: { key: body.key, paid: false } }, "admin");
    else return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enregistrement impossible" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...(await buildTreasuryReport()) });
}
