"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/phoenix/date-range-picker";
import { TzBadge } from "@/components/phoenix/source-clocks";
import {
  MiniStat,
  NumberField as Field,
  PanelTitle,
  Segmented,
  Surface,
} from "@/components/phoenix/ui";
import type { ProfitInputs } from "@/lib/metrics/profit-inputs";

/**
 * Front-end break-even model: what first-rebill approval rate the ads need to
 * pay for themselves. Same maths as the VIP Club break-even calculator, fed
 * with our own spend, front-end revenue, signups and observed rebill price —
 * and benchmarked against the approval rate we actually achieve.
 *
 * First rebill only: month 2+, salvage and later retention are out of scope.
 */

type Scope = "vip" | "all";

type Fields = {
  adSpend: string;
  frontRevenue: string;
  sales: string;
  membershipPrice: string;
  cogsPerOrder: string;
};

const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD"] as const;
type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
  AUD: "A$",
};

const PRESETS = [7, 14, 30] as const;
const CYCLE_PRESETS = [7, 14, 30] as const;
const STORAGE_KEY = "msgate.break-even-calculator";

/** Keeps the projection table readable whatever lifetime is observed. */
const MAX_CYCLES = 24;

function presetRange(days: number) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatCount = (value: number) => new Intl.NumberFormat("fr-FR").format(value);

/** Expected rebills after k cycles when each cycle survives at rate r: r + r² + … + r^k. */
function geometricSum(rate: number, cycles: number) {
  if (rate >= 1) return cycles;
  if (rate <= 0) return 0;
  return (rate * (1 - Math.pow(rate, cycles))) / (1 - rate);
}

/** How many billing cycles an average subscriber lives through. */
function cyclesForLifetime(lifetimeDays: number, cycleDays: number) {
  if (!(lifetimeDays > 0) || !(cycleDays > 0)) return 1;
  return clamp(Math.round(lifetimeDays / cycleDays), 1, MAX_CYCLES);
}

/* ------------------------------------------------------------------ */

const Metric = MiniStat;

const inlineInputClass =
  "h-7 rounded-lg bg-white px-1.5 text-[11px] font-medium tabular-nums text-slate-900 ring-1 ring-slate-900/[0.08] outline-none transition-all duration-200 focus:ring-2 focus:ring-violet-500/40 dark:bg-slate-900 dark:text-slate-50 dark:ring-white/[0.08]";

const selectClass =
  "h-8 rounded-xl bg-white px-2.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-900/[0.08] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/[0.08]";

/* ------------------------------------------------------------------ */

