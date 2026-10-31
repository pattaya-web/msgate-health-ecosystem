import { NextResponse } from "next/server";
import {
  ALLOWED_TYPES,
  MAX_INVOICE_BYTES,
  addInvoice,
  deleteInvoice,
  isDay,
  listInvoices,
  updateInvoice,
} from "@/lib/accounting/supplier-invoices";
import { appUserFor } from "@/lib/auth/session";
import { sessionFromRequest } from "@/lib/auth/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Comptabilité › Factures : la liste des factures fournisseurs, commune à Mady et Alison. */
export async function GET() {
  return NextResponse.json({ invoices: await listInvoices() });
}

const amountOf = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};

/**
 * Ajout : formulaire multipart (file, invoiceDate, periodStart, periodEnd, amount, currency).
 * Modification / suppression : JSON { action: "update" | "delete", id, … }.
 */
export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });

  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Ajoute le PDF de la facture" }, { status: 400 });
    if (file.size > MAX_INVOICE_BYTES) return NextResponse.json({ error: "Fichier trop lourd (25 Mo max)" }, { status: 400 });
    const contentType = file.type || "application/pdf";
    if (!ALLOWED_TYPES.includes(contentType)) return NextResponse.json({ error: "PDF ou image seulement" }, { status: 400 });
    const invoiceDate = form.get("invoiceDate");
    const periodStart = form.get("periodStart");
    const periodEnd = form.get("periodEnd");
    const amount = amountOf(form.get("amount"));
    if (!isDay(invoiceDate)) return NextResponse.json({ error: "Indique la date de la facture" }, { status: 400 });
    if (!isDay(periodStart) || !isDay(periodEnd) || periodStart > periodEnd) return NextResponse.json({ error: "Indique la période payée (du… au…)" }, { status: 400 });
    if (amount === null) return NextResponse.json({ error: "Indique le montant" }, { status: 400 });
    const currency = String(form.get("currency") || "EUR").toUpperCase() === "USD" ? "USD" : "EUR";
    await addInvoice({
      label: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Facture",
      fileName: file.name.slice(0, 200),
      contentType,
      invoiceDate,
      periodStart,
      periodEnd,
      amount,
      currency,
      addedBy: appUserFor(session).full_name,
      data: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ invoices: await listInvoices() });
  }

  let body: { action?: unknown; id?: unknown; label?: unknown; invoiceDate?: unknown; periodStart?: unknown; periodEnd?: unknown; amount?: unknown; currency?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  if (typeof body.id !== "string") return NextResponse.json({ error: "Facture introuvable" }, { status: 400 });
  if (body.action === "delete") {
    if (!(await deleteInvoice(body.id))) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
  } else if (body.action === "update") {
    const patch: Parameters<typeof updateInvoice>[1] = {};
    if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim().slice(0, 120);
    if (isDay(body.invoiceDate)) patch.invoiceDate = body.invoiceDate;
    if (isDay(body.periodStart)) patch.periodStart = body.periodStart;
    if (isDay(body.periodEnd)) patch.periodEnd = body.periodEnd;
    if (body.amount !== undefined) {
      const amount = amountOf(body.amount);
      if (amount === null) return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
      patch.amount = amount;
    }
    if (body.currency === "EUR" || body.currency === "USD") patch.currency = body.currency;
    if (!(await updateInvoice(body.id, patch))) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
  } else {
    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  }
  return NextResponse.json({ invoices: await listInvoices() });
}
