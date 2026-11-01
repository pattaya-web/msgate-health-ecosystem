"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BadgeDollarSign, CalendarHeart, Layers, Loader2, Megaphone, MousePointerClick, ShoppingBag, Sparkles, Target } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { AssociateHeader, Kpi, ago, pct, ratio, usd, usdShort, useNow } from "@/components/associate/parts";
import { useAssociateOverview } from "@/components/associate/use-associate-overview";
import type { AdminSales } from "@/lib/associate/admin-sales";
import type { OrderCategory } from "@/lib/phoenix/types";

/**
 * Le tableau de bord de l'accès Associé : ventes de la boutique, dépense Meta,
 * ROAS réel et ROAS Meta des campagnes, conversion et ventes en temps réel.
 * Une seule source, /api/associate/overview : le serveur ne lui sert rien
 * d'autre (src/lib/auth/guard.ts), ni processeur, ni abonnement.
 *
 * L'admin dans sa propre vue (peau bleue) voit les mêmes cartes, plus le
 * chiffre d'affaires par catégorie de vente et le ROAS combined, que le
 * serveur ne sert qu'à une session admin (src/lib/associate/admin-sales.ts).
 */

const CATEGORIES: Array<{ key: OrderCategory; label: string }> = [
  { key: "direct", label: "Straight sale" },
  { key: "initial", label: "VIP Initial" },
  { key: "recurring", label: "Recurring" },
  { key: "salvage", label: "Salvage" },
  { key: "upsell", label: "Upsell" },
];

