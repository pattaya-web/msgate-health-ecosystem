"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { briefPrompt, defaultDeadline } from "@/lib/creative-pipeline/brief-prompt";
import type { Brief, BriefStatus } from "@/lib/creative-pipeline/store";

/**
 * Les briefs du pipeline créa : un Kanban (Brief → En prod → Prête → Uploadée)
 * et un formulaire court qui remplace WhatsApp. Chaque brief donne son Créa ID
 * (S_HISHERS_VELVET_v2) et son prompt image pour le Studio IA.
 */

const COLUMNS: BriefStatus[] = ["BRIEF", "EN PROD", "PRÊTE", "UPLOADÉE"];
const COLUMN_LABEL: Record<BriefStatus, string> = { BRIEF: "Brief", "EN PROD": "En prod", "PRÊTE": "Prête", "UPLOADÉE": "Uploadée" };
const SWAPS = ["Headline swap", "Visual swap", "Badge swap", "Hook swap"];
const FORMATS = ["3:4", "1:1", "9:16", "4:5"];

type Draft = Partial<Brief> & { formats: string[] };

const blank = (today: string): Draft => ({
  format: "S",
  type: "Itération",
  swap: "Headline swap",
  concept: "",
  method: "",
  source: "",
  angle: "",
  headline: "",
  badge: "",
  visual: "",
  price: "29,99 $ barré 59,98 $",
  formats: ["3:4", "1:1"],
  targetAdset: "",
  deadline: defaultDeadline(today),
  assignee: "Alison",
  status: "BRIEF",
  postId: "",
});

const deadlineLabel = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const wed = new Date(`${day}T12:00:00Z`);
  const thu = new Date(wed.getTime() + 24 * 3_600_000);
  const fmt = (date: Date) => date.toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  return `${fmt(wed)} 18 h validé · ${fmt(thu)} 9 h uploadé`;
};

