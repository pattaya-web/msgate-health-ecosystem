"use client";

import { useEffect, useState } from "react";
import { Coins, Crosshair, PiggyBank, Scale, Target, TrendingUp } from "lucide-react";
import { AssociateHeader, Kpi, pct, ratio, usd, useNow } from "@/components/associate/parts";
import { useAssociateOverview } from "@/components/associate/use-associate-overview";
import type { AssociateOverview } from "@/lib/associate/scope";
import { reportToday } from "@/lib/report-tz";

/**
 * Le profit de l'accès Associé, en cascade : chiffre d'affaires de la boutique,
 * moins remboursements, coût des articles, frais de paiement et pub Meta.
 * Les taux (frais, marge visée) sont réglés par l'admin dans Settings ; rien
 * d'autre à saisir.
 */
export default function AssociateProfitPage() {
  const now = useNow();
  const { range, setRange, overview, loading, loadedAt, refresh } = useAssociateOverview();
  const profit = overview?.profit;
  const positive = (profit?.net ?? 0) >= 0;
  const roas = overview?.roas ?? null;

  const steps = profit
    ? [
        { label: "Chiffre d'affaires", value: profit.revenue, sign: "", strong: true },
        { label: "Remboursements", value: -profit.refunds, sign: "−" },
        {
          // Grille fournisseur : un coût par colis selon le nombre de colliers de la commande.
          label: profit.cogsGrid
            ? `Coût des articles · ${profit.cogsGrid.orders} commande(s), ${profit.cogsUnits} collier(s)`
            : `Coût des articles${profit.cogsUnits ? ` · ${profit.cogsUnits} pièce(s)` : ""}`,
          value: -profit.cogs,
          sign: "−",
          note: profit.cogsGrid
            ? `grille fournisseur${profit.cogsGrid.refundedOrders ? ` · ${profit.cogsGrid.refundedOrders} remboursée(s) à 0` : ""}`
            : profit.cogsMissing > 0
              ? "coût produit pas encore renseigné"
              : undefined,
          noteTone: profit.cogsGrid ? "muted" : "warn",
        },
        { label: `Frais de paiement · ${pct(profit.processingRate, 1)}`, value: -profit.fees, sign: "−" },
        { label: "Publicité Meta", value: -profit.ads, sign: "−" },
      ]
    : [];
  const base = Math.max(profit?.revenue ?? 0, 1);

  return (
    <div className="space-y-4">
      <AssociateHeader
        title="Profit"
        subtitle="Ce qu'il reste une fois les articles, les frais et la pub payés"
        shop={overview?.shop.name ?? null}
        range={range}
        onRange={setRange}
        loading={loading}
        onRefresh={refresh}
        liveAt={overview?.live.updatedAt ?? loadedAt}
        now={now}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Profit net"
          value={profit ? usd(profit.net) : "—"}
          tone={profit ? (positive ? "good" : "bad") : undefined}
          sub={profit?.margin != null ? `${pct(profit.margin)} de marge nette` : "Chargement…"}
          icon={<PiggyBank className="h-4 w-4" />}
        />
        <Kpi label="Chiffre d'affaires" value={profit ? usd(profit.revenue) : "—"} sub={overview ? `${overview.sales.orders} vente(s)` : ""} icon={<Coins className="h-4 w-4" />} delay={60} />
        <Kpi label="ROAS réel" value={ratio(roas)} sub="ventes ÷ dépense Meta" icon={<TrendingUp className="h-4 w-4" />} delay={120} />
        <Kpi
          label="ROAS Meta"
          value={ratio(overview?.meta.metaRoas)}
          sub={overview ? `${overview.meta.purchases} achat(s) attribués par Meta` : ""}
          icon={<Target className="h-4 w-4" />}
          delay={180}
        />
        <Kpi
          label="ROAS breakeven"
          value={ratio(profit?.roasBreakeven)}
          tone={profit?.roasBreakeven != null && roas != null ? (roas >= profit.roasBreakeven ? "good" : "bad") : undefined}
          sub="CA ÷ (CA − articles − frais)"
          icon={<Scale className="h-4 w-4" />}
          delay={200}
        />
        <Kpi
          label="CPA max"
          value={profit?.cpaMax != null ? usd(profit.cpaMax) : "—"}
          tone={profit?.cpaMax != null && overview?.cpa != null ? (overview.cpa <= profit.cpaMax ? "good" : "bad") : undefined}
          sub={overview?.cpa != null ? `CPA réel ${usd(overview.cpa)} · (CA − articles − frais) ÷ commandes` : "(CA − articles − frais) ÷ commandes"}
          icon={<Crosshair className="h-4 w-4" />}
          delay={220}
        />
      </div>

      <div className="r-card r-rise p-5" style={{ animationDelay: "220ms" }}>
        <p className="r-label mb-4">Du chiffre d&apos;affaires au profit</p>
        <div className="space-y-3.5">
          {steps.map((step, index) => (
            <div key={step.label} className="r-row-in" style={{ animationDelay: `${260 + index * 60}ms` }}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[13px]" style={{ color: step.strong ? "var(--ink)" : "var(--ink-2)", fontWeight: step.strong ? 600 : 500 }}>
                  {step.label}
                  {step.note ? (
                    <span className="ml-2 text-[11px]" style={{ color: "noteTone" in step && step.noteTone === "muted" ? "var(--ink-3)" : "var(--r-warn)" }}>
                      {step.note}
                    </span>
                  ) : null}
                </span>
                <span className="text-[13.5px] font-semibold tabular-nums" style={{ color: step.strong ? "var(--ink)" : "var(--ink-2)" }}>
                  {step.sign} {usd(Math.abs(step.value))}
                </span>
              </div>
              <div className="r-bar">
                <span style={{ width: `${Math.min(100, (Math.abs(step.value) / base) * 100)}%`, opacity: step.strong ? 1 : 0.55 }} />
              </div>
            </div>
          ))}
          {profit ? (
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--line)" }}>
              <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                Profit net
              </span>
              <span className="text-[22px] font-semibold tabular-nums" style={{ color: positive ? "var(--r-good)" : "var(--r-bad)" }}>
                {usd(profit.net)}
              </span>
            </div>
          ) : (
            <p className="r-sub py-6 text-center">{loading ? "Chargement…" : "Pas de données sur la période."}</p>
          )}
        </div>
      </div>

      {overview ? <DailyTable overview={overview} /> : null}

      <p className="r-sub px-1">
        ROAS réel : les ventes de la boutique divisées par la dépense Meta. ROAS Meta : la valeur des achats que Meta attribue à ses campagnes, divisée par la même dépense.
        Coût des articles : la grille fournisseur, un prix par colis selon le nombre de colliers de chaque commande (0 si elle est remboursée en entier).
      </p>
    </div>
  );
}