/** Le bloc de l'admin : une tuile par catégorie (part du CA total en barre) et le ROAS combined. */
function AdminCategories({ admin, loading }: { admin: AdminSales | null; loading: boolean }) {
  const total = admin?.total ?? 0;
  return (
    <div className="r-card r-rise p-4" style={{ animationDelay: "200ms" }} data-admin-categories>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="r-icon">
            <Layers className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              Chiffre d&apos;affaires par catégorie
            </p>
            <p className="r-sub">mêmes boutiques et même période · ventes approuvées</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="r-chip" style={{ height: 26 }} title="Alison ne voit pas ce bloc">
            Admin seulement
          </span>
          <Link href="/settings" className="r-sub font-medium underline underline-offset-2">
            Régler le périmètre
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {CATEGORIES.map(({ key, label }) => {
          const entry = admin?.categories[key];
          const missing = admin != null && entry?.revenue == null;
          const share = entry?.revenue && total > 0 ? (entry.revenue / total) * 100 : 0;
          return (
            <div key={key} className="rounded-2xl px-3 py-2.5" style={{ background: "var(--r-accent-soft)" }}>
              <p className="r-label">{label}</p>
              <p className="mt-1 text-[19px] font-semibold tabular-nums leading-tight" style={{ color: missing ? "var(--ink-4)" : "var(--ink)" }}>
                {entry?.revenue != null ? usdShort(entry.revenue) : "—"}
              </p>
              <p className="r-sub mt-0.5 truncate" style={{ fontSize: 10.5 }}>
                {missing ? "disponible avec Reign" : entry ? `${entry.orders ?? 0} vente(s) · ${pct(share, 0)}` : loading ? "Chargement…" : "—"}
              </p>
              <div className="r-bar mt-1.5" style={{ height: 4 }}>
                <span style={{ width: `${Math.min(100, share)}%` }} />
              </div>
            </div>
          );
        })}
        <div className="rounded-2xl px-3 py-2.5" style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--r-accent) 16%, transparent), var(--r-accent-soft))", border: "1px solid color-mix(in oklab, var(--r-accent) 22%, transparent)" }}>
          <p className="r-label" style={{ color: "var(--r-accent-ink)" }}>
            ROAS combined
          </p>
          <p className="mt-1 text-[19px] font-semibold tabular-nums leading-tight" style={{ color: "var(--r-accent-ink)" }}>
            {ratio(admin?.roasCombined)}
          </p>
          <p className="r-sub mt-0.5 truncate" style={{ fontSize: 10.5 }} title="Tout le chiffre d'affaires des catégories ÷ dépense Meta">
            {admin ? `${usdShort(total)} ÷ dépense Meta` : loading ? "Chargement…" : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

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
  const { range, setRange, overview, admin, loading, error, loadedAt, building, refresh } = useAssociateOverview();
  // L'admin dans sa propre vue : peau bleue et bloc des catégories. En « Vue Alison », exactement la page d'Alison.
  const adminView = isAdmin && !isAssociate;

  const chartData = useMemo(() => (overview?.sales.series ?? []).map((point) => ({ ...point, label: shortDay(point.date) })), [overview]);

  const sales = overview?.sales;
  const roas = overview?.roas ?? null;
  const metaRoas = overview?.meta.metaRoas ?? null;
  const campaigns = overview?.meta.campaigns ?? [];
  const bestRoas = Math.max(1, ...campaigns.map((campaign) => campaign.roas ?? 0));

  // Le graphique suit la peau : Recharts pose ses couleurs en attributs SVG, où les variables CSS ne s'appliquent pas partout.
  const accent = adminView ? (dark ? "#60a5fa" : "#2563eb") : dark ? "#ff7aa8" : "#e85a8b";
  const bar = adminView ? (dark ? "rgba(147,197,253,0.26)" : "rgba(37,99,235,0.16)") : dark ? "rgba(255,176,203,0.28)" : "rgba(232,90,139,0.18)";
  const grid = adminView ? (dark ? "rgba(130,170,255,0.08)" : "rgba(29,78,216,0.08)") : dark ? "rgba(255,160,195,0.08)" : "rgba(180,47,96,0.08)";
  const tick = adminView ? (dark ? "#64789a" : "#91a3c4") : dark ? "#8a6474" : "#c29fae";
  const dotRing = adminView ? (dark ? "#0a1222" : "#fff") : dark ? "#150a10" : "#fff";

  return (
    <div className="space-y-4">
      {!isAssociate && !isAdmin ? (
        <div className="r-chip w-full justify-between" style={{ height: "auto", padding: "8px 14px", borderRadius: 16 }}>
          <span>Vue Associé : exactement ce que voit Alison.</span>
        </div>
      ) : null}

      <AssociateHeader
        title={overview?.shop.name ?? "Venom"}
        subtitle={sales ? `${usd(sales.revenue)} de chiffre d'affaires sur la période` : "Chargement…"}
        shop={null}
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

      {overview?.phoenix.error ? (
        <div className="r-card r-rise flex items-center gap-2 px-4 py-3 text-[12.5px]" style={{ color: "var(--r-bad)" }}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Ventes Shopify indisponibles : {overview.phoenix.error}
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
          label="ROAS réel"
          value={ratio(roas)}
          sub={`ventes ÷ dépense Meta · ROAS Meta ${ratio(metaRoas)}`}
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

      {adminView ? <AdminCategories admin={admin} loading={loading} /> : null}

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
                  <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke={accent} strokeWidth={2.4} fill="url(#rose-rev)" animationDuration={900} activeDot={{ r: 5, fill: accent, stroke: dotRing, strokeWidth: 2 }} />
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
              <div>
                <p className="r-label">ROAS des campagnes</p>
                <p className="r-sub mt-0.5">attribué par Meta, sur la période</p>
              </div>
              <span className="r-icon">
                <Sparkles className="h-4 w-4" />
              </span>
            </div>
            {campaigns.length ? (
              <ul className="mt-2 space-y-2.5">
                {campaigns.slice(0, 6).map((campaign, index) => (
                  <li key={campaign.id} className="r-row-in" style={{ animationDelay: `${340 + index * 50}ms` }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[12px] font-medium" style={{ color: campaign.status === "ACTIVE" ? "var(--ink)" : "var(--ink-3)" }} title={campaign.name}>
                        {campaign.name}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: "var(--r-accent-ink)" }}>
                        {ratio(campaign.roas)}
                      </span>
                    </div>
                    <p className="r-sub truncate" style={{ fontSize: 10.5 }} title={campaign.account}>
                      {campaign.account}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="r-bar flex-1" style={{ height: 5 }}>
                        <span style={{ width: `${Math.min(100, ((campaign.roas ?? 0) / bestRoas) * 100)}%` }} />
                      </div>
                      <span className="r-sub shrink-0">
                        {usd(campaign.spend, 0)} · {campaign.purchases} achat(s)
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="r-sub py-3">{loading ? "Chargement…" : "Aucune dépense sur la période."}</p>
            )}
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