export function BreakEvenCalculator() {
  const [fields, setFields] = useState<Fields>({
    adSpend: "",
    frontRevenue: "",
    sales: "",
    membershipPrice: "",
    cogsPerOrder: "",
  });
  const [currency, setCurrency] = useState<Currency>("USD");
  const [scope, setScope] = useState<Scope>("vip");
  const [days, setDays] = useState<number | "custom">(7);
  const [custom, setCustom] = useState(presetRange(7));
  const [approval, setApproval] = useState(65);
  const [cycleDays, setCycleDays] = useState("7");
  const [cycles, setCycles] = useState("3");
  const [retentionRate, setRetentionRate] = useState("");
  const [inputs, setInputs] = useState<ProfitInputs | null>(null);
  const [loading, setLoading] = useState(true);
  const [restored, setRestored] = useState(false);

  const range = days === "custom" ? custom : presetRange(days);

  // COGS is the only figure we cannot observe, so it is the only one persisted.
  // localStorage is unreachable during the server render, hence the effect.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as {
        cogsPerOrder?: string;
        currency?: Currency;
        scope?: Scope;
        cycleDays?: string;
      };
      if (saved.cogsPerOrder != null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFields((current) => ({ ...current, cogsPerOrder: saved.cogsPerOrder as string }));
      }
      if (saved.currency && CURRENCIES.includes(saved.currency)) setCurrency(saved.currency);
      if (saved.scope === "vip" || saved.scope === "all") setScope(saved.scope);
      if (saved.cycleDays) setCycleDays(saved.cycleDays);
    } catch {
      // first visit, nothing stored
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ cogsPerOrder: fields.cogsPerOrder, currency, scope, cycleDays })
    );
  }, [fields.cogsPerOrder, currency, scope, cycleDays, restored]);

  const applyAuto = useCallback((data: ProfitInputs, nextScope: Scope) => {
    const be = data.breakEven;
    setFields((current) => ({
      ...current,
      adSpend: String(be.adSpend),
      frontRevenue: String(nextScope === "vip" ? be.frontRevenueVip : be.frontRevenueAll),
      sales: String(nextScope === "vip" ? be.salesVip : be.salesAll),
      membershipPrice: String(be.membershipPrice),
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const params = new URLSearchParams({ start: range.start, end: range.end });
        const res = await fetch(`/api/profit/inputs?${params}`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled || !res.ok) return;

        const data = body as ProfitInputs;
        setInputs(data);
        applyAuto(data, scope);
        // Start the simulator on the rate we actually achieve, not a guess.
        if (data.breakEven.observedApprovalRate > 0) {
          setApproval(Math.round(data.breakEven.observedApprovalRate));
          setRetentionRate(String(data.breakEven.observedApprovalRate));
        }
        setCycles(String(cyclesForLifetime(data.retention.avgLifetimeDays, Number(cycleDays))));
      } catch {
        // keep whatever is on screen
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Scope changes are applied without refetching, just below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end, applyAuto]);

  const changeScope = (next: Scope) => {
    setScope(next);
    if (inputs) applyAuto(inputs, next);
  };

  const changeCycle = (next: string) => {
    setCycleDays(next);
    if (inputs) setCycles(String(cyclesForLifetime(inputs.retention.avgLifetimeDays, Number(next))));
  };

  const money = useCallback(
    (value: number) =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(value) ? value : 0),
    [currency]
  );

  const result = useMemo(() => {
    const val = (key: keyof Fields) => Math.max(0, Number(fields[key]) || 0);

    const adSpend = val("adSpend");
    const frontRevenue = val("frontRevenue");
    const sales = val("sales");
    const membershipPrice = val("membershipPrice");
    const totalCogs = val("cogsPerOrder") * sales;

    const rebillRevenueNeeded = Math.max(0, adSpend + totalCogs - frontRevenue);
    const rebillRevenueAt100 = sales * membershipPrice;
    const breakEvenRate =
      rebillRevenueAt100 > 0 ? (rebillRevenueNeeded / rebillRevenueAt100) * 100 : 0;

    const projectedRebill = (rebillRevenueAt100 * approval) / 100;
    const totalRevenue = frontRevenue + projectedRebill;
    const projectedProfit = totalRevenue - adSpend - totalCogs;

    const nearBand = Math.max(50, (adSpend + totalCogs) * 0.02);
    const status =
      adSpend <= 0 && frontRevenue <= 0
        ? "waiting"
        : projectedProfit < -nearBand
          ? "loss"
          : Math.abs(projectedProfit) <= nearBand
            ? "near"
            : "profit";

    return {
      adSpend,
      frontRevenue,
      sales,
      membershipPrice,
      totalCogs,
      rebillRevenueNeeded,
      rebillRevenueAt100,
      breakEvenRate,
      frontRoas: adSpend > 0 ? frontRevenue / adSpend : 0,
      totalRoas: adSpend > 0 ? totalRevenue / adSpend : 0,
      cpa: sales > 0 ? adSpend / sales : 0,
      aov: sales > 0 ? frontRevenue / sales : 0,
      projectedRebill,
      totalRevenue,
      projectedProfit,
      profitPerCustomer: sales > 0 ? projectedProfit / sales : 0,
      hasInputs: adSpend > 0 && sales > 0 && membershipPrice > 0,
      status,
    };
  }, [fields, approval]);

  /**
   * Beyond the first rebill, each cycle only happens for the customers who
   * survived the previous ones, so expected rebills compound geometrically:
   * r + r² + … + r^n. The cost to recover stays fixed, which is what makes a
   * break-even cycle appear.
   */
  const projection = useMemo(() => {
    const cycleLength = Math.max(1, Number(cycleDays) || 0);
    const horizon = clamp(Math.round(Number(cycles) || 0), 1, MAX_CYCLES);
    const survival = clamp((Number(retentionRate) || 0) / 100, 0, 1);
    const cost = result.adSpend + result.totalCogs;
    const perCycleRevenue = result.sales * result.membershipPrice;

    const rows = Array.from({ length: horizon }, (_, index) => {
      const cycle = index + 1;
      const rebillsPerCustomer = geometricSum(survival, cycle);
      const revenue = result.frontRevenue + perCycleRevenue * rebillsPerCustomer;

      return {
        cycle,
        day: cycle * cycleLength,
        rebillsPerCustomer,
        revenue,
        profit: revenue - cost,
      };
    });

    const last = rows[rows.length - 1];
    const breakEvenCycle = rows.find((row) => row.profit >= 0)?.cycle ?? null;

    return {
      cycleLength,
      horizon,
      survival,
      rows,
      breakEvenCycle,
      breakEvenDay: breakEvenCycle == null ? null : breakEvenCycle * cycleLength,
      rebillsPerCustomer: last?.rebillsPerCustomer ?? 0,
      revenue: last?.revenue ?? 0,
      profit: last?.profit ?? 0,
      revenuePerCustomer: result.sales > 0 ? (last?.revenue ?? 0) / result.sales : 0,
      roas: result.adSpend > 0 ? (last?.revenue ?? 0) / result.adSpend : 0,
    };
  }, [cycleDays, cycles, retentionRate, result]);

  const observed = inputs?.breakEven.observedApprovalRate ?? 0;
  const headroom = observed - result.breakEvenRate;
  const symbol = SYMBOLS[currency];

  const verdict = !result.hasInputs
    ? "Renseigne tes chiffres pour calculer le taux d'approbation nécessaire."
    : result.rebillRevenueNeeded <= 0
      ? "Ton revenu front-end couvre déjà la pub et les COGS avant le moindre rebill."
      : result.breakEvenRate > 100
        ? "Même 100 % d'approbation au premier rebill ne rembourserait pas la campagne."
        : `Il te faut environ ${result.breakEvenRate.toFixed(1)} % des premiers rebills approuvés pour être à l'équilibre.`;

  return (
    <section className="space-y-2">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="shrink-0 text-[13px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Break-even front-end
        </h2>
        <TzBadge source="mixed" />

        <Segmented
          size="sm"
          value={days}
          onChange={(next) => {
            if (next !== "custom") setLoading(true);
            setDays(next);
          }}
          options={[
            ...PRESETS.map((preset) => ({
              value: preset as number | "custom",
              label: `${preset} jours`,
            })),
            { value: "custom" as number | "custom", label: "Perso" },
          ]}
        />

        {days === "custom" ? (
          <DateRangePicker
            value={custom}
            onChange={(next) => {
              setLoading(true);
              setCustom(next);
            }}
            className="h-8 text-[11px]"
          />
        ) : (
          <span className="text-[11px] text-slate-400">
            {range.start} au {range.end}
          </span>
        )}

        <Segmented
          size="sm"
          accent="violet"
          value={scope}
          onChange={changeScope}
          options={[
            { value: "vip" as Scope, label: "VIP seul" },
            { value: "all" as Scope, label: "Tout + Shopify" },
          ]}
        />

        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
          className={selectClass}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        {loading ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-emerald-500" /> : null}
      </div>

      <div className="grid gap-2 lg:grid-cols-[300px_1fr]">
        {/* Inputs */}
        <div className="min-w-0 space-y-2">
          <Surface accent="indigo" className="p-3">
            <PanelTitle accent="indigo" className="mb-2.5">
              Performance des campagnes
            </PanelTitle>
            <div className="space-y-2.5">
              <Field
                label="Dépense publicitaire"
                value={fields.adSpend}
                onChange={(v) => setFields((c) => ({ ...c, adSpend: v }))}
                prefix={symbol}
                auto
                hint="Meta, période choisie"
              />
              <Field
                label="Revenu front-end"
                value={fields.frontRevenue}
                onChange={(v) => setFields((c) => ({ ...c, frontRevenue: v }))}
                prefix={symbol}
                auto
                hint={
                  scope === "vip"
                    ? "premières commandes VIP (Phoenix initial)"
                    : "VIP initial + commandes Shopify"
                }
              />
              <Field
                label="Nombre de ventes"
                value={fields.sales}
                onChange={(v) => setFields((c) => ({ ...c, sales: v }))}
                auto
                hint={
                  scope === "vip" ? "clients VIP acquis" : "clients VIP + acheteurs Shopify"
                }
              />
            </div>
          </Surface>

          <Surface accent="violet" className="p-3">
            <PanelTitle accent="violet" className="mb-2.5">
              Abonnement
            </PanelTitle>
            <Field
              label="Prix du membership VIP"
              value={fields.membershipPrice}
              onChange={(v) => setFields((c) => ({ ...c, membershipPrice: v }))}
              prefix={symbol}
              auto
              hint={
                inputs?.breakEven.recurringApproved
                  ? `moyenne observée sur ${inputs.breakEven.recurringApproved} rebills`
                  : "montant du premier rebill"
              }
            />
          </Surface>

          <Surface accent="amber" className="p-3">
            <PanelTitle accent="amber" className="mb-2.5">
              Coûts produit
            </PanelTitle>
            <Field
              label="COGS moyen par commande"
              value={fields.cogsPerOrder}
              onChange={(v) => setFields((c) => ({ ...c, cogsPerOrder: v }))}
              prefix={symbol}
              hint="produit + logistique, vide pour du digital"
            />
            {result.totalCogs > 0 ? (
              <p className="mt-1.5 text-[10px] text-slate-400">
                Soit {money(result.totalCogs)} sur {result.sales} ventes.
              </p>
            ) : null}
          </Surface>
        </div>

        {/* Results */}
        <div className="min-w-0 space-y-2">
          <Surface accent="emerald" className="p-3.5">
            <PanelTitle accent="emerald">
              Taux d&apos;approbation du 1er rebill pour être à l&apos;équilibre
            </PanelTitle>
            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-emerald-700 dark:text-emerald-300">
                {result.breakEvenRate.toFixed(2)} %
              </p>
              {observed > 0 && result.hasInputs ? (
                <span
                  className={cn(
                    "rounded-lg px-2 py-1 text-[11px] font-semibold ring-1",
                    headroom >= 0
                      ? "bg-emerald-100/70 text-emerald-800 ring-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-200"
                      : "bg-rose-100/70 text-rose-700 ring-rose-500/20 dark:bg-rose-500/20 dark:text-rose-200"
                  )}
                >
                  ton taux réel {observed.toFixed(1)} % · {headroom >= 0 ? "+" : ""}
                  {headroom.toFixed(1)} pt
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
              {verdict}
            </p>
          </Surface>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric label="ROAS front-end" value={`${result.frontRoas.toFixed(2)}×`} />
            <Metric
              label="Revenu rebill nécessaire"
              value={money(result.rebillRevenueNeeded)}
            />
            <Metric
              label="Revenu rebill à 100 %"
              value={money(result.rebillRevenueAt100)}
            />
            <Metric label="Revenu front-end" value={money(result.frontRevenue)} />
            <Metric label="CPA réel" value={money(result.cpa)} />
            <Metric label="Panier moyen" value={money(result.aov)} />
          </div>

          <Surface plain className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                ROAS front-end
              </p>
              <p className="mt-1 text-base font-semibold leading-none tabular-nums text-slate-900 dark:text-slate-50">
                {result.frontRoas.toFixed(2)}×
              </p>
            </div>
            <span className="shrink-0 text-lg font-light text-slate-300 dark:text-slate-600">→</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                ROAS après 1er rebill
              </p>
              <p className="mt-1 text-base font-semibold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
                {result.totalRoas.toFixed(2)}×
              </p>
            </div>
          </Surface>

          {/* Simulator */}
          <Surface plain className="p-3">
            <div className="flex items-center gap-2">
              <PanelTitle>Simulateur 1er rebill</PanelTitle>
              {observed > 0 ? (
                <button
                  type="button"
                  onClick={() => setApproval(Math.round(observed))}
                  className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-medium text-slate-600 ring-1 ring-slate-900/[0.08] transition-all duration-200 hover:text-emerald-700 hover:ring-emerald-500/30 dark:bg-slate-900 dark:text-slate-300 dark:ring-white/[0.08]"
                >
                  <Target className="h-3 w-3" />
                  mon taux réel
                </button>
              ) : null}
              <span className="ml-auto text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {approval} %
              </span>
            </div>

            <div className="relative mt-4 pb-5">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={approval}
                onChange={(event) => setApproval(Number(event.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 dark:bg-slate-700"
                aria-label="Taux d'approbation attendu du premier rebill"
              />
              {result.rebillRevenueAt100 > 0 ? (
                <div
                  className="pointer-events-none absolute top-[-7px] flex flex-col items-center transition-all duration-200"
                  style={{
                    left: `${clamp(result.breakEvenRate, 0, 100)}%`,
                    transform: `translateX(${
                      result.breakEvenRate < 8 ? "0" : result.breakEvenRate > 92 ? "-100%" : "-50%"
                    })`,
                  }}
                >
                  <span className="h-5 w-0.5 rounded-full bg-slate-900 dark:bg-slate-100" />
                  <span className="mt-1 whitespace-nowrap rounded-md bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                    {result.breakEvenRate > 100
                      ? "BE >100 %"
                      : `BE ${result.breakEvenRate.toFixed(1)} %`}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
              {[
                ["Revenu rebill projeté", money(result.projectedRebill)],
                ["Revenu total après rebill", money(result.totalRevenue)],
                ["COGS total", money(result.totalCogs)],
                ["Dépense publicitaire", money(result.adSpend)],
                ["Profit par client", money(result.profitPerCustomer)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-2 border-b border-slate-900/[0.04] py-1 dark:border-white/[0.04]"
                >
                  <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {label}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div
              className={cn(
                "mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 ring-1 transition-all duration-200",
                result.status === "loss"
                  ? "bg-rose-50/70 ring-rose-500/20 dark:bg-rose-500/10"
                  : result.status === "near"
                    ? "bg-amber-50/70 ring-amber-500/20 dark:bg-amber-500/10"
                    : "bg-emerald-50/70 ring-emerald-500/20 dark:bg-emerald-500/10"
              )}
            >
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Profit projeté avant frais
                </p>
                <p
                  className={cn(
                    "mt-1 text-xl font-semibold leading-none tabular-nums",
                    result.projectedProfit >= 0
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {result.projectedProfit >= 0 ? "+" : ""}
                  {money(result.projectedProfit)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-sm dark:bg-slate-900/60 dark:text-slate-200">
                {result.status === "waiting"
                  ? "En attente"
                  : result.status === "loss"
                    ? "Perte"
                    : result.status === "near"
                      ? "Proche de l'équilibre"
                      : "Rentable"}
              </span>
            </div>

            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              {money(result.frontRevenue)} front-end + {money(result.projectedRebill)} de rebills −{" "}
              {money(result.adSpend)} de pub − {money(result.totalCogs)} de COGS ={" "}
              {result.projectedProfit >= 0 ? "+" : ""}
              {money(result.projectedProfit)}.
            </p>
          </Surface>

          {/* Multi-cycle projection */}
          <Surface accent="violet" className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <PanelTitle accent="violet">Projection sur plusieurs rebills</PanelTitle>

              <Segmented
                size="sm"
                accent="violet"
                value={Number(cycleDays)}
                onChange={(next) => changeCycle(String(next))}
                options={CYCLE_PRESETS.map((preset) => ({
                  value: preset as number,
                  label: `tous les ${preset} j`,
                }))}
              />

              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                cycle
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={cycleDays}
                  onChange={(event) => changeCycle(event.target.value)}
                  className={cn(inlineInputClass, "w-12")}
                />
                j
              </label>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                rétention/cycle
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={retentionRate}
                  onChange={(event) => setRetentionRate(event.target.value)}
                  className={cn(inlineInputClass, "w-14")}
                />
                %
              </label>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                horizon
                <input
                  type="number"
                  min="1"
                  max={MAX_CYCLES}
                  step="1"
                  value={cycles}
                  onChange={(event) => setCycles(event.target.value)}
                  className={cn(inlineInputClass, "w-12")}
                />
                cycles
              </label>
            </div>

            {inputs?.retention.churned ? (
              <div className="mt-2.5 space-y-1 rounded-xl bg-white/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500 shadow-sm dark:bg-slate-900/50 dark:text-slate-400">
                <p>
                  Un client reste{" "}
                  <strong className="text-slate-700 dark:text-slate-200">
                    {inputs.retention.avgLifetimeDays} jours en moyenne
                  </strong>{" "}
                  entre son premier paiement et le moment où il part, que ce soit par annulation,
                  remboursement ou litige. La moitié partent avant{" "}
                  {inputs.retention.medianLifetimeDays} jours.
                </p>
                <p>
                  Calculé sur les {formatCount(inputs.retention.churned)} clients réellement partis
                  ces {inputs.retention.windowDays} derniers jours, pas sur la période choisie en
                  haut, sinon l&apos;échantillon serait trop petit.
                </p>
                <p>
                  Avec un rebill tous les {projection.cycleLength} jours, il a donc le temps de payer
                  environ{" "}
                  <strong className="text-slate-700 dark:text-slate-200">
                    {cyclesForLifetime(inputs.retention.avgLifetimeDays, projection.cycleLength)}{" "}
                    rebills
                  </strong>{" "}
                  avant de partir. C&apos;est ce chiffre qui remplit la case « horizon », et tu peux
                  le changer à la main.
                </p>
              </div>
            ) : null}

            <div
              className={cn(
                "mt-2.5 rounded-xl px-3 py-2.5 ring-1 transition-all duration-200",
                projection.breakEvenCycle == null
                  ? "bg-rose-50/70 ring-rose-500/20 dark:bg-rose-500/10"
                  : "bg-emerald-50/70 ring-emerald-500/20 dark:bg-emerald-500/10"
              )}
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Retour sur investissement
              </p>
              <p className="mt-1 text-xs font-semibold leading-snug text-slate-800 dark:text-slate-100">
                {!result.hasInputs
                  ? "Renseigne tes chiffres pour projeter les cycles."
                  : projection.breakEvenCycle == null
                    ? `Mise non récupérée après ${projection.horizon} cycles, soit ${projection.horizon * projection.cycleLength} jours.`
                    : `Mise récupérée au rebill n° ${projection.breakEvenCycle}, soit environ ${projection.breakEvenDay} jours après l'acquisition.`}
              </p>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric
                label="Rebills par client"
                value={projection.rebillsPerCustomer.toFixed(2)}
              />
              <Metric label="Revenu par client" value={money(projection.revenuePerCustomer)} />
              <Metric
                label={`Profit sur ${projection.horizon} cycles`}
                value={`${projection.profit >= 0 ? "+" : ""}${money(projection.profit)}`}
                tone={
                  projection.profit >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                }
              />
              <Metric label="ROAS sur l'horizon" value={`${projection.roas.toFixed(2)}×`} />
            </div>

            <div className="thin-scroll mt-2 max-h-[200px] overflow-auto rounded-xl bg-white/70 px-2.5 py-1 shadow-sm dark:bg-slate-900/50">
              <table className="w-full min-w-[420px] text-left text-[11px]">
                <thead className="sticky top-0 bg-white/95 backdrop-blur dark:bg-slate-900/95">
                  <tr className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    <th className="py-1.5">Rebill</th>
                    <th className="py-1.5 text-right">Jour</th>
                    <th className="py-1.5 text-right">Rebills/client</th>
                    <th className="py-1.5 text-right">Revenu cumulé</th>
                    <th className="py-1.5 text-right">Profit cumulé</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.rows.map((row) => (
                    <tr
                      key={row.cycle}
                      className={cn(
                        "border-t border-slate-900/[0.04] transition-colors dark:border-white/[0.04]",
                        row.cycle === projection.breakEvenCycle
                          ? "bg-emerald-50/80 font-semibold dark:bg-emerald-500/10"
                          : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      )}
                    >
                      <td className="rounded-l-lg py-1.5 text-slate-600 dark:text-slate-300">
                        n° {row.cycle}
                        {row.cycle === projection.breakEvenCycle ? " · break-even" : ""}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">J+{row.day}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">
                        {row.rebillsPerCustomer.toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {money(row.revenue)}
                      </td>
                      <td
                        className={cn(
                          "rounded-r-lg py-1.5 text-right tabular-nums",
                          row.profit >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        )}
                      >
                        {row.profit >= 0 ? "+" : ""}
                        {money(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          <p className="rounded-xl bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 ring-1 ring-slate-900/[0.05] dark:bg-slate-900/50 dark:text-slate-400 dark:ring-white/[0.05]">
            <strong className="text-slate-700 dark:text-slate-200">Deux lectures.</strong> Le
            simulateur du haut ne compte que le premier rebill, comme l&apos;outil d&apos;origine. La
            projection ci-dessus étend le calcul aux rebills suivants en appliquant ta rétention à
            chaque cycle. Le salvage et les upsells restent hors modèle.
          </p>
        </div>
      </div>
    </section>
  );
}
