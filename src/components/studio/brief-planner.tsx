"use client";

import { useState, type DragEvent } from "react";
import { ImagePlus, Loader2, RefreshCw, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { fileToDataUrl } from "@/components/mass-test/engine-client";
import type { CompetitorInspiration } from "@/lib/brandsearch/types";
import type { CreativePlan, PlannedCreative } from "@/lib/creative-engine/workspace-plan";
import { cn } from "@/lib/utils";

/**
 * Le planificateur de brief, partagé par tous les endroits où l'on génère :
 * « Create 5 ads… » devient N concepts distincts (Hermes), montrés en cartes
 * avant tout envoi. Chaque écran garde sa propre suite (aperçu, génération).
 */

export type PlanResult = CreativePlan & {
  engine: string;
  /** Une créa d'inspiration était jointe au brief. */
  referenceAttached?: boolean;
  /** Hermes l'a réellement regardée dans la requête de planification. */
  referenceSeen?: boolean;
  /** Ce qu'il y a vu (ADN créatif), et les éléments visuels concrets qu'il reprend. */
  referenceSummary?: string | null;
  referenceElements?: string[];
  /** Faits propres au concurrent lus sur l'image et écartés (avec un produit actif). */
  competitorFacts?: string[];
  /** Pubs concurrentes Brand Search utilisées comme inspiration. */
  competitorInspiration?: { domain: string; ads: number; patterns: number } | null;
};

/** Hermes tourne sur un modèle qui ne voit pas : l'opérateur choisit de continuer en texte seul ou non. */
export class VisionUnavailableError extends Error {}

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
  /** Créa d'inspiration (data URL) : hébergée puis vue par Hermes dans la requête de planification. */
  referenceDataUrl?: string | null;
  /** Planifier depuis le texte seul, l'image restant jointe à la génération. */
  ignoreReference?: boolean;
  /** Pubs concurrentes sélectionnées et analysées dans la galerie Brand Search. */
  competitorInspiration?: CompetitorInspiration | null;
};

export async function requestPlan(input: PlanRequest): Promise<PlanResult> {
  const res = await fetch("/api/creative-engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "workspace-plan", ...input }) });
  const data = (await res.json()) as { plan?: PlanResult; error?: string; visionUnavailable?: boolean };
  if (!res.ok || !data.plan) {
    if (data.visionUnavailable) throw new VisionUnavailableError(data.error || "Le modèle Hermes actuel ne voit pas les images");
    throw new Error(data.error || "Planification impossible");
  }
  return data.plan;
}

/** L'avertissement quand Hermes ne peut pas voir l'image : rien n'est planifié tant que l'opérateur n'a pas choisi. */
export function VisionWarning({ message, onContinue, onDismiss, busy }: { message: string; onContinue: () => void; onDismiss: () => void; busy?: boolean }) {
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-vision-warning>
      <div className="font-semibold">Hermes current model does not support vision.</div>
      <p className="mt-0.5 text-[11.5px]">{message} L&apos;image reste jointe à la génération, mais le planificateur ne peut pas la regarder. Tu peux planifier depuis le texte seul.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={busy} onClick={onContinue} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900" data-plan-text-only>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Planifier sans l&apos;image
        </button>
        <button type="button" onClick={onDismiss} className="h-8 rounded-lg px-2 text-[12px] font-medium text-amber-900/70 hover:text-amber-900 dark:text-amber-200/70">
          Annuler
        </button>
      </div>
    </section>
  );
}

export function engineLabel(engine: string) {
  return engine === "hermes" ? "Hermes" : "Claude";
}

export function PlanCards({
  plan,
  withProduct = false,
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
  /** Un produit actif accompagnait la planification (le statut le dit). */
  withProduct?: boolean;
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
        {plan.referenceAttached ? (
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", plan.referenceSeen ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800")} title={plan.referenceSeen ? plan.referenceSummary ?? "" : "Planifié depuis le texte seul : le modèle Hermes actuel n'a pas regardé l'image."} data-plan-reference={plan.referenceSeen ? "seen" : "unseen"}>
            {plan.referenceSeen ? (withProduct ? "Produit actif + référence lue par Hermes" : "Référence lue par Hermes") : "Référence non lisible par le modèle Hermes actuel"}
          </span>
        ) : null}
        {plan.competitorInspiration ? (
          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800" data-plan-competitor={plan.competitorInspiration.ads}>
            Inspiration Brand Search · {plan.competitorInspiration.domain} · {plan.competitorInspiration.ads} pub{plan.competitorInspiration.ads > 1 ? "s" : ""} · {plan.competitorInspiration.patterns} motif{plan.competitorInspiration.patterns > 1 ? "s" : ""}
          </span>
        ) : null}
        {plan.competitorFacts?.length ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800" title={plan.competitorFacts.join(" · ")} data-plan-competitor-facts={plan.competitorFacts.length}>
            {plan.competitorFacts.length} fait{plan.competitorFacts.length > 1 ? "s" : ""} concurrent{plan.competitorFacts.length > 1 ? "s" : ""} écarté{plan.competitorFacts.length > 1 ? "s" : ""}
          </span>
        ) : null}
        {plan.referenceSeen && plan.referenceElements?.length ? (
          <div className="basis-full text-[10.5px] text-slate-500" data-plan-elements={plan.referenceElements.length}>
            <span className="font-semibold uppercase tracking-wide text-slate-400">Éléments repris : </span>
            {plan.referenceElements.join(" · ")}
          </div>
        ) : null}
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


/** Une image glissée, collée ou choisie, gardée en data URL : la créa que le batch doit suivre. */
export function CreativeReferenceSlot({ value, onChange, hint }: { value: string | null; onChange: (dataUrl: string | null) => void; hint?: string }) {
  const [over, setOver] = useState(false);
  async function take(files: FileList | File[] | null | undefined) {
    const file = [...(files ?? [])].find((entry) => entry.type.startsWith("image/"));
    if (!file) return;
    if (file.size > 4_000_000) return toast.error("Image trop lourde (4 Mo max)");
    onChange(await fileToDataUrl(file));
  }
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files);
  };
  return (
    <div
      className={cn("flex items-center gap-2 rounded-xl p-1.5 text-[11px] transition-colors", over ? "bg-emerald-50 ring-2 ring-dashed ring-emerald-400 dark:bg-emerald-950/30" : "bg-slate-50 dark:bg-slate-800/60")}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      data-creative-reference={value ? "set" : "empty"}
    >
      {value ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-900/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-full w-full object-cover" />
          <button type="button" onClick={() => onChange(null)} className="absolute right-0 top-0 rounded bg-black/60 p-0.5 text-white" aria-label="Retirer la créa de référence">
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ) : (
        <label className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-dashed ring-slate-300 hover:text-slate-600 dark:bg-slate-900 dark:ring-slate-600" title="Choisir une image">
          <ImagePlus className="h-4 w-4" />
          <input type="file" accept="image/*" className="hidden" data-creative-reference-input onChange={(event) => { void take(event.target.files); event.target.value = ""; }} />
        </label>
      )}
      <div className="min-w-0 text-slate-500">
        <div className="font-semibold uppercase tracking-wide text-slate-500">Creative inspiration{value ? " · jointe" : " · optionnel"}</div>
        <div className="text-[10.5px] text-slate-400">{hint ?? "Pub concurrente ou créa de style : glisse, colle (Ctrl+V dans le brief) ou choisis. Le batch en garde l'angle, la structure et le style ; le produit et ses faits restent les tiens."}</div>
      </div>
    </div>
  );
}
