"use client";

import { AlertTriangle, Landmark } from "lucide-react";
import type { BankAction } from "@/lib/ecosystem/bank-actions";
import { cn } from "@/lib/utils";

export function BankActionsPanel({ actions }: { actions: BankAction[] }) {
  return (
    <aside className="rounded-xl border border-orange-200/80 bg-orange-50/60 dark:border-orange-900/50 dark:bg-orange-950/25">
      <div className="flex items-center gap-2 border-b border-orange-200/70 px-3 py-2.5 dark:border-orange-900/40">
        <Landmark className="h-3.5 w-3.5 text-orange-600" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-orange-950 dark:text-orange-100">
            Actions · Banques
          </p>
          <p className="text-[10px] text-orange-800/70 dark:text-orange-300/70">
            Orange = pending / en cours · 2 banks min (1 + backup)
          </p>
        </div>
        <span className="rounded-full bg-orange-200/80 px-2 py-0.5 text-[10px] font-bold tabular-nums text-orange-900">
          {actions.length}
        </span>
      </div>

      {actions.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-emerald-700 dark:text-emerald-400">
          OK — chaque IBO a au moins 2 banks (dont backup).
        </p>
      ) : (
        <ul className="max-h-[360px] space-y-2 overflow-y-auto p-2.5">
          {actions.map((a) => (
            <li
              key={a.id}
              className={cn(
                "rounded-lg border px-2.5 py-2",
                a.level === "critical"
                  ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40"
                  : "border-orange-300 bg-orange-100/90 dark:border-orange-800 dark:bg-orange-950/40"
              )}
            >
              <div className="mb-1 flex items-start gap-1.5">
                <AlertTriangle
                  className={cn(
                    "mt-0.5 h-3 w-3 shrink-0",
                    a.level === "critical" ? "text-rose-600" : "text-orange-600"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                    {a.title}
                  </p>
                  <p className="truncate text-[10px] text-slate-600 dark:text-slate-300">
                    {a.iboName}
                    {a.llcLabel !== "—" ? ` · ${a.llcLabel}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
                  {a.banks}/2
                </span>
              </div>
              <p className="pl-4 text-[10px] leading-snug text-slate-600 dark:text-slate-400">
                {a.detail}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
