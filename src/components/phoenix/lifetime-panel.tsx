"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2 } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { TzBadge } from "@/components/phoenix/source-clocks";
import type { PhoenixRetention } from "@/lib/phoenix/retention";

const WINDOWS = [
  { months: 3, label: "3 mois" },
  { months: 6, label: "6 mois" },
  { months: 12, label: "12 mois" },
] as const;

const LINES = [
  { key: "avgDays", label: "Toutes sorties", color: "#059669", width: 2, dash: undefined },
  { key: "avgCancel", label: "Annulation", color: "#64748b", width: 1.3, dash: "4 3" },
  { key: "avgRefund", label: "Remboursement", color: "#8b5cf6", width: 1.3, dash: "4 3" },
  { key: "avgDispute", label: "Litige", color: "#f43f5e", width: 1.3, dash: "4 3" },
] as const;

function rangeFor(months: number) {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const days = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1).replace(".0", "")} j`;

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900/60">
      <p className="truncate text-[10px] leading-tight text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums",
          tone || "text-slate-900 dark:text-slate-50"
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-400">{sub}</p> : null}
    </div>
  );
}

export function LifetimePanel() {
  const [months, setMonths] = useState<number>(6);
  const [data, setData] = useState<PhoenixRetention | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const { start, end } = rangeFor(months);

    (async () => {
      try {
        const res = await fetch(`/api/phoenix/retention?start=${start}&end=${end}`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (!cancelled && res.ok) setData(body as PhoenixRetention);
      } catch {
        // the panel keeps its previous state and shows the empty line below
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [months]);

  const totals = data?.totals;
  const hasDisputes = (totals?.disputes ?? 0) > 0;

  const chartData = useMemo(
    () => (data?.series || []).filter((point) => point.churned > 0),
    [data]
  );

  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Durée de vie client
        </h2>
        <TzBadge source="phoenix" />
        <span className="truncate text-[10px] text-slate-400">
          temps passé abonné avant annulation, remboursement ou litige
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {loading ? <Loader2 className="h-3 w-3 animate-spin text-emerald-500" /> : null}
          <div className="flex rounded-md bg-slate-100 p-0.5 text-[10px] dark:bg-slate-800">
            {WINDOWS.map((window) => (
              <button
                key={window.months}
                type="button"
                onClick={() => {
                  setLoading(true);
                  setMonths(window.months);
                }}
                className={cn(
                  "rounded px-1.5 py-0.5 font-medium transition",
                  months === window.months
                    ? "bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-500"
                )}
              >
                {window.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!data || !totals ? (
        <div className="rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/60">
          {loading ? "Calcul des durées de vie…" : "Snapshot Phoenix indisponible."}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <Cell
              label="Durée de vie moyenne"
              value={days(totals.avgDays)}
              sub={`${formatNumber(totals.churned)} clients partis`}
            />
            <Cell label="Médiane" value={days(totals.medianDays)} sub="la moitié part avant" />
            <Cell
              label="Avant annulation"
              value={days(totals.avgCancel)}
              sub={`${formatNumber(totals.cancels)} annulations`}
            />
            <Cell
              label="Avant remboursement"
              value={days(totals.avgRefund)}
              sub={`${formatNumber(totals.refunds)} remboursements`}
              tone="text-violet-600 dark:text-violet-400"
            />
            <Cell
              label="Avant litige"
              value={days(totals.avgDispute)}
              sub={hasDisputes ? `${formatNumber(totals.disputes)} litiges` : "aucun litige détecté"}
              tone={hasDisputes ? "text-rose-600 dark:text-rose-400" : undefined}
            />
            <Cell
              label="Ancienneté des actifs"
              value={days(totals.activeAvgDays)}
              sub={`${formatNumber(totals.activeCount)} encore abonnés`}
              tone="text-emerald-600 dark:text-emerald-400"
            />
          </div>

          <div className="grid gap-1.5 lg:grid-cols-[1.6fr_1fr]">
            <div className="min-w-0 rounded-lg border border-slate-200/80 bg-white p-2 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="mb-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
                {LINES.filter((line) => line.key !== "avgDispute" || hasDisputes).map((line) => (
                  <span
                    key={line.key}
                    className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: line.color }} />
                    {line.label}
                  </span>
                ))}
                <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-sm bg-slate-200 dark:bg-slate-700" />
                  Clients partis
                </span>
              </div>
              <div className="h-[170px] sm:h-[190px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 4, right: 2, left: -28, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    <YAxis
                      yAxisId="days"
                      tick={{ fontSize: 9, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                      unit=" j"
                    />
                    <YAxis
                      yAxisId="count"
                      orientation="right"
                      tick={{ fontSize: 9, fill: "#cbd5e1" }}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(16,185,129,0.05)" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as PhoenixRetention["series"][number];
                        return (
                          <div className="rounded-lg border border-slate-200 bg-white/95 px-2 py-1.5 text-[10px] shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
                            <p className="mb-0.5 font-medium text-slate-500 dark:text-slate-400">
                              {label}
                            </p>
                            <p className="text-slate-800 dark:text-slate-100">
                              Moyenne {days(row.avgDays)} · médiane {days(row.medianDays)}
                            </p>
                            <p className="text-slate-500">
                              {formatNumber(row.churned)} clients partis — {formatNumber(row.cancels)}{" "}
                              annulations, {formatNumber(row.refunds)} remboursements,{" "}
                              {formatNumber(row.disputes)} litiges
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      yAxisId="count"
                      dataKey="churned"
                      name="Clients partis"
                      fill="#e2e8f0"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={22}
                      isAnimationActive={false}
                    />
                    {LINES.filter((line) => line.key !== "avgDispute" || hasDisputes).map((line) => (
                      <Line
                        key={line.key}
                        yAxisId="days"
                        type="monotone"
                        dataKey={line.key}
                        name={line.label}
                        stroke={line.color}
                        strokeWidth={line.width}
                        strokeDasharray={line.dash}
                        dot={{ r: 1.6, strokeWidth: 0, fill: line.color }}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200/80 bg-white p-2 dark:border-slate-800 dark:bg-slate-900/60">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Répartition des durées
              </p>
              <div className="space-y-1">
                {data.bands.map((band) => (
                  <div key={band.label} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-[10px] text-slate-600 dark:text-slate-300">
                      {band.label}
                    </span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${band.share}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
                      {formatNumber(band.count)}
                    </span>
                    <span className="w-10 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {band.share}%
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-slate-400">
                Chaque client compte une seule fois, sur sa première sortie. Les abonnés encore
                actifs sont exclus de la moyenne : leur compteur tourne toujours.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