export function BriefBoard({ briefs, today, onChanged }: { briefs: Brief[]; today: string; onChanged: () => Promise<void> | void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(payload: Record<string, unknown>, done?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/creative-pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Action impossible");
      if (done) toast.success(done);
      await onChanged();
      return body;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    if (!draft.concept?.trim() || !draft.method?.trim()) return toast.error("Concept et méthode obligatoires (ils forment le Créa ID)");
    const body = await post({ action: "brief.save", brief: draft }, draft.id ? "Brief modifié" : "Brief créé");
    if (body) setDraft(null);
  }

  const copyPrompt = (brief: Draft) => {
    void navigator.clipboard
      .writeText(briefPrompt({ format: brief.format ?? "S", formats: brief.formats, angle: brief.angle ?? "", headline: brief.headline ?? "", badge: brief.badge ?? "", visual: brief.visual ?? "", price: brief.price ?? "", type: brief.type ?? "Itération", swap: brief.swap ?? "" }))
      .then(() => toast.success("Prompt copié : colle-le dans le Studio IA avec les photos du produit"));
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const previewId = draft ? `${draft.format === "V" ? "V" : "S"}_${(draft.concept || "CONCEPT").toUpperCase().replace(/[^A-Z0-9]+/g, "")}_${(draft.method || "METHODE").toUpperCase().replace(/[^A-Z0-9]+/g, "")}_v${draft.version ?? "?"}` : "";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setDraft(blank(today))} className="inline-flex items-center gap-1 rounded-md bg-[#1877F2] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#166fe5]">
          <Plus className="h-3.5 w-3.5" /> Nouveau brief
        </button>
        <a href="/studio-ia" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">
          <Sparkles className="h-3.5 w-3.5" /> Ouvrir le Studio IA
        </a>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        {COLUMNS.map((column, columnIndex) => {
          const cards = briefs.filter((brief) => brief.status === column);
          return (
            <div key={column} className="min-h-[120px] rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {COLUMN_LABEL[column]} <span className="text-slate-400">{cards.length}</span>
              </p>
              <div className="space-y-1.5">
                {cards.map((brief) => (
                  <div key={brief.id} className="rounded-md bg-white p-2 text-[11.5px] ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-white/10">
                    <button type="button" onClick={() => setDraft({ ...brief })} className="block w-full text-left">
                      <p className="truncate font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-50">{brief.creaId}</p>
                      <p className="truncate text-slate-500">
                        {brief.type === "Itération" ? brief.swap || "Itération" : "Nouveau concept"} · {brief.assignee || "—"}
                      </p>
                      {brief.headline ? <p className="truncate text-slate-700 dark:text-slate-300">« {brief.headline} »</p> : null}
                      <p className="text-[10.5px] text-slate-400">{deadlineLabel(brief.deadline)}</p>
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      <button type="button" disabled={busy || columnIndex === 0} onClick={() => void post({ action: "brief.move", id: brief.id, status: COLUMNS[columnIndex - 1] })} className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="Colonne précédente">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" disabled={busy || columnIndex === COLUMNS.length - 1} onClick={() => void post({ action: "brief.move", id: brief.id, status: COLUMNS[columnIndex + 1] })} className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="Colonne suivante">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => copyPrompt({ ...brief })} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-[#1877F2] hover:bg-[#e7f0ff]" title="Copier le prompt image pour le Studio IA">
                        <Copy className="h-3 w-3" /> Prompt
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {draft ? (
        <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/40" onClick={() => setDraft(null)}>
          <aside className="flex h-full w-[min(520px,100vw)] flex-col overflow-y-auto bg-white p-4 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-semibold">{draft.id ? "Modifier le brief" : "Nouveau brief"}</p>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-800">{draft.creaId ?? previewId}</code>
              <button type="button" onClick={() => setDraft(null)} className="ml-auto grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <Field label="Format">
                <select value={draft.format} onChange={(e) => set("format", e.target.value as "S" | "V")} className={INPUT}>
                  <option value="S">S · statique</option>
                  <option value="V">V · vidéo</option>
                </select>
              </Field>
              <Field label="Type">
                <select value={draft.type} onChange={(e) => set("type", e.target.value as Brief["type"])} className={INPUT}>
                  <option>Itération</option>
                  <option>Nouveau concept</option>
                </select>
              </Field>
              <Field label="Concept (ex. HISHERS)">
                <input value={draft.concept ?? ""} onChange={(e) => set("concept", e.target.value)} className={INPUT} />
              </Field>
              <Field label="Méthode (ex. VELVET)">
                <input value={draft.method ?? ""} onChange={(e) => set("method", e.target.value)} className={INPUT} />
              </Field>
              {draft.type === "Itération" ? (
                <>
                  <Field label="Swap">
                    <select value={draft.swap} onChange={(e) => set("swap", e.target.value)} className={INPUT}>
                      {SWAPS.map((swap) => (
                        <option key={swap}>{swap}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Source (post ID d'origine)">
                    <input value={draft.source ?? ""} onChange={(e) => set("source", e.target.value)} className={INPUT} />
                  </Field>
                </>
              ) : null}
              <Field label="Angle" wide>
                <input value={draft.angle ?? ""} onChange={(e) => set("angle", e.target.value)} className={INPUT} />
              </Field>
              <Field label="Headline" wide>
                <input value={draft.headline ?? ""} onChange={(e) => set("headline", e.target.value)} className={INPUT} />
              </Field>
              <Field label="Badge">
                <input value={draft.badge ?? ""} onChange={(e) => set("badge", e.target.value)} className={INPUT} />
              </Field>
              <Field label="Prix affiché">
                <input value={draft.price ?? ""} onChange={(e) => set("price", e.target.value)} className={INPUT} />
              </Field>
              <Field label="Visuel (3 lignes)" wide>
                <textarea value={draft.visual ?? ""} onChange={(e) => set("visual", e.target.value)} rows={3} className={cn(INPUT, "h-auto py-1.5")} />
              </Field>
              <Field label="Formats" wide>
                <div className="flex gap-3 pt-1">
                  {FORMATS.map((format) => (
                    <label key={format} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={draft.formats.includes(format)}
                        onChange={(e) => set("formats", e.target.checked ? [...draft.formats, format] : draft.formats.filter((item) => item !== format))}
                      />
                      {format}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Ad set cible">
                <input value={draft.targetAdset ?? ""} onChange={(e) => set("targetAdset", e.target.value)} className={INPUT} placeholder="MIX 7" />
              </Field>
              <Field label="Deadline (mercredi)">
                <input type="date" value={draft.deadline ?? ""} onChange={(e) => set("deadline", e.target.value)} className={INPUT} />
                <span className="text-[10.5px] text-slate-400">{deadlineLabel(draft.deadline ?? "")}</span>
              </Field>
              <Field label="Assigné">
                <select value={draft.assignee} onChange={(e) => set("assignee", e.target.value)} className={INPUT}>
                  <option>Alison</option>
                  <option>Mady</option>
                </select>
              </Field>
              <Field label="Statut">
                <select value={draft.status} onChange={(e) => set("status", e.target.value as BriefStatus)} className={INPUT}>
                  {COLUMNS.map((column) => (
                    <option key={column} value={column}>
                      {COLUMN_LABEL[column]}
                    </option>
                  ))}
                </select>
              </Field>
              {draft.status === "UPLOADÉE" ? (
                <Field label="Post ID en ligne" wide>
                  <input value={draft.postId ?? ""} onChange={(e) => set("postId", e.target.value)} className={INPUT} />
                </Field>
              ) : null}
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Prompt image (Studio IA)</p>
                <button type="button" onClick={() => copyPrompt(draft)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[#1877F2] hover:bg-[#e7f0ff]">
                  <Copy className="h-3 w-3" /> Copier
                </button>
              </div>
              <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-snug text-slate-600 dark:text-slate-300">
                {briefPrompt({ format: draft.format ?? "S", formats: draft.formats, angle: draft.angle ?? "", headline: draft.headline ?? "", badge: draft.badge ?? "", visual: draft.visual ?? "", price: draft.price ?? "", type: draft.type ?? "Itération", swap: draft.swap ?? "" })}
              </pre>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-md bg-[#1877F2] px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Enregistrer
              </button>
              {draft.id ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Supprimer le brief ${draft.creaId} ?`)) void post({ action: "brief.delete", id: draft.id }, "Brief supprimé").then((body) => body && setDraft(null));
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

const INPUT = "h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] font-normal dark:border-white/10 dark:bg-slate-950";

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("block font-medium text-slate-600 dark:text-slate-300", wide && "col-span-2")}>
      <span className="mb-0.5 block text-[11px]">{label}</span>
      {children}
    </label>
  );
}
