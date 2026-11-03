"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2, RotateCcw, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { RampRow, RampStatus, ScalingRamp as Ramp } from "@/lib/metrics/scaling-ramp";

/**
 * Le bloc « Rampe de scaling » de l'Ads Manager, sous la barre Objectifs :
 * pour chaque ad set actif et chaque CBO, le statut du jour (MONTER / TENIR /
 * REDESCENDRE / COUPER / TEST), le prochain budget et quand il est autorisé,
 * avec un bouton « Appliquer » qui change le budget chez Meta et l'écrit au
 * journal. Les règles et le cap global sont calculés par le serveur
 * (src/lib/metrics/scaling-ramp.ts).
 */

const MODE_KEY = "msgate-ramp-aggressive";
const OPEN_KEY = "msgate-ramp-open";

/* Couleurs en dur : le thème admin repeint le vert en bleu. */
const STATUS_STYLE: Record<RampStatus, { color: string; background: string; label: string }> = {
  MONTER: { color: "#15803d", background: "rgba(22, 163, 74, 0.12)", label: "MONTER" },
  TENIR: { color: "#b45309", background: "rgba(217, 119, 6, 0.12)", label: "TENIR" },
  REDESCENDRE: { color: "#c2410c", background: "rgba(234, 88, 12, 0.14)", label: "REDESCENDRE" },
  COUPER: { color: "#e11d48", background: "rgba(225, 29, 72, 0.12)", label: "COUPER" },
  TEST: { color: "#4f46e5", background: "rgba(79, 70, 229, 0.12)", label: "TEST" },
};

