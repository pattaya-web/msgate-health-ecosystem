"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/auth-context";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { OrderCategory, PhoenixOverview, SnapshotProgress } from "@/lib/phoenix/types";
import { DateRangePicker } from "@/components/phoenix/date-range-picker";
import { LifetimePanel } from "@/components/phoenix/lifetime-panel";
import { MultiSelect } from "@/components/phoenix/multi-select";
import { PhoenixRefundPanel } from "@/components/phoenix/refund-panel";
import { ProfitCalculator } from "@/components/phoenix/profit-calculator";
import { BreakEvenCalculator } from "@/components/phoenix/break-even-calculator";
import { SourceClocks, TzBadge, type TzSource } from "@/components/phoenix/source-clocks";
import {
  GhostButton,
  KpiCard,
  PanelTitle,
  Segmented,
  SplitBar,
  Surface,
} from "@/components/phoenix/ui";
import { Card } from "@/components/ui/card";
import { BUCKET_LABELS, CAMPAIGN_BUCKETS } from "@/lib/meta/buckets";
import type { RoasDaily } from "@/lib/metrics/roas-daily";

type TabId = "overview" | "profit" | "breakeven" | "checkout" | "refunds";

const CATEGORIES: Array<{ key: OrderCategory; label: string; color: string }> = [
  { key: "direct", label: "Direct Sale", color: "#6366f1" },
  { key: "initial", label: "Initial Subscription", color: "#8b5cf6" },
  { key: "recurring", label: "Recurring Subscription", color: "#10b981" },
  { key: "salvage", label: "Subscription Salvage", color: "#0ea5e9" },
  { key: "upsell", label: "Upsell", color: "#f59e0b" },
];

const REVENUE_SERIES = [
  { key: "direct", label: "Direct", color: "#6366f1" },
  { key: "initial", label: "Initial", color: "#8b5cf6" },
  { key: "recurring", label: "Recurring", color: "#10b981" },
  { key: "salvage", label: "Salvage", color: "#0ea5e9" },
  { key: "upsell", label: "Upsell", color: "#f59e0b" },
] as const;

