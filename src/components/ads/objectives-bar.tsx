"use client";

import { Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ObjectivesBar as Objectives } from "@/lib/metrics/objectives";

/**
 * La barre « Objectifs du jour » en haut de l'Ads Manager : seulement les
 * chiffres à tenir chaque jour (ROAS minimum, à tenir, pour scaler, CPA max et
 * cible, conversion, ajout panier, CPC max, dépense max), recalculés depuis la
 * grille fournisseur, le panier moyen et les frais.
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

export function ObjectivesBar({ data, loading }: { data: Objectives | null; loading: boolean }) {
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

  // Les objectifs du jour, seulement : les chiffres qu'il faut tenir.
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-9">
      <Cell label="ROAS minimum" value={num(t.breakeven)} tone="loss" sub="en dessous : on perd de l'argent" title={roasHelp} />
      <Cell label="ROAS à tenir" value={num(t.hold)} tone="good" sub="rentable, ne rien toucher en dessous" title={roasHelp} />
      <Cell label="ROAS pour scaler" value={num(t.scale)} tone="scale" sub="+30 % par 48 h au-dessus" title={roasHelp} />
      <Cell label="CPA maximum" value={usd(data.cpaMax, 2)} tone="loss" sub="coût par commande à ne pas dépasser" title="Dépense Meta ÷ commandes. Au-dessus, chaque commande fait perdre de l'argent." />
      <Cell label="CPA cible" value={usd(data.cpaTarget, 2)} tone="good" sub="25 % de marge nette" />
      <Cell label="Conversion site" value={`≥ ${num(t.conversionGoal, 1)} %`} tone="good" sub="commandes ÷ visites" title="En dessous alors que l'ajout panier tient : c'est le checkout, vérifier le site avant de toucher aux pubs." />
      <Cell label="Ajout panier" value={`≥ ${num(t.cartGoal, 0)} %`} tone="good" sub="ajouts ÷ visites" />
      <Cell label="CPC maximum" value={cpcMax != null ? usd(cpcMax, 2) : "—"} tone="hold" sub={`moyenne 7 j ${usd(data.cpc.avg7, 2)} + 20 % : au-dessus, fatigue créa`} />
      <Cell
        label="Dépense max / jour"
        value={usd(data.spendCap)}
        tone="hold"
        sub="selon le ROAS réel 3 jours"
        title={`500 $ sous un ROAS réel 3 jours de ${num(t.hold)}, 700 $ jusqu'à ${num(t.scale)}, 1 000 $ au-delà.`}
      />
    </div>
  );
}