const eur = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} €`;
const num = (value: number | null | undefined) => (value == null ? "—" : value.toFixed(2).replace(".", ","));
const when = (value: string) =>
  new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (value: string) => {
  const hours = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 3_600_000));
  return hours < 48 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
};

function readBool(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}
function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // stockage refusé : sans gravité
  }
}

export function ScalingRamp({ onApplied }: { onApplied?: (level: "campaign" | "adset", id: string, patch: { dailyBudget?: number; status?: "PAUSED" }) => void }) {
  const [aggressive, setAggressive] = useState(true);
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Ramp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Les préférences du navigateur, relues au tick suivant (pas de setState synchrone dans l'effet).
  useEffect(() => {
    const timer = setTimeout(() => {
      setAggressive(readBool(MODE_KEY, true));
      setOpen(readBool(OPEN_KEY, true));
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const load = useCallback(async (mode: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/metrics/scaling-ramp?aggressive=${mode ? 1 : 0}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Rampe indisponible");
      setData(body as Ramp);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rampe indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !open) return;
    const timer = setTimeout(() => void load(aggressive), 0);
    return () => clearTimeout(timer);
  }, [ready, open, aggressive, load]);

  async function send(row: { id: string; level: "campaign" | "adset"; name: string }, patch: { dailyBudget?: number; status?: "PAUSED" }, reason: string, label: string) {
    setBusy(row.id);
    try {
      const res = await fetch("/api/meta/entity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, level: row.level, ...patch, source: "rampe", reason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Meta a refusé la modification");
      onApplied?.(row.level, row.id, patch);
      toast.success(label);
      await load(aggressive);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Modification impossible");
    } finally {
      setBusy(null);
    }
  }

  function apply(row: RampRow) {
    const roas = `ROAS 3 j ${num(row.roas3)}`;
    if (row.status === "COUPER") {
      if (!window.confirm(`Couper (mettre en pause) « ${row.name} » ?\n${row.reasons.join("\n")}`)) return;
      void send(row, { status: "PAUSED" }, `Rampe : COUPER · ${roas}`, `${row.name} coupé`);
      return;
    }
    if (!window.confirm(`${row.status === "MONTER" ? "Monter" : "Redescendre"} « ${row.name} » : ${eur(row.budget)} → ${eur(row.nextBudget)} ?`)) return;
    void send(row, { dailyBudget: row.nextBudget }, `Rampe : ${row.status} · ${roas}`, `${row.name} : ${eur(row.budget)} → ${eur(row.nextBudget)}`);
  }

  function undo() {
    const last = data?.undo;
    if (!last) return;
    if (!window.confirm(`Annuler le dernier palier de « ${last.name} » : ${eur(last.after)} → ${eur(last.before)} ?`)) return;
    void send(last, { dailyBudget: last.before }, "Annulation du dernier palier", `${last.name} : retour à ${eur(last.before)}`);
  }

  const toggleOpen = () => {
    setOpen((current) => {
      writeBool(OPEN_KEY, !current);
      return !current;
    });
  };
  const toggleMode = () => {
    setAggressive((current) => {
      writeBool(MODE_KEY, !current);
      return !current;
    });
  };

  const counts = data ? (["MONTER", "REDESCENDRE", "COUPER"] as RampStatus[]).map((status) => ({ status, count: data.rows.filter((row) => row.status === status).length })).filter((row) => row.count) : [];

  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={toggleOpen} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-50">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
          <TrendingUp className="h-4 w-4" />
          Rampe de scaling
        </button>
        {counts.map((row) => (
          <span key={row.status} className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ color: STATUS_STYLE[row.status].color, background: STATUS_STYLE[row.status].background }}>
            {row.count} {STATUS_STYLE[row.status].label}
          </span>
        ))}
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300" title="ON : on monte dès le seuil « à tenir » (1,80 / 1,58). OFF : seulement au seuil « scaler » (2,00 / 1,75).">
          Mode agressif
          <button
            type="button"
            role="switch"
            aria-checked={aggressive}
            onClick={toggleMode}
            className={cn("relative h-5 w-9 rounded-full transition-colors", aggressive ? "bg-[#16a34a]" : "bg-slate-300 dark:bg-slate-600")}
          >
            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", aggressive ? "left-[18px]" : "left-0.5")} />
          </button>
        </label>
      </header>

      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-2 dark:border-white/[0.06]">
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}
          {!data && !error ? <p className="py-4 text-center text-[12px] text-slate-500">Calcul de la rampe…</p> : null}
          {data ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <span>
                  ROAS réel 3 j{" "}
                  <b className="tabular-nums" style={{ color: data.cap.frozen ? "#e11d48" : data.cap.limit == null ? "#15803d" : "#b45309" }}>
                    {num(data.realRoas3)}
                  </b>{" "}
                  <span className="text-slate-400">
                    ({data.window.start.slice(8)}/{data.window.start.slice(5, 7)} → {data.window.end.slice(8)}/{data.window.end.slice(5, 7)}, toute la dépense Meta)
                  </span>
                </span>
                <span
                  className="rounded-md px-2 py-0.5 font-semibold"
                  style={data.cap.frozen ? { color: "#e11d48", background: "rgba(225,29,72,0.1)" } : data.cap.limit == null ? { color: "#15803d", background: "rgba(22,163,74,0.1)" } : { color: "#b45309", background: "rgba(217,119,6,0.1)" }}
                >
                  {data.cap.label}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  Budget total aujourd&apos;hui <b className="tabular-nums">{eur(data.totals.now)}</b> → après paliers du jour <b className="tabular-nums">{eur(data.totals.afterToday)}</b>
                </span>
              </div>
              {data.warnings.map((warning) => (
                <p key={warning} className="text-[11px] text-amber-700">
                  {warning}
                </p>
              ))}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="py-1.5 pr-2 font-semibold">Nom</th>
                      <th className="px-2 font-semibold">Budget</th>
                      <th className="px-2 font-semibold">ROAS 3 j</th>
                      <th className="px-2 font-semibold">Achats 3 j</th>
                      <th className="px-2 font-semibold">Dernier palier</th>
                      <th className="px-2 font-semibold">Statut</th>
                      <th className="px-2 font-semibold">Prochain budget</th>
                      <th className="px-2 font-semibold">Autorisé à partir du</th>
                      <th className="pl-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                    {data.rows.map((row) => {
                      const style = STATUS_STYLE[row.status];
                      const actionable = row.status === "MONTER" || row.status === "REDESCENDRE" || row.status === "COUPER";
                      const roasColor =
                        row.roas3 == null || row.thresholds.minimum == null
                          ? undefined
                          : row.roas3 < row.thresholds.minimum
                            ? "#e11d48"
                            : row.thresholds.rise != null && row.roas3 >= row.thresholds.rise
                              ? "#15803d"
                              : "#b45309";
                      return (
                        <tr key={row.id} className="align-top">
                          <td className="max-w-[260px] py-1.5 pr-2">
                            <p className="truncate font-semibold text-slate-900 dark:text-slate-50" title={row.name}>
                              {row.level === "campaign" ? "CBO · " : ""}
                              {row.name}
                            </p>
                            <p className="truncate text-[10.5px] text-slate-400" title={`${row.accountName} › ${row.campaignName}`}>
                              {row.accountName} › {row.campaignName} · {row.product} · {row.activeAds} créa{row.activeAds > 1 ? "s" : ""}
                            </p>
                            <p className="text-[10.5px] leading-snug text-slate-500" title={row.reasons.join("\n")}>
                              {row.reasons.join(" · ")}
                            </p>
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">{eur(row.budget)}</td>
                          <td className="px-2 py-1.5 font-semibold tabular-nums" style={{ color: roasColor }} title={`Minimum ${num(row.thresholds.minimum)} · montée ${num(row.thresholds.rise)} · dépense 3 j ${eur(row.spend3)}`}>
                            {num(row.roas3)}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">{row.purchases3}</td>
                          <td className="px-2 py-1.5 text-[11px]">
                            {row.lastChange ? (
                              <>
                                <p className="tabular-nums">
                                  {row.lastChange.before != null ? `${eur(row.lastChange.before)} → ` : ""}
                                  {row.lastChange.after != null ? eur(row.lastChange.after) : "—"}
                                </p>
                                <p className="text-slate-400">
                                  {when(row.lastChange.at)} · {ago(row.lastChange.at)}
                                </p>
                              </>
                            ) : (
                              <span className="text-slate-400">aucun</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ color: style.color, background: style.background }}>
                              {style.label}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {row.status === "COUPER" ? (
                              <span style={{ color: "#e11d48" }}>pause</span>
                            ) : row.nextBudget !== row.budget ? (
                              <b style={{ color: style.color }}>{eur(row.nextBudget)}</b>
                            ) : (
                              <span className="text-slate-500" title="Le prochain palier (+30 %) quand les conditions seront réunies">
                                {eur(row.nextStep)}
                                {row.blockedByCap != null ? <span className="ml-1 text-[10px] text-rose-600">(cap)</span> : null}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">{actionable ? "maintenant" : row.allowedAt ? when(row.allowedAt) : "à 400 € dépensés"}</td>
                          <td className="py-1.5 pl-2 text-right">
                            {actionable ? (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => apply(row)}
                                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                style={{ background: style.color }}
                              >
                                {busy === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                Appliquer
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/50">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Rampe prévisionnelle sur 10 jours</p>
                  <p className="text-[10.5px] text-slate-500">Si les ad sets qui montent tiennent leur ROAS : +30 % toutes les 48 h, arrondi à 5 €, plafonné par le cap.</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {data.forecast.map((step) => (
                      <span key={step.day} className="rounded-md bg-white px-2 py-1 text-[11px] tabular-nums ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-white/10">
                        <span className="text-slate-400">J{step.day ? `+${step.day}` : "0"}</span> <b>{eur(step.total)}</b>
                        {step.capped ? <span className="ml-1 text-[10px] text-amber-600">cap</span> : null}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/50">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Rampe de référence (×1,3 par palier, arrondi 5 €)</p>
                  {data.examples.map((ramp) => (
                    <p key={ramp[0]} className="mt-1 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                      {ramp.map((value) => value.toLocaleString("fr-FR")).join(" → ")}
                    </p>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Journal des budgets (20 derniers)</p>
                  {data.undo ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={undo}
                      className="ml-auto inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
                      title={`${data.undo.name} : ${eur(data.undo.after)} → ${eur(data.undo.before)}`}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Annuler le dernier palier
                    </button>
                  ) : null}
                </div>
                {data.journal.length ? (
                  <ul className="mt-1 divide-y divide-slate-100 text-[11px] dark:divide-white/[0.06]">
                    {data.journal.map((line) => (
                      <li key={`${line.objectId}-${line.at}`} className="flex flex-wrap items-baseline gap-x-2 py-1">
                        <span className="w-[120px] shrink-0 text-slate-400">{when(line.at)}</span>
                        <span className="min-w-0 max-w-[260px] truncate font-medium text-slate-800 dark:text-slate-100" title={line.objectName}>
                          {line.objectName}
                        </span>
                        <span className="tabular-nums">
                          {line.before != null ? eur(line.before) : "—"} → {line.after != null ? eur(line.after) : "—"}
                        </span>
                        {line.note ? <span className="text-slate-500">{line.note}</span> : null}
                        <span className="ml-auto text-slate-400">
                          {line.who} · {line.source}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">Aucun changement de budget enregistré.</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
