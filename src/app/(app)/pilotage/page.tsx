"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Compass, Loader2, RefreshCw, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { reportToday } from "@/lib/report-tz";
import type { Alert, DayFigures, PilotageReport, SiteDay } from "@/lib/pilotage/build";

/**
 * Pilotage (Venom) : la page qu'on ouvre chaque matin. Les objectifs à tenir
 * pour être rentable (en vert), le profit d'hier et des 3 derniers jours, le
 * profit par commande selon le nombre de colliers (grille fournisseur), la
 * conversion Reign et l'approbation des MID, puis les alertes.
 * Calcul : src/lib/pilotage/build.ts.
 */

const usd = (value: number | null | undefined, digits = 0) =>
  value == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const num = (value: number | null | undefined, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));
const pct = (value: number | null | undefined, digits = 1) => (value == null ? "—" : `${value.toFixed(digits).replace(".", ",")} %`);
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeLabel = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

const GOOD = "var(--r-good)";
const BAD = "var(--r-bad)";
const WARN = "#b45309";

function Section({ step, title, icon, right, children }: { step?: number; title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="r-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {step ? (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: "var(--r-accent, #233137)" }}>
            {step}
          </span>
        ) : (
          <span style={{ color: "var(--ink-3)" }}>{icon}</span>
        )}
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
          {title}
        </h2>
        {right ? <div className="ml-auto">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Une case objectif : en vert, c'est le chiffre à tenir pour être rentable. */
function GoalTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: "color-mix(in srgb, #10b981 12%, transparent)", boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, #10b981 55%, transparent)" }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "#047857" }}>
        {label}
      </p>
      <p className="mt-0.5 text-[21px] font-bold tabular-nums" style={{ color: "#047857" }}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "#065f46" }}>
        {sub}
      </p>
    </div>
  );
}

/** Une case « où on en est » : verte si l'objectif est tenu, orange entre le minimum et la cible, rouge en dessous du minimum. */
function ActualTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? GOOD : tone === "bad" ? BAD : tone === "warn" ? WARN : "var(--ink)";
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
      <p className="r-label">{label}</p>
      <p className="mt-0.5 text-[19px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </p>
      {sub ? <p className="r-sub mt-0.5 leading-snug">{sub}</p> : null}
    </div>
  );
}

function ProfitCard({ title, fig, note }: { title: string; fig: DayFigures; note?: string }) {
  return (
    <div className="rounded-xl p-3.5" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
      <p className="r-label">
        {title}
        {note ? <span className="ml-1.5 normal-case">{note}</span> : null}
      </p>
      <p className="mt-1 text-[24px] font-semibold tabular-nums" style={{ color: fig.profit >= 0 ? GOOD : BAD }}>
        {usd(fig.profit)}
      </p>
      <p className="r-sub mt-1 tabular-nums">
        CA {usd(fig.revenue)} · {fig.orders} cmd · pub {usd(fig.spend)} · colliers {usd(fig.cogs)}
      </p>
      <p className="mt-0.5 text-[12px] font-medium tabular-nums" style={{ color: "var(--ink-2)" }}>
        ROAS réel {num(fig.roas)}
      </p>
    </div>
  );
}

