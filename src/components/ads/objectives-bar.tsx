"use client";

import { Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ObjectivesBar as Objectives } from "@/lib/metrics/objectives";

/**
 * La barre « Objectifs du jour » en haut de l'Ads Manager : une ligne par
 * produit (29,99 $ sur les vraies ventes, 39,99 $ calculé à la grille) avec
 * ROAS minimum, à tenir, pour scaler, CPA max et cible ; puis les repères
 * communs : taux de conversion réel de la période (commandes Reign ÷ visites
 * Shopify), ajout panier, CPC max.
 */

type Tone = "loss" | "hold" | "good" | "scale" | "none";

/*
 * Couleurs en dur (pas les classes « emerald ») : le thème admin repeint le
 * vert en bleu, or ici le code couleur doit rester rouge / orange / vert / vert foncé.
 */
const TONE_STYLE: Record<Tone, { color: string; background: string; ring: string }> = {
  loss: { color: "#e11d48", background: "rgba(225, 29, 72, 0.07)", ring: "rgba(225, 29, 72, 0.35)" },
  hold: { color: "#d97706", background: "rgba(217, 119, 6, 0.08)", ring: "rgba(217, 119, 6, 0.4)" },
  good: { color: "#16a34a", background: "rgba(22, 163, 74, 0.08)", ring: "rgba(22, 163, 74, 0.4)" },
  scale: { color: "#14532d", background: "rgba(21, 128, 61, 0.16)", ring: "rgba(21, 128, 61, 0.7)" },
  none: { color: "inherit", background: "transparent", ring: "rgba(15, 23, 42, 0.08)" },
};

