"use client";

import { Building2, CreditCard, Landmark, Network } from "lucide-react";
import type { EcosystemGoals, SystemHealthResult } from "@/types";
import type { GoalProgress } from "@/lib/goals";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Actives = {
  ibos: number;
  banks: number;
  mids: number;
  llcs: number;
};

export function PilotPanel({
  health,
  actives,
  progress,
  goals,
  canWrite,
  onTargetChange,
}: {
  health: SystemHealthResult;
  actives: Actives;
  progress: GoalProgress[];
  goals: EcosystemGoals;
  canWrite: boolean;
  onTargetChange: (key: keyof EcosystemGoals, value: number) => void;
}) {
  const keyMap: Record<GoalProgress["kind"], keyof EcosystemGoals> = {
    ibos: "target_ibos",
    llcs: "target_llcs",
    banks: "target_banks",
    mids: "target_mids",
  };

  const statusLabel =
    health.status === "healthy"
      ? "Bonne santé"
      : health.status === "monitor"
        ? "À surveiller"
        : "Dégradée";

  const activeCards = [
    { label: "IBO actifs", value: actives.ibos, icon: Network },
    { label: "Banks actives", value: actives.banks, icon: Landmark },
    { label: "MID approuvés", value: actives.mids, icon: CreditCard },
    { label: "LLC", value: actives.llcs, icon: Building2 },
  ];

  // Focus IBO / Bank / MID for goal chase (skip LLC clutter)
  const mainGoals = progress.filter((g) => g.kind !== "llcs");

  return (
    <Card className="overflow-hidden border-emerald-100/80 dark:border-emerald-900/40">
      <CardContent className="space-y-4 p-4 sm:p-5">
        {/* Status strip */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Pilotage · clin d’œil
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{health.explanation}</p>
          </div>
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold",
              health.status === "healthy" && "bg-emerald-100 text-emerald-800",
              health.status === "monitor" && "bg-amber-100 text-amber-900",
              health.status === "critical" && "bg-rose-100 text-rose-900"
            )}
          >
            <span className="tabular-nums">{health.score}</span>
            <span className="text-[11px] font-medium opacity-80">/100 · {statusLabel}</span>
          </div>
        </div>

        {/* Actifs now */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {activeCards.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl bg-slate-50/90 px-3 py-2.5 dark:bg-slate-900/50"
            >
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                <Icon className="h-3 w-3 text-emerald-600" />
                {label}
              </div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Objectifs progression */}
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Objectifs — progression
          </p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {mainGoals.map((g) => {
              const targetKey = keyMap[g.kind];
              return (
                <div
                  key={g.kind}
                  className="rounded-xl border border-slate-100 px-3 py-2.5 dark:border-slate-800"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {g.label}
                    </span>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400">
                      <span>cible</span>
                      <Input
                        type="number"
                        min={0}
                        disabled={!canWrite}
                        className="h-6 w-11 px-1 text-center text-[11px] font-semibold"
                        value={goals[targetKey]}
                        onChange={(e) => {
                          const n = Math.max(0, Number(e.target.value) || 0);
                          onTargetChange(targetKey, n);
                        }}
                      />
                    </div>
                  </div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-lg font-semibold tabular-nums text-emerald-700">
                      {g.current}
                      <span className="text-xs font-medium text-slate-400">/{g.target}</span>
                    </span>
                    {g.potential > 0 ? (
                      <span className="text-[10px] text-amber-600">+{g.potential} en cours</span>
                    ) : g.remaining === 0 ? (
                      <span className="text-[10px] text-emerald-600">atteint</span>
                    ) : (
                      <span className="text-[10px] text-slate-400">reste {g.remaining}</span>
                    )}
                  </div>
                  <Progress
                    value={g.currentPct}
                    className="h-1.5"
                    indicatorClassName={cn(
                      g.currentPct >= 100
                        ? "bg-emerald-500"
                        : g.pipelinePct >= 100
                          ? "bg-amber-400"
                          : "bg-emerald-500"
                    )}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {health.appliedPenalties.length > 0 ? (
          <ul className="space-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800">
            {health.appliedPenalties.map((p) => (
              <li key={p.rule} className="flex gap-2">
                <span className="shrink-0 font-medium text-rose-600">−{p.penalty}</span>
                <span>{p.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
