"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared/page-states";
import {
  ALERT_TYPES,
  ALERT_TYPE_LABEL,
  NO_MID,
  emptyTotals,
  type AlertType,
  type AlertsResponse,
  type DisputifierAlert,
  type MidSummary,
} from "@/lib/disputifier/types";
import { cn, downloadCsv } from "@/lib/utils";

const FEES_KEY = "msgate-alert-fees";

/** Tarifs facturés par alerte : ils dépendent du contrat ISO, donc jamais devinés. */
type Fees = { ethoca: number; cdrn: number; rdr: number; chargeback: number };

const NO_FEES: Fees = { ethoca: 0, cdrn: 0, rdr: 0, chargeback: 0 };

const RANGES = [
  { days: 7, label: "7 j" },
  { days: 30, label: "30 j" },
  { days: 90, label: "90 j" },
] as const;

const selectClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200";

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Les frais d'alertes sont prélevés le lundi et couvrent la semaine jeudi → mercredi
 * qui précède : le prélèvement du lundi 17/08 correspondait aux alertes du 07 au 13/08.
 * Déduit d'un seul relevé, à reconfirmer sur un deuxième lundi.
 */
function billingWeek(reference = new Date()) {
  const monday = new Date(reference);
  const daysUntilMonday = (8 - monday.getDay()) % 7 || 7;
  monday.setDate(monday.getDate() + (monday.getDay() === 1 ? 0 : daysUntilMonday));

  const start = new Date(monday);
  start.setDate(start.getDate() - 10);
  const end = new Date(monday);
  end.setDate(end.getDate() - 4);

  return { start: iso(start), end: iso(end), monday: iso(monday) };
}

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function typeTone(type: AlertType) {
  if (type === "rdr") return "border-violet-200 bg-violet-50 text-violet-700";
  if (type === "ethoca") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50", tone)}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

export default function AlertsRdrPage() {
  const [start, setStart] = useState(() => isoDaysAgo(30));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [merchant, setMerchant] = useState("all");
  const [mid, setMid] = useState("all");
  const [type, setType] = useState<"all" | AlertType>("all");
  const [infer, setInfer] = useState(false);
  // Disputifier facture par compte, pas par MID : c'est la vue qui colle au relevé.
  const [groupBy, setGroupBy] = useState<"merchant" | "mid">("merchant");
  const [fees, setFees] = useState<Fees>(NO_FEES);
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FEES_KEY);
      if (raw) setFees({ ...NO_FEES, ...(JSON.parse(raw) as Fees) });
    } catch {
      // tarifs illisibles : on repart à zéro plutôt que d'inventer un montant
    }
  }, []);

  function patchFee(key: keyof Fees, value: number) {
    setFees((current) => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(FEES_KEY, JSON.stringify(next));
      } catch {
        // quota plein : sans gravité
      }
      return next;
    });
  }

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          start,
          end,
          merchant,
          mid,
          type,
          infer: infer ? "1" : "0",
        });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/disputifier/alerts?${params}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Disputifier injoignable");
        setData(body as AlertsResponse);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Chargement impossible");
      } finally {
        setLoading(false);
      }
    },
    [start, end, merchant, mid, type, infer]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals ?? emptyTotals();
  const alerts = useMemo(() => data?.alerts ?? [], [data]);
  const byMid = useMemo(() => data?.byMid ?? [], [data]);

  // Seuls les MID actifs sont proposés : les MID fermés ne encaissent plus rien.
  const midOptions = useMemo(() => {
    const merchants = data?.merchants ?? [];
    const scoped = merchant === "all" ? merchants : merchants.filter((m) => m.merchantId === merchant);
    return scoped.flatMap((item) =>
      item.mids
        .filter((entry) => entry.status !== "Closed")
        .map((entry) => ({
          id: entry.mid_id,
          label: merchant === "all" ? `${item.merchantName} — ${entry.mid_name}` : entry.mid_name,
        }))
    );
  }, [data, merchant]);

  /** Un MID fermé qui porte encore des alertes doit rester lisible dans le récap. */
  const closedMids = useMemo(
    () =>
      new Set(
        (data?.merchants ?? []).flatMap((item) =>
          item.mids.filter((entry) => entry.status === "Closed").map((entry) => entry.mid_id)
        )
      ),
    [data]
  );

  const inferred = useMemo(
    () => alerts.filter((alert) => alert.midSource === "inferred").length,
    [alerts]
  );

  const noFees = fees.ethoca === 0 && fees.cdrn === 0 && fees.rdr === 0 && fees.chargeback === 0;

  /**
   * Deux canaux de débit distincts, à ne surtout pas additionner : Disputifier ne
   * prélève que ses frais par alerte (le lundi), tandis que les remboursements et
   * les chargebacks partent directement via l'acquéreur.
   */
  const debits = useMemo(() => {
    const source =
      groupBy === "mid"
        ? byMid
        : [
            ...byMid
              .reduce((acc, row) => {
                const current = acc.get(row.merchantName);
                if (!current) {
                  // Copie profonde : les compteurs de byMid alimentent l'autre tableau.
                  acc.set(row.merchantName, {
                    ...row,
                    midId: row.merchantName,
                    midName: row.merchantName,
                    refunded: { ...row.refunded },
                    notRefunded: { ...row.notRefunded },
                    chargebacks: { ...row.chargebacks },
                    byType: {
                      ethoca: { ...row.byType.ethoca },
                      cdrn: { ...row.byType.cdrn },
                      rdr: { ...row.byType.rdr },
                    },
                  });
                  return acc;
                }
                current.count += row.count;
                current.amount += row.amount;
                current.refunded.count += row.refunded.count;
                current.refunded.amount += row.refunded.amount;
                current.chargebacks.count += row.chargebacks.count;
                current.chargebacks.amount += row.chargebacks.amount;
                for (const key of ALERT_TYPES) {
                  current.byType[key].count += row.byType[key].count;
                  current.byType[key].amount += row.byType[key].amount;
                }
                return acc;
              }, new Map<string, MidSummary>())
              .values(),
          ];

    const rows = source.map((row) => ({
      key: row.midId ?? NO_MID,
      label: row.midName,
      sub: groupBy === "mid" ? row.merchantName : `${row.count} alertes`,
      alertCount: row.count,
      ethoca: row.byType.ethoca.count,
      cdrn: row.byType.cdrn.count,
      rdr: row.byType.rdr.count,
      alertFees:
        row.byType.ethoca.count * fees.ethoca +
        row.byType.cdrn.count * fees.cdrn +
        row.byType.rdr.count * fees.rdr,
      refunds: row.refunded.amount,
      refundCount: row.refunded.count,
      chargebacks: row.chargebacks.amount + row.chargebacks.count * fees.chargeback,
      chargebackCount: row.chargebacks.count,
    }));

    rows.sort((a, b) => b.alertFees - a.alertFees);

    const add = (pick: (row: (typeof rows)[number]) => number) =>
      rows.reduce((sum, row) => sum + pick(row), 0);

    return {
      rows,
      alertFees: add((row) => row.alertFees),
      refunds: add((row) => row.refunds),
      chargebacks: add((row) => row.chargebacks),
      alertCount: add((row) => row.alertCount),
    };
  }, [byMid, fees, groupBy]);

  function exportCsv() {
    if (!alerts.length) {
      toast.error("Aucune alerte à exporter");
      return;
    }
    downloadCsv(
      `alertes-${type}-${start}_${end}.csv`,
      alerts.map((alert) => ({
        type: ALERT_TYPE_LABEL[alert.type],
        alerte: alert.alertAt,
        transaction: alert.transactionAt ?? "",
        marchand: alert.merchantName,
        mid: alert.midName ?? "",
        mid_source: alert.midSource ?? "aucun",
        commande: alert.orderNumber ?? "",
        montant: alert.amount,
        devise: alert.currency,
        last4: alert.cardLast4 ?? "",
        emetteur: alert.issuer ?? "",
        raison: alert.reasonCode ?? "",
        descriptor: alert.descriptor ?? "",
        refund: alert.refundAction ?? "",
        flag: alert.flagAction ?? "",
      }))
    );
  }

  return (
    <div>
      <PageHeader
        title="Alertes RDR / Ethoca"
        description="Ethoca, CDRN et RDR remontés depuis Disputifier, toutes organisations confondues."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button size="sm" onClick={() => load(true)} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Rafraîchir
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const week = billingWeek();
            setStart(week.start);
            setEnd(week.end);
          }}
          title={`Semaine jeudi → mercredi prélevée le lundi ${billingWeek().monday}`}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
            start === billingWeek().start && end === billingWeek().end
              ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          )}
        >
          Semaine facturée
        </button>

        <div className="flex items-center gap-1">
          {RANGES.map((range) => {
            const active = start === isoDaysAgo(range.days);
            return (
              <button
                key={range.days}
                type="button"
                onClick={() => {
                  setStart(isoDaysAgo(range.days));
                  setEnd(new Date().toISOString().slice(0, 10));
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                )}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        <input
          type="date"
          className={selectClass}
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <input type="date" className={selectClass} value={end} onChange={(e) => setEnd(e.target.value)} />

        <select
          className={selectClass}
          value={merchant}
          onChange={(e) => {
            setMerchant(e.target.value);
            // Un MID appartient à un seul marchand : le garder ne renverrait rien.
            setMid("all");
          }}
        >
          <option value="all">Tous les marchands</option>
          {(data?.merchants ?? []).map((item) => (
            <option key={item.merchantId} value={item.merchantId}>
              {item.merchantName}
            </option>
          ))}
        </select>

        <select
          className={cn(selectClass, "max-w-[280px]")}
          value={mid}
          onChange={(e) => setMid(e.target.value)}
        >
          <option value="all">Tous les MID</option>
          {midOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
          <option value={NO_MID}>Sans MID</option>
        </select>

        <label
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
          title="Rattache au MID les alertes que Disputifier laisse sans MidID, en lisant le descriptor. Décoché, les compteurs collent au portail Disputifier."
        >
          <input
            type="checkbox"
            checked={infer}
            onChange={(e) => setInfer(e.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-600"
          />
          MID déduits
        </label>

        <select
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value as "all" | AlertType)}
        >
          <option value="all">Tous les types</option>
          {ALERT_TYPES.map((item) => (
            <option key={item} value={item}>
              {ALERT_TYPE_LABEL[item]}
            </option>
          ))}
        </select>
      </div>

      {data?.errors?.length ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            {data.errors.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Alertes"
          value={String(totals.count)}
          sub={`${money(totals.amount)} de transactions alertées`}
          tone="text-rose-600 dark:text-rose-400"
        />
        {ALERT_TYPES.map((item) => (
          <Kpi
            key={item}
            label={ALERT_TYPE_LABEL[item]}
            value={String(totals.byType[item].count)}
            sub={money(totals.byType[item].amount)}
          />
        ))}
      </div>

      {byMid.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                Prélèvement Disputifier
              </h2>
              <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {(
                  [
                    ["merchant", "Par compte"],
                    ["mid", "Par MID"],
                  ] as Array<["merchant" | "mid", string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setGroupBy(value)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      groupBy === value
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["ethoca", "Ethoca"],
                  ["cdrn", "CDRN"],
                  ["rdr", "RDR"],
                  ["chargeback", "Frais CB"],
                ] as Array<[keyof Fees, string]>
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1 text-[11px] text-slate-500">
                  {label}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={fees[key] || ""}
                    placeholder="0"
                    onChange={(e) => patchFee(key, Number(e.target.value) || 0)}
                    className="w-[62px] rounded-md border border-slate-200 px-1.5 py-1 text-right tabular-nums text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  />
                </label>
              ))}
            </div>
          </div>

          <p className="px-3 pt-1.5 text-[11px] text-slate-500">
            Disputifier ne prélève que ses frais par alerte. Les remboursements et les chargebacks
            partent séparément, directement via l&apos;acquéreur.
          </p>

          {noFees ? (
            <p className="px-3 pt-1 text-[11px] text-amber-600 dark:text-amber-400">
              Renseigne tes tarifs par alerte ci-dessus pour obtenir le montant prélevé.
            </p>
          ) : null}

          <div className="mt-2 overflow-x-auto thin-scroll">
            <table className="w-full min-w-[860px] text-[12px]">
              <thead className="border-y border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-2 font-semibold">
                    {groupBy === "merchant" ? "Compte" : "MID"}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">Alertes</th>
                  <th className="px-3 py-2 text-right font-semibold">Frais Disputifier</th>
                  <th className="px-3 py-2 text-right font-semibold">Remboursements</th>
                  <th className="px-3 py-2 text-right font-semibold">Chargebacks</th>
                </tr>
              </thead>
              <tbody>
                {debits.rows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-slate-50 last:border-0 dark:border-slate-800/60"
                  >
                    <td className="max-w-[300px] px-3 py-2">
                      <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {row.label}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{row.sub}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">
                      {row.ethoca}×E · {row.cdrn}×C · {row.rdr}×R
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                      {money(row.alertFees)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {money(row.refunds)}
                      <span className="ml-1 text-[11px] text-slate-400">{row.refundCount}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {row.chargebackCount === 0 ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        <>
                          {money(row.chargebacks)}
                          <span className="ml-1 text-[11px] text-slate-400">
                            {row.chargebackCount}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 dark:border-slate-700">
                <tr className="font-semibold text-slate-900 dark:text-slate-100">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {debits.alertCount}
                  </td>
                  <td className="px-3 py-2 text-right text-[14px] tabular-nums text-rose-600 dark:text-rose-400">
                    {money(debits.alertFees)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(debits.refunds)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(debits.chargebacks)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}

      {byMid.length > 0 ? (
        <div className="mb-4 overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-900/[0.06] thin-scroll dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pt-3">
            <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
              Contrôle par MID
            </h2>
            <span className="text-[11px] text-slate-500">
              {infer
                ? `${inferred} alerte${inferred > 1 ? "s" : ""} rattachée${
                    inferred > 1 ? "s" : ""
                  } via le descriptor — ces lignes n'apparaissent pas dans le portail Disputifier`
                : "Attribution Disputifier uniquement — réconciliable avec le portail"}
            </span>
          </div>

          <table className="mt-2 w-full min-w-[760px] text-[12px]">
            <thead className="border-y border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-3 py-2 font-semibold">MID</th>
                {ALERT_TYPES.map((item) => (
                  <th key={item} className="px-3 py-2 text-right font-semibold">
                    {ALERT_TYPE_LABEL[item]}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 text-right font-semibold">Montant</th>
              </tr>
            </thead>
            <tbody>
              {byMid.map((row) => (
                <tr
                  key={row.midId ?? NO_MID}
                  className="border-b border-slate-50 last:border-0 dark:border-slate-800/60"
                >
                  <td className="max-w-[300px] px-3 py-2">
                    <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {row.midName}
                      {row.midId && closedMids.has(row.midId) ? (
                        <span className="ml-1 text-[10px] font-normal text-amber-600">fermé</span>
                      ) : null}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {row.merchantName}
                      {row.inferred > 0 ? ` · ${row.inferred} déduit(s)` : ""}
                    </div>
                  </td>
                  {ALERT_TYPES.map((item) => (
                    <td
                      key={item}
                      className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300"
                    >
                      {row.byType[item].count === 0 ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        <>
                          {row.byType[item].count}
                          <span className="ml-1 text-[11px] text-slate-400">
                            {money(row.byType[item].amount)}
                          </span>
                        </>
                      )}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {row.count}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    {money(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 dark:border-slate-700">
              <tr className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                <td className="px-3 py-2">Total</td>
                {ALERT_TYPES.map((item) => (
                  <td key={item} className="px-3 py-2 text-right tabular-nums">
                    {totals.byType[item].count}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{totals.count}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">
                  {money(totals.amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {loading && !data ? (
        <LoadingState />
      ) : alerts.length === 0 ? (
        <EmptyState
          title="Aucune alerte sur la période"
          description="Élargis la plage de dates ou change de marchand."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-900/[0.06] thin-scroll dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          <table className="w-full min-w-[1000px] text-[12px]">
            <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-3 py-2 font-semibold">Alerte</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Marchand / MID</th>
                <th className="px-3 py-2 font-semibold">Commande</th>
                <th className="px-3 py-2 font-semibold">Transaction</th>
                <th className="px-3 py-2 text-right font-semibold">Montant</th>
                <th className="px-3 py-2 font-semibold">Carte</th>
                <th className="px-3 py-2 font-semibold">Raison</th>
                <th className="px-3 py-2 font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert: DisputifierAlert) => (
                <tr
                  key={`${alert.type}-${alert.id}`}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                    {alert.alertAt.slice(0, 16)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        typeTone(alert.type)
                      )}
                    >
                      {ALERT_TYPE_LABEL[alert.type]}
                    </span>
                  </td>
                  <td className="max-w-[240px] px-3 py-2">
                    <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {alert.merchantName}
                    </div>
                    <div
                      className="truncate text-[11px] text-slate-500"
                      title={alert.midSource === "inferred" ? "MID déduit du descriptor" : undefined}
                    >
                      {alert.midSource === "inferred" ? "≈ " : ""}
                      {alert.midName ?? alert.descriptor ?? "—"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                    {alert.orderNumber ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {alert.transactionAt?.slice(0, 10) ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {money(alert.amount, alert.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {alert.cardLast4 ? `•••• ${alert.cardLast4}` : "—"}
                    {alert.issuer ? (
                      <div className="truncate text-[11px] text-slate-400">{alert.issuer}</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {alert.reasonCode ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Badge
                        variant={alert.refundAction === "Refunded" ? "success" : "secondary"}
                        className="text-[10px]"
                      >
                        {alert.refundAction ?? "—"}
                      </Badge>
                      {alert.flagAction && alert.flagAction !== "No Flag" ? (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <ShieldAlert className="h-3 w-3" />
                          {alert.flagAction}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.truncated ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Résultats plafonnés — resserre la période pour tout voir.
        </p>
      ) : null}
    </div>
  );
}
