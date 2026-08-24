"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InvoiceDocument } from "@/components/invoices/invoice-document";
import { Button } from "@/components/ui/button";
import {
  defaultInvoice,
  formatInvoiceAmount,
  invoiceFileName,
  invoiceTotal,
  newLineId,
  type Invoice,
  type InvoiceLine,
} from "@/lib/invoices/types";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "msgate-invoice-draft";
const ZOOM_KEY = "msgate-invoice-zoom";
const ZOOMS = [0.55, 0.7, 1] as const;

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-600 dark:focus:ring-emerald-900/40";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
      <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {children}
    </section>
  );
}

export default function InvoicesPage() {
  const [invoice, setInvoice] = useState<Invoice>(defaultInvoice);
  const [zoom, setZoom] = useState<number>(0.7);
  const [hydrated, setHydrated] = useState(false);

  // Le brouillon survit à un refresh : une facture se remplit rarement d'un trait.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setInvoice({ ...defaultInvoice(), ...(JSON.parse(raw) as Invoice) });
      const savedZoom = Number(localStorage.getItem(ZOOM_KEY));
      if (ZOOMS.includes(savedZoom as (typeof ZOOMS)[number])) setZoom(savedZoom);
    } catch {
      // brouillon illisible : on garde le modèle par défaut
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(invoice));
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // quota plein : le brouillon n'est pas critique
    }
  }, [invoice, zoom, hydrated]);

  const patch = useCallback((changes: Partial<Invoice>) => {
    setInvoice((current) => ({ ...current, ...changes }));
  }, []);

  const patchBank = useCallback((changes: Partial<Invoice["bank"]>) => {
    setInvoice((current) => ({ ...current, bank: { ...current.bank, ...changes } }));
  }, []);

  function patchLine(id: string, changes: Partial<InvoiceLine>) {
    setInvoice((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === id ? { ...line, ...changes } : line)),
    }));
  }

  function addLine() {
    setInvoice((current) => ({
      ...current,
      lines: [...current.lines, { id: newLineId(), description: "", amount: 0 }],
    }));
  }

  function removeLine(id: string) {
    setInvoice((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((line) => line.id !== id) : current.lines,
    }));
  }

  function reset() {
    if (!confirm("Repartir du modèle vierge ? Les modifications en cours seront perdues.")) return;
    setInvoice(defaultInvoice());
    toast.success("Modèle réinitialisé");
  }

  /** Le navigateur nomme le PDF d'après le titre du document : on le force le temps de l'impression. */
  function print() {
    const previous = document.title;
    document.title = invoiceFileName(invoice);
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  const total = invoiceTotal(invoice.lines);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Facturation
          </h1>
          <p className="text-[12px] text-slate-500">
            Modèle ScaleXReach — change le destinataire, les lignes et les montants, puis exporte en PDF.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </Button>
          <Button size="sm" onClick={print}>
            <Printer className="h-3.5 w-3.5" />
            Imprimer / PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3 print:hidden">
          <Section title="Facture">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date">
                <input
                  type="date"
                  className={inputClass}
                  value={invoice.invoiceDate}
                  onChange={(e) => patch({ invoiceDate: e.target.value })}
                />
              </Field>
              <Field label="Paiement">
                <input
                  className={inputClass}
                  value={invoice.paymentMethod}
                  onChange={(e) => patch({ paymentMethod: e.target.value })}
                />
              </Field>
              <Field label="Période du">
                <input
                  type="date"
                  className={inputClass}
                  value={invoice.serviceFrom}
                  onChange={(e) => patch({ serviceFrom: e.target.value })}
                />
              </Field>
              <Field label="Période au">
                <input
                  type="date"
                  className={inputClass}
                  value={invoice.serviceTo}
                  onChange={(e) => patch({ serviceTo: e.target.value })}
                />
              </Field>
            </div>

            <p className="text-[11px] text-slate-500">
              Le PDF sera nommé{" "}
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {invoiceFileName(invoice)}
              </span>
            </p>
          </Section>

          <Section title="Destinataire (Bill to)">
            <Field label="Société">
              <input
                className={inputClass}
                value={invoice.clientName}
                onChange={(e) => patch({ clientName: e.target.value })}
              />
            </Field>
            <Field label="Adresse">
              <textarea
                rows={2}
                className={cn(inputClass, "resize-y")}
                value={invoice.clientAddress}
                onChange={(e) => patch({ clientAddress: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className={inputClass}
                value={invoice.clientEmail}
                onChange={(e) => patch({ clientEmail: e.target.value })}
              />
            </Field>
          </Section>

          <Section title="Lignes">
            <div className="space-y-2">
              {invoice.lines.map((line) => (
                <div key={line.id} className="flex items-start gap-1.5">
                  <textarea
                    rows={2}
                    placeholder="Description de la prestation"
                    className={cn(inputClass, "min-w-0 flex-1 resize-y")}
                    value={line.description}
                    onChange={(e) => patchLine(line.id, { description: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={cn(inputClass, "w-[86px] shrink-0 tabular-nums")}
                    value={line.amount}
                    onChange={(e) => patchLine(line.id, { amount: Number(e.target.value) || 0 })}
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={invoice.lines.length === 1}
                    className="mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-rose-950/40"
                    aria-label="Supprimer la ligne"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" />
                Ajouter une ligne
              </Button>
              <div className="text-[12px] text-slate-500">
                Total <span className="font-semibold text-slate-900 dark:text-slate-100">{formatInvoiceAmount(total)}</span>
              </div>
            </div>
          </Section>

          <details className="group rounded-2xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
              Émetteur & coordonnées bancaires
              <span className="ml-1 text-[11px] font-normal text-slate-400">(rarement modifié)</span>
            </summary>
            <div className="space-y-2.5 px-3 pb-3">
              <Field label="Marque">
                <input
                  className={inputClass}
                  value={invoice.brandName}
                  onChange={(e) => patch({ brandName: e.target.value })}
                />
              </Field>
              <Field label="Raison sociale">
                <input
                  className={inputClass}
                  value={invoice.issuerLegalName}
                  onChange={(e) => patch({ issuerLegalName: e.target.value })}
                />
              </Field>
              <Field label="Adresse émetteur">
                <textarea
                  rows={2}
                  className={cn(inputClass, "resize-y")}
                  value={invoice.issuerAddress}
                  onChange={(e) => patch({ issuerAddress: e.target.value })}
                />
              </Field>
              <Field label="Email émetteur">
                <input
                  className={inputClass}
                  value={invoice.issuerEmail}
                  onChange={(e) => patch({ issuerEmail: e.target.value })}
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Banque">
                  <input
                    className={inputClass}
                    value={invoice.bank.bankName}
                    onChange={(e) => patchBank({ bankName: e.target.value })}
                  />
                </Field>
                <Field label="Bénéficiaire">
                  <input
                    className={inputClass}
                    value={invoice.bank.beneficiary}
                    onChange={(e) => patchBank({ beneficiary: e.target.value })}
                  />
                </Field>
                <Field label="Account No.">
                  <input
                    className={inputClass}
                    value={invoice.bank.accountNumber}
                    onChange={(e) => patchBank({ accountNumber: e.target.value })}
                  />
                </Field>
                <Field label="ABA Routing">
                  <input
                    className={inputClass}
                    value={invoice.bank.routing}
                    onChange={(e) => patchBank({ routing: e.target.value })}
                  />
                </Field>
                <Field label="SWIFT" className="col-span-2">
                  <input
                    className={inputClass}
                    value={invoice.bank.swift}
                    onChange={(e) => patchBank({ swift: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Adresse banque">
                <textarea
                  rows={2}
                  className={cn(inputClass, "resize-y")}
                  value={invoice.bank.bankAddress}
                  onChange={(e) => patchBank({ bankAddress: e.target.value })}
                />
              </Field>
              <Field label="Adresse bénéficiaire">
                <textarea
                  rows={2}
                  className={cn(inputClass, "resize-y")}
                  value={invoice.bank.beneficiaryAddress}
                  onChange={(e) => patchBank({ beneficiaryAddress: e.target.value })}
                />
              </Field>
            </div>
          </details>
        </div>

        <div className="invoice-preview min-w-0 overflow-x-auto rounded-2xl bg-slate-100/70 p-3 ring-1 ring-slate-900/[0.06] thin-scroll dark:bg-slate-950/50 dark:ring-slate-100/[0.06]">
          <div className="mb-2 flex items-center justify-end gap-1 print:hidden">
            {ZOOMS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setZoom(value)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium tabular-nums transition-colors",
                  zoom === value
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                )}
              >
                {Math.round(value * 100)}%
              </button>
            ))}
          </div>

          {/* `zoom` plutôt qu'un `transform` : il réduit aussi la place occupée dans le flux. */}
          <div
            className="invoice-zoom mx-auto w-fit shadow-[0_10px_40px_-12px_rgba(15,23,42,0.35)]"
            style={{ zoom }}
          >
            <InvoiceDocument invoice={invoice} />
          </div>
        </div>
      </div>
    </div>
  );
}
