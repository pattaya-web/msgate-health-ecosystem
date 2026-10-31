"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check, HandCoins, Loader2, Megaphone, PiggyBank, RefreshCw, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { Kpi, pct, usd } from "@/components/associate/parts";
import { CogsEditor } from "@/components/phoenix/cogs-editor";
import { cn } from "@/lib/utils";
import type { Frequency, Partner, PartnershipPeriod, PartnershipReport } from "@/lib/associate/partnership";

/**
 * MoneyTalk : la paie d'Alison sur le Straight Sale de Venom. Version 1
 * (aujourd'hui, Alison paie la pub) : tout le bénéfice est pour elle.
 * Version 2 (plus tard, Mady paie la pub) : moitié-moitié, la moitié de la pub
 * de Mady retirée de sa paie. Calcul côté serveur (src/lib/associate/partnership.ts).
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

export default function MoneyTalkPage() {
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
        if (!res.ok) throw new Error(json.error ?? "MoneyTalk indisponible");
        if (alive) setReport(json);
      } catch (error) {
        if (alive) toast.error(error instanceof Error ? error.message : "MoneyTalk indisponible");
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
  const madyPaysFrom = report?.settings.madyPaysFrom ?? null;

  return (
    <div className="space-y-4">
      <div className="r-rise flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="r-chip">
              <HandCoins className="h-3.5 w-3.5" />
              {madyPaysFrom ? `Mady paie la pub depuis le ${dayLabel(madyPaysFrom)} · 50/50` : "Alison paie la pub · tout le bénéfice pour elle"}
            </span>
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
            MoneyTalk
          </h1>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            Ce qu&apos;Alison touche sur Venom : ventes − coût produit − frais − pub = bénéfice.
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
                onClick={() => frequency !== value && void save({ frequency: value }, value === "weekly" ? "Paie tous les 7 jours" : "Paie tous les mois")}
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
          sub={report ? `${usd(report.totals.owed)} au total · ${usd(report.totals.paid)} déjà versé` : "Chargement…"}
          icon={<HandCoins className="h-4 w-4" />}
        />
        <Kpi
          label={current?.current ? "Sa paie, période en cours" : "Sa paie, dernière période"}
          value={current ? usd(current.owed) : "—"}
          sub={current ? periodLabel(current, frequency) : ""}
          icon={<CalendarClock className="h-4 w-4" />}
          delay={60}
        />
        <Kpi
          label="Bénéfice de la période"
          value={current ? usd(current.profit) : "—"}
          tone={current ? (current.profit >= 0 ? "good" : "bad") : undefined}
          sub={current ? `${usd(current.revenue)} de ventes · ${current.orders} commande(s)` : ""}
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

      {current ? <Versions period={current} frequency={frequency} processingRate={report?.processingRate ?? 0} /> : null}

      <div className="r-card r-rise overflow-hidden" style={{ animationDelay: "260ms" }}>
        <div className="flex items-center justify-between px-5 pt-4">
          <p className="r-label">Période par période</p>
          <p className="r-sub">{frequency === "weekly" ? "semaines du lundi au dimanche" : "mois civils"}</p>
        </div>
        <div className="overflow-x-auto px-2 pb-3 pt-2">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead>
              <tr className="r-label text-left">
                <th className="px-3 py-2 font-medium">Période</th>
                <th className="px-3 py-2 text-right font-medium">Ventes</th>
                <th className="px-3 py-2 text-right font-medium">Coût produit</th>
                <th className="px-3 py-2 text-right font-medium">Frais</th>
                <th className="px-3 py-2 text-right font-medium">Pub</th>
                <th className="px-3 py-2 text-right font-medium">Bénéfice</th>
                <th className="px-3 py-2 text-right font-medium">Paie Alison</th>
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
                  <td className="px-3 py-2.5 text-right tabular-nums">{usd(period.fees)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" title={`Alison ${usd(period.adsAlison)} · Mady ${usd(period.adsMady)}`}>
                    {usd(period.adsAlison + period.adsMady)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: period.profit >= 0 ? "var(--r-good)" : "var(--r-bad)" }}>
                    {usd(period.profit)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                    {usd(period.owed)}
                    <span className="r-sub ml-1.5 font-normal">{period.version === 2 ? "50/50" : "100 %"}</span>
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

type Step = { label: string; value: number; strong?: boolean; note?: string };

/** Les deux versions côte à côte, sur les chiffres de la période : celle qui s'applique est mise en avant. */
function Versions({ period, frequency, processingRate }: { period: PartnershipPeriod; frequency: Frequency; processingRate: number }) {
  const ads = period.adsAlison + period.adsMady;
  const base = period.revenue - period.refunds - period.cogs - period.fees;
  const common: Step[] = [
    { label: `Ventes Straight Sale · ${period.orders} commande(s)`, value: period.revenue, strong: true },
    ...(period.refunds ? [{ label: "Remboursements", value: -period.refunds }] : []),
    { label: "Coût produit", value: -period.cogs, note: period.cogsMissing > 0 ? `${period.cogsMissing} pièce(s) sans coût renseigné` : undefined },
    { label: `Frais de paiement · ${pct(processingRate, 1)}`, value: -period.fees },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <VersionCard
        active={period.version === 1}
        tag="Version 1 · aujourd'hui"
        title="Alison paie la pub"
        steps={[...common, { label: "Pub payée par Alison", value: -ads }]}
        resultLabel="Paie d'Alison · tout le bénéfice"
        result={period.payV1}
        note="Tant qu'elle paie la pub de sa poche, tout le bénéfice est pour elle."
        delay={200}
        frequency={frequency}
        period={period}
      />
      <VersionCard
        active={period.version === 2}
        tag="Version 2 · plus tard"
        title="Mady paie la pub"
        steps={[
          { label: "Ventes − coût produit − frais", value: base, strong: true },
          { label: "Moitié pour Alison", value: base / 2 },
          { label: "Moitié de la pub de Mady, retirée de sa paie", value: -ads / 2 },
        ]}
        resultLabel="Paie d'Alison · 50/50"
        result={period.payV2}
        note="Dès que la pub passe sur le compte agence de Mady : moitié-moitié, et la moitié de la pub qu'il a avancée est retirée de sa paie."
        delay={240}
        frequency={frequency}
        period={period}
      />
    </div>
  );
}

