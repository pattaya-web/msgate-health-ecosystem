"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";
import {
  MIX_OPTIONS,
  buildCreativeName,
  conceptGuess,
  isoWeek,
  namingContextFor,
  parseCreativeName,
  slugToken,
} from "@/lib/creative-naming";

/**
 * La fenêtre « Renommer » de l'Ads Manager.
 *
 * Avant, c'était window.prompt : Safari en appli (écran d'accueil) et certains
 * Chrome la bloquent sans rien dire, et le renommage semblait ne pas marcher.
 * `askName()` ouvre cette fenêtre et rend le nouveau nom (ou null si annulé) ;
 * <RenameDialogHost /> est posé une fois dans la page.
 *
 * Pour une pub, `naming` (semaine + MIX déduits du lancement et de l'ad set)
 * ajoute les champs de la convention S45_MIX1_CONCEPT_VARIANTE : il ne reste
 * qu'à taper le CONCEPT et la VARIANTE. Le même hôte ouvre aussi « Renommer
 * tout l'ad set » et « Normaliser » (openNamingPanel).
 */

/** Ce qu'on sait d'une pub pour la nommer : semaine (lancement, sinon nom de l'ad set) et MIX (nom de l'ad set). */
export type NamingHint = { week: number | null; mix: string | null };

type Request = { title: string; current: string; naming?: NamingHint; resolve: (value: string | null) => void };

let pending: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function askName(title: string, current: string, naming?: NamingHint): Promise<string | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { title, current, naming, resolve };
    emit();
  });
}

/** Une pub telle que les fenêtres de nommage en ont besoin. */
export type NamingAd = { id: string; name: string; createdTime: string };
/** Renomme une pub chez Meta (même route que « Renommer ») ; lève une erreur si Meta refuse. */
export type RenameAd = (id: string, name: string) => Promise<void>;

export type NamingPanel =
  | { kind: "adset"; adsetName: string; ads: NamingAd[]; onRename: RenameAd }
  | { kind: "normalize"; adsets: Array<{ adsetId: string; adsetName: string; ads: NamingAd[] }>; onRename: RenameAd };

let panel: NamingPanel | null = null;

export function openNamingPanel(next: NamingPanel) {
  pending?.resolve(null);
  pending = null;
  panel = next;
  emit();
}

function closePanel() {
  panel = null;
  emit();
}

function close(value: string | null) {
  const request = pending;
  pending = null;
  emit();
  request?.resolve(value);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function RenameDialogHost() {
  const request = useSyncExternalStore(subscribe, () => pending, () => null);
  const current = useSyncExternalStore(subscribe, () => panel, () => null);
  const mounted = useMounted();
  if (!mounted) return null;
  if (request) return createPortal(<RenameDialog key={`${request.title}:${request.current}`} request={request} />, document.body);
  if (current?.kind === "adset") return createPortal(<AdsetNamingDialog panel={current} />, document.body);
  if (current?.kind === "normalize") return createPortal(<NormalizeDialog panel={current} />, document.body);
  return null;
}

type Parts = { week: string; mix: string; concept: string; variante: string; iteration?: number };

/** Les morceaux de départ d'un nom : ceux du nom actuel s'il suit déjà la convention, sinon semaine + MIX déduits et un CONCEPT deviné. */
function initialParts(current: string, naming: NamingHint): Parts {
  const parsed = parseCreativeName(current);
  if (parsed) return { week: String(parsed.week), mix: parsed.mix, concept: parsed.concept, variante: parsed.variante, iteration: parsed.iteration };
  return { week: naming.week ? String(naming.week) : "", mix: naming.mix ?? "", concept: conceptGuess(current), variante: "" };
}

/** Le nom tel qu'il se dessine, même incomplet (« S45_MIX1_HEMIOS_ ») : on voit ce qu'il reste à taper. */
function draftName(parts: Parts) {
  const full = buildCreativeName({ week: Number(parts.week) || 0, mix: parts.mix, concept: parts.concept, variante: parts.variante, iteration: parts.iteration });
  if (full) return full;
  const week = Number(parts.week) ? `S${String(Number(parts.week)).padStart(2, "0")}` : "S??";
  return [week, parts.mix || "MIX?", slugToken(parts.concept), slugToken(parts.variante)].join("_");
}

const FIELD =
  "h-10 w-full rounded-xl border border-slate-200 bg-transparent px-2.5 text-[16px] text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/15 sm:text-[13px] dark:border-slate-700 dark:text-slate-50";
const SMALL_FIELD =
  "h-8 w-full rounded-lg border border-slate-200 bg-transparent px-2 text-[16px] text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/15 sm:text-[12px] dark:border-slate-700 dark:text-slate-50";
const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-slate-400";

function ConventionBadge({ name }: { name: string }) {
  const ok = Boolean(parseCreativeName(name));
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" /> : null}
      {ok ? "Convention" : "Hors convention"}
    </span>
  );
}

