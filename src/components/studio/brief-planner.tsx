"use client";

import { Loader2, RefreshCw, Wand2 } from "lucide-react";
import { enginePost } from "@/components/mass-test/engine-client";
import type { CreativePlan, PlannedCreative } from "@/lib/creative-engine/workspace-plan";
import { cn } from "@/lib/utils";

/**
 * Le planificateur de brief, partagé par tous les endroits où l'on génère :
 * « Create 5 ads… » devient N concepts distincts (Hermes), montrés en cartes
 * avant tout envoi. Chaque écran garde sa propre suite (aperçu, génération).
 */

export type PlanResult = CreativePlan & { engine: string };

export type PlanRequest = {
  brief: string;
  count: number;
  ratio: string;
  hasReference: boolean;
  /** Produit du Creative Engine, quand il y en a un. */
  productId?: string | null;
  /** Sinon, ce qu'on sait du produit (fiche lue en prompt libre), ou rien. */
  product?: { name: string; store?: string; url?: string; price?: string } | null;
  avoid?: string[];
};

export async function requestPlan(input: PlanRequest): Promise<PlanResult> {
  const data = await enginePost<{ plan: PlanResult }>({ action: "workspace-plan", ...input });
  return data.plan;
}

export function engineLabel(engine: string) {
  return engine === "hermes" ? "Hermes" : "Claude";
}

export function PlanCards({
  plan,
  selected,
  onSelect,
  onEdit,
  onRewrite,
  rewriting,
  actionLabel,
  onAction,
  busy,
}: {
  plan: PlanResult;
  selected: Set<number>;
  onSelect: (next: Set<number>) => void;
  onEdit: (index: number, prompt: string) => void;
  onRewrite: (index: number) => void;
  rewriting: number | null;
  /** Texte du bouton final ; reçoit le nombre coché. */
  actionLabel: (count: number) => string;
  onAction: () => void;
  busy?: boolean;
}) {
  const planned = plan.creatives;
  return (
    <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70" data-plan>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[12px] font-semibold text-slate-900 dark:text-slate-100" data-plan-count>
          Batch : {planned.length} créa{planned.length > 1 ? "s" : ""} = {planned.length} image{planned.length > 1 ? "s" : ""}
        </div>
        <span className="text-[10.5px] text-slate-400">planifié par {engineLabel(plan.engine)} · {plan.ratio}</span>
        <div className="ml-auto flex items-center gap-1.5 text-[11px]">
          <button type="button" onClick={() => onSelect(new Set(planned.map((creative) => creative.index)))} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Tout sélectionner
          </button>
          <button type="button" onClick={() => onSelect(new Set())} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Tout désélectionner
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {planned.map((creative: PlannedCreative) => (
          <article key={creative.index} className={cn("rounded-xl border p-2.5", selected.has(creative.index) ? "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900" : "border-slate-200 bg-slate-50 opacity-70 dark:border-slate-800 dark:bg-slate-900/40")} data-creative-card={creative.index}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(creative.index)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(creative.index);
                  else next.delete(creative.index);
                  onSelect(next);
                }}
                aria-label={`Créa ${creative.index}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                  <span className="font-semibold uppercase tracking-wide text-slate-500">Creative {String(creative.index).padStart(2, "0")}</span>
                  {creative.angle ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-angle>{creative.angle}</span> : null}
                  <button type="button" disabled={rewriting !== null} onClick={() => onRewrite(creative.index)} className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:hover:text-slate-200" title="Demander un autre concept pour cette créa">
                    {rewriting === creative.index ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Réécrire
                  </button>
                </div>
                {creative.concept ? <div className="mt-0.5 text-[11.5px] text-slate-700 dark:text-slate-300" data-concept>{creative.concept}</div> : null}
                {creative.hook ? <div className="text-[11px] text-slate-500">Hook : « {creative.hook} »</div> : null}
                <textarea value={creative.prompt} onChange={(event) => onEdit(creative.index, event.target.value)} rows={3} className="mt-1.5 w-full resize-y rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed outline-none dark:bg-slate-800" data-creative-prompt />
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" disabled={!selected.size || busy} onClick={onAction} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900" data-generate-selected>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {actionLabel(selected.size)}
        </button>
      </div>
    </section>
  );
}

/** Remplace une créa du plan (réécriture) ou son prompt (édition). */
export function patchPlan(plan: PlanResult, index: number, patch: Partial<PlannedCreative>): PlanResult {
  return { ...plan, creatives: plan.creatives.map((creative) => (creative.index === index ? { ...creative, ...patch, index } : creative)) };
}

/** Les concepts des autres créas, pour que la réécriture d'une seule ne les répète pas. */
export function avoidList(plan: PlanResult, index: number): string[] {
  return plan.creatives.filter((creative) => creative.index !== index).map((creative) => creative.concept || creative.angle).filter(Boolean);
}
