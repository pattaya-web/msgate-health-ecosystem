"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type Point = { date: string; label: string; spend: number; sales: number; orders: number; roas: number | null };

/**
 * La dépense Meta jour par jour face aux ventes Shopify du même jour (heure de
 * Paris des deux côtés), avec le ROAS du jour. La dépense est convertie en
 * dollars (comptes en euros) ; pour un associé, le serveur ne renvoie que ses
 * comptes.
 */
export function DailySpendChart({ start, end, reloadKey }: { start: string; end: string; reloadKey: number }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [points, setPoints] = useState<Point[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const [spendRes, salesRes] = await Promise.all([
          fetch(`/api/meta/accounts?start=${start}&end=${end}`, { cache: "no-store" }),
          fetch(`/api/shopify/daily?start=${start}&end=${end}`, { cache: "no-store" }),
        ]);
        const spend = (await spendRes.json()) as { byDate?: Record<string, number>; conversion?: string | null };
        const sales = (await salesRes.json().catch(() => ({}))) as { series?: Array<{ date: string; netSales: number; orders: number }> };
        if (cancelled) return;
        const byDay = new Map((sales.series ?? []).map((point) => [point.date, point]));
        const days: string[] = [];
        for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`) && days.length < 120; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          days.push(cursor.toISOString().slice(0, 10));
        }
        setPoints(
          days.map((date) => {
            const spent = spend.byDate?.[date] ?? 0;
            const shop = byDay.get(date);
            const revenue = shop?.netSales ?? 0;
            return { date, label: `${date.slice(8)}/${date.slice(5, 7)}`, spend: spent, sales: revenue, orders: shop?.orders ?? 0, roas: spent > 0 ? revenue / spent : null };
          })
        );
        setNote(spend.conversion ?? null);
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [start, end, reloadKey]);

  const totals = useMemo(() => {
    const spend = (points ?? []).reduce((sum, point) => sum + point.spend, 0);
    const sales = (points ?? []).reduce((sum, point) => sum + point.sales, 0);
    const orders = (points ?? []).reduce((sum, point) => sum + point.orders, 0);
    return { spend, sales, orders, roas: spend > 0 ? sales / spend : null };
  }, [points]);

  const spendColor = dark ? "rgba(148,163,184,0.45)" : "rgba(100,116,139,0.35)";
  const salesColor = dark ? "#34d399" : "#059669";
  const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)";
  const tick = dark ? "#64748b" : "#94a3b8";

  return (
    <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Dépense par jour · ventes Shopify</span>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : null}
        <span className="ml-auto text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">
          pub {formatCurrency(totals.spend)} · ventes {formatCurrency(totals.sales)} · {totals.orders} commandes · ROAS {totals.roas != null ? totals.roas.toFixed(2) : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-48">
        {points?.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
              <YAxis tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k$` : `${Math.round(v)}$`)} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]?.payload as Point;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10.5px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
                      <p className="mb-0.5 font-medium text-slate-500">{label}</p>
                      <p className="tabular-nums text-slate-700 dark:text-slate-200">Pub {formatCurrency(point.spend)}</p>
                      <p className="tabular-nums text-slate-700 dark:text-slate-200">
                        Ventes {formatCurrency(point.sales)} · {point.orders} cmd
                      </p>
                      <p className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">ROAS {point.roas != null ? point.roas.toFixed(2) : "—"}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="spend" name="Pub" fill={spendColor} radius={[5, 5, 0, 0]} maxBarSize={22} animationDuration={600} />
              <Line dataKey="sales" name="Ventes" type="monotone" stroke={salesColor} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} animationDuration={800} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-400">{loading ? "Chargement…" : "Aucune donnée sur la période"}</div>
        )}
      </div>
      {note ? <p className="mt-1 text-[9.5px] text-slate-400">{note}</p> : null}
    </div>
  );
}