function VersionCard({
  active,
  tag,
  title,
  steps,
  resultLabel,
  result,
  note,
  delay,
  frequency,
  period,
}: {
  active: boolean;
  tag: string;
  title: string;
  steps: Step[];
  resultLabel: string;
  result: number;
  note: string;
  delay: number;
  frequency: Frequency;
  period: PartnershipPeriod;
}) {
  return (
    <div className={cn("r-card r-rise p-5", !active && "opacity-70")} style={{ animationDelay: `${delay}ms`, outline: active ? "2px solid var(--r-accent)" : undefined }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="r-label">{tag}</p>
          <p className="mt-0.5 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
            {title}
          </p>
        </div>
        <span className="r-chip">
          {active ? "s'applique maintenant" : "simulation"} · {periodLabel(period, frequency)}
        </span>
      </div>
      <div className="space-y-2.5">
        {steps.map((step) => (
          <div key={step.label} className="flex items-baseline justify-between gap-3">
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
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
          {resultLabel}
        </span>
        <span className="text-[22px] font-semibold tabular-nums" style={{ color: result >= 0 ? "var(--r-good)" : "var(--r-bad)" }}>
          {usd(result)}
        </span>
      </div>
      <p className="r-sub mt-1.5">{note}</p>
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
  const dateInput = "w-full rounded-xl border bg-transparent px-3 py-2 text-[13px]";
  const dateStyle = { borderColor: "var(--line)", color: "var(--ink)" } as const;
  return (
    <div className="r-card r-rise p-5" style={{ animationDelay: "300ms" }}>
      <p className="r-label mb-1">Réglages (toi seul les vois)</p>
      <p className="r-sub mb-4">Le passage à la version 2, le premier jour compté, et qui paie chaque compte pub.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="r-label">Je paie la pub à partir du</span>
          <input
            type="date"
            defaultValue={report.settings.madyPaysFrom ?? ""}
            disabled={saving}
            onBlur={(event) =>
              event.target.value !== (report.settings.madyPaysFrom ?? "") &&
              void onSave({ madyPaysFrom: event.target.value || null }, event.target.value ? "Version 2 à partir de cette date" : "Retour à la version 1")
            }
            className={dateInput}
            style={dateStyle}
          />
          <span className="r-sub block">Vide = Alison paie encore la pub (version 1).</span>
        </label>
        <label className="block space-y-1.5">
          <span className="r-label">Début du calcul</span>
          <input
            type="date"
            defaultValue={report.settings.startDate}
            disabled={saving}
            onBlur={(event) => event.target.value && event.target.value !== report.settings.startDate && void onSave({ startDate: event.target.value }, "Date de début enregistrée")}
            className={dateInput}
            style={dateStyle}
          />
        </label>
        <div className="space-y-2">
          <span className="r-label">Comptes pub Meta</span>
          {report.accounts.map((account) => (
            <div key={account.id} className="space-y-1 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
              <span className="block truncate" title={account.id}>
                {account.name}
              </span>
              <div className="r-tabs">
                {(["alison", "mady"] as Partner[]).map((payer) => (
                  <button
                    key={payer}
                    type="button"
                    disabled={saving}
                    className="r-tab whitespace-nowrap"
                    data-active={account.payer === payer ? "true" : "false"}
                    onClick={() => account.payer !== payer && void onSave({ payers: { [account.id]: payer } }, `${account.name} : payé par ${payer === "mady" ? "Mady" : "Alison"}`)}
                  >
                    {payer === "mady" ? "Mady" : "Alison"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
