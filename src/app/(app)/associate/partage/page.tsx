"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check, HandCoins, Loader2, Megaphone, PiggyBank, RefreshCw, Scale, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { Kpi, pct, usd } from "@/components/associate/parts";
import { CogsEditor } from "@/components/phoenix/cogs-editor";
import { cn } from "@/lib/utils";
import type { Frequency, Partner, PartnershipPeriod, PartnershipReport } from "@/lib/associate/partnership";

/**
 * Le partage 50/50 de Venom entre Mady et Alison : ventes Straight Sale, coût
 * produit, frais, la pub de chacun, le bénéfice, et ce que Mady verse à Alison
 * à chaque période (7 jours ou mois, au choix d'Alison). Le calcul est fait
 * côté serveur (src/lib/associate/partnership.ts).
 */

const REFRESH_MS = 2 * 60_000;

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const periodLabel = (period: Pick<PartnershipPeriod, "start" | "end">, frequency: Frequency) =>
  frequency === "monthly"
    ? new Date(`${period.start}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
    : `${dayLabel(period.start)} → ${dayLabel(period.end)}`;

async function post(body: unknown): Promise<PartnershipReport> {
  const res = await fetch("/api/associate/partnership", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as PartnershipReport & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Enregistrement impossible");
  return json;
}

export default function AssociatePartagePage() {
  const { isAdmin } = useAuth();
  const [report, setReport] = useState<PartnershipReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/associate/partnership", { cache: "no-store" });
        const json = (await res.json()) as PartnershipReport & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Partage indisponible");
        if (alive) setReport(json);
      } catch (error) {
        if (alive) toast.error(error instanceof Error ? error.message : "Partage indisponible");
      } finally {
        if (alive) setLoading(false);
      }
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [reloadKey]);

  const save = useCallback(async (body: unknown, done?: string) => {
    setSaving(true);
    try {
      setReport(await post(body));
      if (done) toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }, []);

  const frequency = report?.settings.frequency ?? "weekly";
  const current = report?.periods.find((period) => period.current) ?? report?.periods[0] ?? null;
  const warning = report?.periods.find((period) => period.error)?.error ?? null;

  return (
    <div className="space-y-4">
      <div className="r-rise flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="r-chip">
              <Scale className="h-3.5 w-3.5" />
              Mady 50 % · Alison 50 %
            </span>
            {report ? <span className="r-chip">depuis le {dayLabel(report.settings.startDate)}</span> : null}
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
            Partage 50/50
          </h1>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            Ventes Straight Sale − coût produit − frais − toute la pub = bénéfice, partagé en deux. Alison récupère en plus la pub qu&apos;elle a payée.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="r-tabs" role="radiogroup" aria-label="Rythme de paiement">
            {(["weekly", "monthly"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={frequency === value}
                disabled={saving}
                className="r-tab whitespace-nowrap"
                data-active={frequency === value ? "true" : "false"}
                onClick={() => frequency !== value && void save({ frequency: value }, value === "weekly" ? "Paiement tous les 7 jours" : "Paiement tous les mois")}
              >
                {value === "weekly" ? "Tous les 7 jours" : "Tous les mois"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="r-icon h-10 w-10 rounded-full transition-transform hover:scale-105 active:scale-95"
            aria-label="Actualiser"
            title="Actualiser"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {warning ? (
        <div className="r-card flex items-center gap-2.5 px-4 py-3 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {warning}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Reste à verser à Alison"
          value={report ? usd(report.totals.due) : "—"}
          tone={report ? (report.totals.due >= 0 ? "good" : "bad") : undefined}
          sub={report ? `${usd(report.totals.owed)} dû au total · ${usd(report.totals.paid)} déjà versé` : "Chargement…"}
          icon={<HandCoins className="h-4 w-4" />}
        />
        <Kpi
          label={current?.current ? "À verser cette période" : "À verser, dernière période"}
          value={current ? usd(current.owed) : "—"}
          sub={current ? periodLabel(current, frequency) : ""}
          icon={<CalendarClock className="h-4 w-4" />}
          delay={60}
        />
        <Kpi
          label="Bénéfice à partager"
          value={current ? usd(current.profit) : "—"}
          tone={current ? (current.profit >= 0 ? "good" : "bad") : undefined}
          sub={current ? `${usd(current.half)} chacun` : ""}
          icon={<PiggyBank className="h-4 w-4" />}
          delay={120}
        />
        <Kpi
          label="Pub de la période"
          value={current ? usd(current.adsAlison + current.adsMady) : "—"}
          sub={current ? `Alison ${usd(current.adsAlison)} · Mady ${usd(current.adsMady)}` : ""}
          icon={<Megaphone className="h-4 w-4" />}
          delay={180}
        />
      </div>

      {current ? <Breakdown period={current} frequency={frequency} processingRate={report?.processingRate ?? 0} /> : null}

      <div className="r-card r-rise overflow-hidden" style={{ animationDelay: "260ms" }}>
        <div className="flex items-center justify-between px-5 pt-4">
          <p className="r-label">Période par période</p>
          <p className="r-sub">{frequency === "weekly" ? "semaines du lundi au dimanche" : "mois civils"}</p>
        </div>
        <div className="overflow-x-auto px-2 pb-3 pt-2">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="r-label text-left">
                <th className="px-3 py-2 font-medium">Période</th>
                <th className="px-3 py-2 text-right font-medium">Ventes</th>
                <th className="px-3 py-2 text-right font-medium">Coût produit</th>
                <th className="px-3 py-2 text-right font-medium">Pub Alison</th>
                <th className="px-3 py-2 text-right font-medium">Pub Mady</th>
                <th className="px-3 py-2 text-right font-medium">Bénéfice</th>
                <th className="px-3 py-2 text-right font-medium">À verser</th>
                <th className="px-3 py-2 text-right font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {(report?.periods ?? []).map((period) => (
                <tr key={period.key} className="border-t" style={{ borderColor: "var(--line)", color: "var(--ink-2)" }}>
                  <td className="px-3 py-2.5 font-medium" style={{ color: "var(--ink)" }}>
                    {periodLabel(period, frequency)}
                    {period.current ? <span className="r-sub ml-2">en cours</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {usd(period.revenue)}
                    <span className="r-sub ml-1">· {period.orders}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{usd(period.cogs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{usd(period.adsAlison)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{usd(period.adsMady)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: period.profit >= 0 ? "var(--r-good)" : "var(--r-bad)" }}>
                    {usd(period.profit)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                    {usd(period.owed)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <PaidCell period={period} isAdmin={isAdmin} saving={saving} onSave={save} />
                  </td>
                </tr>
              ))}
              {!report?.periods.length ? (
                <tr>
                  <td colSpan={8} className="r-sub py-8 text-center">
                    {loading ? "Chargement…" : "Aucune période pour l'instant."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && report ? <AdminSettings report={report} saving={saving} onSave={save} /> : null}
      {/* Le coût produit qu'on met : le même éditeur que le Profit calculator, réservé à l'admin. */}
      {isAdmin ? <CogsEditor onSaved={() => setReloadKey((key) => key + 1)} /> : null}
    </div>
  );
}

function Breakdown({ period, frequency, processingRate }: { period: PartnershipPeriod; frequency: Frequency; processingRate: number }) {
  const steps: Array<{ label: string; value: number; strong?: boolean; note?: string }> = [
    { label: `Ventes Straight Sale · ${period.orders} commande(s)`, value: period.revenue, strong: true },
    { label: "Remboursements", value: -period.refunds },
    {
      label: "Coût produit",
      value: -period.cogs,
      note: period.cogsMissing > 0 ? `${period.cogsMissing} pièce(s) sans coût renseigné, comptées à 0 $` : undefined,
    },
    { label: `Frais de paiement · ${pct(processingRate, 1)}`, value: -period.fees },
    { label: "Pub payée par Alison", value: -period.adsAlison },
    { label: "Pub payée par Mady", value: -period.adsMady },
  ];
  const base = Math.max(period.revenue, 1);
  return (
    <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
      <div className="r-card r-rise p-5" style={{ animationDelay: "200ms" }}>
        <p className="r-label mb-4">Le calcul · {periodLabel(period, frequency)}</p>
        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.label}>
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
                  {step.value < 0 ? "−" : ""} {usd(Math.abs(step.value))}
                </span>
              </div>
              <div className="r-bar">
                <span style={{ width: `${Math.min(100, (Math.abs(step.value) / base) * 100)}%`, opacity: step.strong ? 1 : 0.55 }} />
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--line)" }}>
            <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              Bénéfice
            </span>
            <span className="text-[22px] font-semibold tabular-nums" style={{ color: period.profit >= 0 ? "var(--r-good)" : "var(--r-bad)" }}>
              {usd(period.profit)}
            </span>
          </div>
        </div>
      </div>

      <div className="r-card r-rise p-5" style={{ animationDelay: "240ms" }}>
        <p className="r-label mb-4">Qui touche quoi</p>
        <div className="space-y-3 text-[13px]" style={{ color: "var(--ink-2)" }}>
          <Line label="Moitié du bénéfice · Mady" value={period.half} />
          <Line label="Moitié du bénéfice · Alison" value={period.half} />
          <Line label="+ pub avancée par Alison, remboursée" value={period.adsAlison} />
          <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                Mady verse à Alison
              </span>
              <span className="text-[22px] font-semibold tabular-nums" style={{ color: period.owed >= 0 ? "var(--r-good)" : "var(--r-bad)" }}>
                {usd(period.owed)}
              </span>
            </div>
            <p className="r-sub mt-1.5">
              {period.owed < 0
                ? "Négatif : sur cette période, c'est Alison qui doit cette somme à Mady."
                : period.adsMady > 0
                  ? "La moitié de la pub avancée par Mady est déjà retirée : elle est dans le bénéfice."
                  : "Sa moitié du bénéfice, plus la pub qu'elle a payée de sa poche."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
        {usd(value)}
      </span>
    </div>
  );
}

function PaidCell({ period, isAdmin, saving, onSave }: { period: PartnershipPeriod; isAdmin: boolean; saving: boolean; onSave: (body: unknown, done?: string) => Promise<void> }) {
  if (period.paid) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="r-chip" title={`Versé le ${new Date(period.paid.at).toLocaleDateString("fr-FR")}`}>
          <Check className="h-3.5 w-3.5" />
          payé {usd(period.paid.amount)}
        </span>
        {isAdmin ? (
          <button type="button" disabled={saving} title="Rouvrir" className="r-icon h-7 w-7 rounded-full" onClick={() => void onSave({ markPaid: { key: period.key, paid: false } }, "Période rouverte")}>
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    );
  }
  if (period.current) return <span className="r-sub">en cours</span>;
  if (!isAdmin) return <span className="r-sub">à verser</span>;
  return (
    <button
      type="button"
      disabled={saving}
      className="r-chip font-semibold"
      onClick={() => void onSave({ markPaid: { key: period.key, amount: period.owed, paid: true } }, "Période marquée payée")}
    >
      Marquer payé
    </button>
  );
}

function AdminSettings({ report, saving, onSave }: { report: PartnershipReport; saving: boolean; onSave: (body: unknown, done?: string) => Promise<void> }) {
  return (
    <div className="r-card r-rise p-5" style={{ animationDelay: "300ms" }}>
      <p className="r-label mb-1">Réglages (toi seul les vois)</p>
      <p className="r-sub mb-4">Qui paie chaque compte pub, et le premier jour compté dans le partage.</p>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <label className="block space-y-1.5">
          <span className="r-label">Début du partage</span>
          <input
            type="date"
            defaultValue={report.settings.startDate}
            disabled={saving}
            onBlur={(event) => event.target.value && event.target.value !== report.settings.startDate && void onSave({ startDate: event.target.value }, "Date de début enregistrée")}
            className="w-full rounded-xl border bg-transparent px-3 py-2 text-[13px]"
            style={{ borderColor: "var(--line)", color: "var(--ink)" }}
          />
        </label>
        <div className="space-y-2">
          <span className="r-label">Comptes pub Meta</span>
          {report.accounts.map((account) => (
            <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
              <span>
                {account.name} <span className="r-sub">· {account.id}</span>
              </span>
              <div className="r-tabs">
                {(["alison", "mady"] as Partner[]).map((payer) => (
                  <button
                    key={payer}
                    type="button"
                    disabled={saving}
                    className="r-tab"
                    data-active={account.payer === payer ? "true" : "false"}
                    onClick={() => account.payer !== payer && void onSave({ payers: { [account.id]: payer } }, `${account.name} : payé par ${payer === "mady" ? "Mady" : "Alison"}`)}
                  >
                    payé par {payer === "mady" ? "Mady" : "Alison"}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="r-sub">Un nouveau compte ajouté au périmètre (Settings) est compté comme payé par Mady.</p>
        </div>
      </div>
    </div>
  );
}