function Delta({ now, before }: { now: number | null | undefined; before: number | null | undefined }) {
  if (now == null || before == null || !before) return null;
  const change = ((now - before) / before) * 100;
  const down = change < 0;
  return (
    <span className="ml-1.5 inline-flex items-center text-[11px] font-semibold" style={{ color: Math.abs(change) < 5 ? "var(--ink-3)" : down ? BAD : GOOD }}>
      {down ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
      {Math.abs(change).toFixed(0)} %
    </span>
  );
}

function SiteRow({ day, before }: { day: SiteDay; before?: SiteDay }) {
  const attempts = day.reignApproved != null && day.reignDeclined != null ? day.reignApproved + day.reignDeclined : null;
  return (
    <tr className="border-t" style={{ borderColor: "var(--line)" }}>
      <td className="py-2 pr-3 text-[12.5px] font-medium" style={{ color: "var(--ink)" }}>
        {day.label}
      </td>
      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">{day.sessions != null ? day.sessions.toLocaleString("fr-FR") : "—"}</td>
      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">
        {pct(day.cartRate)}
        {before ? <Delta now={day.cartRate} before={before.cartRate} /> : null}
      </td>
      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">{day.orders}</td>
      <td className="px-3 py-2 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: day.siteConversion != null && day.siteConversion < 7 ? BAD : "var(--ink)" }}>
        {pct(day.siteConversion)}
        {before ? <Delta now={day.siteConversion} before={before.siteConversion} /> : null}
      </td>
      <td className="px-3 py-2 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
        {pct(day.reignConversion)}
        {before ? <Delta now={day.reignConversion} before={before.reignConversion} /> : null}
        {attempts != null ? <span className="r-sub ml-1 font-normal">({day.reignApproved}/{attempts})</span> : null}
      </td>
    </tr>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className="flex flex-col gap-1.5 border-t py-2.5 first:border-t-0 sm:flex-row sm:items-center" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: WARN }} />
          {alert.title}
        </p>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
          {alert.why}
        </p>
      </div>
      {alert.link ? (
        alert.link.href.startsWith("http") ? (
          <a href={alert.link.href} target="_blank" rel="noreferrer" className="r-chip h-8 shrink-0 px-3">
            {alert.link.label}
          </a>
        ) : (
          <Link href={alert.link.href} className="r-chip h-8 shrink-0 px-3">
            {alert.link.label}
          </Link>
        )
      ) : null}
    </div>
  );
}

