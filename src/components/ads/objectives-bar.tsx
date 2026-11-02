"use client";

import { Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROAS_LEVEL_TEXT, roasLevel } from "@/components/ads/roas-tone";
import type { ObjectivesBar as Objectives } from "@/lib/metrics/objectives";

/**
 * La barre « Objectifs » en haut de l'Ads Manager : le ROAS réel global de la
 * période et des 3 derniers jours (ventes ÷ toute la dépense Meta, jamais le
 * filtre « Actifs »), le CPA, la conversion du site et l'ajout panier, le CPC
 * du jour, la dépense du jour contre son plafond et le profit net. Chaque case
 * prend la couleur de son seuil ; les seuils viennent de la grille fournisseur,
 * du panier moyen et des frais.
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
const pct = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(1).replace(".", ",")} %`);

/** Plus haut = mieux (conversion, ajout panier) : vert à l'objectif, orange à moins de 10 % en dessous, rouge sinon. */
function atLeast(value: number | null | undefined, goal: number): Tone {
  if (value == null) return "none";
  return value >= goal ? "good" : value >= goal * 0.9 ? "hold" : "loss";
}

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
        Objectifs : calcul du ROAS réel, du CPA et des seuils…
      </div>
    );
  }
  const t = data.thresholds;
  const real = { breakeven: t.breakeven, hold: t.hold, scale: t.scale };
  const periodLevel = roasLevel(data.period.roas, real);
  const last3Level = roasLevel(data.last3.roas, real);
  const metaGap = t.metaFactor != null ? Math.round((1 - t.metaFactor) * 100) : null;
  const roasHelp =
    `ROAS réel = ventes Shopify ÷ dépense Meta totale (les deux comptes, campagnes coupées comprises, jamais le filtre « Actifs »).\n` +
    `Seuils (grille fournisseur, panier moyen, frais ${"4 %"}) : rouge sous ${num(t.breakeven)} (on perd de l'argent, baisser les budgets) ; orange jusqu'à ${num(t.hold)} (fragile, ne rien toucher) ; vert jusqu'à ${num(t.scale)} (+20 % sur un ad set par 48 h) ; vert foncé au-delà (+30 % par 48 h, la hyper peut monter).\n` +
    (metaGap != null
      ? `Le ROAS Meta attribué est ${metaGap >= 0 ? `${metaGap} % en dessous` : `${-metaGap} % au-dessus`} du ROAS réel sur 7 jours : pour juger une campagne ou un ad set au ROAS Meta, les seuils équivalents sont breakeven ${num(t.meta.breakeven)}, hold ${num(t.meta.hold)}, scale ${num(t.meta.scale)}. Les décisions de budget global se prennent au ROAS réel ; les comparaisons entre campagnes au ROAS Meta (c'est ce qui colore les lignes plus bas).`
      : "");
  const cpaTone = (cpa: number | null): Tone =>
    cpa == null || data.cpaMax == null ? "none" : cpa > data.cpaMax ? "loss" : data.cpaTarget != null && cpa > data.cpaTarget ? "hold" : "good";
  const cpcTone: Tone =
    data.cpc.today == null || data.cpc.avg7 == null ? "none" : data.cpc.today > data.cpc.avg7 * 1.2 ? "loss" : data.cpc.today > data.cpc.avg7 ? "hold" : "good";
  const cpcChange = data.cpc.today != null && data.cpc.avg7 ? Math.round((data.cpc.today / data.cpc.avg7 - 1) * 100) : null;
  const spendTone: Tone = data.spendCap == null ? "none" : data.today.spend > data.spendCap ? "loss" : data.today.spend > data.spendCap * 0.85 ? "hold" : "good";

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-9">
        <Cell
          label={`ROAS réel · ${periodLabel}`}
          value={num(data.period.roas)}
          tone={periodLevel ?? "none"}
          sub={periodLevel ? ROAS_LEVEL_TEXT[periodLevel] : `${usd(data.period.revenue)} ÷ ${usd(data.period.spend)}`}
          title={roasHelp}
          wide
        />
        <Cell label="ROAS réel · 3 jours" value={num(data.last3.roas)} tone={last3Level ?? "none"} sub={last3Level ? ROAS_LEVEL_TEXT[last3Level] : ""} title={roasHelp} wide />
        <Cell
          label="CPA réel"
          value={usd(data.period.cpa, 2)}
          tone={cpaTone(data.period.cpa)}
          sub={`max ${usd(data.cpaMax, 2)} · cible ${usd(data.cpaTarget, 2)}`}
          title={`CPA = dépense Meta totale ÷ commandes. Au-dessus du CPA max (${usd(data.cpaMax, 2)}) on perd de l'argent ; sous le CPA cible (${usd(data.cpaTarget, 2)}) on garde 25 % de marge. 3 jours : ${usd(data.last3.cpa, 2)}.`}
        />
        <Cell
          label="Conversion site"
          value={pct(data.period.conversion)}
          tone={atLeast(data.period.conversion, t.conversionGoal)}
          sub={`objectif ≥ ${num(t.conversionGoal, 1)} %`}
          title="Commandes ÷ visites Shopify. Si elle baisse alors que l'ajout panier tient, c'est le checkout : vérifier le site avant de toucher aux pubs."
        />
        <Cell
          label="Ajout panier"
          value={pct(data.period.cartRate)}
          tone={atLeast(data.period.cartRate, t.cartGoal)}
          sub={`objectif ≥ ${num(t.cartGoal, 0)} %`}
          title="Visites avec un ajout au panier ÷ visites (Shopify). S'il baisse : page produit, prix ou trafic."
        />
        <Cell
          label="CPC du jour"
          value={data.cpc.today != null ? usd(data.cpc.today, 2) : "—"}
          tone={cpcTone}
          sub={`moyenne 7 j ${usd(data.cpc.avg7, 2)}${cpcChange != null ? ` · ${cpcChange >= 0 ? "+" : ""}${cpcChange} %` : ""}`}
          title="CPC moyen du jour (dépense ÷ clics, les deux comptes) contre sa moyenne 7 jours. À +20 % ou plus : fatigue créa."
        />
        <Cell
          label="Dépense du jour"
          value={usd(data.today.spend)}
          tone={spendTone}
          sub={data.spendCap != null ? `plafond ${usd(data.spendCap)} · budgets ${usd(data.budgetsTotal)}/j` : ""}
          title={`Plafond selon le ROAS réel 3 jours : 500 $ sous ${num(t.hold)}, 700 $ jusqu'à ${num(t.scale)}, 1 000 $ au-delà.`}
        />
        <Cell label="Profit net du jour" value={usd(data.today.profit)} tone={data.today.profit >= 0 ? "good" : "loss"} sub="en cours" title="CA − colliers (grille fournisseur) − frais 4 % − pub Meta." />
        <Cell label="Profit net 3 jours" value={usd(data.last3.profit)} tone={data.last3.profit >= 0 ? "good" : "loss"} sub={`CA ${usd(data.last3.revenue)} · pub ${usd(data.last3.spend)}`} title="CA − colliers (grille fournisseur) − frais 4 % − pub Meta, sur les 3 derniers jours complets." />
      </div>
      <p className="px-1 text-[9.5px] text-slate-400">
        Seuils ROAS réel {num(t.breakeven)} / {num(t.hold)} / {num(t.scale)} · au ROAS Meta (lignes ci-dessous) {num(t.meta.breakeven)} / {num(t.meta.hold)} / {num(t.meta.scale)}
        {metaGap != null ? ` (Meta ${metaGap >= 0 ? `${metaGap} % sous` : `${-metaGap} % au-dessus du`} réel sur 7 j)` : ""} · recalculés depuis la grille fournisseur, le panier moyen et les frais.
      </p>
    </div>
  );
}
