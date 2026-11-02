"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ClipboardCopy,
  Compass,
  FlaskConical,
  Gauge,
  Loader2,
  NotebookPen,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { reportToday } from "@/lib/report-tz";
import type { Alert, CreativeRow, DayFigures, Decision, PilotageReport, SiteDay } from "@/lib/pilotage/build";
import type { JournalEntry } from "@/lib/pilotage/journal";

/**
 * Pilotage (Venom) : la page qu'on ouvre chaque matin. Dans l'ordre de la
 * checklist de 5 minutes : 1) profit d'hier et des 3 derniers jours,
 * 2) conversion et ajout panier contre la veille, 3) les décisions du jour,
 * 4) les alertes, 5) ce qui a été modifié hier. Puis les objectifs, les créas
 * et les tests en cours. Une décision par ligne, le chiffre qui la justifie, un
 * bouton ou un lien pour agir. Calcul : src/lib/pilotage/build.ts.
 */

const usd = (value: number | null | undefined, digits = 0) =>
  value == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const num = (value: number | null | undefined, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));
const pct = (value: number | null | undefined, digits = 1) => (value == null ? "—" : `${value.toFixed(digits).replace(".", ",")} %`);
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeLabel = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function Section({ step, title, icon, right, children }: { step?: number; title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
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

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "var(--r-good)" : tone === "bad" ? "var(--r-bad)" : tone === "warn" ? "#b45309" : "var(--ink)";
  return (
    <div className="rounded-xl px-3 py-2.5 ring-1" style={{ background: "var(--r-soft, rgba(15,23,42,0.03))", borderColor: "var(--line)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
      <p className="r-label">{label}</p>
      <p className="mt-0.5 text-[19px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </p>
      {sub ? <p className="r-sub mt-0.5 leading-snug">{sub}</p> : null}
    </div>
  );
}

function ProfitCard({ title, fig, note }: { title: string; fig: DayFigures; note?: string }) {
  const good = fig.profit >= 0;
  return (
    <div className="rounded-xl p-3.5" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
      <p className="r-label">
        {title}
        {note ? <span className="ml-1.5 normal-case">{note}</span> : null}
      </p>
      <p className="mt-1 text-[24px] font-semibold tabular-nums" style={{ color: good ? "var(--r-good)" : "var(--r-bad)" }}>
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
    <span className="ml-1.5 inline-flex items-center text-[11px] font-semibold" style={{ color: Math.abs(change) < 5 ? "var(--ink-3)" : down ? "var(--r-bad)" : "var(--r-good)" }}>
      {down ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
      {Math.abs(change).toFixed(0)} %
    </span>
  );
}

const SCOPE_STYLE: Record<Decision["scope"], string> = {
  site: "bg-rose-100 text-rose-800",
  dépense: "bg-amber-100 text-amber-800",
  hyper: "bg-emerald-100 text-emerald-800",
  campagne: "bg-sky-100 text-sky-800",
  "ad set": "bg-indigo-100 text-indigo-800",
  pub: "bg-slate-200 text-slate-700",
};

function DecisionRow({ decision, busy, onAct }: { decision: Decision; busy: boolean; onAct: (decision: Decision) => void }) {
  return (
    <div className="flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-center" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", SCOPE_STYLE[decision.scope])}>{decision.scope}</span>
          <span className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
            {decision.title}
          </span>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: "var(--ink-2)" }}>
          {decision.why}
        </p>
        <p className="r-sub mt-0.5 truncate" title={decision.where}>
          {decision.where}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {decision.action ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAct(decision)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
            style={{ background: decision.action.kind === "pause" ? "var(--r-bad)" : "var(--r-accent, #233137)" }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {decision.action.label}
          </button>
        ) : null}
        {decision.link ? (
          decision.link.href.startsWith("http") ? (
            <a href={decision.link.href} target="_blank" rel="noreferrer" className="r-chip h-9 px-3">
              {decision.link.label}
            </a>
          ) : (
            <Link href={decision.link.href} className="r-chip h-9 px-3">
              {decision.link.label}
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className="flex flex-col gap-1.5 border-t py-2.5 first:border-t-0 sm:flex-row sm:items-center" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "#b45309" }} />
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

function copy(text: string, done: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error("Copie impossible")
  );
}

function Trend({ values }: { values: Array<number | null> }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      {values.map((value, index) => (
        <span key={index} className="text-[11.5px]" style={{ color: value == null ? "var(--ink-3)" : value >= 2 ? "var(--r-good)" : value >= 1.6 ? "#b45309" : "var(--r-bad)" }}>
          {index ? <span style={{ color: "var(--ink-3)" }}>→ </span> : null}
          {value == null ? "—" : num(value)}
        </span>
      ))}
    </span>
  );
}

function CreativeLine({ row, extra }: { row: CreativeRow; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t py-2 first:border-t-0 sm:flex-row sm:items-center sm:gap-3" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" style={{ color: "var(--ink)" }} title={row.name}>
          {row.name}
        </p>
        <p className="r-sub truncate">
          {row.account} › {row.campaign}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: "var(--ink-2)" }}>
        <span>{row.purchases7} achats / 7 j</span>
        <span>{row.purchasesLifetime} au total</span>
        <span>ROAS 7 j {num(row.roas7)}</span>
        <Trend values={row.trend} />
        {extra}
        {row.postId ? (
          <button type="button" className="r-chip h-7 px-2" onClick={() => copy(row.postId as string, "Post ID copié")} title={row.postId}>
            <ClipboardCopy className="h-3 w-3" /> Post ID
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SiteRow({ label, day, before }: { label: string; day: SiteDay; before?: SiteDay }) {
  return (
    <tr className="border-t" style={{ borderColor: "var(--line)" }}>
      <td className="py-2 pr-3 text-[12.5px] font-medium" style={{ color: "var(--ink)" }}>
        {label}
      </td>
      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">{day ? day.sessions.toLocaleString("fr-FR") : "—"}</td>
      <td className="px-3 py-2 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: day && day.conversion < 7 ? "var(--r-bad)" : "var(--ink)" }}>
        {pct(day?.conversion)}
        {before !== undefined ? <Delta now={day?.conversion} before={before?.conversion} /> : null}
      </td>
      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">
        {pct(day?.cartRate)}
        {before !== undefined ? <Delta now={day?.cartRate} before={before?.cartRate} /> : null}
      </td>
    </tr>
  );
}

function JournalLine({ entry }: { entry: JournalEntry }) {
  const what =
    entry.action === "budget"
      ? `Budget ${entry.before ?? "?"} → ${entry.after} ${entry.currency ?? ""}`
      : entry.action === "status"
        ? entry.after === "PAUSED"
          ? "Coupé"
          : entry.after === "ACTIVE"
            ? "Rallumé"
            : String(entry.after)
        : entry.action === "rename"
          ? `Renommé « ${entry.after} »`
          : entry.action === "create"
            ? `Créé : ${entry.after}`
            : "Note";
  return (
    <div className="flex flex-col gap-0.5 border-t py-2 text-[12.5px] first:border-t-0 sm:flex-row sm:gap-3" style={{ borderColor: "var(--line)" }}>
      <span className="shrink-0 tabular-nums sm:w-[150px]" style={{ color: "var(--ink-3)" }}>
        {timeLabel(entry.at)}
      </span>
      <span className="shrink-0 font-semibold capitalize sm:w-[70px]" style={{ color: "var(--ink)" }}>
        {entry.who}
      </span>
      <span className="min-w-0 flex-1" style={{ color: "var(--ink-2)" }}>
        <span className="font-medium" style={{ color: "var(--ink)" }}>
          {what}
        </span>
        {entry.objectName ? ` · ${entry.objectName}` : ""}
        {entry.campaignName && entry.campaignName !== entry.objectName ? ` · ${entry.campaignName}` : ""}
        {entry.note ? <span style={{ color: "var(--ink-3)" }}> — {entry.note}</span> : null}
        {entry.source === "pilotage" ? <span className="r-sub ml-1">(Pilotage)</span> : null}
      </span>
    </div>
  );
}

export default function PilotagePage() {
  const [report, setReport] = useState<PilotageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showHolds, setShowHolds] = useState(false);
  const [showJournal, setShowJournal] = useState(false);

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

  const act = async (decision: Decision) => {
    const action = decision.action;
    if (!action) return;
    if (!window.confirm(`${decision.title}\n\n${decision.where}\n\nConfirmer ? (noté dans le journal)`)) return;
    setBusyId(decision.id);
    try {
      const res = await fetch("/api/meta/entity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action.kind === "pause"
            ? { id: action.id, level: action.level, status: "PAUSED", source: "pilotage", reason: action.reason }
            : { id: action.id, level: action.level, dailyBudget: action.value, source: "pilotage", reason: action.reason }
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Meta a refusé");
      toast.success(action.kind === "pause" ? "Pub coupée" : "Budget mis à jour");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible");
    } finally {
      setBusyId(null);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    const res = await fetch("/api/pilotage/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
    if (!res.ok) {
      toast.error("Note non enregistrée");
      return;
    }
    setNote("");
    toast.success("Noté dans le journal");
    await load(true);
  };

  const setTest = async (id: string, patch: Record<string, unknown>, done: string) => {
    const res = await fetch("/api/pilotage/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error || "Enregistrement impossible");
      return;
    }
    toast.success(done);
    await load(true);
  };

  const o = report?.objectives;
  const actions = report?.decisions.filter((decision) => decision.kind !== "hold") ?? [];
  const holds = report?.decisions.filter((decision) => decision.kind === "hold") ?? [];
  const today = reportToday();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="r-chip">
              <Compass className="h-3.5 w-3.5" /> Venom · {dayLabel(today)}
            </span>
            {report ? <span className="r-chip">Jugé sur {dayLabel(report.days.d3)} → {dayLabel(report.days.d1)}</span> : null}
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
            Pilotage
          </h1>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            Ce qu&apos;il faut faire aujourd&apos;hui, dans l&apos;ordre. Les décisions se basent sur les 3 derniers jours complets, jamais sur une seule journée.
          </p>
        </div>
        <button type="button" onClick={() => void load(true)} className="r-icon h-10 w-10 shrink-0 rounded-full" title="Actualiser" aria-label="Actualiser">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {report?.warnings.length ? (
        <div className="r-card px-4 py-2.5 text-[12px]" style={{ color: "#b45309" }}>
          {report.warnings.join(" · ")}
        </div>
      ) : null}

      {!report ? (
        <div className="r-card flex items-center justify-center gap-2 p-10 text-[13px]" style={{ color: "var(--ink-3)" }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Lecture de Meta, des ventes et du site… (une dizaine de secondes)
        </div>
      ) : (
        <>
          {/* Objectifs */}
          <Section title="Objectifs" icon={<Target className="h-4 w-4" />} right={<span className="r-sub">calculés sur les 7 derniers jours</span>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile
                label="ROAS réel 3 j"
                value={num(o?.realRoas.last3)}
                tone={o?.realRoas.last3 != null && o.roasBreakeven != null ? (o.realRoas.last3 >= (o.roasTarget ?? 99) ? "good" : o.realRoas.last3 >= o.roasBreakeven ? "warn" : "bad") : undefined}
                sub={`hier ${num(o?.realRoas.yesterday)} · auj. ${num(o?.realRoas.today)}`}
              />
              <Tile label="ROAS breakeven" value={num(o?.roasBreakeven)} sub="en dessous on perd" />
              <Tile label="ROAS cible" value={num(o?.roasTarget)} sub="marge nette 25 %" />
              <Tile label="CPA réel 3 j" value={usd(o?.cpa.last3, 2)} tone={o?.cpa.last3 != null && o.cpaMax != null ? (o.cpa.last3 <= (o.cpaTarget ?? 0) ? "good" : o.cpa.last3 <= o.cpaMax ? "warn" : "bad") : undefined} sub={`hier ${usd(o?.cpa.yesterday, 2)}`} />
              <Tile label="CPA max" value={usd(o?.cpaMax, 2)} sub="au-dessus on perd" />
              <Tile label="CPA cible" value={usd(o?.cpaTarget, 2)} sub="marge avant pub × 0,75" />
            </div>
            <p className="r-sub mt-2.5 leading-relaxed">
              Panier moyen {usd(o?.aov, 2)} · {num(o?.collarsPerOrder)} colliers par commande · colliers {usd(o?.cogsPerOrder, 2)} · frais {usd(o?.feesPerOrder, 2)} ({num(o?.processingRate, 0)} %) → marge avant pub{" "}
              <strong>{usd(o?.marginBeforeAds, 2)}</strong> par commande. ROAS réel = ventes Shopify ÷ toute la dépense Meta (campagnes coupées comprises).{" "}
              Plafond de dépense : <strong>{o?.spendCap ? `${usd(o.spendCap)}/j` : "libre"}</strong> (budgets actifs {usd(o?.budgetsTotal)}/j) — 700 $ tant que le ROAS réel 3 j est sous 2,0, 1 000 $ tant qu&apos;il est sous 2,2.
            </p>
          </Section>

          {/* 1. Profit */}
          <Section step={1} title="Profit net : hier et 3 derniers jours" icon={null}>
            <div className="grid gap-2 sm:grid-cols-3">
              <ProfitCard title="Hier" note={dayLabel(report.days.d1)} fig={report.profit.yesterday} />
              <ProfitCard title="3 derniers jours" fig={report.profit.last3} />
              <ProfitCard title="Aujourd'hui" note="(en cours)" fig={report.profit.today} />
            </div>
            <p className="r-sub mt-2">Profit = ventes − colliers (grille) − frais de paiement − pub Meta.</p>
          </Section>

          {/* 2. Site */}
          <Section step={2} title="Le site : conversion et ajout panier" icon={null} right={<span className="r-sub">conversion = commandes ÷ visites</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead>
                  <tr className="r-label text-left">
                    <th className="pb-1.5 pr-3 font-medium">Jour</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Visites</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Conversion</th>
                    <th className="px-3 pb-1.5 text-right font-medium">Ajout panier</th>
                  </tr>
                </thead>
                <tbody style={{ color: "var(--ink-2)" }}>
                  <SiteRow label={`Hier (${dayLabel(report.days.d1)})`} day={report.site.yesterday} before={report.site.dayBefore} />
                  <SiteRow label={`Avant-hier (${dayLabel(report.days.d2)})`} day={report.site.dayBefore} />
                  <SiteRow label="Aujourd'hui (en cours)" day={report.site.today} />
                  <SiteRow label="Moyenne 7 jours" day={report.site.last7} />
                </tbody>
              </table>
            </div>
            {!report.site.yesterday ? <p className="r-sub mt-2">Trafic Shopify indisponible (Shopify non branché pour les visites).</p> : null}
          </Section>

          {/* 3. Décisions */}
          <Section step={3} title="Décisions du jour" icon={null} right={<span className="r-sub">{actions.filter((decision) => decision.kind === "action").length} à faire</span>}>
            {actions.length ? (
              actions.map((decision) => <DecisionRow key={decision.id} decision={decision} busy={busyId === decision.id} onAct={(item) => void act(item)} />)
            ) : (
              <p className="flex items-center gap-2 py-2 text-[13px]" style={{ color: "var(--r-good)" }}>
                <Check className="h-4 w-4" /> Rien à changer aujourd&apos;hui.
              </p>
            )}
            {holds.length ? (
              <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
                <button type="button" className="r-chip" onClick={() => setShowHolds((value) => !value)}>
                  {showHolds ? "Masquer" : "Voir"} ce qu&apos;on ne touche pas ({holds.length})
                </button>
                {showHolds ? holds.map((decision) => <DecisionRow key={decision.id} decision={decision} busy={false} onAct={() => undefined} />) : null}
              </div>
            ) : null}
            <p className="r-sub mt-2 leading-relaxed">
              Règles : pub à 60 $ sans achat → couper (sauf 20 achats d&apos;historique ou test de moins de 72 h). Ad set ou campagne : ROAS réel 3 j sous 1,5 avec 150 $ → −30 % ; à 2,0 ou plus → +25 %.
              Une modification par campagne et par jour, jamais +30 % d&apos;un coup ni deux hausses en 48 h. Le ROAS réel d&apos;une campagne est son ROAS Meta recalé par le rapport ventes Shopify ÷ achats Meta du compte
              {o?.metaToReal != null ? ` (× ${num(o.metaToReal)} en ce moment)` : ""}.
            </p>
          </Section>

          {/* 4. Alertes */}
          <Section step={4} title="Alertes" icon={null} right={<span className="r-sub">{report.alerts.length}</span>}>
            {report.alerts.length ? report.alerts.map((alert) => <AlertRow key={alert.id} alert={alert} />) : <p className="py-1 text-[13px]" style={{ color: "var(--ink-3)" }}>Aucune alerte.</p>}
          </Section>

          {/* 5. Journal */}
          <Section step={5} title="Ce qui a été modifié hier" icon={null} right={<button type="button" className="r-chip" onClick={() => setShowJournal((value) => !value)}>{showJournal ? "Hier seulement" : "Tout le journal"}</button>}>
            {(showJournal ? report.journal.recent : report.journal.yesterday).length ? (
              (showJournal ? report.journal.recent : report.journal.yesterday).map((entry) => <JournalLine key={entry.id} entry={entry} />)
            ) : (
              <p className="py-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
                {showJournal ? "Le journal est vide pour l'instant." : "Rien de noté hier."}
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void addNote()}
                placeholder="Noter un changement fait ailleurs (dans Meta, sur le site…) : qui, quoi, quelle campagne"
                className="h-10 min-w-0 flex-1 rounded-xl border bg-transparent px-3 text-[13px] outline-none"
                style={{ borderColor: "var(--line)", color: "var(--ink)" }}
              />
              <button type="button" onClick={() => void addNote()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold text-white" style={{ background: "var(--r-accent, #233137)" }}>
                <NotebookPen className="h-4 w-4" /> Noter
              </button>
            </div>
            <p className="r-sub mt-1.5">Les budgets, pauses, relances et créations faits dans l&apos;Ads Manager, l&apos;uploader ou ici sont notés tout seuls (qui, quoi, avant / après).</p>
          </Section>

          {/* Créas */}
          <Section title="Créas" icon={<Sparkles className="h-4 w-4" />} right={<Link href="/ads-uploader" className="r-chip">Ads uploader</Link>}>
            <div className="grid gap-2 sm:grid-cols-2">
              {report.creatives.perAccount.map((account) => (
                <Tile
                  key={account.account}
                  label={`${account.account} · statics neufs cette semaine`}
                  value={`${account.newThisWeek} / ${account.target}`}
                  tone={account.newThisWeek >= account.target ? "good" : "warn"}
                  sub={
                    account.testingBudgets.length
                      ? `Ad sets de test : ${account.testingBudgets.map((row) => `${row.name} (${usd(row.budgetUsd)}/j)`).join(" · ")} — cible 80 $/j`
                      : "Pas d'ad set TESTING actif : en créer un à 80 $/j pour les 5 statics de la semaine."
                  }
                />
              ))}
            </div>
            <p className="r-sub mt-2">Pipeline : 5 statics neufs par semaine en TESTING à 80 $/j → 72 h sans toucher → Scaling si 5 achats et ROAS Meta ≥ 2,5 → post ID en Hyper à 30 achats.</p>

            {report.creatives.promote.length ? (
              <div className="mt-3">
                <p className="r-label mb-1">À promouvoir en Scaling (5 achats, ROAS Meta ≥ 2,5)</p>
                {report.creatives.promote.map((row) => <CreativeLine key={row.adId} row={row} />)}
              </div>
            ) : null}
            {report.creatives.hyperCandidates.length ? (
              <div className="mt-3">
                <p className="r-label mb-1">À passer en Hyper par post ID (30 achats ou plus)</p>
                {report.creatives.hyperCandidates.map((row) => <CreativeLine key={row.adId} row={row} />)}
              </div>
            ) : null}
            {report.creatives.inTest.length ? (
              <div className="mt-3">
                <p className="r-label mb-1">En test : ne pas toucher</p>
                {report.creatives.inTest.map((row) => (
                  <CreativeLine key={row.adId} row={row} extra={<span className="r-chip h-6 px-2">encore {Math.max(0, 72 - row.ageHours)} h</span>} />
                ))}
              </div>
            ) : null}
            <div className="mt-3">
              <p className="r-label mb-1">Winners actuels (7 j : 5 achats ou plus, ROAS Meta ≥ 2,0) · tendance ROAS Meta sur 3 jours</p>
              {report.creatives.winners.length ? report.creatives.winners.map((row) => <CreativeLine key={row.adId} row={row} />) : <p className="r-sub">Aucun winner sur 7 jours.</p>}
            </div>
          </Section>

          {/* Tests */}
          <Section title="Tests en cours" icon={<FlaskConical className="h-4 w-4" />}>
            <div className="grid gap-2 md:grid-cols-2">
              {report.tests.priceTests.map((test) => (
                <div key={test.id} className="rounded-xl p-3.5" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                      {test.name}
                    </p>
                    <span
                      className="r-chip"
                      style={{ color: test.status === "gagne" ? "var(--r-good)" : test.status === "perd" ? "var(--r-bad)" : undefined }}
                    >
                      {test.status}
                    </span>
                  </div>
                  <p className="r-sub mt-1">
                    Produit dupliqué à {usd(test.price, 2)}, campagne ABO {usd(test.dailyBudget)}/j, {test.days} jours, {usd(test.minSpend)} minimum. Campagnes dont le nom contient « {test.campaignKeyword} ».
                  </p>
                  {test.startDate ? (
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] tabular-nums" style={{ color: "var(--ink-2)" }}>
                      <span>Du {dayLabel(test.startDate)} au {test.endDate ? dayLabel(test.endDate) : "—"}</span>
                      <span>Jour {test.daysElapsed} / {test.days}</span>
                      <span>Dépense {usd(test.spend)} / {usd(test.minSpend)}</span>
                      <span>Visites {test.visits}</span>
                      <span>Commandes {test.orders}</span>
                      <span className="font-semibold" style={{ color: test.conversion != null && test.conversion >= test.thresholdConversion ? "var(--r-good)" : "var(--ink)" }}>
                        Conversion {pct(test.conversion)} (seuil {pct(test.thresholdConversion)})
                      </span>
                      <span>Profit / visite {usd(test.profitPerVisit, 2)}</span>
                      <span>À {usd(report.tests.basePrice, 2)} : {usd(test.baseProfitPerVisit, 2)}</span>
                    </div>
                  ) : (
                    <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
                      Pour battre {usd(report.tests.basePrice, 2)}, il faut au moins {pct(test.thresholdConversion)} de conversion
                      {test.autoThreshold != null ? ` (calculé sur la conversion actuelle de ${pct(report.tests.baseConversion)} : ${pct(test.autoThreshold)})` : ""}.
                    </p>
                  )}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {test.startDate ? (
                      <button type="button" className="r-chip" onClick={() => void setTest(test.id, { startDate: null }, "Test arrêté")}>
                        Arrêter / remettre à zéro
                      </button>
                    ) : (
                      <button type="button" className="r-chip font-semibold" onClick={() => void setTest(test.id, { startDate: today }, "Test lancé aujourd'hui")}>
                        Lancé aujourd&apos;hui
                      </button>
                    )}
                    <button
                      type="button"
                      className="r-chip"
                      onClick={() => {
                        const keyword = window.prompt("Mot-clé contenu dans le nom des campagnes du test", test.campaignKeyword);
                        if (keyword && keyword.trim()) void setTest(test.id, { campaignKeyword: keyword.trim() }, "Mot-clé enregistré");
                      }}
                    >
                      Mot-clé des campagnes
                    </button>
                  </div>
                </div>
              ))}
              <div className="rounded-xl p-3.5" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
                <p className="flex items-center gap-1.5 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                  <Gauge className="h-4 w-4" /> Upsell {report.tests.upsell.label} à {usd(report.tests.upsell.price, 2)}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] tabular-nums" style={{ color: "var(--ink-2)" }}>
                  <span>Acceptés : {report.tests.upsell.accepted} / {report.tests.upsell.orders} commandes</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>
                    Taux {pct(report.tests.upsell.rate)}
                  </span>
                  <span>Revenu {usd(report.tests.upsell.revenue, 2)}</span>
                  <span>Coût du collier en plus {usd(report.tests.upsell.extraCost, 2)}</span>
                  <span>Profit ajouté {usd(report.tests.upsell.profitAdded, 2)}</span>
                  <span>Par commande {usd(report.tests.upsell.profitPerOrder, 2)}</span>
                </div>
                <p className="r-sub mt-1.5">Sur les 7 derniers jours. Coût du collier en plus = grille 3 colliers − grille 2 colliers.</p>
              </div>
            </div>
          </Section>

          <p className="r-sub px-1">Mis à jour {timeLabel(report.builtAt)} · relu toutes les 2 minutes au plus.</p>
        </>
      )}
    </div>
  );
}
