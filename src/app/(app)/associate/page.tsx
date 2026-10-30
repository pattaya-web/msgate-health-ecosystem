"use client";

import { reportToday } from "@/lib/report-tz";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Eye, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { AssociateOverview } from "@/lib/associate/scope";
import { DateRangePicker, type DateRange } from "@/components/phoenix/date-range-picker";
import { GhostButton, KpiCard, PanelTitle, Surface } from "@/components/phoenix/ui";

/**
 * La page Straight Sale de l'accès Associé.
 *
 * Même habillage que l'écran Stats, mais une seule source : /api/associate/overview,
 * qui ne renvoie que les ventes directes du périmètre et les dépenses Meta qui
 * leur sont associées. La page n'a pas d'autre API à appeler, et le serveur ne
 * lui répondrait pas (src/lib/auth/guard.ts).
 */

function monthRange(date = new Date()): DateRange {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const shortDay = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;
// Les journées se comptent à Paris, comme Shopify et Meta (src/lib/report-tz.ts).
const nyToday = reportToday;


const axisProps = { tick: { fontSize: 9, fill: "#94a3b8" }, axisLine: false, tickLine: false } as const;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-2 py-1.5 text-[10px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-0.5 font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(payload[0]?.value ?? 0)}</p>
    </div>
  );
}

export default function AssociatePage() {
  const { isAssociate, isAdmin } = useAuth();
  const [range, setRange] = useState<DateRange>(() => monthRange());
  const [overview, setOverview] = useState<AssociateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (current: DateRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/associate/overview?start=${current.start}&end=${current.end}`, { cache: "no-store" });
      const body = (await res.json()) as { overview?: AssociateOverview; error?: string };
      if (!res.ok || !body.overview) throw new Error(body.error || `HTTP ${res.status}`);
      setOverview(body.overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tableau de bord indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  // Différé d'un tick : la règle React Compiler refuse un setState synchrone dans l'effet.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(range), 0);
    return () => window.clearTimeout(timer);
  }, [range, load]);

  // Pendant qu'une synchronisation Phoenix tourne, les chiffres se complètent : on relit toutes les 15 s.
  const building = Boolean(overview?.phoenix.building || overview?.phoenix.progress?.running);
  useEffect(() => {
    if (!building) return;
    const timer = window.setInterval(() => void load(range), 15_000);
    return () => window.clearInterval(timer);
  }, [building, range, load]);

  // Période qui contient aujourd'hui : relue toutes les minutes, pour coller à Reign.
  useEffect(() => {
    const today = nyToday();
    if (range.start > today || range.end < today) return;
    const timer = window.setInterval(() => void load(range), 60_000);
    return () => window.clearInterval(timer);
  }, [range, load]);

  const chartData = useMemo(
    () => (overview?.straightSale.series ?? []).map((point) => ({ label: shortDay(point.date), revenue: point.revenue })),
    [overview]
  );

  const sale = overview?.straightSale;
  const meta = overview?.meta;
  const currency = meta?.currency ?? "USD";
  const scopeEmpty = Boolean(overview && !overview.scope.metaAccountIds.length && !overview.scope.campaignKeyword);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">STRAIGHT SALE</h1>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            Ventes directes et dépenses Meta Ads associées
            {overview?.scope.stores.length ? ` · ${overview.scope.stores.join(", ")}` : ""}
          </p>
        </div>
        <GhostButton className="ml-auto shrink-0" onClick={() => void load(range)} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          <span className="hidden sm:inline">Actualiser</span>
        </GhostButton>
        <div className="thin-scroll -mx-3 w-full overflow-x-auto px-3 lg:mx-0 lg:w-auto lg:px-0">
          <div className="w-max">
            <DateRangePicker value={range} onChange={setRange} />
          </div>
        </div>
      </div>

      {!isAssociate ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-[12px] text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300">
          <Eye className="h-3.5 w-3.5 shrink-0" />
          Vue Associé : cette page est exactement ce que voit un compte associé, avec le périmètre réglé par l&apos;admin.
          {isAdmin ? (
            <Link href="/settings" className="ml-auto font-medium underline underline-offset-2">
              Régler le périmètre
            </Link>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      {building ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-[12px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Synchronisation des ventes en cours
          {overview?.phoenix.progress && overview.phoenix.progress.total > 0
            ? ` · ${formatNumber(overview.phoenix.progress.done)}/${formatNumber(overview.phoenix.progress.total)}`
            : ""}
          , les chiffres se complètent.
        </div>
      ) : null}

      {overview && !overview.phoenix.configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          Les ventes ne sont pas branchées sur ce serveur (Phoenix non configuré).
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          accent="indigo"
          label="Chiffre d'affaires Straight Sale"
          value={formatCurrency(sale?.revenue ?? 0)}
          sub={sale ? `${formatNumber(sale.approved)} ventes approuvées` : "—"}
        />
        <KpiCard
          accent="sky"
          label="Taux d'approbation"
          value={sale ? `${sale.approvalRate.toFixed(1)}%` : "—"}
          sub={sale ? `${formatNumber(sale.approved)} / ${formatNumber(sale.attempts)} tentatives` : "—"}
        />
        <KpiCard
          accent="rose"
          label="Dépense Meta Ads"
          value={formatCurrency(meta?.spend ?? 0, currency)}
          sub={
            meta?.error
              ? meta.error
              : !meta?.configured
                ? "Meta non configuré"
                : scopeEmpty
                  ? "Aucun compte associé (voir l'admin)"
                  : `${formatNumber(meta.accounts.length)} compte(s) retenu(s)`
          }
        />
        <KpiCard
          accent="emerald"
          label="ROAS · CPA"
          value={overview?.roas != null ? `${overview.roas.toFixed(2)}×` : "—"}
          sub={overview?.cpa != null ? `CPA ${formatCurrency(overview.cpa, currency)}` : "Pas de dépense sur la période"}
        />
      </div>

      <Surface accent="indigo" interactive={false}>
        <PanelTitle accent="indigo">Chiffre d&apos;affaires par jour</PanelTitle>
        <div className="mt-2 h-56">
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
                <defs>
                  <linearGradient id="assoc-rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
                <YAxis {...axisProps} width={48} tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`)} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="revenue" name="Straight Sale" stroke="#6366f1" strokeWidth={1.5} fill="url(#assoc-rev)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-slate-400">
              {loading ? "Chargement…" : "Aucune vente sur la période"}
            </div>
          )}
        </div>
      </Surface>

      <Surface accent="rose" interactive={false}>
        <PanelTitle accent="rose">Comptes Meta Ads</PanelTitle>
        {meta?.accounts.length ? (
          <table className="mt-2 w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1 font-medium">Compte</th>
                <th className="py-1 text-right font-medium">Campagnes</th>
                <th className="py-1 text-right font-medium">Dépense</th>
              </tr>
            </thead>
            <tbody>
              {meta.accounts.map((account) => (
                <tr key={account.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 text-slate-700 dark:text-slate-200">{account.name}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{formatNumber(account.campaigns)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(account.spend, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-[12px] text-slate-400">
            {scopeEmpty ? "Aucun compte ou mot-clé n'est encore associé à Straight Sale." : loading ? "Chargement…" : "Aucune dépense sur la période."}
          </p>
        )}
      </Surface>
    </div>
  );
}
