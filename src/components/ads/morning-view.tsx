"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Morning, MorningCreative } from "@/lib/metrics/morning";
import type { RampRow } from "@/lib/metrics/scaling-ramp";

/**
 * L'onglet « Matin » de l'Ads Manager : une ligne de chiffres, les actions de
 * la rampe qui ont un bouton, les créas à couper (lecture 3 j), le rappel du
 * jour. Tient sur un écran ; le reste est dans l'onglet Ads Manager.
 */

const GREEN = "#15803d";
const ORANGE = "#b45309";
const RED = "#e11d48";

const eur = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} €`;
const usd = (value: number | null) => (value == null ? "—" : `${value < 0 ? "−" : ""}${Math.round(Math.abs(value)).toLocaleString("fr-FR")} $`);
const num = (value: number | null, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));

function readAggressive() {
  try {
    return localStorage.getItem("msgate-ramp-aggressive") !== "0";
  } catch {
    return true;
  }
}

export function MorningView({ onApplied }: { onApplied?: (level: "campaign" | "adset", id: string, patch: { dailyBudget?: number; status?: "PAUSED" }) => void }) {
  const [data, setData] = useState<Morning | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/metrics/morning?aggressive=${readAggressive() ? 1 : 0}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Matin indisponible");
      setData(body as Morning);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Matin indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function entity(id: string, level: "campaign" | "adset" | "ad", patch: { dailyBudget?: number; status?: "PAUSED" }, source: string, reason: string) {
    const res = await fetch("/api/meta/entity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, level, ...patch, source, reason }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Meta a refusé la modification");
  }

  async function run(key: string, confirmText: string, action: () => Promise<void>, done: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(key);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible");
    } finally {
      setBusy(null);
    }
  }

  const applyRamp = (row: RampRow) => {
    const cut = row.status === "COUPER";
    const patch = cut ? { status: "PAUSED" as const } : { dailyBudget: row.nextBudget };
    void run(
      row.id,
      cut ? `Couper (mettre en pause) « ${row.name} » ?\n${row.reasons[0] ?? ""}` : `« ${row.name} » : ${eur(row.budget)} → ${eur(row.nextBudget)} ?`,
      async () => {
        await entity(row.id, row.level, patch, "rampe", `Rampe : ${row.surf ? "SURF (pour la journée)" : row.verdict?.startsWith("Fin du surf") ? "fin du surf" : row.status} · ROAS 3 j ${num(row.roas3)}`);
        onApplied?.(row.level, row.id, patch);
      },
      cut ? `${row.name} coupé` : `${row.name} : ${eur(row.nextBudget)}`
    );
  };

  const applyCreative = (row: MorningCreative) => {
    void run(
      row.key,
      `Couper « ${row.name} » dans « ${row.adsetName} » ?\n${row.label}\n${row.why}`,
      async () => {
        for (const id of row.liveAdIds) await entity(id, "ad", { status: "PAUSED" }, "pipeline", `Matin : ${row.label}`);
        await log(`Couper « ${row.name} » dans « ${row.adsetName} » (Matin) · ${row.label}`);
      },
      `${row.name} coupée`
    );
  };

  async function log(what: string) {
    await fetch("/api/creative-pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "log", what }) }).catch(() => {});
  }

  if (!data) {
    return (
      <section className="rounded-2xl bg-white p-6 text-center text-[13px] text-slate-500 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        {error ? <span className="text-rose-600">{error}</span> : <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
      </section>
    );
  }

  const nothing = !data.rampActions.length && !data.creatives.length;
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
        <span>
          ROAS réel 3 j <b className="tabular-nums" style={{ color: data.open ? GREEN : RED }}>{num(data.realRoas3)}</b>
        </span>
        <span>
          Bénéfice réel 3 j <b className="tabular-nums" style={{ color: (data.profit3 ?? 0) >= 0 ? GREEN : RED }}>{usd(data.profit3)}</b>
        </span>
        <span>
          Approbation Reign 7 j <b className="tabular-nums">{data.approval7 == null ? "—" : `${num(data.approval7, 1)} %`}</b>
        </span>
        <span className="rounded-md px-2 py-0.5 text-[12px] font-bold" style={data.open ? { color: GREEN, background: "rgba(22,163,74,0.12)" } : { color: RED, background: "rgba(225,29,72,0.1)" }}>
          {data.open ? `HAUSSES OUVERTES (≥ ${num(data.breakeven)})` : `GEL (sous ${num(data.breakeven)})`}
        </span>
        <button type="button" onClick={() => void load()} className="ml-auto grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100" title="Recalculer">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {nothing ? (
        <p className="py-10 text-center text-[26px] font-bold text-slate-800 dark:text-slate-100">Rien à faire aujourd&apos;hui</p>
      ) : (
        <>
          {data.rampActions.length ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Budgets (rampe)</p>
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {data.rampActions.map((row) => {
                  const color = row.status === "MONTER" ? GREEN : row.status === "COUPER" ? RED : ORANGE;
                  return (
                    <li key={row.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                      <span className="min-w-0 flex-1 truncate font-semibold" title={row.reasons[0]}>
                        {row.name}
                        {row.verdict ? <span className="ml-1.5 text-[11.5px] font-normal text-slate-500">· {row.verdict}</span> : null}
                      </span>
                      <span className="text-[11.5px] text-slate-500 tabular-nums">ROAS {num(row.roas3)} · {eur(row.budget)}</span>
                      <button type="button" disabled={busy !== null} onClick={() => applyRamp(row)} className="inline-flex w-[150px] items-center justify-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: color }}>
                        {busy === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {row.status === "COUPER" ? "Couper" : row.status === "MONTER" ? `${row.surf ? "Surf" : "Monter"} à ${eur(row.nextBudget)}` : `Revenir à ${eur(row.nextBudget)}`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {data.creatives.length ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Créas à couper (lecture 3 j)</p>
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {data.creatives.map((row) => (
                  <CreativeAction key={row.key} row={row} busy={busy} onAct={() => applyCreative(row)} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {data.note ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-900 ring-1 ring-amber-200">{data.note}</p> : null}
    </section>
  );
}

function CreativeAction({ row, busy, onAct }: { row: MorningCreative; busy: string | null; onAct: () => void }) {
  return (
    <li className="flex items-center gap-3 py-1.5 text-[13px]">
      <span className="min-w-0 flex-1" title={row.why}>
        <span className="block truncate">
          <b>{row.name}</b> <span className="text-[11.5px] text-slate-400">· {row.adsetName}</span>
        </span>
        <span className="block truncate text-[11px] text-slate-500">{row.label}</span>
      </span>
      <span className="text-[11.5px] tabular-nums">
        <b style={{ color: RED }}>{row.badge}</b> · {Math.round(row.sales)} ventes 7 j
      </span>
      <button type="button" disabled={busy !== null} onClick={onAct} className="inline-flex w-[150px] items-center justify-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: RED }}>
        {busy === row.key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Couper
      </button>
    </li>
  );
}
