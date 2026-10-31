"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Receipt, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { reportToday } from "@/lib/report-tz";
import type { SupplierInvoice } from "@/lib/accounting/supplier-invoices";

/**
 * Comptabilité › Factures : les factures fournisseurs qu'on paie, pour tout
 * tracer. On glisse le PDF, on indique la date de la facture, la période
 * qu'elle couvre (du… au…) et le montant. Liste commune à Mady et Alison.
 */

const inputClass = "h-10 w-full rounded-xl border bg-transparent px-3 text-[13px] outline-none transition-shadow focus:ring-2";
const inputStyle = { borderColor: "var(--line)", color: "var(--ink)" } as const;

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(amount);
const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

function monthBounds() {
  const today = reportToday();
  const [year, month] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { today, first: `${today.slice(0, 7)}-01`, last };
}

type Draft = { file: File; invoiceDate: string; periodStart: string; periodEnd: string; amount: string; currency: "EUR" | "USD" };

export default function SupplierInvoicesPage() {
  const [invoices, setInvoices] = useState<SupplierInvoice[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/accounting/invoices", { cache: "no-store" });
        const json = (await res.json()) as { invoices?: SupplierInvoice[] };
        if (alive && json.invoices) setInvoices(json.invoices);
      } catch {
        // Le prochain passage réessaiera.
      }
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const pick = useCallback((file: File | undefined) => {
    if (!file) return;
    const { today, first, last } = monthBounds();
    setDraft({ file, invoiceDate: today, periodStart: first, periodEnd: last, amount: "", currency: "EUR" });
  }, []);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", draft.file);
      form.set("invoiceDate", draft.invoiceDate);
      form.set("periodStart", draft.periodStart);
      form.set("periodEnd", draft.periodEnd);
      form.set("amount", draft.amount);
      form.set("currency", draft.currency);
      const res = await fetch("/api/accounting/invoices", { method: "POST", body: form });
      const json = (await res.json()) as { invoices?: SupplierInvoice[]; error?: string };
      if (!res.ok || !json.invoices) throw new Error(json.error ?? "Enregistrement impossible");
      setInvoices(json.invoices);
      setDraft(null);
      toast.success("Facture ajoutée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove(invoice: SupplierInvoice) {
    if (!window.confirm(`Supprimer « ${invoice.label} » pour vous deux ?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/invoices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id: invoice.id }) });
      const json = (await res.json()) as { invoices?: SupplierInvoice[]; error?: string };
      if (!res.ok || !json.invoices) throw new Error(json.error ?? "Suppression impossible");
      setInvoices(json.invoices);
      toast.success("Facture supprimée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  const totals = (invoices ?? []).reduce<Record<string, number>>((acc, invoice) => {
    acc[invoice.currency] = (acc[invoice.currency] ?? 0) + invoice.amount;
    return acc;
  }, {});

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="r-chip">
            <Receipt className="h-3.5 w-3.5" />
            Comptabilité
          </span>
          {invoices ? <span className="r-chip">{invoices.length} facture(s)</span> : null}
          {Object.entries(totals).map(([currency, total]) => (
            <span key={currency} className="r-chip">
              Total {money(total, currency)}
            </span>
          ))}
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
          Factures
        </h1>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          Toutes les factures fournisseurs qu&apos;on paie : le PDF, sa date, la période payée et le montant.
        </p>
      </div>

      {draft ? (
        <div className="r-card space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="r-icon h-10 w-10 shrink-0 rounded-xl">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
                {draft.file.name}
              </p>
              <p className="r-sub">{(draft.file.size / 1024).toFixed(0)} Ko</p>
            </div>
            <button type="button" className="r-icon h-9 w-9 shrink-0 rounded-full" title="Annuler" onClick={() => setDraft(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block space-y-1.5">
              <span className="r-label">Date de la facture</span>
              <input type="date" value={draft.invoiceDate} onChange={(event) => setDraft({ ...draft, invoiceDate: event.target.value })} className={inputClass} style={inputStyle} />
            </label>
            <label className="block space-y-1.5">
              <span className="r-label">Période payée · du</span>
              <input type="date" value={draft.periodStart} onChange={(event) => setDraft({ ...draft, periodStart: event.target.value })} className={inputClass} style={inputStyle} />
            </label>
            <label className="block space-y-1.5">
              <span className="r-label">au</span>
              <input type="date" value={draft.periodEnd} onChange={(event) => setDraft({ ...draft, periodEnd: event.target.value })} className={inputClass} style={inputStyle} />
            </label>
            <label className="block space-y-1.5">
              <span className="r-label">Montant</span>
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={draft.amount}
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                  className={cn(inputClass, "min-w-0 flex-1")}
                  style={inputStyle}
                />
                <select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as "EUR" | "USD" })} className={cn(inputClass, "w-20 shrink-0")} style={inputStyle}>
                  <option value="EUR">€</option>
                  <option value="USD">$</option>
                </select>
              </div>
            </label>
          </div>
          <button
            type="button"
            disabled={busy || !draft.amount.trim()}
            onClick={() => void save()}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold text-white transition-opacity disabled:opacity-50 sm:w-auto sm:px-6"
            style={{ background: "var(--r-accent, #233137)" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Enregistrer la facture
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => picker.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files?.[0]);
          }}
          className={cn("r-card flex w-full flex-col items-center gap-2 border-2 border-dashed px-4 py-10 text-center transition-colors", dragging && "opacity-80")}
          style={{ borderColor: dragging ? "var(--r-accent, #233137)" : undefined }}
        >
          <span className="r-icon h-12 w-12 rounded-full">
            <Upload className="h-5 w-5" />
          </span>
          <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            Glisse le PDF de la facture ici
          </span>
          <span className="r-sub">ou touche pour choisir un fichier · PDF ou photo, 25 Mo max</span>
        </button>
      )}
      <input ref={picker} type="file" accept="application/pdf,image/*" className="hidden" onChange={(event) => pick(event.target.files?.[0] ?? undefined)} />

      <div className="space-y-2">
        {(invoices ?? []).map((invoice) => (
          <div key={invoice.id} className="r-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <a
              href={`/api/accounting/invoices/file?id=${invoice.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 flex-1 items-center gap-3"
              title="Ouvrir la facture"
            >
              <span className="r-icon h-10 w-10 shrink-0 rounded-xl">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
                  {invoice.label}
                </span>
                <span className="r-sub block">
                  Facture du {day(invoice.invoiceDate)} · ajoutée par {invoice.addedBy}
                </span>
              </span>
            </a>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className="r-sub text-[12px]">
                {day(invoice.periodStart)} → {day(invoice.periodEnd)}
              </span>
              <span className="text-[15px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                {money(invoice.amount, invoice.currency)}
              </span>
              <button type="button" disabled={busy} className="r-icon h-9 w-9 shrink-0 rounded-full" title="Supprimer" onClick={() => void remove(invoice)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {invoices && !invoices.length ? <p className="r-sub py-8 text-center">Pas encore de facture. Glisse un PDF au-dessus.</p> : null}
        {!invoices ? <p className="r-sub py-8 text-center">Chargement…</p> : null}
      </div>
    </div>
  );
}
