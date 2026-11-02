"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { CalendarClock, Coins, HandCoins, Loader2, Megaphone, Package, PiggyBank, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { Kpi, usd } from "@/components/associate/parts";
import { ProfitCalculator } from "@/components/phoenix/profit-calculator";
import { cn } from "@/lib/utils";
import type { Frequency, Partner, PartnershipPeriod, PartnershipReport } from "@/lib/associate/partnership";

/**
 * MoneyTalk : le bénéfice d'Alison sur le Straight Sale de Venom, vu de son
 * côté. Aujourd'hui (version 1) c'est elle qui paie la pub et elle garde tout
 * le bénéfice du Straight sale : rien « à lui verser ». Le coût des colliers se
 * règle à part avec Mady. Version 2 (plus tard, Mady paie la pub) :
 * moitié-moitié. Calcul côté serveur (src/lib/associate/partnership.ts).
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
  const { isAdmin, isAssociate } = useAuth();
  // Le tableau de bord d'Alison : « ton », « ta » ; vu par Mady, « d'Alison ».
  const mine = isAssociate;
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

  // Le bouton « Actualiser » de l'en-tête : on relit MoneyTalk sur place plutôt que de recharger la page.
  useEffect(() => {
    const onRefresh = (event: Event) => {
      event.preventDefault();
      setReloadKey((key) => key + 1);
    };
    window.addEventListener("msgate:refresh", onRefresh);
    return () => window.removeEventListener("msgate:refresh", onRefresh);
  }, []);

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
  const shared = current?.version === 2;
  const totalProfit = (report?.periods ?? []).reduce((sum, period) => sum + period.owed, 0);
  const startDay = report?.settings.startDate ?? null;

  return (
    <div className="space-y-4">
      <div className="r-rise flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4">
        <div className="min-w-0 sm:flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="r-chip">
              <HandCoins className="h-3.5 w-3.5" />
              {madyPaysFrom
                ? `Mady paie la pub depuis le ${dayLabel(madyPaysFrom)} · 50/50`
                : mine
                  ? "Tu paies la pub · tout le bénéfice du Straight sale est pour toi"
                  : "Alison paie la pub · tout le bénéfice du Straight sale est pour elle"}
            </span>
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
            MoneyTalk
          </h1>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            {mine ? "Ton bénéfice sur Venom" : "Le bénéfice d'Alison sur Venom"} : ventes Straight sale − frais de paiement − pub = bénéfice. Le coût des
            colliers se règle à part.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="r-tabs flex-1 sm:flex-none" role="radiogroup" aria-label="Rythme de paiement">
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
            className="r-icon h-10 w-10 shrink-0 rounded-full transition-transform hover:scale-105 active:scale-95"
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
          label={`${mine ? (shared ? "Ta part" : "Ton bénéfice") : shared ? "Part d'Alison" : "Bénéfice d'Alison"} · ${current?.current ? "période en cours" : "dernière période"}`}
          value={current ? usd(current.owed) : "—"}
          tone={current ? (current.owed >= 0 ? "good" : "bad") : undefined}
          sub={current ? `${periodLabel(current, frequency)}${shared ? " · 50/50" : ""}` : "Chargement…"}
          icon={<PiggyBank className="h-4 w-4" />}
        />
        <Kpi
          label={mine ? "Ton bénéfice depuis le début" : "Bénéfice d'Alison depuis le début"}
          value={report ? usd(totalProfit) : "—"}
          tone={report ? (totalProfit >= 0 ? "good" : "bad") : undefined}
          sub={startDay ? `depuis le ${dayLabel(startDay)}` : ""}
          icon={<CalendarClock className="h-4 w-4" />}
          delay={60}
        />
        <Kpi
          label="Ventes de la période"
          value={current ? usd(current.revenue) : "—"}
          sub={current ? `${current.orders} commande(s) Straight sale` : ""}
          icon={<Coins className="h-4 w-4" />}
          delay={120}
        />
        <Kpi
          label={mine && !shared ? "Pub que tu as payée" : "Pub de la période"}
          value={current ? usd(current.adsAlison + current.adsMady) : "—"}
          sub={current ? (shared ? `Alison ${usd(current.adsAlison)} · Mady ${usd(current.adsMady)}` : "comptes Venom et Badgal, en $") : ""}
          icon={<Megaphone className="h-4 w-4" />}
          delay={180}
        />
      </div>

      {/* Le calculateur du Straight sale (Venom seul) : chiffres de la période pré-remplis, tout se modifie. */}
      <div className="r-rise space-y-2" style={{ animationDelay: "200ms" }}>
        <div className="px-1">
          <p className="r-label">Calculateur de profit · Straight sale</p>
          <p className="r-sub">
            Pré-rempli pour la période (champs « auto ») : ventes, remboursements et retours, commandes, pub Meta, colliers (grille fournisseur) et
            frais de paiement à 4 %. À compléter à la main si besoin : le frais fixe par transaction et les autres coûts (Shopify, applis, agent…).
            Tout se modifie pour simuler. {mine ? "Ton bénéfice" : "Le bénéfice d'Alison"} reste celui du tableau ci-dessous (sans le coût des colliers, réglé à part).
          </p>
        </div>
        <ProfitCalculator
          endpoint="/api/associate/profit"
          alerts={false}
          storageKey="msgate.profit-calculator.straight"
          defaults={{ processingRate: String(report?.processingRate ?? 4) }}
        />
      </div>

      <div className="r-card r-rise overflow-hidden" style={{ animationDelay: "260ms" }}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 pt-4">
          <p className="r-label">Période par période</p>
          <p className="r-sub">{frequency === "weekly" ? "semaines du lundi au dimanche" : "mois civils"}</p>
        </div>
        {/* Sur téléphone : une carte par période, empilées, plutôt qu'un tableau qui défile. */}
        <div className="space-y-2.5 px-3 pb-3 pt-3 md:hidden">
          {(report?.periods ?? []).map((period) => (
            <PeriodCard key={period.key} period={period} frequency={frequency} mine={mine} />
          ))}
          {!report?.periods.length ? <p className="r-sub py-8 text-center">{loading ? "Chargement…" : "Aucune période pour l'instant."}</p> : null}
        </div>
        <div className="hidden overflow-x-auto px-2 pb-3 pt-2 md:block">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead>
              <tr className="r-label text-left">
                <th className="px-3 py-2 font-medium">Période</th>
                <th className="px-3 py-2 text-right font-medium">Ventes</th>
                <th className="px-3 py-2 text-right font-medium">Frais de paiement</th>
                <th className="px-3 py-2 text-right font-medium">Pub</th>
                <th className="px-3 py-2 text-right font-medium">{mine ? "Ton bénéfice" : "Bénéfice d'Alison"}</th>
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
                  <td className="px-3 py-2.5 text-right tabular-nums">{usd(period.fees)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" title={`Alison ${usd(period.adsAlison)} · Mady ${usd(period.adsMady)}`}>
                    {usd(period.adsAlison + period.adsMady)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: period.owed >= 0 ? "var(--r-good)" : "var(--r-bad)" }}>
                    {usd(period.owed)}
                    {period.version === 2 ? <span className="r-sub ml-1.5 font-normal">50/50</span> : null}
                  </td>
                </tr>
              ))}
              {!report?.periods.length ? (
                <tr>
                  <td colSpan={5} className="r-sub py-8 text-center">
                    {loading ? "Chargement…" : "Aucune période pour l'instant."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && report ? <AdminSettings report={report} saving={saving} onSave={save} /> : null}
      {/* Le coût des colliers (COGS) : il se règle dans la grille fournisseur, plus par pièce. */}
      {isAdmin ? (
        <Link href="/grille-fournisseur" className="r-card r-rise flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5" style={{ animationDelay: "320ms" }}>
          <Package className="h-5 w-5 shrink-0" style={{ color: "var(--ink-3)" }} />
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
              Coût des colliers (COGS) · Grille fournisseur
            </span>
            <span className="r-sub block">Le prix du colis selon le nombre de colliers : c&apos;est là que tu le modifies ou que tu ajoutes une nouvelle grille.</span>
          </span>
        </Link>
      ) : null}
    </div>
  );
}

