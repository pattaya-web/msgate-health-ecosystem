"use client";

import { reportToday } from "@/lib/report-tz";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Loader2, RefreshCw, RotateCcw, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/phoenix/date-range-picker";
import { TzBadge } from "@/components/phoenix/source-clocks";
import {
  GhostButton,
  MiniStat,
  NumberField as Field,
  PanelTitle,
  Segmented,
  Surface,
  type Accent,
} from "@/components/phoenix/ui";
import type { ProfitInputs } from "@/lib/metrics/profit-inputs";
import type { SupplierGrid, SupplierGridConfig } from "@/lib/metrics/supplier-grid";
import { useAuth } from "@/lib/auth/auth-context";
import Link from "next/link";

/**
 * Same model as the VIP Club profit calculator, wired to our own figures.
 *
 * Everything the cockpit already knows (revenue, refunds, transactions,
 * chargebacks, ad spend) is pulled from the API for the selected window; the
 * rates only the operator knows stay manual and are remembered between visits.
 */

type FieldId =
  | "revenue"
  | "refunds"
  | "processingRate"
  | "fixedProcessingFee"
  | "transactions"
  | "crmRate"
  | "chargebacks"
  | "chargebackFee"
  | "chargebackValue"
  | "rdrCount"
  | "rdrFee"
  | "ethocaCount"
  | "ethocaFee"
  | "cdrnCount"
  | "cdrnFee"
  | "cogs"
  | "ads"
  | "otherCosts"
  | "reserveRate"
  | "reserveReleased";

type Fields = Record<FieldId, string>;

/**
 * Typed once by the operator and remembered; everything else comes from the API.
 * Only the alert *prices* stay manual — their volumes come from Disputifier.
 */
const MANUAL_FIELDS: FieldId[] = [
  "processingRate",
  "fixedProcessingFee",
  "crmRate",
  "chargebackFee",
  "rdrFee",
  "ethocaFee",
  "cdrnFee",
  "otherCosts",
  "reserveRate",
  "reserveReleased",
];

const EMPTY: Fields = {
  revenue: "",
  refunds: "",
  processingRate: "",
  fixedProcessingFee: "",
  transactions: "",
  crmRate: "",
  chargebacks: "",
  chargebackFee: "",
  chargebackValue: "",
  rdrCount: "",
  rdrFee: "",
  ethocaCount: "",
  ethocaFee: "",
  cdrnCount: "",
  cdrnFee: "",
  cogs: "",
  ads: "",
  otherCosts: "",
  reserveRate: "",
  reserveReleased: "",
};

const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD"] as const;
type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
  AUD: "A$",
};

const PRESETS = [7, 14, 30] as const;

const STORAGE_KEY = "msgate.profit-calculator";

const selectClass =
  "h-8 rounded-xl bg-white px-2.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-900/[0.08] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/[0.08]";

const PALETTE = [
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#f97316",
  "#06b6d4",
  "#22c55e",
  "#eab308",
  "#ec4899",
];

