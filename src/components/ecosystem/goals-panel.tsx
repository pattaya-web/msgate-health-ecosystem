"use client";

import { useState } from "react";
import { ChevronDown, Target } from "lucide-react";
import type { EcosystemGoals } from "@/types";
import type { GoalProgress } from "@/lib/goals";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export function GoalsPanel({
  progress,
  goals,
  canWrite,
  onTargetChange,
}: {
  progress: GoalProgress[];
  goals: EcosystemGoals;
  canWrite: boolean;
  onTargetChange: (key: keyof EcosystemGoals, value: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const keyMap: Record<GoalProgress["kind"], keyof EcosystemGoals> = {
    ibos: "target_ibos",
    llcs: "target_llcs",
    banks: "target_banks",
    mids: "target_mids",
  };

  const summary = progress
    .map((g) => `${g.label} ${g.current}/${g.target}`)
    .join(" · ");

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/50"
        aria-expanded={open}
      >
        <Target className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Objectifs & avancées
        </span>
        {!open ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{summary}</span>
        ) : (
          <span className="flex-1 text-[11px] text-slate-400">Clique pour replier</span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <CardContent className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="mb-3 text-[11px] text-slate-500">
            Ex. objectif 5 IBO → 2 actifs · 1 potentiel = pipeline 3/5. Santé recalculée auto.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {progress.map((g) => {
              const targetKey = keyMap[g.kind];
              return (
                <div
                  key={g.kind}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/40"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">{g.label}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span>Objectif</span>
                      <Input
                        type="number"
                        min={0}
                        disabled={!canWrite}
                        className="h-7 w-14 px-1.5 text-center text-xs font-semibold"
                        value={goals[targetKey]}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const n = Math.max(0, Number(e.target.value) || 0);
                          onTargetChange(targetKey, n);
                        }}
                      />
                    </div>
                  </div>

                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <div className="text-lg font-semibold tabular-nums text-emerald-700">
                      {g.current}
                      <span className="text-sm font-medium text-slate-400">/{g.target}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {g.potential > 0 ? (
                        <span className="text-amber-600">+{g.potential} potentiel</span>
                      ) : (
                        <span>
                          pipeline {g.current + g.potential}/{g.target}
                        </span>
                      )}
                    </div>
                  </div>

                  <Progress
                    value={g.currentPct}
                    className="h-2"
                    indicatorClassName={cn(
                      g.currentPct >= 100
                        ? "bg-emerald-500"
                        : g.pipelinePct >= 100
                          ? "bg-amber-400"
                          : "bg-emerald-500"
                    )}
                  />
                  <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
                    <span>Actifs {g.currentPct}%</span>
                    <span>
                      Pipeline {g.current + g.potential}/{g.target} ({g.pipelinePct}%)
                    </span>
                  </div>
                  {g.remaining > 0 ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Encore {g.remaining} {g.label} actif{g.remaining > 1 ? "s" : ""} pour
                      l’objectif
                      {g.potential > 0 ? ` · ${g.potential} en cours` : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-emerald-600">Objectif atteints ✓</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