function monthRange(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const shortDay = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;
const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

function formatEta(ms: number | null) {
  if (ms == null || ms <= 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  if (minutes >= 1) return `${minutes} min`;
  return `${Math.max(5, Math.round(ms / 1000))} s`;
}

function toneForRate(rate: number) {
  if (rate >= 60) return "text-emerald-600 dark:text-emerald-400";
  if (rate >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  source,
  hint,
  right,
  children,
}: {
  title: string;
  source: TzSource;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="shrink-0 text-[13px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <TzBadge source={source} />
        {hint ? <span className="truncate text-[11px] text-slate-400">{hint}</span> : null}
        {right ? <div className="ml-auto shrink-0">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  source,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  source?: TzSource;
}) {
  return (
    <Surface plain className="min-w-0 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] leading-tight text-slate-500 dark:text-slate-400">
        <span className="truncate">{label}</span>
        {source ? <TzBadge source={source} className="ml-auto" /> : null}
      </p>
      <p
        className={cn(
          "mt-1.5 truncate text-lg font-semibold leading-none tracking-tight tabular-nums",
          tone || "text-slate-900 dark:text-slate-50"
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-1.5 truncate text-[11px] leading-tight text-slate-400">{sub}</p>
      ) : null}
    </Surface>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
  absolute,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    dataKey?: string | number;
    value?: number;
    color?: string;
    stroke?: string;
    fill?: string;
  }>;
  label?: string;
  currency?: boolean;
  absolute?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-2 py-1.5 text-[10px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-0.5 font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {payload.map((entry) => {
        const raw = entry.value ?? 0;
        return (
          <p
            key={String(entry.dataKey)}
            className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: entry.color || entry.stroke || entry.fill }}
            />
            <span>{entry.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">
              {currency
                ? formatCurrency(absolute ? Math.abs(raw) : raw)
                : formatNumber(absolute ? Math.abs(raw) : raw)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

const axisProps = {
  tick: { fontSize: 9, fill: "#94a3b8" },
  axisLine: false,
  tickLine: false,
} as const;

const NARROW_QUERY = "(max-width: 639px)";

function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Recharts sizes axes in pixels, so the layout has to know the real viewport. */
function useIsNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
}

/* ------------------------------------------------------------------ */

export default function PhoenixPage() {
  const { canWrite, isAdmin } = useAuth();
  const [tab, setTab] = useState<TabId>("overview");
  const initial = useMemo(() => monthRange(), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [stores, setStores] = useState<string[]>([]);
  const [processors, setProcessors] = useState<string[]>([]);
  const [overview, setOverview] = useState<PhoenixOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<SnapshotProgress | null>(null);
  const [subsMode, setSubsMode] = useState<"daily" | "cumulative">("daily");
  const [roas, setRoas] = useState<RoasDaily | null>(null);
  const [roasLoading, setRoasLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const narrow = useIsNarrow();

  // Callers own the spinner: this only ever touches state after an await, so
  // it can be called straight from an effect without cascading renders.
  const load = useCallback(
    async (opts?: { refresh?: boolean }) => {
      try {
        const params = new URLSearchParams({ start, end });
        if (stores.length) params.set("stores", stores.join(","));
        if (processors.length) params.set("processors", processors.join(","));
        if (opts?.refresh) params.set("refresh", "1");

        const res = await fetch(`/api/phoenix/overview?${params}`, { cache: "no-store" });
        const body = await res.json();

        if (res.status === 202) {
          setProgress(body.progress || { running: true, phase: "customers", done: 0, total: 0 });
          return;
        }
        if (!res.ok) throw new Error(body.error || "Overview failed");

        setOverview(body.overview);
        setProgress(body.progress || null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Phoenix error");
      } finally {
        setLoading(false);
      }
    },
    [start, end, stores, processors]
  );

  // Meta and Shopify are slower than Phoenix and independent of its filters, so
  // that block loads on its own rather than holding the page back.
  const loadRoas = useCallback(async () => {
    try {
      const res = await fetch(`/api/roas/daily?start=${start}&end=${end}`, { cache: "no-store" });
      const body = await res.json();
      if (res.ok) setRoas(body as RoasDaily);
    } catch {
      // the section renders its own empty state
    } finally {
      setRoasLoading(false);
    }
  }, [start, end]);

  // Filters are applied through the Search button, so the initial fetch runs
  // once. `load` only writes state after awaiting the response, but the linter
  // cannot see through the try/finally, hence the second suppression.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadRoas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A full sync is rate-limited and can run for tens of minutes: poll its
  // progress and fold in partial results as they land.
  useEffect(() => {
    if (!progress?.running) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;

    let ticks = 0;
    pollRef.current = setInterval(async () => {
      ticks += 1;
      try {
        const res = await fetch("/api/phoenix/snapshot", { cache: "no-store" });
        const body = await res.json();
        const next: SnapshotProgress = body.progress;
        setProgress(next);

        if (!next.running) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (next.phase === "error") toast.error(next.error || "Sync Phoenix échouée");
          void load();
        } else if (ticks % 6 === 0) {
          void load();
        }
      } catch {
        // transient — keep polling
      }
    }, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [progress?.running, load]);

  const revenueData = useMemo(
    () => (overview?.revenue.series || []).map((p) => ({ ...p, label: shortDay(p.date) })),
    [overview]
  );
  const subsData = useMemo(
    () =>
      (overview?.subscriptions.series || []).map((p) => ({
        ...p,
        label: shortDay(p.date),
        cancelledNeg: -p.cancelled,
      })),
    [overview]
  );
  const processorChart = useMemo(
    () =>
      (overview?.checkout.processors || [])
        .filter((p) => p.attempts > 0)
        .slice(0, 8)
        .map((p) => {
          const short = p.name.replace(/^Kurv - BMO - /, "");
          return { ...p, short: narrow ? short.slice(0, 12) : short.slice(0, 22) };
        }),
    [overview, narrow]
  );

  const coveragePct = overview ? Math.round(overview.meta.coverage * 100) : 0;
  const eta = formatEta(progress?.etaMs ?? null);
  const syncing = Boolean(progress?.running);
  const buildingPct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const net = overview?.subscriptions.net ?? 0;
  const direct = overview?.orderSummary.direct;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            STATS
          </h1>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {overview?.client || "SkinRenew"}
            {overview
              ? ` · ${formatNumber(overview.meta.transactions)} transactions · couverture ${coveragePct} %`
              : ""}
          </p>
        </div>
        <GhostButton
          className="ml-auto shrink-0"
          onClick={() => void load({ refresh: true })}
          disabled={syncing}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          <span className="hidden sm:inline">Resynchroniser</span>
          <span className="sm:hidden">Sync</span>
        </GhostButton>
        <div className="thin-scroll -mx-3 w-full overflow-x-auto px-3 lg:mx-0 lg:w-auto lg:px-0">
          <div className="w-max">
            <SourceClocks />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-12 z-30 -mx-3 px-3 py-1.5 backdrop-blur-xl sm:-mx-4 sm:px-4 lg:static lg:mx-0 lg:px-0 lg:py-0 lg:backdrop-blur-none">
        <div className="thin-scroll overflow-x-auto">
          <Segmented
            className="w-full min-w-max"
            value={tab}
            onChange={(next) => setTab(next)}
            options={[
              { value: "overview" as TabId, label: "Vue d'ensemble" },
              { value: "profit" as TabId, label: "Profit" },
              { value: "breakeven" as TabId, label: "Break-even" },
              { value: "checkout" as TabId, label: "Checkout" },
              { value: "refunds" as TabId, label: "Remboursements" },
            ]}
          />
        </div>
      </div>

      {/* Filters — the calculators carry their own timeframe */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-2xl bg-white px-2.5 py-2 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]",
          (tab === "profit" || tab === "breakeven") && "hidden"
        )}
      >
        <DateRangePicker
          value={{ start, end }}
          onChange={(next) => {
            setStart(next.start);
            setEnd(next.end);
          }}
          className="w-full sm:w-auto"
        />
        <div className="min-w-[120px] flex-1 sm:max-w-[190px]">
          <MultiSelect
            options={overview?.options.stores || []}
            value={stores}
            onChange={setStores}
            placeholder="Tous les stores"
          />
        </div>
        <div className="min-w-[120px] flex-1 sm:max-w-[210px]">
          <MultiSelect
            options={overview?.options.processors || []}
            value={processors}
            onChange={setProcessors}
            placeholder="Tous les processeurs"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setRoasLoading(true);
            void load();
            void loadRoas();
          }}
          disabled={loading}
          className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-medium text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Rechercher
        </button>
      </div>

      {/* Sync banner */}
      {syncing || (overview && !overview.meta.complete) ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <Loader2 className={cn("h-3 w-3 shrink-0 text-amber-600", syncing && "animate-spin")} />
          <p className="min-w-0 flex-1 truncate text-[10px] text-amber-900 dark:text-amber-200">
            Synchronisation {formatNumber(progress?.done || 0)}/
            {formatNumber(progress?.total || 0)} abonnés
            {eta ? ` · reste ${eta}` : ""}
          </p>
          <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-amber-200/60">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${overview ? coveragePct : buildingPct}%` }}
            />
          </div>
        </div>
      ) : null}

      {!overview ? (
        <Card className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          {progress?.phase === "error" ? (
            <>
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <p className="text-[11px] text-rose-600">{progress.error}</p>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Première synchronisation Phoenix
              </p>
              <div className="h-1 w-48 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${buildingPct}%` }}
                />
              </div>
            </>
          )}
        </Card>
      ) : null}

      {tab === "overview" ? <RoasBlock data={roas} loading={roasLoading} /> : null}

      {tab === "profit" ? <ProfitCalculator /> : null}

      {tab === "breakeven" ? <BreakEvenCalculator /> : null}

      {overview && tab === "overview" ? (
        <div className="space-y-3">
          {/* Key figures */}
          <Section title="Chiffres clés" source="phoenix" hint="tout Phoenix, journée américaine">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Approbation Direct Sale"
              value={direct ? pct(direct.approvalRate) : "—"}
              sub={direct ? `${formatNumber(direct.approved)} sur ${formatNumber(direct.attempts)}` : undefined}
              tone={direct ? toneForRate(direct.approvalRate) : undefined}
            />
            <Stat
              label="Revenus de la période"
              value={formatCurrency(overview.revenue.total)}
              sub={`${formatNumber(overview.period.approved)} commandes approuvées`}
            />
            <Stat
              label="Abonnés actifs"
              value={formatNumber(overview.lifetime.activeSubscriptions)}
              sub={`${formatNumber(overview.lifetime.subscribersInSalvage)} en salvage`}
            />
            <Stat
              label="Abonnements nets"
              value={`${net > 0 ? "+" : ""}${formatNumber(net)}`}
              sub="nouveaux moins annulés"
              tone={net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
            />
            <Stat
              label="Nouveaux abonnements"
              value={formatNumber(overview.subscriptions.created)}
              sub="sur la période"
            />
            <Stat
              label="Abonnements annulés"
              value={formatNumber(overview.subscriptions.cancelled)}
              sub={`${formatNumber(overview.lifetime.cancelledSubscriptions)} depuis le début`}
            />
          </div>
          </Section>

          {/* Order summary */}
          <Section
            title="Order Summary"
            source="phoenix"
            hint={`${overview.range.start} au ${overview.range.end}`}
            right={
              <span className="text-[10px] text-slate-400">
                {pct(overview.period.approvalRate)} d&apos;approbation globale
              </span>
            }
          >
            <div className="thin-scroll overflow-x-auto rounded-lg border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60">
              <table className="w-full min-w-[440px] text-left text-[11px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800">
                    <th className="px-2.5 py-1.5">Catégorie</th>
                    <th className="px-2.5 py-1.5 text-right">Taux d&apos;approbation</th>
                    <th className="px-2.5 py-1.5 text-right">Approuvées</th>
                    <th className="px-2.5 py-1.5 text-right">Tentatives</th>
                    <th className="px-2.5 py-1.5 text-right">Revenus</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map((category) => {
                    const stats = overview.orderSummary[category.key];
                    const empty = stats.attempts === 0;
                    return (
                      <tr
                        key={category.key}
                        className="border-b border-slate-50 last:border-0 dark:border-slate-800/60"
                      >
                        <td className="px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: category.color }}
                            />
                            {category.label}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <div className="flex items-center justify-end gap-2">
                            <div className="hidden h-1 w-16 overflow-hidden rounded-full bg-slate-100 sm:block dark:bg-slate-800">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(100, stats.approvalRate)}%`,
                                  background: category.color,
                                }}
                              />
                            </div>
                            <span
                              className={cn(
                                "w-11 text-right font-semibold tabular-nums",
                                empty ? "text-slate-300 dark:text-slate-600" : toneForRate(stats.approvalRate)
                              )}
                            >
                              {empty ? "—" : pct(stats.approvalRate)}
                            </span>
                          </div>
                        </td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                          {formatNumber(stats.approved)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-400">
                          {formatNumber(stats.attempts)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                          {formatCurrency(stats.revenue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Charts */}
          <div className="grid gap-2 lg:grid-cols-2">
            <Card className="min-w-0 p-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Revenus
                </h3>
                <TzBadge source="phoenix" />
                <p className="text-sm font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(overview.revenue.total)}
                </p>
              </div>
              <div className="mb-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
                {REVENUE_SERIES.map((serie) => (
                  <span
                    key={serie.key}
                    className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: serie.color }}
                    />
                    {serie.label}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {formatCurrency(overview.revenue[serie.key])}
                    </span>
                  </span>
                ))}
              </div>
              <div className="h-[160px] sm:h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
                    <defs>
                      {REVENUE_SERIES.map((serie) => (
                        <linearGradient
                          key={serie.key}
                          id={`ph-rev-${serie.key}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor={serie.color} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={serie.color} stopOpacity={0.03} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
                    <YAxis {...axisProps} width={48} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                    <Tooltip content={<ChartTooltip currency />} />
                    {REVENUE_SERIES.map((serie) => (
                      <Area
                        key={serie.key}
                        type="monotone"
                        dataKey={serie.key}
                        name={serie.label}
                        stackId="rev"
                        stroke={serie.color}
                        strokeWidth={1.2}
                        fill={`url(#ph-rev-${serie.key})`}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="min-w-0 p-2.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Abonnements nets
                </h3>
                <TzBadge source="phoenix" />
                <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Nouveaux
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {formatNumber(overview.subscriptions.created)}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  Annulés
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {formatNumber(overview.subscriptions.cancelled)}
                  </span>
                </span>
                <div className="ml-auto flex rounded-md bg-slate-100 p-0.5 text-[10px] dark:bg-slate-800">
                  {(["daily", "cumulative"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSubsMode(mode)}
                      className={cn(
                        "rounded px-1.5 py-0.5 font-medium transition",
                        subsMode === mode
                          ? "bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                          : "text-slate-500"
                      )}
                    >
                      {mode === "daily" ? "Par jour" : "Cumulé"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[160px] sm:h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  {subsMode === "daily" ? (
                    <ComposedChart
                      data={subsData}
                      margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                      stackOffset="sign"
                    >
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
                      <YAxis {...axisProps} width={40} />
                      <Tooltip content={<ChartTooltip absolute />} />
                      <ReferenceLine y={0} stroke="#cbd5e1" />
                      <Bar
                        dataKey="created"
                        name="Nouveaux"
                        fill="#10b981"
                        radius={[2, 2, 0, 0]}
                        maxBarSize={12}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="cancelledNeg"
                        name="Annulés"
                        fill="#f43f5e"
                        radius={[0, 0, 2, 2]}
                        maxBarSize={12}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="net"
                        name="Net"
                        stroke="#0f172a"
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  ) : (
                    <AreaChart data={subsData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ph-cum" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
                      <YAxis {...axisProps} width={40} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={0} stroke="#cbd5e1" />
                      <Area
                        type="monotone"
                        dataKey="cumulative"
                        name="Net cumulé"
                        stroke="#059669"
                        strokeWidth={1.5}
                        fill="url(#ph-cum)"
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <LifetimePanel />

          {/* Calendar month */}
          <Section title={overview.month.label} source="phoenix" hint="mois calendaire complet">
            <div className="grid grid-cols-3 gap-1.5">
              <Stat
                label="Transactions réussies"
                value={formatNumber(overview.month.totalTransactions)}
              />
              <Stat
                label="Remboursements"
                value={formatNumber(overview.month.refunds.count)}
                sub={`${pct(overview.month.refunds.rate)} · ${formatCurrency(overview.month.refunds.amount)}`}
              />
              <Stat
                label="Chargebacks"
                value={formatNumber(overview.month.chargebacks.count)}
                sub={overview.month.chargebacks.count ? pct(overview.month.chargebacks.rate) : "aucun"}
              />
            </div>
          </Section>
        </div>
      ) : null}

      {overview && tab === "checkout" ? (
        <div className="space-y-2">
          <Card className="p-2.5">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Taux d&apos;approbation par processeur
              <TzBadge source="phoenix" />
            </h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={processorChart}
                  layout="vertical"
                  margin={{ top: 0, right: 32, left: 4, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} {...axisProps} unit="%" />
                  <YAxis
                    type="category"
                    dataKey="short"
                    {...axisProps}
                    width={narrow ? 80 : 140}
                    tick={{ fontSize: 9, fill: "#64748b" }}
                  />
                  <Tooltip
                    cursor={{ fill: "#f1f5f9" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as (typeof processorChart)[number];
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white/95 px-2 py-1.5 text-[10px] shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
                          <p className="font-medium text-slate-700 dark:text-slate-200">{row.name}</p>
                          <p className="text-slate-500">
                            {formatNumber(row.approved)} approuvées sur {formatNumber(row.attempts)} ·{" "}
                            {pct(row.approvalRate)}
                          </p>
                          <p className="text-slate-500">{formatCurrency(row.revenue)} de revenus</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="approvalRate" radius={[0, 3, 3, 0]} maxBarSize={16} isAnimationActive={false}>
                    {processorChart.map((row) => (
                      <Cell
                        key={row.name}
                        fill={
                          row.approvalRate >= 60
                            ? "#10b981"
                            : row.approvalRate >= 45
                              ? "#f59e0b"
                              : "#f43f5e"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-2 lg:grid-cols-2">
            <Card className="min-w-0 p-2.5">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Détail par processeur
                <TzBadge source="phoenix" />
              </h3>
              <PerfTable rows={overview.checkout.processors} />
            </Card>
            <Card className="min-w-0 p-2.5">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Motifs de refus
                <TzBadge source="phoenix" />
              </h3>
              <div className="thin-scroll overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      <th className="pb-1">Motif</th>
                      <th className="pb-1">Code</th>
                      <th className="pb-1 text-right">Occurrences</th>
                      <th className="pb-1 text-right">Part</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.checkout.declines.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-5 text-center text-slate-400">
                          Aucun refus sur la période
                        </td>
                      </tr>
                    ) : (
                      overview.checkout.declines.slice(0, 10).map((row) => (
                        <tr
                          key={`${row.code}-${row.reason}`}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="py-1 pr-2 text-slate-700 dark:text-slate-200">{row.reason}</td>
                          <td className="py-1 pr-2 text-slate-400">{row.code}</td>
                          <td className="py-1 text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {formatNumber(row.count)}
                          </td>
                          <td className="py-1 text-right tabular-nums text-slate-500">
                            {pct(row.share)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "refunds" ? (
        <PhoenixRefundPanel canWrite={canWrite || isAdmin} onDone={() => void load()} />
      ) : null}
    </div>
  );
}

const ratio = (value: number | null) => (value == null ? "—" : `${value.toFixed(2)}×`);

const BUCKET_COLORS: Record<(typeof CAMPAIGN_BUCKETS)[number], string> = {
  hyperscaling: "#4f46e5",
  scaling: "#0ea5e9",
  testing: "#f59e0b",
  other: "#94a3b8",
};

/** Hidden on phones, where the cards already stack in reading order. */
function Operator({ symbol }: { symbol: string }) {
  return (
    <div className="hidden items-center justify-center text-lg font-light text-slate-300 sm:flex dark:text-slate-600">
      {symbol}
    </div>
  );
}

/**
 * The three sources on one line: Meta pays, Shopify carries the direct sales
 * and Phoenix the subscription legs. Upsells stay out of the ratio.
 */
function RoasBlock({ data, loading }: { data: RoasDaily | null; loading: boolean }) {
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/60">
        {loading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-emerald-500" />
            Chargement Meta et Shopify…
          </>
        ) : (
          "Meta et Shopify indisponibles."
        )}
      </div>
    );
  }

  const totals = data.totals;
  const buckets = data.meta?.byBucket;

  return (
    <Section
      title="Performance globale"
      source="mixed"
      hint="Meta paie · Shopify direct · Phoenix abonnements"
      right={
        loading ? <Loader2 className="h-3 w-3 animate-spin text-emerald-500" /> : undefined
      }
    >
      <div className="space-y-2">
        {/* What gets read first: what we paid and what the store sold. */}
        <div className="grid grid-cols-2 gap-2">
          <KpiCard
            accent="indigo"
            source="meta"
            label="Dépense Meta"
            value={formatCurrency(totals.spend)}
            sub={
              totals.spendManual > 0
                ? `dont ${formatCurrency(totals.spendManual)} saisis à la main`
                : `${data.meta?.tokensWorking ?? 0}/${data.meta?.tokensTotal ?? 0} tokens actifs`
            }
          />
          <KpiCard
            accent="sky"
            source="shopify"
            label="Ventes Shopify"
            value={formatCurrency(totals.directRevenue)}
            sub={`${formatNumber(totals.shopifyOrders)} commandes · ${formatCurrency(totals.shopifyReturns)} de retours déduits`}
          />
        </div>

        {/* Both ratios share the same denominator, so they add up exactly.
            On phones the operators drop out and the combined card spans full width. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_20px_1fr_20px_1.2fr] sm:items-center [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
          <KpiCard
            accent="emerald"
            source="shopify"
            label="ROAS OTP"
            value={ratio(totals.roasDirect)}
            sub={`${formatCurrency(totals.directRevenue)} de ventes uniques`}
          />
          <Operator symbol="+" />
          <KpiCard
            accent="violet"
            source="phoenix"
            label="ROAS abonnements"
            value={ratio(totals.roasRebill)}
            sub={`${formatCurrency(totals.rebillRevenue)} initial + recurring + salvage`}
          />
          <Operator symbol="=" />
          <KpiCard
            accent="amber"
            source="mixed"
            label="ROAS combiné"
            size="lg"
            value={ratio(totals.roasGlobal)}
            sub={`${formatCurrency(totals.totalRevenue)} pour ${formatCurrency(totals.spend)} dépensés`}
          />
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          <Surface accent="indigo" className="p-3">
            <PanelTitle
              accent="indigo"
              right={
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                    {formatCurrency(totals.spend)}
                  </span>
                  <TzBadge source="meta" />
                </span>
              }
            >
              Dépense Meta par phase
            </PanelTitle>
            <div className="mt-2.5">
              <SplitBar
                total={totals.spend}
                format={formatCurrency}
                items={CAMPAIGN_BUCKETS.map((bucket) => ({
                  label: BUCKET_LABELS[bucket],
                  value: buckets?.[bucket] ?? 0,
                  color: BUCKET_COLORS[bucket],
                }))}
              />
            </div>
          </Surface>

          <Surface accent="violet" className="p-3">
            <PanelTitle
              accent="violet"
              right={
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                    {formatCurrency(totals.rebillRevenue)}
                  </span>
                  <TzBadge source="phoenix" />
                </span>
              }
            >
              Revenus abonnements
            </PanelTitle>
            <div className="mt-2.5">
              <SplitBar
                total={totals.rebillRevenue}
                format={formatCurrency}
                items={[
                  { label: "Initial", value: totals.initialRevenue, color: "#8b5cf6" },
                  { label: "Recurring", value: totals.recurringRevenue, color: "#10b981" },
                  { label: "Salvage", value: totals.salvageRevenue, color: "#0ea5e9" },
                ]}
              />
            </div>
          </Surface>
        </div>

        {data.warnings.length ? (
          <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1.5 dark:border-amber-500/25 dark:bg-amber-500/10">
            {data.warnings.map((warning) => (
              <li key={warning} className="text-[10px] text-amber-800 dark:text-amber-200">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  );
}

function PerfTable({ rows }: { rows: PhoenixOverview["checkout"]["processors"] }) {
  if (!rows.length) {
    return <p className="py-5 text-center text-[11px] text-slate-400">Aucune donnée sur la période</p>;
  }
  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full min-w-[400px] text-left text-[11px]">
        <thead>
          <tr className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <th className="pb-1">Processeur</th>
            <th className="pb-1 text-right">Tentatives</th>
            <th className="pb-1 text-right">Approuvées</th>
            <th className="pb-1 text-right">Taux</th>
            <th className="pb-1 text-right">Revenus</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-slate-100 dark:border-slate-800">
              <td className="max-w-[180px] truncate py-1 pr-2 text-slate-700 dark:text-slate-200">
                {row.name}
              </td>
              <td className="py-1 text-right tabular-nums text-slate-500">
                {formatNumber(row.attempts)}
              </td>
              <td className="py-1 text-right tabular-nums text-slate-500">
                {formatNumber(row.approved)}
              </td>
              <td className={cn("py-1 text-right font-semibold tabular-nums", toneForRate(row.approvalRate))}>
                {pct(row.approvalRate)}
              </td>
              <td className="py-1 text-right tabular-nums text-slate-700 dark:text-slate-200">
                {formatCurrency(row.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