function presetRange(days: number) {
  // Les N derniers jours, aujourd'hui compris, en jours de Paris (ceux de Shopify et Meta) :
  // une boutique qui démarre vend surtout aujourd'hui, l'exclure affichait 0 $.
  const today = reportToday();
  const end = new Date(`${today}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: today };
}

/* ------------------------------------------------------------------ */

function Group({
  title,
  accent = "slate",
  children,
}: {
  title: string;
  accent?: Accent;
  children: React.ReactNode;
}) {
  return (
    <Surface accent={accent} className="p-3">
      <PanelTitle accent={accent} className="mb-2.5">
        {title}
      </PanelTitle>
      {children}
    </Surface>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-900/[0.04] py-1 last:border-0 dark:border-white/[0.04]">
      <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
          tone || "text-slate-700 dark:text-slate-200"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** La ligne de chiffres en tête : tout le compte pour l'admin, le Straight sale seul pour l'associé. */
function SalesStrip({ inputs, money }: { inputs: ProfitInputs; money: (value: number) => string }) {
  const c = inputs.categories;
  const roas = inputs.roasCombined != null ? `${inputs.roasCombined.toFixed(2)}×` : "—";
  const items: Array<[string, string, string?]> =
    inputs.scope === "straight"
      ? [
          ["Straight sale", money(c.direct), `${c.directSales} vente(s)`],
          ["Dépense Meta", money(inputs.ads)],
          ["ROAS straight sale", roas],
          ["Colliers", inputs.cogs != null ? money(inputs.cogs) : "—", inputs.cogsDetail ? `${inputs.cogsDetail.units} collier(s) · grille fournisseur` : undefined],
        ]
      : [
          ["Straight sale", money(c.direct), `${c.directSales} vente(s)`],
          ["VIP Initial", money(c.initial)],
          ["Recurring", money(c.recurring)],
          ["Salvage", money(c.salvage)],
          ["Upsell", money(c.upsell)],
          ["Dépense Meta", money(inputs.ads)],
          ["ROAS combiné", roas, "straight sale + abonnements"],
        ];
  return (
    <div className={cn("grid gap-2", inputs.scope === "straight" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7")}>
      {items.map(([label, value, sub]) => (
        <div key={label} className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
          <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
          {sub ? <p className="truncate text-[10px] text-slate-400">{sub}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function ProfitCalculator({
  endpoint = "/api/profit/inputs",
  alerts = true,
  storageKey = STORAGE_KEY,
  refreshKey = 0,
  defaults,
}: {
  /** D'où viennent les chiffres : /api/profit/inputs (tout le compte) ou /api/associate/profit (Straight sale). */
  endpoint?: string;
  /**
   * Les alertes Disputifier (RDR, Ethoca, CDRN) : seulement pour l'admin. Sans
   * elles, le calculateur passe en mode Straight sale : ventes, remboursements
   * et retours, frais de paiement, colliers, pub et autres coûts, rien d'autre
   * (ni CRM, ni chargebacks, ni réserve).
   */
  alerts?: boolean;
  /** Clé de mémorisation des taux, distincte par vue. */
  storageKey?: string;
  /** Change pour forcer un rechargement (après une modification des COGS). */
  refreshKey?: number;
  /** Les taux pré-remplis tant que rien n'a été saisi (ex. frais de paiement du Straight sale). */
  defaults?: Partial<Record<FieldId, string>>;
} = {}) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [days, setDays] = useState<number | "custom">(7);
  const [custom, setCustom] = useState(presetRange(7));
  const [loading, setLoading] = useState(true);
  const [inputs, setInputs] = useState<ProfitInputs | null>(null);
  const [restored, setRestored] = useState(false);

  const range = days === "custom" ? custom : presetRange(days);
  // Une clé stable : les taux par défaut arrivent parfois après le premier rendu (réglages chargés ensuite).
  const defaultsKey = JSON.stringify(defaults ?? {});

  // Manual rates survive reloads; the auto fields are always refetched.
  // localStorage cannot be read during the server render, so this has to happen
  // after mount — the one case the set-state-in-effect rule cannot express.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as Partial<Fields> & {
        currency?: Currency;
      };
      const fallback = JSON.parse(defaultsKey) as Partial<Fields>;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFields((current) => {
        const next = { ...current };
        for (const id of MANUAL_FIELDS) {
          if (saved[id] != null && saved[id] !== "") next[id] = saved[id] as string;
          else if (fallback[id]) next[id] = fallback[id] as string;
        }
        return next;
      });
      if (saved.currency && CURRENCIES.includes(saved.currency)) setCurrency(saved.currency);
    } catch {
      // first visit, nothing stored
    }
    setRestored(true);
  }, [storageKey, defaultsKey]);

  useEffect(() => {
    if (!restored) return;
    const payload: Record<string, string> = { currency };
    for (const id of MANUAL_FIELDS) payload[id] = fields[id];
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [fields, currency, restored, storageKey]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const params = new URLSearchParams({ start: range.start, end: range.end });

        // Disputifier is a separate source: its outage must not blank the rest.
        const [inputsRes, alertsRes] = await Promise.allSettled([
          fetch(`${endpoint}?${params}`, { cache: "no-store" }).then(async (res) =>
            res.ok ? ((await res.json()) as ProfitInputs) : null
          ),
          alerts
            ? fetch(
                `/api/disputifier/alerts?start=${range.start}&end=${range.end}&merchant=all&mid=all&type=all&infer=0`,
                { cache: "no-store" }
              ).then(async (res) => (res.ok ? await res.json() : null))
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        const data = inputsRes.status === "fulfilled" ? inputsRes.value : null;
        const byType =
          alertsRes.status === "fulfilled" ? alertsRes.value?.totals?.byType : undefined;

        if (data) setInputs(data);

        setFields((current) => ({
          ...current,
          ...(data
            ? {
                revenue: String(data.revenue),
                refunds: String(data.refunds),
                transactions: String(data.transactions),
                chargebacks: String(data.chargebacks),
                chargebackValue: String(data.chargebackValue),
                ads: String(data.ads),
                // Le COGS calculé remplace la saisie quand la source donne les articles vendus.
                ...(data.cogs != null ? { cogs: String(data.cogs) } : {}),
              }
            : {}),
          ...(byType
            ? {
                ethocaCount: String(byType.ethoca?.count ?? 0),
                cdrnCount: String(byType.cdrn?.count ?? 0),
                rdrCount: String(byType.rdr?.count ?? 0),
              }
            : {}),
        }));
      } catch {
        // keep whatever is on screen
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, endpoint, alerts, refreshKey]);

  const set = useCallback(
    (id: FieldId) => (value: string) => setFields((current) => ({ ...current, [id]: value })),
    []
  );

  const money = useCallback(
    (value: number) =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value),
    [currency]
  );

  const simple = !alerts;
  const { isAdmin, isAssociate } = useAuth();
  const [grid, setGrid] = useState<SupplierGrid | null>(null);

  // La grille en vigueur, pour définir le coût des colliers (COGS) sous le champ.
  useEffect(() => {
    if (!simple) return;
    let cancelled = false;
    void fetch("/api/accounting/supplier-grid", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<SupplierGridConfig>) : null))
      .then((config) => {
        if (cancelled || !config?.grids?.length) return;
        const latest = [...config.grids].sort(
          (a, b) => (a.fromOrder ?? -1) - (b.fromOrder ?? -1) || (a.fromDate ?? "").localeCompare(b.fromDate ?? "")
        );
        setGrid(latest[latest.length - 1]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [simple]);

  const result = useMemo(() => {
    // En mode Straight sale, les champs masqués ne comptent pas.
    const hidden: FieldId[] = simple ? ["crmRate", "chargebacks", "chargebackFee", "chargebackValue", "reserveRate", "reserveReleased"] : [];
    const val = (id: FieldId) => (hidden.includes(id) ? 0 : Math.max(0, Number(String(fields[id]).replace(",", ".")) || 0));

    const revenue = val("revenue");
    const refunds = val("refunds");
    const processing =
      (revenue * val("processingRate")) / 100 + val("transactions") * val("fixedProcessingFee");
    const crmFees = (revenue * val("crmRate")) / 100;
    const cbValue = val("chargebackValue");
    const cbFees = val("chargebacks") * val("chargebackFee");
    const rdr = val("rdrCount") * val("rdrFee");
    const ethoca = val("ethocaCount") * val("ethocaFee");
    const cdrn = val("cdrnCount") * val("cdrnFee");
    const cogs = val("cogs");
    const ads = val("ads");
    const other = val("otherCosts");

    const deductions =
      refunds + processing + crmFees + cbValue + cbFees + rdr + ethoca + cdrn + cogs + ads + other;
    const profit = revenue - deductions;

    const reserve = (revenue * val("reserveRate")) / 100;
    const reserveReleased = val("reserveReleased");
    const cash = profit - reserve + reserveReleased;

    return {
      revenue,
      refunds,
      processing,
      crmFees,
      cbValue,
      cbFees,
      alerts: { rdr, ethoca, cdrn },
      cogs,
      ads,
      other,
      deductions,
      profit,
      reserve,
      reserveReleased,
      cash,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      refundRate: revenue > 0 ? (refunds / revenue) * 100 : 0,
      cbRate: val("transactions") > 0 ? (val("chargebacks") / val("transactions")) * 100 : 0,
      roas: ads > 0 ? revenue / ads : 0,
      /** Per-day profit, which is the number worth watching across windows. */
      perDay: inputs?.range.days ? profit / inputs.range.days : 0,
      perOrder: val("transactions") > 0 ? profit / val("transactions") : 0,
    };
  }, [fields, inputs, simple]);

  const costs = useMemo(
    () =>
      [
        { label: simple ? "Remboursements et retours" : "Remboursements", value: result.refunds },
        { label: simple ? "Frais de paiement" : "Frais de traitement", value: result.processing },
        { label: "CRM", value: result.crmFees },
        { label: "Chargebacks", value: result.cbValue + result.cbFees },
        {
          label: "Frais d'alertes",
          value: result.alerts.rdr + result.alerts.ethoca + result.alerts.cdrn,
        },
        { label: simple ? "Colliers (grille fournisseur)" : "COGS et livraison", value: result.cogs },
        { label: simple ? "Pub Meta" : "Publicité", value: result.ads },
        { label: "Autres coûts", value: result.other },
      ].filter((cost) => cost.value > 0),
    [result, simple]
  );

  const symbol = SYMBOLS[currency];

  return (
    <section className="space-y-2">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="shrink-0 text-[13px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {inputs?.scope === "straight" ? "Profit Straight sale" : "Calculateur de profit"}
        </h2>
        <TzBadge source="mixed" />

        <Segmented
          size="sm"
          value={days}
          onChange={(next) => {
            if (next !== "custom") setLoading(true);
            setDays(next);
          }}
          options={[
            ...PRESETS.map((preset) => ({
              value: preset as number | "custom",
              label: `${preset} jours`,
            })),
            { value: "custom" as number | "custom", label: "Perso" },
          ]}
        />

        {days === "custom" ? (
          <DateRangePicker
            value={custom}
            onChange={(next) => {
              setLoading(true);
              setCustom(next);
            }}
            className="h-8 text-[11px]"
          />
        ) : (
          <span className="text-[11px] text-slate-400">
            {range.start} au {range.end}
          </span>
        )}

        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
          className={selectClass}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" /> : null}
          <GhostButton
            onClick={() =>
              setFields((current) => {
                const next = { ...current };
                for (const id of MANUAL_FIELDS) next[id] = "";
                return next;
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Vider les taux
          </GhostButton>
          {simple ? null : (
          <GhostButton
            onClick={() =>
              setFields((current) => ({
                ...current,
                processingRate: "4.87",
                crmRate: "1.5",
                chargebackFee: "27.35",
                rdrFee: "40",
                ethocaFee: "45",
                cdrnFee: "40",
                reserveRate: "10",
              }))
            }
          >
            <Wand2 className="h-3.5 w-3.5" />
            Taux types
          </GhostButton>
          )}
        </div>
      </div>

      {inputs?.warnings.length ? (
        <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          {inputs.warnings.map((warning) => (
            <li key={warning} className="text-[10px] text-amber-800 dark:text-amber-200">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {inputs ? <SalesStrip inputs={inputs} money={money} /> : null}

      <div className="grid gap-2 lg:grid-cols-[1fr_320px]">
        {/* Inputs */}
        <div className="min-w-0 space-y-2">
          <Group title={simple ? "Ventes, remboursements et retours" : "Revenus et remboursements"} accent="emerald">
            <div className="grid grid-cols-2 gap-2">
              <Field
                label={simple ? "Ventes Straight sale" : "Revenu total traité"}
                value={fields.revenue}
                onChange={set("revenue")}
                prefix={symbol}
                auto
                hint={
                  inputs
                    ? inputs.scope === "straight"
                      ? `straight sale uniquement · ${inputs.categories.directSales} vente(s)`
                      : `straight sale ${Math.round(inputs.categories.direct)} + upsell ${Math.round(inputs.categories.upsell)} + abonnements ${Math.round(inputs.breakdown.phoenixRebill)}`
                    : undefined
                }
              />
              <Field
                label={simple ? "Remboursements et retours" : "Remboursements, alertes incluses"}
                value={fields.refunds}
                onChange={set("refunds")}
                prefix={symbol}
                auto
                hint={
                  simple
                    ? "remboursés chez Reign et dans Shopify sur la période"
                    : inputs
                    ? inputs.breakdown.shopifyReturns > 0
                      ? `facturation ${Math.round(inputs.breakdown.phoenixRefunds)} + retours Shopify ${Math.round(inputs.breakdown.shopifyReturns)}`
                      : "remboursements de la facturation"
                    : undefined
                }
              />
            </div>
          </Group>

          <Group title={simple ? "Frais de paiement" : "Traitement des paiements"} accent="sky">
            <div className={cn("grid grid-cols-2 gap-2", simple ? "sm:grid-cols-3" : "sm:grid-cols-4")}>
              <Field
                label={simple ? "Frais de paiement" : "Frais de traitement"}
                value={fields.processingRate}
                onChange={set("processingRate")}
                suffix="%"
                hint={simple ? "le % pris par le processeur sur chaque vente" : undefined}
              />
              <Field
                label="Frais fixe par transaction"
                value={fields.fixedProcessingFee}
                onChange={set("fixedProcessingFee")}
                prefix={symbol}
                hint={simple ? "s'il y en a un (ex. 0,30 $), sinon vide" : undefined}
              />
              <Field
                label="Nombre de transactions"
                value={fields.transactions}
                onChange={set("transactions")}
                auto
                hint={
                  inputs
                    ? inputs.scope === "straight"
                      ? "commandes Straight sale de la période"
                      : `${inputs.breakdown.shopifyOrders} ventes + ${inputs.breakdown.phoenixSubscriptionPayments} prélèvements`
                    : undefined
                }
              />
              {simple ? null : <Field label="Frais CRM" value={fields.crmRate} onChange={set("crmRate")} suffix="%" />}
            </div>
          </Group>

          {simple ? null : (
          <Group title="Chargebacks" accent="rose">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Field
                label="Nombre de chargebacks"
                value={fields.chargebacks}
                onChange={set("chargebacks")}
                auto
              />
              <Field
                label="Frais par dossier"
                value={fields.chargebackFee}
                onChange={set("chargebackFee")}
                prefix={symbol}
              />
              <Field
                label="Valeur totale perdue"
                value={fields.chargebackValue}
                onChange={set("chargebackValue")}
                prefix={symbol}
                auto
              />
            </div>
          </Group>
          )}

          {alerts ? (
          <Group title="Alertes" accent="amber">
            <div className="space-y-1.5">
              {(
                [
                  ["RDR", "rdrCount", "rdrFee"],
                  ["Ethoca", "ethocaCount", "ethocaFee"],
                  ["CDRN", "cdrnCount", "cdrnFee"],
                ] as Array<[string, FieldId, FieldId]>
              ).map(([label, countId, feeId]) => (
                <div key={label} className="grid grid-cols-[52px_1fr_1fr] items-end gap-2">
                  <span className="pb-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                    {label}
                  </span>
                  <Field
                    label="Nombre d'alertes"
                    value={fields[countId]}
                    onChange={set(countId)}
                  />
                  <Field
                    label="Frais par alerte"
                    value={fields[feeId]}
                    onChange={set(feeId)}
                    prefix={symbol}
                  />
                </div>
              ))}
              <p className="text-[9px] leading-snug text-slate-400">
                La valeur remboursée des alertes appartient au champ remboursements. Cette section ne
                compte que les frais de service.
              </p>
            </div>
          </Group>
          ) : null}

          <Group title={simple ? "Colliers, pub et autres coûts" : "Coûts opérationnels"} accent="indigo">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Field
                label={simple ? "Colliers (grille fournisseur)" : "COGS et livraison"}
                value={fields.cogs}
                onChange={set("cogs")}
                prefix={symbol}
                auto={inputs?.cogs != null}
                hint={
                  inputs?.cogsDetail?.grid
                    ? `grille fournisseur · ${inputs.cogsDetail.grid.orders} commande(s), ${inputs.cogsDetail.units} collier(s)`
                    : inputs?.cogsDetail
                      ? `${inputs.cogsDetail.units} unité(s) × coût de base`
                      : "vide pour du digital"
                }
              />
              <Field
                label={simple ? "Pub Meta" : "Dépense publicitaire"}
                value={fields.ads}
                onChange={set("ads")}
                prefix={symbol}
                auto
                hint={simple ? "comptes Venom et Badgal, en $" : "Meta"}
              />
              <Field
                label="Autres coûts"
                value={fields.otherCosts}
                onChange={set("otherCosts")}
                prefix={symbol}
                hint={simple ? "Shopify, applis, agent, échantillons… sur la période" : "équipe, agences, logiciels"}
              />
            </div>
            {simple ? (
              <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-[10.5px] leading-snug text-slate-500 ring-1 ring-slate-900/[0.05] dark:bg-slate-900/40 dark:text-slate-400 dark:ring-white/[0.06]">
                <p>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">COGS</span> (coût des marchandises vendues) : ce que coûtent les
                  colliers expédiés : achat, emballage et livraison jusqu&apos;au client, tout compris dans le prix du fournisseur. Il est calculé commande par commande avec la grille fournisseur, selon le
                  nombre de colliers du colis ; une commande remboursée en entier compte 0.
                </p>
                {grid ? (
                  <p className="mt-1 tabular-nums">
                    {grid.label} : {grid.prices.map((price, index) => `${index + 1} collier${index ? "s" : ""} ${price.toFixed(2).replace(".", ",")} $`).join(" · ")} · 5 et plus :
                    + {grid.extraPerUnit.toFixed(2).replace(".", ",")} $ par collier en plus.
                  </p>
                ) : null}
                {isAdmin && !isAssociate ? (
                  <Link href="/grille-fournisseur" className="mt-1 inline-block font-semibold text-slate-700 underline underline-offset-2 dark:text-slate-200">
                    Modifier la grille fournisseur
                  </Link>
                ) : null}
              </div>
            ) : null}
          </Group>

          {simple ? null : (
          <Group title="Réserve glissante" accent="violet">
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Réserve retenue"
                value={fields.reserveRate}
                onChange={set("reserveRate")}
                suffix="%"
              />
              <Field
                label="Réserve libérée sur la période"
                value={fields.reserveReleased}
                onChange={set("reserveReleased")}
                prefix={symbol}
              />
            </div>
            <p className="mt-1 text-[9px] leading-snug text-slate-400">
              La réserve réduit la trésorerie disponible, pas le profit réellement généré.
            </p>
          </Group>
          )}
        </div>

        {/* Results */}
        <div className="min-w-0 space-y-2 lg:sticky lg:top-16 lg:self-start">
          <Surface accent={result.profit >= 0 ? "emerald" : "rose"} className="p-3.5">
            <PanelTitle accent={result.profit >= 0 ? "emerald" : "rose"}>
              {simple ? "Profit net Straight sale" : "Profit net avant réserve"}
            </PanelTitle>
            <p
              className={cn(
                "mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums",
                result.profit >= 0
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-rose-600 dark:text-rose-400"
              )}
            >
              {money(result.profit)}
            </p>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              {result.margin.toFixed(2)} % de marge · {money(result.perDay)} par jour
              {simple && result.perOrder ? ` · ${money(result.perOrder)} par commande` : ""}
            </p>
          </Surface>

          <Surface plain className="p-3">
            {simple ? (
              <>
                <Row label="Ventes Straight sale" value={money(result.revenue)} tone="font-semibold" />
                <Row label="Remboursements et retours" value={`− ${money(result.refunds)}`} />
                <Row label="Frais de paiement" value={`− ${money(result.processing)}`} />
                <Row label="Colliers (grille fournisseur)" value={`− ${money(result.cogs)}`} />
                <Row label="Pub Meta" value={`− ${money(result.ads)}`} />
                <Row label="Autres coûts" value={`− ${money(result.other)}`} />
              </>
            ) : (
              <>
            <Row label="Revenu brut" value={money(result.revenue)} tone="font-semibold" />
            <Row label="Remboursements" value={`− ${money(result.refunds)}`} />
            <Row label="Frais de traitement" value={`− ${money(result.processing)}`} />
            <Row label="Frais CRM" value={`− ${money(result.crmFees)}`} />
            <Row label="Valeur des chargebacks" value={`− ${money(result.cbValue)}`} />
            <Row label="Frais de chargebacks" value={`− ${money(result.cbFees)}`} />
            <Row label="Frais RDR" value={`− ${money(result.alerts.rdr)}`} />
            <Row label="Frais Ethoca" value={`− ${money(result.alerts.ethoca)}`} />
            <Row label="Frais CDRN" value={`− ${money(result.alerts.cdrn)}`} />
            <Row label="COGS et livraison" value={`− ${money(result.cogs)}`} />
            <Row label="Publicité" value={`− ${money(result.ads)}`} />
            <Row label="Autres coûts" value={`− ${money(result.other)}`} />
              </>
            )}
            <Row
              label="Total des déductions"
              value={money(result.deductions)}
              tone="font-semibold text-rose-600 dark:text-rose-400"
            />
          </Surface>

          {simple ? null : (
          <Surface plain className="p-3">
            <Row label="Réserve retenue" value={`− ${money(result.reserve)}`} />
            <Row label="Réserve libérée" value={`+ ${money(result.reserveReleased)}`} />
            <Row
              label="Trésorerie disponible estimée"
              value={money(result.cash)}
              tone={cn(
                "font-semibold",
                result.cash >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              )}
            />
          </Surface>
          )}

          <div className="grid grid-cols-3 gap-2">
            {(simple
              ? [
                  ["Taux de retour", `${result.refundRate.toFixed(2)} %`],
                  ["Profit / commande", money(result.perOrder)],
                  ["ROAS", `${result.roas.toFixed(2)}×`],
                ]
              : [
                  ["Taux de remboursement", `${result.refundRate.toFixed(2)} %`],
                  ["Taux de chargeback", `${result.cbRate.toFixed(2)} %`],
                  ["ROAS", `${result.roas.toFixed(2)}×`],
                ]
            ).map(([label, value]) => (
              <MiniStat key={label} label={label} value={value} />
            ))}
          </div>

          <Surface plain className="p-3">
            <PanelTitle className="mb-2">Répartition des coûts</PanelTitle>
            {costs.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-slate-400">
                Renseigne tes coûts pour remplir le graphique.
              </p>
            ) : (
              <>
                <div className="h-[150px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={costs}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={34}
                        outerRadius={60}
                        paddingAngle={2}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {costs.map((cost, index) => (
                          <Cell key={cost.label} fill={PALETTE[index % PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => money(Number(value) || 0)}
                        contentStyle={{
                          borderRadius: 12,
                          border: "none",
                          boxShadow: "0 4px 16px rgba(16,24,40,0.12)",
                          fontSize: 11,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1">
                  {costs.map((cost, index) => (
                    <div key={cost.label} className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: PALETTE[index % PALETTE.length] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {cost.label}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
                        {money(cost.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Surface>

          {inputs?.cogsDetail?.products.length ? (
            <Surface plain className="p-3">
              <PanelTitle className="mb-2">Marge par produit vendu</PanelTitle>
              {inputs.cogsDetail.products.map((row) => (
                <Row
                  key={row.key}
                  label={`${row.name} · ${row.units} u. × ${money(row.unitCost)}${row.fallback ? " (défaut)" : ""}`}
                  value={`− ${money(row.cogs)}`}
                />
              ))}
              <Row
                label="Marge brute (revenu − remboursements − COGS)"
                value={money(result.revenue - result.refunds - result.cogs)}
                tone="font-semibold text-emerald-700 dark:text-emerald-300"
              />
            </Surface>
          ) : null}

          <p className="flex items-start gap-1.5 px-1 text-[10px] leading-snug text-slate-400">
            <RefreshCw className="mt-0.5 h-3 w-3 shrink-0" />
            Les champs « auto » se rechargent à chaque changement de période. Tes taux restent
            mémorisés sur cet appareil.
          </p>
        </div>
      </div>
    </section>
  );
}
