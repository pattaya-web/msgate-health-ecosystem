import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { deleteSupplierGrid, getSupplierGrids, saveSupplierGrid } from "@/lib/metrics/supplier-grid";

export const dynamic = "force-dynamic";

/** La grille fournisseur (coût du colis par nombre de colliers) : réservée à l'admin. */
export async function GET(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  return NextResponse.json({ ok: true, ...(await getSupplierGrids()) });
}

export async function POST(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  let body: { action?: string; id?: string; label?: string; fromOrder?: unknown; fromDate?: unknown; prices?: unknown; extraPerUnit?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  try {
    const config =
      body.action === "delete"
        ? await deleteSupplierGrid(body.id)
        : await saveSupplierGrid({
            id: body.id || undefined,
            label: body.label,
            fromOrder: body.fromOrder,
            fromDate: body.fromDate,
            prices: body.prices,
            extraPerUnit: body.extraPerUnit,
          });
    return NextResponse.json({ ok: true, ...config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enregistrement impossible" }, { status: 400 });
  }
}