export default function PilotagePage() {
  const [report, setReport] = useState<PilotageReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pilotage${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const body = (await res.json()) as PilotageReport & { error?: string };
      if (!res.ok) throw new Error(body.error || "Pilotage indisponible");
      setReport(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pilotage indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Le bouton « Actualiser » de l'en-tête relit la page sur place.
  useEffect(() => {
    const onRefresh = (event: Event) => {
      event.preventDefault();
      void load(true);
    };
    window.addEventListener("msgate:refresh", onRefresh);
    return () => window.removeEventListener("msgate:refresh", onRefresh);
  }, [load]);

  const o = report?.objectives;
  const roasTone = (value: number | null | undefined) =>
    value == null || o?.roasBreakeven == null ? undefined : value >= (o.roasTarget ?? Infinity) ? "good" : value >= o.roasBreakeven ? "warn" : "bad";
  const cpaTone = (value: number | null | undefined) =>
    value == null || o?.cpaMax == null ? undefined : value <= (o.cpaTarget ?? 0) ? "good" : value <= o.cpaMax ? "warn" : "bad";
  const today = reportToday();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="r-chip">
              <Compass className="h-3.5 w-3.5" /> Venom · {dayLabel(today)}
            </span>
            {report ? <span className="r-chip">3 derniers jours : {dayLabel(report.days.d3)} → {dayLabel(report.days.d1)}</span> : null}
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
            Pilotage
          </h1>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            Les objectifs à tenir pour être rentable, où on en est, et ce qui cloche.
          </p>
        </div>
        <button type="button" onClick={() => void load(true)} className="r-icon h-10 w-10 shrink-0 rounded-full" title="Actualiser" aria-label="Actualiser">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {report?.warnings.length ? (
        <div className="r-card px-4 py-2.5 text-[12px]" style={{ color: WARN }}>
          {report.warnings.join(" · ")}
        </div>
      ) : null}

      {!report ? (
        <div className="r-card flex items-center justify-center gap-2 p-10 text-[13px]" style={{ color: "var(--ink-3)" }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Lecture de Meta, de Reign et du site… (une dizaine de secondes)
        </div>
      ) : (
        <>
          <Section title="Objectifs pour être rentable" icon={<Target className="h-4 w-4" />} right={<span className="r-sub">calculés sur les 7 derniers jours</span>}>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <GoalTile label="ROAS minimum" value={num(o?.roasBreakeven)} sub="au-dessus : on gagne de l'argent (breakeven)" />
              <GoalTile label="ROAS cible" value={num(o?.roasTarget)} sub="pour 25 % de marge nette" />
              <GoalTile label="CPA maximum" value={usd(o?.cpaMax, 2)} sub="coût par commande à ne pas dépasser" />
              <GoalTile label="CPA cible" value={usd(o?.cpaTarget, 2)} sub="pour 25 % de marge nette" />
            </div>
            <p className="r-label mb-1.5 mt-3">Où on en est</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <ActualTile label="ROAS réel 3 jours" value={num(o?.realRoas.last3)} tone={roasTone(o?.realRoas.last3)} sub={`7 jours : ${num(o?.realRoas.last7)}`} />
              <ActualTile label="ROAS réel hier" value={num(o?.realRoas.yesterday)} tone={roasTone(o?.realRoas.yesterday)} sub={`aujourd'hui (en cours) : ${num(o?.realRoas.today)}`} />
              <ActualTile label="CPA réel 3 jours" value={usd(o?.cpa.last3, 2)} tone={cpaTone(o?.cpa.last3)} />
              <ActualTile label="CPA réel hier" value={usd(o?.cpa.yesterday, 2)} tone={cpaTone(o?.cpa.yesterday)} />
            </div>
            <p className="r-sub mt-2.5 leading-relaxed">
              Panier moyen {usd(o?.aov, 2)} · {num(o?.collarsPerOrder)} colliers par commande · colliers {usd(o?.cogsPerOrder, 2)} · frais {usd(o?.feesPerOrder, 2)} ({num(o?.processingRate, 0)} %) → il reste{" "}
              <strong>{usd(o?.marginBeforeAds, 2)}</strong> par commande pour payer la pub. ROAS réel = ventes ÷ toute la dépense Meta (campagnes coupées comprises). Vert : objectif tenu ; orange : rentable mais sous la cible ; rouge : on perd de l&apos;argent.
              {o?.spendCap
                ? ` Dépense conseillée : ${usd(o.spendCap)}/j maximum avec un ROAS réel 3 jours à ${num(o.realRoas.last3)} — 500 $ sous ${num(report.thresholds.hold)}, 700 $ jusqu'à ${num(report.thresholds.scale)}, 1 000 $ au-delà (budgets actifs ${usd(o.budgetsTotal)}/j).`
                : ""}
            </p>
          </Section>

          <Section step={1} title="Profit net : hier et 3 derniers jours">
            <div className="grid gap-2 sm:grid-cols-3">
              <ProfitCard title="Hier" note={dayLabel(report.days.d1)} fig={report.profit.yesterday} />
              <ProfitCard title="3 derniers jours" fig={report.profit.last3} />
              <ProfitCard title="Aujourd'hui" note="(en cours)" fig={report.profit.today} />
            </div>
            <p className="r-sub mt-2">Profit = ventes − colliers (grille fournisseur) − frais de paiement − pub Meta.</p>
          </Section>

          <Section step={2} title="Profit par commande selon le nombre de colliers" right={<span className="r-sub">7 derniers jours · {report.perQuantity.grid}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="r-label text-left">
                    <th className="pb-1.5 pr-3 font-medium">Commande</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Commandes</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Prix payé</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Colis (prix + livraison)</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Frais</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Reste avant pub</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Profit après pub</th>
                  </tr>
                </thead>
                <tbody style={{ color: "var(--ink-2)" }}>
                  {report.perQuantity.rows.map((row) => (
                    <tr key={row.quantity} className="border-t text-[12.5px] tabular-nums" style={{ borderColor: "var(--line)" }}>
                      <td className="py-2 pr-3 font-medium" style={{ color: "var(--ink)" }}>
                        {row.quantity} collier{row.quantity > 1 ? "s" : ""}
                      </td>
                      <td className="px-3 py-2 text-right">{row.orders}</td>
                      <td className="px-3 py-2 text-right">{usd(row.avgPrice, 2)}</td>
                      <td className="px-3 py-2 text-right font-semibold" style={{ color: "var(--ink)" }}>
                        {usd(row.parcelCost, 2)}
                      </td>
                      <td className="px-3 py-2 text-right">{usd(row.fees, 2)}</td>
                      <td className="px-3 py-2 text-right font-semibold" style={{ color: row.marginBeforeAds == null ? undefined : row.marginBeforeAds >= 0 ? GOOD : BAD }}>
                        {usd(row.marginBeforeAds, 2)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold" style={{ color: row.profitAfterAds == null ? undefined : row.profitAfterAds >= 0 ? GOOD : BAD }}>
                        {usd(row.profitAfterAds, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="r-sub mt-2">
              Colis = prix du fournisseur pour ce nombre de colliers, livraison au client comprise. Profit après pub = reste avant pub − coût moyen d&apos;acquisition d&apos;une commande sur 7 jours (
              {usd(report.perQuantity.cpa7, 2)}).
            </p>
          </Section>

          <Section step={3} title="Conversion et approbation Reign" right={<span className="r-sub">visites et panier : Shopify · paiement : Reign</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="r-label text-left">
                    <th className="pb-1.5 pr-3 font-medium">Jour</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Visites</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Ajout panier</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Commandes</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Conversion site</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Conversion Reign</th>
                  </tr>
                </thead>
                <tbody style={{ color: "var(--ink-2)" }}>
                  <SiteRow day={report.site[0]} before={report.site[1]} />
                  <SiteRow day={report.site[1]} />
                  <SiteRow day={report.site[2]} />
                  <SiteRow day={report.site[3]} />
                </tbody>
              </table>
            </div>
            <p className="r-sub mt-1.5">
              Conversion site = commandes ÷ visites. Conversion Reign = clients dont le paiement est passé ÷ clients qui ont essayé de payer (approbation par client unique de Reign).
            </p>

            <p className="r-label mb-1 mt-4">Approbation Reign par carte</p>
            {report.mids.last3.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px]">
                  <thead>
                    <tr className="r-label text-left">
                      <th className="pb-1.5 pr-3 font-medium">Carte</th>
                      <th className="px-3 pb-1.5 text-right font-medium">Hier</th>
                      <th className="px-3 pb-1.5 text-right font-medium">3 derniers jours</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: "var(--ink-2)" }}>
                    {report.mids.last3.map((mid) => {
                      const y = report.mids.yesterday.find((row) => row.name === mid.name);
                      const tone = (rate: number | undefined) => (rate == null ? undefined : rate >= 80 ? GOOD : rate >= 70 ? WARN : BAD);
                      return (
                        <tr key={mid.name} className="border-t text-[12.5px] tabular-nums" style={{ borderColor: "var(--line)" }}>
                          <td className="py-2 pr-3 font-medium" style={{ color: "var(--ink)" }}>
                            {mid.name}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold" style={{ color: tone(y?.approvalRate) }}>
                            {y ? `${pct(y.approvalRate)} ` : "—"}
                            {y ? <span className="r-sub font-normal">({y.approved}/{y.attempts})</span> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold" style={{ color: tone(mid.approvalRate) }}>
                            {pct(mid.approvalRate)} <span className="r-sub font-normal">({mid.approved}/{mid.attempts})</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="r-sub">Aucune tentative de paiement Reign sur les 3 derniers jours.</p>
            )}
            <p className="r-sub mt-1.5">
              Par commande : une commande refusée puis payée compte comme approuvée. L&apos;API de Reign ne donne pas le MID de chaque paiement, d&apos;où le découpage par réseau de carte.
            </p>
          </Section>

          <Section step={4} title="Alertes" right={<span className="r-sub">{report.alerts.length}</span>}>
            {report.alerts.length ? (
              report.alerts.map((alert) => <AlertRow key={alert.id} alert={alert} />)
            ) : (
              <p className="flex items-center gap-2 py-1 text-[13px]" style={{ color: GOOD }}>
                <Check className="h-4 w-4" /> Aucune alerte.
              </p>
            )}
          </Section>

          <p className="r-sub px-1">Mis à jour {timeLabel(report.builtAt)} · relu toutes les 2 minutes au plus.</p>
        </>
      )}
    </div>
  );
}
