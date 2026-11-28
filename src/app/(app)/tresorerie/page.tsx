"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, Landmark, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { reportToday } from "@/lib/report-tz";
import type { TreasuryPeriod, TreasuryReport } from "@/lib/accounting/treasury";

/**
 * Comptabilité › Trésorerie (admin) : ce qui est à Mady (Initial, Recurring,
 * Salvage, Upsell), ce que Reign a encaissé et ce qui est arrivé en banque.
 */

const inputClass = "h-10 w-full rounded-xl border bg-transparent px-3 text-[13px] outline-none transition-shadow focus:ring-2";
const inputStyle = { borderColor: "var(--line)", color: "var(--ink)" } as const;

const usd = (amount: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }).format(amount);
const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDay = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function periodLabel(period: TreasuryPeriod, frequency: TreasuryReport["frequency"]) {
  if (frequency === "monthly") {
    const text = new Date(`${period.start}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return `Semaine du ${day(period.start)} au ${day(period.end)}`;
}

type Report = TreasuryReport & { error?: string };

export default function TreasuryPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [deposit, setDeposit] = useState({ date: reportToday(), amount: "", processor: "", note: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/treasury", { cache: "no-store" });
      const json = (await res.json()) as Report;
      if (!res.ok) throw new Error(json.error ?? "Trésorerie indisponible");
      setReport(json);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Trésorerie indisponible");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 120_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  async function send(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/treasury", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = (await res.json()) as Report;
      if (!res.ok) throw new Error(json.error ?? "Enregistrement impossible");
      setReport(json);
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const totals = report?.totals;
  const processors = report?.processors.length ? report.processors : ["Reign"];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="r-chip">
            <Landmark className="h-3.5 w-3.5" />
            Comptabilité
          </span>
          {report ? <span className="r-chip">{report.frequency === "monthly" ? "Par mois" : "Par semaine"}</span> : null}
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
          Trésorerie
        </h1>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          Ce qui est à toi et ce que Reign t&apos;a viré en banque : période par période.
        </p>
      </div>

      {/* Les trois comptes */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="r-card p-4">
          <p className="r-label flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5" /> À toi · 100 %
          </p>
          <p className="mt-1 text-[24px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
            {totals ? usd(totals.mine) : "…"}
          </p>
          <p className="r-sub mt-0.5">VIP Initial + Recurring + Salvage + Upsell.</p>
        </div>
        <div className="r-card p-4">
          <p className="r-label flex items-center gap-1.5">
            <ArrowDownToLine className="h-3.5 w-3.5" /> Dépôts Reign
          </p>
          <p className="mt-1 text-[24px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
            {totals ? usd(totals.deposits) : "…"}
            <span className="ml-1.5 text-[13px] font-normal" style={{ color: "var(--ink-3)" }}>
              reçus
            </span>
          </p>
          <p className="r-sub mt-0.5">
            {totals ? (
              <>
                Encaissé par les processeurs Reign : <b>{usd(totals.reignCollected)}</b> · pas encore arrivé :{" "}
                <b style={{ color: totals.toReceive > 0 ? "#b45309" : undefined }}>{usd(Math.max(0, totals.toReceive))}</b> (frais et réserve compris)
              </>
            ) : (
              "Chargement…"
            )}
          </p>
        </div>
      </div>

      {/* Noter un dépôt */}
      <div className="r-card space-y-3 p-4 sm:p-5">
        <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
          Noter un dépôt Reign reçu en banque
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[9rem_9rem_1fr_1fr_auto]">
          <label className="block space-y-1.5">
            <span className="r-label">Date du dépôt</span>
            <input type="date" value={deposit.date} onChange={(event) => setDeposit({ ...deposit, date: event.target.value })} className={inputClass} style={inputStyle} />
          </label>
          <label className="block space-y-1.5">
            <span className="r-label">Montant ($)</span>
            <input inputMode="decimal" placeholder="0,00" value={deposit.amount} onChange={(event) => setDeposit({ ...deposit, amount: event.target.value })} className={inputClass} style={inputStyle} />
          </label>
          <label className="block space-y-1.5">
            <span className="r-label">Processeur / MID</span>
            <input list="treasury-processors" placeholder={processors[0]} value={deposit.processor} onChange={(event) => setDeposit({ ...deposit, processor: event.target.value })} className={inputClass} style={inputStyle} />
            <datalist id="treasury-processors">
              {processors.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="block space-y-1.5">
            <span className="r-label">Note</span>
            <input placeholder="ex. payout du 27 oct. au 2 nov." value={deposit.note} onChange={(event) => setDeposit({ ...deposit, note: event.target.value })} className={inputClass} style={inputStyle} />
          </label>
          <button
            type="button"
            disabled={busy || !deposit.amount.trim()}
            onClick={() =>
              void send({ action: "addDeposit", ...deposit, processor: deposit.processor || processors[0] }, "Dépôt noté").then((ok) => ok && setDeposit({ ...deposit, amount: "", note: "" }))
            }
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--r-accent, #233137)" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Ajouter
          </button>
        </div>
      </div>

      {/* Période par période */}
      <div className="space-y-2">
        {(report?.periods ?? []).map((period) => {
          return (
            <div key={period.key} className="r-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                  {periodLabel(period, report?.frequency ?? "weekly")}
                </p>
                {period.current ? <span className="r-chip">En cours</span> : null}
                {period.error ? <span className="r-sub text-[11px]">{period.error}</span> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="r-label">À toi</p>
                  <p className="text-[18px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                    {usd(period.mine.total)}
                  </p>
                  <p className="r-sub text-[11px]">
                    Initial {usd(period.mine.initial)} · Recurring {usd(period.mine.recurring)} · Salvage {usd(period.mine.salvage)}
                    {period.mine.upsell ? ` · Upsell ${usd(period.mine.upsell)}` : ""}
                  </p>
                </div>
                <div>
                  <p className="r-label">Reign</p>
                  <p className="text-[18px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                    {usd(period.deposits)}
                    <span className="ml-1 text-[12px] font-normal" style={{ color: "var(--ink-3)" }}>
                      reçus
                    </span>
                  </p>
                  <p className="r-sub text-[11px]">Encaissé par les processeurs sur la période : {usd(period.reignCollected)}</p>
                </div>
              </div>

            </div>
          );
        })}
        {!report ? (
          <p className="r-sub flex items-center justify-center gap-2 py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Calcul des périodes…
          </p>
        ) : null}
      </div>

      {/* Les dépôts notés */}
      <div className="r-card p-4">
        <p className="mb-2 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
          Dépôts notés
        </p>
        {report?.deposits.length ? (
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {report.deposits.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2">
                <span className="w-24 shrink-0 text-[12.5px] tabular-nums" style={{ color: "var(--ink-2)" }}>
                  {fullDay(entry.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--ink)" }}>
                  {entry.processor}
                  {entry.note ? <span style={{ color: "var(--ink-3)" }}> · {entry.note}</span> : null}
                </span>
                <span className={cn("shrink-0 text-[14px] font-semibold tabular-nums")} style={{ color: "var(--ink)" }}>
                  {usd(entry.amount)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  title="Supprimer"
                  onClick={() => window.confirm("Supprimer ce dépôt ?") && void send({ action: "deleteDeposit", id: entry.id }, "Dépôt supprimé")}
                  className="r-icon h-8 w-8 shrink-0 rounded-full"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="r-sub py-4 text-center">{report ? "Aucun dépôt noté. Ajoute le premier virement Reign au-dessus." : "Chargement…"}</p>
        )}
      </div>
    </div>
  );
}
