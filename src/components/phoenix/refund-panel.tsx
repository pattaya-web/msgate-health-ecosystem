"use client";

import { useCallback, useState } from "react";
import { Loader2, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import type { PhoenixTransaction } from "@/lib/phoenix/types";
import { Card } from "@/components/ui/card";

type Props = {
  canWrite: boolean;
  onDone?: () => void;
};

const inputClass =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

const labelClass = "text-[10px] font-medium uppercase tracking-wide text-slate-400";

export function PhoenixRefundPanel({ canWrite, onDone }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [txs, setTxs] = useState<PhoenixTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("refund from MSGate cockpit");
  const [actionType, setActionType] = useState<"fullRefund" | "partial_refund">("partial_refund");
  const [cancelSubscription, setCancelSubscription] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const loadHistory = useCallback(async () => {
    const id = customerId.trim();
    if (!id) {
      toast.error("Entre un CustomerId");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/phoenix/transaction-history?customerId=${encodeURIComponent(id)}&startDateTime=${encodeURIComponent("2020-01-01T00:00:00.000Z")}`,
        { cache: "no-store" }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "History failed");
      const rows: PhoenixTransaction[] = body.Result || [];
      setTxs([...rows].sort((a, b) => (b.Date || "").localeCompare(a.Date || "")));
      toast.success(`${rows.length} transaction(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "History error");
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  async function submitRefund() {
    const cid = Number(customerId);
    const oid = Number(orderId);
    const value = Number(amount);
    if (!cid || !oid || !value) {
      toast.error("CustomerId, OrderId et montant requis");
      return;
    }
    if (!confirm(`Confirmer refund ${actionType} de ${value} sur order ${oid} ?`)) return;
    setRefunding(true);
    try {
      const res = await fetch("/api/phoenix/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: cid,
          orderId: oid,
          refundAmount: value,
          comment: comment || "refund from MSGate",
          actionType,
          cancelSubscription,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Refund failed");
      toast.success(body.data?.Msg || "Refund OK");
      await loadHistory();
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refund error");
    } finally {
      setRefunding(false);
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[1.5fr_0.5fr]">
      <Card className="min-w-0 p-3.5">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="w-40 space-y-1">
            <p className={labelClass}>CustomerId</p>
            <input
              className={inputClass}
              placeholder="ex. 5993802"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadHistory();
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => void loadHistory()}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Charger l&apos;historique
          </button>
          <p className="text-[10px] text-slate-400">
            Clique une ligne pour pré-remplir le refund.
          </p>
        </div>

        <div className="thin-scroll max-h-[60vh] overflow-auto rounded-lg border border-slate-100 sm:max-h-[440px] dark:border-slate-800">
          <table className="w-full min-w-[620px] text-left text-[11px]">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80">
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Order</th>
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5">Leg</th>
                <th className="px-2 py-1.5 text-right">Montant</th>
                <th className="px-2 py-1.5">Réponse</th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    Aucune transaction chargée
                  </td>
                </tr>
              ) : (
                txs.map((tx, index) => {
                  const approved = tx.ResponseCode === "100";
                  return (
                    <tr
                      key={`${tx.TransactionNo}-${index}`}
                      className="cursor-pointer border-t border-slate-100 transition hover:bg-emerald-50/40 dark:border-slate-800 dark:hover:bg-slate-800/40"
                      onClick={() => {
                        if (tx.OrderId) setOrderId(String(tx.OrderId));
                        setAmount(String(tx.Amount || ""));
                      }}
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                        {(tx.Date || "").replace("T", " ").slice(0, 16)}
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">{tx.OrderId}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-700 dark:text-slate-200">
                        {tx.Type}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{tx.TransactionType}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-800 dark:text-slate-100">
                        {formatCurrency(Number(tx.Amount) || 0)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                            approved
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                          )}
                        >
                          {tx.ResponseMessage || tx.ResponseCode}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="h-fit border-rose-200/70 p-3.5 dark:border-rose-900/50">
        <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Refund</h3>
        <p className="mb-3 text-[10px] text-slate-400">POST /phxcrm/refund — action live</p>

        {!canWrite ? (
          <p className="text-[11px] text-slate-500">Lecture seule : droits insuffisants.</p>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className={labelClass}>OrderId</p>
                <input
                  className={inputClass}
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <p className={labelClass}>Montant</p>
                <input
                  className={inputClass}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
            <select
              className={inputClass}
              value={actionType}
              onChange={(e) => setActionType(e.target.value as "fullRefund" | "partial_refund")}
            >
              <option value="partial_refund">Partial refund</option>
              <option value="fullRefund">Full order refund</option>
            </select>
            <textarea
              className={cn(inputClass, "h-16 py-1.5")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={cancelSubscription}
                onChange={(e) => setCancelSubscription(e.target.checked)}
                className="h-3.5 w-3.5 accent-rose-600"
              />
              Annuler aussi l&apos;abonnement
            </label>
            <button
              type="button"
              onClick={() => void submitRefund()}
              disabled={refunding || !customerId}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-rose-600 text-xs font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {refunding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Undo2 className="h-3.5 w-3.5" />
              )}
              Lancer le refund
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
