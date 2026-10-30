"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BadgeDollarSign, CalendarHeart, Loader2, Megaphone, MousePointerClick, ShoppingBag, Sparkles, Target } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { AssociateHeader, Kpi, ago, pct, ratio, usd, usdShort, useNow } from "@/components/associate/parts";
import { useAssociateOverview } from "@/components/associate/use-associate-overview";

/**
 * Le tableau de bord de l'accès Associé : ventes Straight sale de la boutique,
 * dépense Meta, ROAS face à la cible, conversion et ventes en temps réel.
 * Une seule source, /api/associate/overview : le serveur ne lui sert rien
 * d'autre (src/lib/auth/guard.ts), ni processeur, ni abonnement.
 */

const shortDay = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const revenue = payload.find((entry) => entry.dataKey === "revenue")?.value ?? 0;
  const orders = payload.find((entry) => entry.dataKey === "orders")?.value ?? 0;
  return (
    <div className="r-card px-3 py-2 text-[11.5px]" style={{ borderRadius: 14 }}>
      <p className="r-label mb-0.5">{label}</p>
      <p className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
        {usd(revenue)}
      </p>
      <p className="r-sub">{orders} vente(s)</p>
    </div>
  );
}

export default function AssociatePage() {
  const { isAssociate, isAdmin } = useAuth();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const now = useNow();
  const { range, setRange, overview, loading, error, loadedAt, building, refresh } = useAssociateOverview();

  const chartData = useMemo(() => (overview?.sales.series ?? []).map((point) => ({ ...point, label: shortDay(point.date) })), [overview]);

  const sales = overview?.sales;
  const profit = overview?.profit;
  const roas = overview?.roas ?? null;
  const roasTone = roas == null ? undefined : profit?.targetRoas != null && roas >= profit.targetRoas ? "good" : profit?.breakEvenRoas != null && roas >= profit.breakEvenRoas ? "warn" : "bad";
  const roasMax = Math.max(roas ?? 0, profit?.targetRoas ?? 0, profit?.breakEvenRoas ?? 0, 1) * 1.15;

  const accent = dark ? "#ff7aa8" : "#e85a8b";
  const bar = dark ? "rgba(255,176,203,0.28)" : "rgba(232,90,139,0.18)";
  const grid = dark ? "rgba(255,160,195,0.08)" : "rgba(180,47,96,0.08)";
  const tick = dark ? "#8a6474" : "#c29fae";

  return (
    <div className="space-y-4">
      {!isAssociate ? (
        <div className="r-chip w-full justify-between" style={{ height: "auto", padding: "8px 14px", borderRadius: 16 }}>
          <span>Vue Associé : exactement ce que voit Alison.</span>
          {isAdmin ? (
            <Link href="/settings" className="font-semibold underline underline-offset-2">
              Régler le périmètre
            </Link>
          ) : null}
        </div>
      ) : null}

      <AssociateHeader
        title="Straight sale"
        subtitle="Ventes directes de la boutique et publicité Meta associée"
        shop={overview?.shop.name ?? null}
        range={range}
        onRange={setRange}
        loading={loading}
        onRefresh={refresh}
        liveAt={overview?.live.updatedAt ?? loadedAt}
        now={now}
      />

      {error ? (
        <div className="r-card flex items-center gap-2 px-4 py-3 text-[12.5px]" style={{ color: "var(--r-bad)" }}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {building ? (
        <div className="r-card r-rise flex items-center gap-2 px-4 py-3 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--r-accent)" }} />
          Synchronisation des ventes en cours, les chiffres se complètent…
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Chiffre d'affaires"
          value={sales ? usdShort(sales.revenue) : "—"}
          sub={sales ? `${sales.orders} vente(s) · panier moyen ${sales.average != null ? usd(sales.average) : "—"}` : "Chargement…"}
          icon={<BadgeDollarSign className="h-4 w-4" />}
          delay={0}
        />
        <Kpi
          label="Dépense Meta Ads"
          value={overview ? usdShort(overview.meta.spend) : "—"}
          sub={
            overview
              ? overview.meta.spend > 0
                ? `coût par vente ${overview.cpa != null ? usd(overview.cpa) : "—"}`
                : "Aucune dépense sur la période"
              : "Chargement…"
          }
          icon={<Megaphone className="h-4 w-4" />}
          delay={60}
        />
        <Kpi
          label="ROAS"
          value={ratio(roas)}
          tone={roasTone}
          sub={profit?.targetRoas != null ? `cible ${ratio(profit.targetRoas)} · minimum ${ratio(profit.breakEvenRoas)}` : "cible calculée dès les premières ventes"}
          icon={<Target className="h-4 w-4" />}
          delay={120}
        />
        <Kpi
          label="Taux de conversion"
          value={overview?.conversion ? pct(overview.conversion.rate * 100, 2) : "—"}
          sub={overview?.conversion ? `${overview.conversion.sessions.toLocaleString("fr-FR")} visites · ${pct(overview.conversion.cartRate * 100)} ajout panier` : "Visites de la boutique"}
          icon={<MousePointerClick className="h-4 w-4" />}
          delay={180}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="r-card r-rise p-4" style={{ animationDelay: "220ms" }}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="r-label">Ventes par jour</p>
              <p className="mt-0.5 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                {sales ? usd(sales.revenue) : "—"}
              </p>
            </div>
            <span className="r-sub">heure de Paris</span>
          </div>
          <div className="h-64">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rose-rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent} stopOpacity={dark ? 0.45 : 0.32} />
                      <stop offset="100%" stopColor={accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={grid} strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis yAxisId="rev" tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k$` : `${Math.round(v)}$`)} />
                  <YAxis yAxisId="orders" orientation="right" hide />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: accent, strokeOpacity: 0.25 }} />
                  <Bar yAxisId="orders" dataKey="orders" fill={bar} radius={[6, 6, 0, 0]} maxBarSize={18} animationDuration={700} />
                  <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke={accent} strokeWidth={2.4} fill="url(#rose-rev)" animationDuration={900} activeDot={{ r: 5, fill: accent, stroke: dark ? "#150a10" : "#fff", strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center r-sub">{loading ? "Chargement…" : "Aucune vente sur la période"}</div>
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="r-card r-rise p-4" style={{ animationDelay: "260ms" }}>
            <div className="mb-3 flex items-center justify-between">
              <p className="r-label">Aujourd&apos;hui</p>
              <span className="r-icon">
                <CalendarHeart className="h-4 w-4" />
              </span>
            </div>
            <p className="r-value">{sales ? usd(sales.today.revenue) : "—"}</p>
            <p className="r-sub mt-1.5">{sales ? `${sales.today.orders} vente(s) depuis minuit` : ""}</p>
          </div>

          <div className="r-card r-rise p-4" style={{ animationDelay: "300ms" }}>
            <div className="mb-2 flex items-center justify-between">
              <p className="r-label">Rentabilité</p>
              <span className="r-icon">
                <Sparkles className="h-4 w-4" />
              </span>
            </div>
            <div className="relative mt-3 h-2.5 rounded-full" style={{ background: "var(--r-accent-soft)" }}>
              {profit?.breakEvenRoas != null ? (
                <span className="absolute -top-1 h-4.5 w-0.5 rounded-full" style={{ left: `${(profit.breakEvenRoas / roasMax) * 100}%`, background: "var(--r-warn)" }} title="ROAS minimum" />
              ) : null}
              {profit?.targetRoas != null ? (
                <span className="absolute -top-1 h-4.5 w-0.5 rounded-full" style={{ left: `${(profit.targetRoas / roasMax) * 100}%`, background: "var(--r-good)" }} title="ROAS cible" />
              ) : null}
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.min(100, ((roas ?? 0) / roasMax) * 100)}%`, background: "linear-gradient(90deg, var(--r-accent-2), var(--r-accent))", transition: "width .8s var(--ease-out-expo)" }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["Actuel", ratio(roas), "var(--ink)"],
                ["Minimum", ratio(profit?.breakEvenRoas), "var(--r-warn)"],
                ["Cible", ratio(profit?.targetRoas), "var(--r-good)"],
              ].map(([label, value, color]) => (
                <div key={label}>
                  <p className="r-label">{label}</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums" style={{ color }}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <p className="r-sub mt-2.5">
              Sous le minimum, la pub coûte plus qu&apos;elle ne rapporte. La cible donne {profit ? pct(profit.targetMargin, 0) : "—"} de marge nette.
            </p>
          </div>
        </div>
      </div>

      <div className="r-card r-rise p-4" style={{ animationDelay: "340ms" }}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="r-icon">
              <ShoppingBag className="h-4 w-4" />
            </span>
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              Dernières ventes
            </p>
          </div>
          <span className="r-chip" style={{ height: 26 }}>
            <span className="r-live-dot" />
            en direct
          </span>
        </div>
        {overview?.live.orders.length ? (
          <ul>
            {overview.live.orders.map((order, index) => (
              <li
                key={`${order.at}-${index}`}
                className="r-row-in flex items-center gap-3 border-b py-2.5 last:border-0"
                style={{ animationDelay: `${index * 40}ms`, borderColor: "var(--line-soft)" }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--r-accent)" }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                  {order.number ?? "Commande"}
                </span>
                <span className="r-sub">{ago(order.at, now)}</span>
                <span className="w-20 text-right text-[13px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                  {usd(order.amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="r-sub py-4 text-center">{loading ? "Chargement…" : "Pas encore de vente."}</p>
        )}
      </div>
    </div>
  );
}