const num = (value: number | null | undefined, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));
const usd = (value: number | null | undefined, digits = 0) =>
  value == null ? "—" : `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;

function Cell({ label, value, sub, tone = "none", title, wide }: { label: string; value: string; sub?: string; tone?: Tone; title?: string; wide?: boolean }) {
  return (
    <div
      className={cn("min-w-0 rounded-xl bg-white px-2.5 py-1.5 dark:bg-slate-900/70", wide && "col-span-2 sm:col-span-1")}
      style={{ backgroundImage: `linear-gradient(${TONE_STYLE[tone].background}, ${TONE_STYLE[tone].background})`, boxShadow: `inset 0 0 0 1px ${TONE_STYLE[tone].ring}` }}
      title={title}
    >
      <p className="flex items-center gap-1 truncate text-[9px] font-semibold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400">
        {label}
        {title ? <Info className="h-2.5 w-2.5 shrink-0 opacity-70" /> : null}
      </p>
      <p className={cn("mt-0.5 truncate text-[16px] leading-tight tabular-nums text-slate-900 dark:text-slate-50", tone === "scale" ? "font-bold" : "font-semibold")} style={tone === "none" ? undefined : { color: TONE_STYLE[tone].color }}>
        {value}
      </p>
      {sub ? <p className="truncate text-[9.5px] leading-snug text-slate-500 dark:text-slate-400">{sub}</p> : null}
    </div>
  );
}

export function ObjectivesBar({ data, loading, periodLabel }: { data: Objectives | null; loading: boolean; periodLabel: string }) {
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[11px] text-slate-500 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Objectifs du jour : calcul des seuils…
      </div>
    );
  }
  const t = data.thresholds;
  const metaGap = t.metaFactor != null ? Math.round((1 - t.metaFactor) * 100) : null;
  const roasHelp =
    `ROAS réel = ventes Shopify ÷ dépense Meta totale (les deux comptes, campagnes coupées comprises). Seuils recalculés depuis la grille fournisseur, le panier moyen et les frais 4 %.` +
    (metaGap != null
      ? ` Au ROAS Meta d'une campagne ou d'un ad set (Meta ${metaGap >= 0 ? `${metaGap} % sous` : `${-metaGap} % au-dessus du`} réel sur 7 j) : minimum ${num(t.meta.breakeven)}, à tenir ${num(t.meta.hold)}, scale ${num(t.meta.scale)}.`
      : "");
  const cpcMax = data.cpc.avg7 != null ? data.cpc.avg7 * 1.2 : null;
  // Le taux de conversion réel de la période affichée : commandes Reign ÷ visites Shopify.
  const conversion = data.period.conversion;
  const conversionTone: Tone = conversion == null ? "none" : conversion >= t.conversionGoal ? "good" : conversion >= t.conversionGoal * 0.9 ? "hold" : "loss";

  // Une ligne par produit (29,99 $ sur les vraies ventes, 39,99 $ calculé à la grille), puis les repères communs.
  const products = data.products?.length
    ? data.products
    : [{ id: "bogo", label: "Produit 29,99 $", price: 29.99, source: "ventes 7 j" as const, breakeven: t.breakeven, hold: t.hold, scale: t.scale, cpaMax: data.cpaMax, cpaTarget: data.cpaTarget, meta: t.meta, pattern: "" }];
  return (
    <div className="space-y-1.5">
      {products.map((product) => (
        <div key={product.id} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-[8.5rem_repeat(5,minmax(0,1fr))]">
          <div className="col-span-2 flex flex-col justify-center rounded-xl bg-slate-900 px-2.5 py-1.5 text-white sm:col-span-3 lg:col-span-1 dark:bg-slate-100 dark:text-slate-900">
            <p className="text-[12px] font-bold leading-tight">{product.label}</p>
            <p className="text-[9.5px] leading-snug opacity-70">
              {product.source === "ventes 7 j" ? "sur les ventes des 7 derniers jours" : "calculé : 2 colliers à la grille + frais"}
            </p>
          </div>
          <Cell label="ROAS minimum" value={num(product.breakeven)} tone="loss" sub="en dessous : on perd" title={roasHelp} />
          <Cell label="ROAS à tenir" value={num(product.hold)} tone="good" sub="ne rien toucher en dessous" title={roasHelp} />
          <Cell label="ROAS pour scaler" value={num(product.scale)} tone="scale" sub="+30 % par 48 h au-dessus" title={roasHelp} />
          <Cell label="CPA maximum" value={usd(product.cpaMax, 2)} tone="loss" sub="à ne pas dépasser" title="Dépense Meta ÷ commandes. Au-dessus, chaque commande fait perdre de l'argent." />
          <Cell label="CPA cible" value={usd(product.cpaTarget, 2)} tone="good" sub="25 % de marge nette" />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-[8.5rem_repeat(3,minmax(0,1fr))]">
        <div className="col-span-2 flex items-center rounded-xl px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-900/[0.06] sm:col-span-3 lg:col-span-1 dark:text-slate-400 dark:ring-white/[0.06]">
          Les deux produits
        </div>
        <Cell
          label={`Taux de conversion · ${periodLabel}`}
          value={conversion == null ? "—" : `${num(conversion, 1)} %`}
          tone={conversionTone}
          sub={`commandes Reign ÷ visites Shopify · objectif ≥ ${num(t.conversionGoal, 1)} %`}
          title={`Taux de conversion réel de la période affichée : ${data.period.orders} commandes (Reign) pour les visites Shopify. Sous ${num(t.conversionGoal, 1)} % alors que l'ajout panier tient : c'est le checkout, vérifier le site avant de toucher aux pubs.`}
        />
        <Cell label="Ajout panier" value={`≥ ${num(t.cartGoal, 0)} %`} tone="good" sub="ajouts ÷ visites" />
        <Cell label="CPC maximum" value={cpcMax != null ? usd(cpcMax, 2) : "—"} tone="hold" sub={`moyenne 7 j ${usd(data.cpc.avg7, 2)} + 20 % : au-dessus, fatigue créa`} />
      </div>
    </div>
  );
}