/** Une période en carte (téléphone) : le bénéfice en gros, le détail du calcul en dessous. */
function PeriodCard({ period, frequency, mine }: { period: PartnershipPeriod; frequency: Frequency; mine: boolean }) {
  const rows: { label: string; value: string; color?: string }[] = [
    { label: "Ventes", value: usd(period.revenue) },
    { label: "Commandes", value: String(period.orders) },
    { label: "Frais de paiement", value: usd(period.fees) },
    { label: "Pub", value: usd(period.adsAlison + period.adsMady) },
  ];
  return (
    <div className="rounded-2xl border p-3.5" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13.5px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>
          {periodLabel(period, frequency)}
        </p>
        {period.current ? <span className="r-sub shrink-0">en cours</span> : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="r-label">
          {mine ? "Ton bénéfice" : "Bénéfice d'Alison"}
          {period.version === 2 ? " · 50/50" : ""}
        </span>
        <span className="text-[19px] font-semibold tabular-nums" style={{ color: period.owed >= 0 ? "var(--r-good)" : "var(--r-bad)" }}>
          {usd(period.owed)}
        </span>
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-2.5 text-[12px]" style={{ borderColor: "var(--line)" }}>
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 items-baseline justify-between gap-2">
            <dt className="truncate" style={{ color: "var(--ink-3)" }}>
              {row.label}
            </dt>
            <dd className="shrink-0 font-medium tabular-nums" style={{ color: row.color ?? "var(--ink-2)" }}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