/** Le choix du MIX : MIX1 à MIX5 et VIDEO (plus la valeur actuelle si elle sort de la liste, ex. MIX7). */
function MixSelect({ value, onChange, className }: { value: string; onChange: (value: string) => void; className: string }) {
  const options = [...new Set([...MIX_OPTIONS, value].filter(Boolean))];
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      {!value ? <option value="">—</option> : null}
      {options.map((mix) => (
        <option key={mix} value={mix}>
          {mix}
        </option>
      ))}
    </select>
  );
}

function RenameDialog({ request }: { request: Request }) {
  const [parts, setParts] = useState(() => initialParts(request.current, request.naming ?? { week: null, mix: null }));
  // Avec la convention, le nom complet part du squelette S45_MIX1_… (ou du nom actuel s'il la suit déjà).
  const [value, setValue] = useState(() => (request.naming && !parseCreativeName(request.current) ? draftName(parts) : request.current));
  const input = useRef<HTMLInputElement>(null);
  const concept = useRef<HTMLInputElement>(null);
  const variante = useRef<HTMLInputElement>(null);
  const [focusVariante] = useState(() => Boolean(parts.concept));

  useEffect(() => {
    const timer = setTimeout(() => {
      // Avec la convention, on tape d'abord le CONCEPT (ou la VARIANTE s'il est déjà connu).
      const target = request.naming ? (focusVariante ? variante.current : concept.current) : input.current;
      target?.focus();
      target?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [request.naming, focusVariante]);

  const setPart = (key: "week" | "mix" | "concept" | "variante", next: string) => {
    const updated = { ...parts, [key]: next };
    setParts(updated);
    setValue(draftName(updated));
  };

  // Squelette pas fini (« S45_MIX1_HEMIOS_ », « MIX? ») : on ne l'envoie pas à Meta.
  const unfinished = Boolean(request.naming) && /\?|__|_$/.test(value.trim());

  const submit = () => {
    const next = value.trim();
    if (unfinished) return;
    close(next && next !== request.current ? next : null);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-950/40 p-3 backdrop-blur-[2px] sm:items-center" onClick={() => close(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        className={cn("w-full rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10", request.naming ? "max-w-lg" : "max-w-md")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <Pencil className="h-4 w-4 text-slate-400" />
          <p className="flex-1 text-[14px] font-semibold text-slate-900 dark:text-slate-50">{request.title}</p>
          <button type="button" aria-label="Fermer" onClick={() => close(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {request.naming ? (
            <>
              <div className="mb-3 grid grid-cols-[60px_88px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
                <label className="min-w-0">
                  <span className={LABEL}>Semaine</span>
                  <input inputMode="numeric" value={parts.week} onChange={(event) => setPart("week", event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="45" className={FIELD} />
                </label>
                <label className="min-w-0">
                  <span className={LABEL}>Mix</span>
                  <MixSelect value={parts.mix} onChange={(next) => setPart("mix", next)} className={FIELD} />
                </label>
                <label className="min-w-0">
                  <span className={LABEL}>Concept</span>
                  <input ref={concept} value={parts.concept} onChange={(event) => setPart("concept", event.target.value)} placeholder="HEMIOS" className={cn(FIELD, "uppercase")} />
                </label>
                <label className="min-w-0">
                  <span className={LABEL}>Variante</span>
                  <input ref={variante} value={parts.variante} onChange={(event) => setPart("variante", event.target.value)} placeholder="NAVY" className={cn(FIELD, "uppercase")} />
                </label>
              </div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={LABEL}>Nom complet (modifiable)</span>
                <ConventionBadge name={value.trim()} />
              </div>
            </>
          ) : null}
          <input
            ref={input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={400}
            className={cn(
              "h-11 w-full rounded-xl border border-slate-200 bg-transparent px-3 text-[16px] text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/15 sm:text-[14px] dark:border-slate-700 dark:text-slate-50",
              request.naming && "font-mono"
            )}
          />
          {request.naming && request.current !== value.trim() ? (
            <p className="mt-1 truncate text-[11px] text-slate-400" title={request.current}>
              Avant : {request.current}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => close(null)} className="h-10 rounded-xl px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Annuler
            </button>
            <button
              type="submit"
              disabled={!value.trim() || value.trim() === request.current || unfinished}
              className="h-10 rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
            >
              Renommer sur Meta
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Renommer tout l'ad set · Normaliser
 * ------------------------------------------------------------------ */

type RowStatus = { state: "idle" | "running" | "ok" | "error"; message?: string };

const byLaunch = (a: NamingAd, b: NamingAd) => (a.createdTime || "").localeCompare(b.createdTime || "");

function PanelFrame({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-950/40 p-3 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-2">
          <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-50">{title}</p>
            {subtitle ? <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="mt-3 flex items-center justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

function StatusMark({ status }: { status?: RowStatus }) {
  if (!status || status.state === "idle") return null;
  if (status.state === "running") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />;
  if (status.state === "ok") return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  return (
    <span className="shrink-0 text-[10px] font-semibold text-rose-600" title={status.message}>
      Refusé
    </span>
  );
}

/**
 * « Renommer tout l'ad set » : un CONCEPT tapé une fois, et chaque pub de
 * l'ad set devient S{semaine de son lancement}_{MIX}_{CONCEPT}_V1, V2, V3…
 * (dans l'ordre de lancement). Aperçu avant, puis confirmation.
 */
function AdsetNamingDialog({ panel }: { panel: Extract<NamingPanel, { kind: "adset" }> }) {
  const ads = useMemo(() => [...panel.ads].sort(byLaunch), [panel.ads]);
  const [week, setWeek] = useState("");
  const [mix, setMix] = useState(() => namingContextFor(panel.adsetName).mix ?? "");
  const [concept, setConcept] = useState("");
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [running, setRunning] = useState(false);

  const plan = ads.map((ad, index) => {
    const auto = namingContextFor(panel.adsetName, ad.createdTime).week;
    const name = buildCreativeName({ week: Number(week) || auto || 0, mix, concept, variante: `V${index + 1}` });
    return { ad, name };
  });
  const toRename = plan.filter((row) => row.name && row.name !== row.ad.name && status[row.ad.id]?.state !== "ok");
  const done = Object.values(status).filter((row) => row.state === "ok").length;

  async function apply() {
    if (!toRename.length) return;
    if (!window.confirm(`Renommer ${toRename.length} pub${toRename.length > 1 ? "s" : ""} de « ${panel.adsetName} » chez Meta ?\n\n${toRename.map((row) => `• ${row.ad.name} → ${row.name}`).join("\n")}`)) return;
    setRunning(true);
    for (const row of toRename) {
      setStatus((current) => ({ ...current, [row.ad.id]: { state: "running" } }));
      try {
        await panel.onRename(row.ad.id, row.name);
        setStatus((current) => ({ ...current, [row.ad.id]: { state: "ok" } }));
      } catch (error) {
        setStatus((current) => ({ ...current, [row.ad.id]: { state: "error", message: error instanceof Error ? error.message : "Meta a refusé le renommage" } }));
      }
    }
    setRunning(false);
  }

  return (
    <PanelFrame
      title="Renommer tout l'ad set"
      subtitle={`« ${panel.adsetName} » · ${ads.length} pub${ads.length > 1 ? "s" : ""}, numérotées V1, V2… dans l'ordre de lancement`}
      onClose={() => !running && closePanel()}
      footer={
        <>
          {done ? <span className="mr-auto text-[12px] text-emerald-700">{done} renommée{done > 1 ? "s" : ""} sur Meta</span> : null}
          <button type="button" disabled={running} onClick={closePanel} className="h-10 rounded-xl px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            {done ? "Fermer" : "Annuler"}
          </button>
          <button
            type="button"
            disabled={running || !toRename.length}
            onClick={() => void apply()}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Renommer {toRename.length || ""} pub{toRename.length > 1 ? "s" : ""} sur Meta
          </button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-[72px_96px_minmax(0,1fr)] gap-1.5">
        <label className="min-w-0">
          <span className={LABEL}>Semaine</span>
          <input
            inputMode="numeric"
            value={week}
            onChange={(event) => setWeek(event.target.value.replace(/\D/g, "").slice(0, 2))}
            placeholder="auto"
            title="Vide : la semaine du lancement de chaque pub"
            className={FIELD}
          />
        </label>
        <label className="min-w-0">
          <span className={LABEL}>Mix</span>
          <MixSelect value={mix} onChange={setMix} className={FIELD} />
        </label>
        <label className="min-w-0">
          <span className={LABEL}>Concept</span>
          <input autoFocus value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="HEMIOS" className={cn(FIELD, "uppercase")} />
        </label>
      </div>
      {!mix ? <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200">Pas de « MIX n » dans le nom de l&apos;ad set : choisis le MIX.</p> : null}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
        {plan.map((row) => (
          <li key={row.ad.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-slate-400" title={row.ad.name}>
              {row.ad.name}
            </span>
            <span className="text-slate-300">→</span>
            <span className={cn("min-w-0 flex-1 truncate font-mono font-semibold", row.name === row.ad.name ? "text-slate-400" : "text-slate-800 dark:text-slate-100")} title={row.name}>
              {row.name ? (row.name === row.ad.name ? "inchangé" : row.name) : "—"}
            </span>
            <StatusMark status={status[row.ad.id]} />
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}

type NormalizeRow = { adsetId: string; adsetName: string; ad: NamingAd; week: string; mix: string; concept: string; variante: string };

/**
 * « Normaliser » : les pubs dont le nom ne suit pas la convention, avec pour
 * chacune un nom proposé (semaine + MIX lus dans le nom de l'ad set, semaine
 * du lancement à défaut ; CONCEPT deviné de l'ancien nom ; VARIANTE V1, V2…
 * dans l'ad set). Chaque ligne se valide à part : rien n'est renommé en masse.
 */
function NormalizeDialog({ panel }: { panel: Extract<NamingPanel, { kind: "normalize" }> }) {
  const [rows, setRows] = useState<NormalizeRow[]>(() =>
    panel.adsets.flatMap((adset) => {
      // Les V déjà pris dans l'ad set par des pubs à la convention : on numérote après.
      const taken = adset.ads.map((ad) => parseCreativeName(ad.name)).filter((parsed) => parsed !== null);
      let next = Math.max(0, ...taken.map((parsed) => Number(/^V(\d+)$/.exec(parsed.variante)?.[1] ?? 0)));
      const adsetWeek = namingContextFor(adset.adsetName).week;
      const mix = namingContextFor(adset.adsetName).mix ?? "";
      return adset.ads
        .filter((ad) => !parseCreativeName(ad.name))
        .sort(byLaunch)
        .map((ad) => {
          next += 1;
          const launched = ad.createdTime ? new Date(ad.createdTime) : null;
          const week = adsetWeek ?? (launched && !Number.isNaN(launched.getTime()) ? isoWeek(launched) : null);
          return { adsetId: adset.adsetId, adsetName: adset.adsetName, ad, week: week ? String(week) : "", mix, concept: conceptGuess(ad.name), variante: `V${next}` };
        });
    })
  );
  const [status, setStatus] = useState<Record<string, RowStatus>>({});

  const nameOf = (row: NormalizeRow) => buildCreativeName({ week: Number(row.week) || 0, mix: row.mix, concept: row.concept, variante: row.variante });
  const setField = (id: string, key: "week" | "mix" | "concept" | "variante", value: string) =>
    setRows((current) => current.map((row) => (row.ad.id === id ? { ...row, [key]: value } : row)));
  const left = rows.filter((row) => status[row.ad.id]?.state !== "ok").length;

  async function validate(row: NormalizeRow) {
    const name = nameOf(row);
    if (!name) return;
    setStatus((current) => ({ ...current, [row.ad.id]: { state: "running" } }));
    try {
      await panel.onRename(row.ad.id, name);
      setStatus((current) => ({ ...current, [row.ad.id]: { state: "ok" } }));
    } catch (error) {
      setStatus((current) => ({ ...current, [row.ad.id]: { state: "error", message: error instanceof Error ? error.message : "Meta a refusé le renommage" } }));
    }
  }

  return (
    <PanelFrame
      title="Normaliser les noms des pubs"
      subtitle={
        rows.length
          ? `${left} pub${left > 1 ? "s" : ""} hors convention (S45_MIX1_CONCEPT_VARIANTE) parmi celles affichées. Complète CONCEPT / VARIANTE puis « Valider » ligne par ligne.`
          : "Toutes les pubs affichées suivent déjà la convention."
      }
      onClose={closePanel}
      footer={
        <button type="button" onClick={closePanel} className="h-10 rounded-xl px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          Fermer
        </button>
      }
    >
      <div className="space-y-3">
        {[...new Set(rows.map((row) => row.adsetId))].map((adsetId) => {
          const group = rows.filter((row) => row.adsetId === adsetId);
          return (
            <section key={adsetId}>
              <p className="mb-1 truncate text-[11px] font-semibold text-slate-500" title={group[0].adsetName}>
                {group[0].adsetName}
              </p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                {group.map((row) => {
                  const name = nameOf(row);
                  const state = status[row.ad.id];
                  const done = state?.state === "ok";
                  return (
                    <li key={row.ad.id} className={cn("space-y-1.5 px-2.5 py-2", done && "opacity-60")}>
                      <p className="truncate text-[11px] text-slate-400" title={row.ad.name}>
                        {row.ad.name}
                      </p>
                      <div className="grid grid-cols-[48px_76px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
                        <input
                          inputMode="numeric"
                          value={row.week}
                          disabled={done}
                          aria-label="Semaine"
                          placeholder="S"
                          onChange={(event) => setField(row.ad.id, "week", event.target.value.replace(/\D/g, "").slice(0, 2))}
                          className={SMALL_FIELD}
                        />
                        <MixSelect value={row.mix} onChange={(next) => setField(row.ad.id, "mix", next)} className={SMALL_FIELD} />
                        <input value={row.concept} disabled={done} aria-label="Concept" placeholder="CONCEPT" onChange={(event) => setField(row.ad.id, "concept", event.target.value)} className={cn(SMALL_FIELD, "uppercase")} />
                        <input value={row.variante} disabled={done} aria-label="Variante" placeholder="V1" onChange={(event) => setField(row.ad.id, "variante", event.target.value)} className={cn(SMALL_FIELD, "uppercase")} />
                        <button
                          type="button"
                          disabled={!name || done || state?.state === "running"}
                          onClick={() => void validate(row)}
                          className="h-8 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                        >
                          {done ? "Fait" : "Valider"}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("min-w-0 flex-1 truncate font-mono text-[11px]", name ? "text-slate-700 dark:text-slate-200" : "text-slate-400")}>
                          {name || "Complète le CONCEPT (et le MIX s'il manque)"}
                        </span>
                        <StatusMark status={state} />
                      </div>
                      {state?.state === "error" ? <p className="text-[11px] text-rose-600">{state.message}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </PanelFrame>
  );
}
