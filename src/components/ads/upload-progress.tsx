"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La fenêtre de suivi de l'uploader, en bas à droite : une barre de
 * progression et le journal de l'envoi, étape par étape (médias envoyés,
 * créas préparées, campagne, ad sets, pubs), chacune réussie ou refusée avec
 * le message de Meta.
 */

export type ProgressStep = "media" | "creative" | "campaign" | "adset" | "ad";
export type ProgressItem = { id: string; step: ProgressStep; label: string; status: "pending" | "running" | "ok" | "error"; message?: string };
export type UploadProgressState = {
  phase: "running" | "done" | "error";
  items: ProgressItem[];
  /** Le nombre d'opérations attendues (médias + créas + campagne + ad sets + pubs). */
  total: number;
  error?: string;
  summary?: string;
  startedAt: number;
};

const STEP_LABEL: Record<ProgressStep, string> = {
  media: "Média",
  creative: "Créa",
  campaign: "Campagne",
  adset: "Ad set",
  ad: "Pub",
};

const STEP_ORDER: ProgressStep[] = ["media", "creative", "campaign", "adset", "ad"];

function StatusIcon({ status }: { status: ProgressItem["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  if (status === "error") return <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-600" />;
}

export function UploadProgress({ state, onClose }: { state: UploadProgressState; onClose: () => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  const done = state.items.filter((item) => item.status === "ok" || item.status === "error").length;
  const percent = state.phase === "done" ? 100 : Math.min(99, Math.round((done / Math.max(1, state.total)) * 100));

  // Le journal suit la dernière ligne.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [state.items.length]);

  const counts = STEP_ORDER.map((step) => {
    const rows = state.items.filter((item) => item.step === step);
    return { step, ok: rows.filter((item) => item.status === "ok").length, error: rows.some((item) => item.status === "error"), total: rows.length };
  }).filter((row) => row.total > 0);

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-slate-950 text-slate-100 shadow-[0_24px_60px_rgba(2,6,23,0.45)] ring-1 ring-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        {state.phase === "running" ? (
          <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
        ) : state.phase === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-rose-400" />
        )}
        <p className="text-[13px] font-semibold">
          {state.phase === "running" ? "Création en cours…" : state.phase === "done" ? "Pubs créées" : "Envoi arrêté"}
        </p>
        <span className="ml-auto font-mono text-[11px] text-slate-400">{percent} %</span>
        {state.phase !== "running" ? (
          <button type="button" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white" title="Fermer">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="px-4 pt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              state.phase === "error" ? "bg-rose-500" : state.phase === "done" ? "bg-emerald-500" : "bg-gradient-to-r from-sky-500 to-indigo-400"
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {counts.map((row) => (
            <span
              key={row.step}
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                row.error ? "bg-rose-500/15 text-rose-300" : row.ok === row.total ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-300"
              )}
            >
              {STEP_LABEL[row.step]}s {row.ok}/{row.total}
            </span>
          ))}
        </div>
      </div>

      <div ref={logRef} className="mt-2 max-h-60 space-y-1 overflow-y-auto px-4 pb-3 font-mono text-[11px] leading-snug">
        {state.items.map((item) => (
          <div key={item.id}>
            <div className="flex items-start gap-1.5">
              <StatusIcon status={item.status} />
              <span className="shrink-0 text-slate-500">{STEP_LABEL[item.step].padEnd(8, " ")}</span>
              <span className={cn("min-w-0 flex-1 break-words", item.status === "error" ? "text-rose-300" : item.status === "ok" ? "text-slate-200" : "text-slate-400")}>
                {item.label}
              </span>
            </div>
            {item.message ? <p className="ml-5 mt-0.5 break-words text-[10.5px] text-rose-300/90">↳ {item.message}</p> : null}
          </div>
        ))}
      </div>

      {state.phase === "error" && state.error ? (
        <div className="border-t border-white/10 bg-rose-500/10 px-4 py-2.5 text-[11.5px] leading-snug text-rose-200">{state.error}</div>
      ) : null}
      {state.phase === "done" ? (
        <div className="flex items-center gap-2 border-t border-white/10 bg-emerald-500/10 px-4 py-2.5 text-[11.5px] text-emerald-200">
          <span className="min-w-0 flex-1">{state.summary}</span>
          <Link href="/ads" className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 font-semibold text-white hover:bg-white/20">
            Voir dans l&apos;Ads Manager
          </Link>
        </div>
      ) : null}
    </div>
  );
}
