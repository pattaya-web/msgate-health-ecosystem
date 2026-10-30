"use client";

import { Coins, PiggyBank, Target, TrendingUp } from "lucide-react";
import { AssociateHeader, Kpi, pct, ratio, usd, useNow } from "@/components/associate/parts";
import { useAssociateOverview } from "@/components/associate/use-associate-overview";

/**
 * Le profit de l'accès Associé, en cascade : chiffre d'affaires Straight sale,
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
          label: `Coût des articles${profit.cogsUnits ? ` · ${profit.cogsUnits} pièce(s)` : ""}`,
          value: -profit.cogs,
          sign: "−",
          note: profit.cogsMissing > 0 ? "coût produit pas encore renseigné" : undefined,
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Profit net"
          value={profit ? usd(profit.net) : "—"}
          tone={profit ? (positive ? "good" : "bad") : undefined}
          sub={profit?.margin != null ? `${pct(profit.margin)} de marge nette` : "Chargement…"}
          icon={<PiggyBank className="h-4 w-4" />}
        />
        <Kpi label="Chiffre d'affaires" value={profit ? usd(profit.revenue) : "—"} sub={overview ? `${overview.sales.orders} vente(s)` : ""} icon={<Coins className="h-4 w-4" />} delay={60} />
        <Kpi label="ROAS actuel" value={ratio(roas)} sub={`minimum ${ratio(profit?.breakEvenRoas)}`} icon={<TrendingUp className="h-4 w-4" />} delay={120} />
        <Kpi
          label="ROAS cible"
          value={ratio(profit?.targetRoas)}
          tone="good"
          sub={profit ? `pour ${pct(profit.targetMargin, 0)} de marge nette` : ""}
          icon={<Target className="h-4 w-4" />}
          delay={180}
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
                    <span className="ml-2 text-[11px]" style={{ color: "var(--r-warn)" }}>
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

      <p className="r-sub px-1">
        Le ROAS minimum est celui où la pub rapporte juste ce qu&apos;elle coûte, une fois articles, frais et remboursements payés. Au-dessus de la cible, la marge visée est atteinte.
      </p>
    </div>
  );
}
