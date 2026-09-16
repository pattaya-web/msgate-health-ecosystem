"use client";

import { useMemo, useState } from "react";
import { Loader2, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { panel } from "@/components/mass-test/engine-client";
import type { CompetitorAnalysis, CompetitorCreative, CompetitorInspiration, CompetitorResearch, CreativeAnalysis, StaticAdSort } from "@/lib/brandsearch/types";
import { cn } from "@/lib/utils";

/**
 * La galerie des créas statiques d'un concurrent (Brand Search) : l'opérateur
 * choisit ce qu'il veut, Hermes regarde la sélection (ADN, motifs récurrents,
 * recommandations sans imposer), et la sélection analysée devient
 * l'inspiration de l'Auto-brief. Rien n'est généré ici.
 */

const SORTS: Array<{ id: StaticAdSort; label: string }> = [
  { id: "spend", label: "Dépense UE" },
  { id: "reach", label: "Portée UE" },
  { id: "rank", label: "Rang de portée" },
  { id: "active", label: "Jours actifs" },
  { id: "recent", label: "Plus récentes" },
  { id: "scaler", label: "Score scaler" },
];

/** Hermes regarde environ 40 s par image, par lots de 4 en parallèle : au-delà de 12, la sélection se fait en plusieurs fois. */
const MAX_ANALYZED = 12;
const PER_CHUNK = 4;
// Mesuré : 4 images ≈ 170 s, 8 images en deux lots parallèles + regroupement ≈ 310 s.
const estimateMinutes = (count: number) => Math.max(1, Math.round((Math.min(count, PER_CHUNK) * 50 + (count > PER_CHUNK ? 110 : 0)) / 60));

const euro = (value: number | null) => (value === null ? "—" : `€${Math.round(value).toLocaleString("fr-FR")}`);
const int = (value: number | null) => (value === null ? "—" : Math.round(value).toLocaleString("fr-FR"));
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" }) : "—");

function signalValue(creative: CompetitorCreative, sort: StaticAdSort): number {
  const s = creative.signals;
  switch (sort) {
    case "reach":
      return s.euTotalReach ?? -1;
    case "rank":
      return s.reachRank === null ? Number.MAX_SAFE_INTEGER : s.reachRank;
    case "active":
      return s.activeDays ?? -1;
    case "recent":
      return creative.startDate ? new Date(creative.startDate).getTime() : -1;
    default:
      return s.euTotalSpend ?? -1;
  }
}

export function toInspiration(analysis: CompetitorAnalysis, research: CompetitorResearch, ids: string[]): CompetitorInspiration {
  const byId = new Map(research.creatives.map((creative) => [creative.id, creative]));
  const creatives = analysis.creatives
    .filter((creative) => ids.includes(creative.id))
    .map((creative) => ({ id: creative.id, archetype: creative.archetype, angle: creative.angle, hookMechanism: creative.hookMechanism, layout: creative.layout, elements: creative.elements, proof: creative.proof, competitorFacts: creative.competitorFacts, headline: byId.get(creative.id)?.headline ?? null }));
  const patterns = analysis.patterns.map((pattern) => ({ ...pattern, adIds: pattern.adIds.filter((id) => ids.includes(id)) })).filter((pattern) => pattern.adIds.length);
  return { domain: analysis.domain, patterns, creatives };
}

export function CompetitorResearchPanel({ productId, productName, onUse, active }: { productId: string | null; productName: string | null; onUse: (inspiration: CompetitorInspiration) => void; active: { domain: string; ads: number } | null }) {
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<"active" | "all">("active");
  const [sort, setSort] = useState<StaticAdSort>("spend");
  const [loading, setLoading] = useState(false);
  const [research, setResearch] = useState<CompetitorResearch | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [minSpend, setMinSpend] = useState(0);
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [viewSort, setViewSort] = useState<StaticAdSort>("spend");
  const [zoom, setZoom] = useState<CompetitorCreative | null>(null);
  const [analysis, setAnalysis] = useState<CompetitorAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);

  const analysed = useMemo(() => new Map((analysis?.creatives ?? []).map((creative) => [creative.id, creative] as [string, CreativeAnalysis])), [analysis]);
  const recommended = useMemo(() => new Map((analysis?.recommended ?? []).map((entry) => [entry.id, entry.why])), [analysis]);
  const visible = useMemo(() => {
    const list = (research?.creatives ?? []).filter((creative) => (statusFilter === "all" || creative.status === statusFilter) && (creative.signals.euTotalSpend ?? 0) >= minSpend && (!onlyRecommended || recommended.has(creative.id)));
    return [...list].sort((a, b) => (viewSort === "rank" ? signalValue(a, viewSort) - signalValue(b, viewSort) : signalValue(b, viewSort) - signalValue(a, viewSort)));
  }, [research, statusFilter, minSpend, onlyRecommended, recommended, viewSort]);
  const selectedList = useMemo(() => (research?.creatives ?? []).filter((creative) => selected.has(creative.id)), [research, selected]);
  const unanalysedSelected = selectedList.filter((creative) => !analysed.has(creative.id));

  async function search() {
    const clean = domain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "");
    if (!clean) return toast.error("Indique le domaine du concurrent, ex. myhemios.com");
    setLoading(true);
    setAnalysis(null);
    setSelected(new Set());
    setVisionError(null);
    try {
      const params = new URLSearchParams({ action: "static-ads", domain: clean, limit: String(limit), status, sort });
      const res = await fetch(`/api/brandsearch?${params}`, { cache: "no-store" });
      const data = (await res.json()) as CompetitorResearch & { error?: string };
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setResearch(data);
      setViewSort(sort);
      toast.success(`${data.creatives.length} créa${data.creatives.length > 1 ? "s" : ""} statique${data.creatives.length > 1 ? "s" : ""} de ${data.competitor.domain}${data.total ? ` (sur ${data.total})` : ""}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Brand Search injoignable");
    } finally {
      setLoading(false);
    }
  }

  /** Hermes regarde les pubs cochées ; rend l'analyse (et la garde pour « Utiliser »). */
  async function analyze(list: CompetitorCreative[]): Promise<CompetitorAnalysis | null> {
    if (!research || !list.length) return null;
    if (list.length > MAX_ANALYZED) {
      toast.error(`${MAX_ANALYZED} pubs maximum par analyse : désélectionne-en ${list.length - MAX_ANALYZED}`);
      return null;
    }
    setAnalyzing(true);
    setVisionError(null);
    try {
      const res = await fetch("/api/brandsearch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "analyze-creatives", domain: research.competitor.domain, creatives: list, productId }) });
      const data = (await res.json()) as { analysis?: CompetitorAnalysis; error?: string; visionUnavailable?: boolean };
      if (!res.ok || !data.analysis) {
        if (data.visionUnavailable) setVisionError(data.error || "Hermes current model does not support vision.");
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      // Les analyses précédentes restent ; les nouvelles s'ajoutent ou remplacent.
      setAnalysis((current) => {
        if (!current) return data.analysis as CompetitorAnalysis;
        const fresh = data.analysis as CompetitorAnalysis;
        const ids = new Set(fresh.creatives.map((creative) => creative.id));
        return { ...fresh, creatives: [...current.creatives.filter((creative) => !ids.has(creative.id)), ...fresh.creatives], patterns: fresh.patterns.length ? fresh.patterns : current.patterns, recommended: fresh.recommended.length ? fresh.recommended : current.recommended };
      });
      toast.success(`${data.analysis.creatives.length} pub${data.analysis.creatives.length > 1 ? "s" : ""} analysée${data.analysis.creatives.length > 1 ? "s" : ""} par Hermes · ${data.analysis.patterns.length} motif${data.analysis.patterns.length > 1 ? "s" : ""}`);
      return data.analysis;
    } catch (error) {
      if (!(error instanceof Error && visionError)) toast.error(error instanceof Error ? error.message : "Analyse impossible");
      return null;
    } finally {
      setAnalyzing(false);
    }
  }

  async function applySelection() {
    if (!research || !selectedList.length) return;
    let current = analysis;
    if (unanalysedSelected.length || !current) {
      const fresh = await analyze(selectedList);
      if (!fresh) return;
      current = { ...fresh, creatives: [...(analysis?.creatives.filter((creative) => !fresh.creatives.some((entry) => entry.id === creative.id)) ?? []), ...fresh.creatives] };
    }
    const inspiration = toInspiration(current, research, [...selected]);
    if (!inspiration.creatives.length) return toast.error("Aucune pub analysée dans la sélection");
    onUse(inspiration);
    toast.success(`${inspiration.creatives.length} pub${inspiration.creatives.length > 1 ? "s" : ""} de ${inspiration.domain} en inspiration : écris ton brief, Hermes adapte les motifs à ton produit`);
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className={panel} data-competitor-research>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400" data-competitor-toggle>
          Concurrents · Brand Search {open ? "▾" : "▸"}
        </button>
        {active ? (
          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800" data-competitor-active>
            Inspiration : {active.domain} · {active.ads} pub{active.ads > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={domain} onChange={(event) => setDomain(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="Domaine du concurrent, ex. myhemios.com" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950" data-competitor-domain />
            </div>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wide">Pubs</span>
              <select value={limit} onChange={(event) => setLimit(Number(event.target.value))} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800">
                {[10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wide">Statut</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as "active" | "all")} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800">
                <option value="active">actives</option>
                <option value="all">toutes</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wide">Tri</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as StaticAdSort)} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800">
                {SORTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void search()} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900" data-competitor-search>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Chercher les statics
            </button>
          </div>
          <p className="text-[10.5px] text-slate-400">Un crédit Brand Search par pub renvoyée. Les images expirent 3 jours après la recherche. Signaux disponibles : dépense et portée UE estimées, rang de portée, jours actifs, doublons — pas de ROAS ni de revenu.</p>

          {research ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 p-2 text-[11.5px] dark:bg-slate-800/60" data-competitor-summary>
                <span><span className="text-slate-500">Concurrent :</span> <span className="font-medium text-slate-900 dark:text-slate-100">{research.competitor.domain}</span>{research.competitor.niche ? <span className="text-slate-500"> · {research.competitor.niche}</span> : null}{research.competitor.metaActiveCount !== null ? <span className="text-slate-500"> · {int(research.competitor.metaActiveCount)} pubs Meta actives</span> : null}</span>
                <span><span className="text-slate-500">Statics trouvées :</span> {research.creatives.length}{research.total ? ` / ${int(research.total)}` : ""}</span>
                <span><span className="text-slate-500">Sélection :</span> {selected.size}</span>
                <span><span className="text-slate-500">Analysées :</span> {analysed.size}</span>
                <span><span className="text-slate-500">Motifs récurrents :</span> {analysis?.patterns.length ?? 0}</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                <button type="button" onClick={() => setSelected(new Set(visible.map((creative) => creative.id)))} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300" data-competitor-select-all>Tout sélectionner</button>
                <button type="button" onClick={() => setSelected(new Set())} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300" data-competitor-select-none>Tout désélectionner</button>
                <label className="flex items-center gap-1 text-slate-500">
                  Statut
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")} className="rounded-lg bg-slate-100 px-2 py-0.5 dark:bg-slate-800" data-competitor-filter-status>
                    <option value="all">tous</option>
                    <option value="active">actives</option>
                    <option value="inactive">inactives</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  Dépense UE min
                  <input type="number" min={0} step={100} value={minSpend} onChange={(event) => setMinSpend(Math.max(0, Number(event.target.value) || 0))} className="w-20 rounded-lg bg-slate-100 px-2 py-0.5 dark:bg-slate-800" data-competitor-filter-spend />
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  Trier par
                  <select value={viewSort} onChange={(event) => setViewSort(event.target.value as StaticAdSort)} className="rounded-lg bg-slate-100 px-2 py-0.5 dark:bg-slate-800" data-competitor-view-sort>
                    {SORTS.filter((entry) => entry.id !== "scaler").map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </select>
                </label>
                {analysis?.recommended.length ? (
                  <label className="flex items-center gap-1 text-slate-500">
                    <input type="checkbox" checked={onlyRecommended} onChange={(event) => setOnlyRecommended(event.target.checked)} /> Recommandées par Hermes seulement
                  </label>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-competitor-gallery>
                {visible.map((creative) => {
                  const picked = selected.has(creative.id);
                  const info = analysed.get(creative.id);
                  const why = recommended.get(creative.id);
                  return (
                    <article key={creative.id} className={cn("overflow-hidden rounded-xl bg-white ring-1 dark:bg-slate-900", picked ? "ring-2 ring-emerald-500" : "ring-slate-900/[0.06]")} data-competitor-card={creative.id} data-selected={picked ? "true" : "false"}>
                      <div className="relative aspect-[4/5] bg-slate-100 dark:bg-slate-800">
                        <button type="button" onClick={() => setZoom(creative)} className="block h-full w-full" title="Voir en grand" data-competitor-open>
                          {creative.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={creative.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[11px] text-slate-400">pas d&apos;image</div>
                          )}
                        </button>
                        <label className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-white/90 shadow dark:bg-slate-900/90">
                          <input type="checkbox" checked={picked} onChange={() => toggle(creative.id)} aria-label={`Sélectionner la pub ${creative.id}`} />
                        </label>
                        {why ? <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-md bg-amber-400/95 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950 shadow" title={why} data-competitor-recommended><Star className="h-3 w-3" /> Recommandée</span> : null}
                        {info?.archetype ? <span className="absolute inset-x-1.5 bottom-1.5 truncate rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-medium text-white" title={`${info.archetype} — ${info.angle}`} data-competitor-archetype>{info.archetype}</span> : null}
                      </div>
                      <div className="space-y-0.5 px-2 py-1.5 text-[10px] text-slate-500">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-medium text-slate-700 dark:text-slate-200">{creative.domain}</span>
                          <span className={cn("shrink-0 rounded px-1 text-[9px] font-semibold uppercase", creative.status === "active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}>{creative.status}</span>
                        </div>
                        <div className="truncate" title={creative.id}>ad {creative.adId ?? creative.id}</div>
                        <div>{day(creative.startDate)} → {day(creative.endDate)}{creative.signals.activeDays !== null ? ` · ${creative.signals.activeDays} j` : ""}</div>
                        <div className="truncate" title="Dépense UE estimée · dépense/jour · portée UE · rang · doublons">
                          {euro(creative.signals.euTotalSpend)} · {euro(creative.signals.euDailySpend)}/j · portée {int(creative.signals.euTotalReach)} · rang {creative.signals.reachRank ?? "—"} · ×{creative.signals.duplicateCount ?? "—"}
                        </div>
                        {creative.headline ? <div className="truncate text-slate-700 dark:text-slate-300" title={creative.headline}>{creative.headline}</div> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!visible.length ? <p className="text-[12px] text-slate-500">Aucune pub ne passe ces filtres.</p> : null}

              {visionError ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-[11.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-competitor-vision-warning>
                  <div className="font-semibold">Hermes current model does not support vision.</div>
                  {visionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {analyzing ? <span className="text-[11px] text-slate-500" data-competitor-progress>Hermes regarde {selectedList.length} pub{selectedList.length > 1 ? "s" : ""} par lots de {PER_CHUNK} en parallèle, puis dégage les motifs · environ {estimateMinutes(selectedList.length)} min…</span> : selected.size > MAX_ANALYZED ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{MAX_ANALYZED} pubs max par analyse</span> : null}
                <button type="button" disabled={!selected.size || analyzing} onClick={() => void analyze(selectedList)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" data-competitor-analyze>
                  {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Analyser la sélection ({selected.size})
                </button>
                <button type="button" disabled={!selected.size || analyzing} onClick={() => void applySelection()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900" data-competitor-use>
                  {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Utiliser la sélection comme inspiration ({selected.size})
                </button>
              </div>
              <p className="text-[10.5px] text-slate-400">« Analyser » : Hermes regarde les pubs cochées et décrit leur ADN, les motifs récurrents et ce qu&apos;il recommande. « Utiliser » : seules les pubs cochées (analysées d&apos;abord si besoin) deviennent l&apos;inspiration de l&apos;Auto-brief{productName ? `, adaptées à ${productName}` : ""}. Aucune image n&apos;est générée ici.</p>

              {analysis ? (
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60" data-competitor-patterns={analysis.patterns.length}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Motifs récurrents · {analysis.domain} · {analysis.creatives.length} pub{analysis.creatives.length > 1 ? "s" : ""} regardée{analysis.creatives.length > 1 ? "s" : ""} par Hermes</div>
                  <ol className="mt-1 space-y-1 text-[11.5px]">
                    {analysis.patterns.map((pattern, index) => (
                      <li key={pattern.name}>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{String.fromCharCode(65 + index)}. {pattern.name}</span> <span className="text-slate-600 dark:text-slate-300">— {pattern.description}</span>{pattern.mechanism ? <span className="text-slate-500"> Mécanisme : {pattern.mechanism}</span> : null} <span className="text-slate-400">({pattern.adIds.length})</span>
                      </li>
                    ))}
                  </ol>
                  {analysis.recommended.length ? <p className="mt-1.5 text-[11px] text-slate-500"><Star className="mr-1 inline h-3 w-3 text-amber-500" />Hermes recommande : {analysis.recommended.map((entry) => `${entry.id} (${entry.why})`).join(" · ")}. La sélection reste la tienne.</p> : null}
                  <p className="mt-1 text-[10.5px] text-slate-400">{analysis.signalsNote}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {zoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={() => setZoom(null)} data-competitor-zoom>
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 md:flex-row" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {zoom.imageOriginalUrl || zoom.imageUrl ? <img src={zoom.imageOriginalUrl ?? zoom.imageUrl ?? ""} alt="" className="max-h-[85vh] w-auto max-w-full object-contain" /> : null}
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 overflow-y-auto p-4 text-[12px] md:w-[320px]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{zoom.domain} · ad {zoom.adId ?? zoom.id}</div>
                  <div className="text-[11px] text-slate-500">{zoom.status} · {day(zoom.startDate)} → {day(zoom.endDate)}{zoom.signals.activeDays !== null ? ` · ${zoom.signals.activeDays} jours` : ""}</div>
                </div>
                <button type="button" onClick={() => setZoom(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer"><X className="h-4 w-4" /></button>
              </div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                <dt className="text-slate-500">Dépense UE</dt><dd>{euro(zoom.signals.euTotalSpend)} ({euro(zoom.signals.euDailySpend)}/jour)</dd>
                <dt className="text-slate-500">Portée UE</dt><dd>{int(zoom.signals.euTotalReach)}</dd>
                <dt className="text-slate-500">Rang de portée</dt><dd>{zoom.signals.reachRank ?? "—"}</dd>
                <dt className="text-slate-500">Doublons</dt><dd>{zoom.signals.duplicateCount ?? "—"}</dd>
                <dt className="text-slate-500">Funnel · langue</dt><dd>{zoom.signals.funnelType ?? "—"} · {zoom.signals.language ?? "—"}</dd>
                <dt className="text-slate-500">Plateformes</dt><dd>{zoom.signals.platforms.join(", ") || "—"}</dd>
                <dt className="text-slate-500">Page d&apos;atterrissage</dt><dd className="text-slate-400">non fournie par Brand Search</dd>
              </dl>
              {zoom.headline ? <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Titre</div><p className="text-slate-700 dark:text-slate-300">{zoom.headline}</p></div> : null}
              {zoom.primaryText ? <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Texte principal</div><p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-400">{zoom.primaryText}</p></div> : null}
              {zoom.cta?.text ? <div className="text-[11px] text-slate-500">CTA : {zoom.cta.text}</div> : null}
              {analysed.get(zoom.id) ? (
                <div className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lu par Hermes</div>
                  <div><span className="font-medium">{analysed.get(zoom.id)?.archetype}</span> — {analysed.get(zoom.id)?.angle}</div>
                  <div className="text-slate-500">Mécanisme : {analysed.get(zoom.id)?.hookMechanism}</div>
                  <div className="text-slate-500">Éléments : {analysed.get(zoom.id)?.elements.join(", ")}</div>
                  {analysed.get(zoom.id)?.competitorFacts.length ? <div className="text-amber-700 dark:text-amber-300">À ne pas reprendre : {analysed.get(zoom.id)?.competitorFacts.join(" · ")}</div> : null}
                </div>
              ) : null}
              <div className="mt-auto flex items-center gap-2">
                <button type="button" onClick={() => toggle(zoom.id)} className={cn("inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold", selected.has(zoom.id) ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200")}>
                  {selected.has(zoom.id) ? "Sélectionnée" : "Sélectionner"}
                </button>
                {zoom.dashboardUrl ? <a href={zoom.dashboardUrl} target="_blank" rel="noreferrer" className="text-[11px] text-slate-500 hover:underline">Ouvrir dans Brand Search</a> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