/**
 * Le profit jour par jour sur la période choisie : commandes, CA, dépense Meta,
 * coût des articles (grille fournisseur), frais de paiement, profit
 * approximatif (CA − articles − frais − Meta, sans les remboursements) et ROAS
 * réel. Les jours en perte sont en rouge ; le jour en cours est partiel.
 */
function DailyTable({ overview }: { overview: AssociateOverview }) {
  const { start, end } = overview.range;
  const [spend, setSpend] = useState<{ key: string; days: Record<string, number>; error: string | null } | null>(null);
  const key = `${start}:${end}`;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetch(`/api/associate/spend-daily?start=${start}&end=${end}`)
        .then((res) => res.json())
        .then((body: { days?: Record<string, number>; error?: string | null }) => {
          if (!cancelled) setSpend({ key: `${start}:${end}`, days: body.days ?? {}, error: body.error ?? null });
        })
        .catch(() => {
          if (!cancelled) setSpend({ key: `${start}:${end}`, days: {}, error: "Meta indisponible" });
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // La dépense du jour bouge : relue à chaque nouvel aperçu de la page.
  }, [start, end, overview.live.updatedAt]);

  const today = reportToday();
  const rate = overview.profit.processingRate / 100;
  const days = spend?.key === key ? spend.days : null;
  const rows = [...overview.sales.series].reverse().map((point) => {
    const cogs = overview.profit.cogsByDay[point.date] ?? 0;
    const fees = point.revenue * rate;
    const meta = days?.[point.date] ?? 0;
    return { date: point.date, orders: point.orders, revenue: point.revenue, meta, cogs, fees, profit: point.revenue - cogs - fees - meta, partial: point.date === today };
  });
  const total = rows.reduce(
    (sum, row) => ({ orders: sum.orders + row.orders, revenue: sum.revenue + row.revenue, meta: sum.meta + row.meta, cogs: sum.cogs + row.cogs, fees: sum.fees + row.fees, profit: sum.profit + row.profit }),
    { orders: 0, revenue: 0, meta: 0, cogs: 0, fees: 0, profit: 0 }
  );
  const roasOf = (revenue: number, meta: number) => (days && meta > 0 ? ratio(revenue / meta) : "—");
  const money = (value: number) => (days ? usd(value) : "…");
  const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const lossStyle = { color: "var(--r-bad)" } as const;

  return (
    <div className="r-card r-rise overflow-hidden" style={{ animationDelay: "260ms" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <p className="r-label">Jour par jour</p>
        <p className="r-sub">{spend?.error ? `Dépense Meta indisponible : ${spend.error}` : "Profit approximatif = CA − articles − frais − Meta (sans les remboursements)"}</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-left" style={{ color: "var(--ink-3)" }}>
              {["Date", "Commandes", "Chiffre d'affaires", "Dépense Meta", "Coût des articles", "Frais de paiement", "Profit approx.", "ROAS réel"].map((label, index) => (
                <th key={label} className={`px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide ${index ? "text-right" : "pl-5"}`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const loss = Boolean(days) && row.profit < 0;
              return (
                <tr key={row.date} className="border-t" style={{ borderColor: "var(--line)", background: loss ? "color-mix(in srgb, var(--r-bad) 7%, transparent)" : undefined }}>
                  <td className="py-2 pl-5 pr-3 capitalize" style={{ color: loss ? "var(--r-bad)" : "var(--ink)" }}>
                    {dayLabel(row.date)}
                    {row.partial ? (
                      <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium normal-case" style={{ background: "var(--line)", color: "var(--ink-3)" }}>
                        partiel
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--ink-2)" }}>{row.orders}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--ink)" }}>{usd(row.revenue)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--ink-2)" }}>{money(row.meta)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--ink-2)" }}>{usd(row.cogs)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--ink-2)" }}>{usd(row.fees)}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={loss ? lossStyle : { color: "var(--r-good)" }}>{money(row.profit)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: loss ? "var(--r-bad)" : "var(--ink-2)" }}>{roasOf(row.revenue, row.meta)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold" style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
              <td className="py-2.5 pl-5 pr-3">Total</td>
              <td className="px-3 py-2.5 text-right">{total.orders}</td>
              <td className="px-3 py-2.5 text-right">{usd(total.revenue)}</td>
              <td className="px-3 py-2.5 text-right">{money(total.meta)}</td>
              <td className="px-3 py-2.5 text-right">{usd(total.cogs)}</td>
              <td className="px-3 py-2.5 text-right">{usd(total.fees)}</td>
              <td className="px-3 py-2.5 text-right" style={days && total.profit < 0 ? lossStyle : { color: "var(--r-good)" }}>{money(total.profit)}</td>
              <td className="px-3 py-2.5 text-right">{roasOf(total.revenue, total.meta)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
