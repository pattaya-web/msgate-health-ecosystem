"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckSquare, ChevronDown, Layers, Loader2, Settings2, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BriefBoard } from "@/components/ads/brief-board";
import type { CreativeRow, Margin, PipelineReport, Placement, Todo, Trend, WeeklyItem, WeeklyKind, WindowDays } from "@/lib/creative-pipeline/build";
import type { CreativeStatus, Thresholds } from "@/lib/creative-pipeline/store";
import { parseCreativeName, type ParsedCreativeName } from "@/lib/creative-naming";

/**
 * Le « Pipeline créa » de l'Ads Manager, sous la rampe de scaling : l'outil de
 * décision hebdo (7 j) et quotidien (3 j) du framework TEST → MAIN → BidCap /
 * CostCap. Les 5 KPI de la semaine, le rappel du jour, la liste « À faire
 * cette semaine » (vue 7 j, cases à cocher notées au journal), chaque créa
 * active avec sa date de lancement, sa marge nette et un seul verdict (Couper
 * / Valider → MAIN derrière un bouton avec confirmation), les briefs en
 * Kanban, les archivées, le journal et les Réglages (seuils). Les calculs sont
 * faits par le serveur (src/lib/creative-pipeline).
 */

type Tab = "creas" | "groupes" | "briefs" | "archives" | "journal";
const OPEN_KEY = "msgate-pipeline-open";

/* Couleurs en dur : le thème admin repeint le vert en bleu. */
const GREEN = "#15803d";
const ORANGE = "#b45309";
const RED = "#e11d48";
const BLUE = "#4f46e5";
const TEAL = "#0e7490";
const BADGE_STYLE: Record<Margin["badge"], { color: string; background: string }> = {
  BEST: { color: "#14532d", background: "rgba(21,128,61,0.16)" },
  BONNE: { color: GREEN, background: "rgba(22,163,74,0.1)" },
  CUT: { color: RED, background: "rgba(225,29,72,0.1)" },
  DATA: { color: "#64748b", background: "rgba(100,116,139,0.1)" },
};
const STATUS_COLOR: Record<CreativeStatus, string> = { BRIEF: "#64748b", "EN PROD": "#64748b", "PRÊTE": "#64748b", TEST: BLUE, MAIN: GREEN, SCALING: "#65a30d", BIDCAP: "#7c3aed", COSTCAP: TEAL, OFF: "#94a3b8" };
const TODO_COLOR: Record<Todo, string> = {
  Couper: RED,
  "Couper dans TEST": RED,
  "Valider → MAIN": GREEN,
  "Candidate BidCap": "#7c3aed",
  "Candidate CostCap": TEAL,
  Attendre: ORANGE,
  Surveiller: ORANGE,
  "Tenir dans MAIN": GREEN,
  Laisser: "#475569",
  "—": "#94a3b8",
};
const WINDOW_LABEL: Record<WindowDays, string> = { 3: "3 j · quotidien", 7: "7 j · hebdo", 14: "14 j" };
const WINDOW_HELP: Partial<Record<WindowDays, string>> = {
  7: "Lecture de fin de semaine. Décide qui passe en MAIN, qui se coupe, qui candidate BidCap / CostCap.",
  3: "Lecture du matin. Décide les coupes d'urgence et les surveillances. Jamais de passage en MAIN sur 3 j.",
};
const WEEKLY_TITLE: Record<WeeklyKind, string> = {
  cut: "Couper",
  validate: "Valider → MAIN",
  cutTest: "Couper dans TEST (déjà en MAIN et elle y dépense)",
  candidate: "Candidates BidCap / CostCap",
  watch: "Surveiller",
  brief: "Brief du jeudi",
};
const THRESHOLD_FIELDS: Array<[keyof Thresholds, string]> = [
  ["cutMargin", "Marge 7 j CUT, sous (%)"],
  ["bestMargin", "Marge 7 j BEST, dès (%)"],
  ["minSales", "Ventes 7 j pour un verdict"],
  ["mainSales", "Ventes 7 j pour la MAIN (avant J7, ou BONNE)"],
  ["bidcapSales", "Ventes 7 j pour le BidCap"],
  ["testCutSpend", "Dépense en MAIN sur 3 j pour couper la copie TEST ($)"],
  ["trendPts", "Tendance 3 j / 7 j (points)"],
  ["rescueRoas", "ROAS 3 j de sauvetage"],
  ["testSales", "Ad set TEST : ventes 3 j pour monter"],
  ["testRise", "Ad set TEST : hausse (%)"],
  ["testWait", "Ad set TEST : attente entre deux changements (h)"],
  ["testCap", "Ad set TEST : plafond (× budget de départ)"],
  ["surfRise", "Surf : hausse du jour (%)"],
  ["surfRoas", "Surf : ROAS du jour minimum"],
  ["surfSales", "Surf : ventes du jour minimum"],
  ["surfHour", "Surf : avant (heure du compte)"],
];

const usd = (value: number | null | undefined, digits = 0) =>
  value == null ? "—" : `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;
const num = (value: number | null | undefined, digits = 2) => (value == null ? "—" : value.toFixed(digits).replace(".", ","));
/** L'heure de Paris, avec l'équivalent à Dubaï. */
const when = (value: string) => {
  const date = new Date(value);
  const paris = date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const dubai = date.toLocaleTimeString("fr-FR", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" });
  return `${paris} (Dubaï ${dubai})`;
};
const dayLabel = (value: string) => new Date(value).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });
const TREND_COLOR = (trend: Trend) => (trend === "↑" ? GREEN : trend === "↓" ? RED : "#64748b");

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Le nom à la convention d'une créa (calculé par le serveur ; relu ici si la réponse vient d'une version sans ce champ). */
const namingOf = (row: CreativeRow): ParsedCreativeName | null => row.naming ?? parseCreativeName(row.name);

type NamingFilter = { week: string; mix: string; concept: string; variante: string };
const NO_FILTER: NamingFilter = { week: "", mix: "", concept: "", variante: "" };
/** Valeur de filtre pour « hors convention ». */
const NONE = "—";

function namingValue(naming: ParsedCreativeName | null, key: keyof NamingFilter) {
  if (!naming) return NONE;
  return key === "week" ? `S${String(naming.week).padStart(2, "0")}` : naming[key];
}

/**
 * Les créas dans l'ordre du tri, chaque itération (_IT2, _IT3, ou doublon _2)
 * rangée sous sa créa d'origine : même MIX_CONCEPT_VARIANTE (`base`, sans la
 * semaine). L'origine = celle sans _IT (ni doublon), sinon la semaine la plus
 * ancienne. Les noms hors convention restent seuls.
 */
function groupIterations(rows: CreativeRow[]) {
  const byBase = new Map<string, CreativeRow[]>();
  for (const row of rows) {
    const naming = namingOf(row);
    if (!naming) continue;
    byBase.set(naming.base, [...(byBase.get(naming.base) ?? []), row]);
  }
  const rank = (row: CreativeRow) => {
    const naming = namingOf(row)!;
    return [naming.iteration ? 1 : 0, naming.dup ? 1 : 0, naming.week, naming.iteration ?? 1, naming.dup ?? 1];
  };
  const compare = (a: CreativeRow, b: CreativeRow) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.launchedAt.localeCompare(b.launchedAt);
  };
  const out: Array<{ row: CreativeRow; children: CreativeRow[] }> = [];
  for (const row of rows) {
    const naming = namingOf(row);
    const family = naming ? byBase.get(naming.base) ?? [row] : [row];
    if (family.length < 2) {
      out.push({ row, children: [] });
      continue;
    }
    const [origin, ...children] = [...family].sort(compare);
    // La famille prend la place de son origine dans le tri ; ses itérations la suivent.
    if (origin.key === row.key) out.push({ row, children });
  }
  return out;
}

export function CreativePipeline() {
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("creas");
  const [windowDays, setWindowDays] = useState<WindowDays>(7);
  const [data, setData] = useState<PipelineReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: "margin" | "pct" | "spend" | "sales"; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [promote, setPromote] = useState<{ row: CreativeRow; place: Placement } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [namingFilter, setNamingFilter] = useState<NamingFilter>(NO_FILTER);
  /** Les familles d'itérations repliées (clé de la créa d'origine). */
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = setTimeout(() => {
      setOpen(readOpen());
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const load = useCallback(async (days: WindowDays, refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/creative-pipeline?window=${days}${refresh ? "&refresh=1" : ""}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Pipeline indisponible");
      setData(body as PipelineReport);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !open) return;
    const timer = setTimeout(() => void load(windowDays), 0);
    return () => clearTimeout(timer);
  }, [ready, open, windowDays, load]);

  async function pipelinePost(payload: Record<string, unknown>) {
    const res = await fetch("/api/creative-pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Action impossible");
    return body;
  }

  async function cut(row: CreativeRow, place: Placement) {
    if (!place.liveAdIds.length) return;
    if (!window.confirm(`Couper « ${row.name} » dans « ${place.adsetName} » ? ${place.liveAdIds.length > 1 ? `Ses ${place.liveAdIds.length} pubs passent` : "La pub passe"} en pause chez Meta.\n\n${place.label}\n${place.why}`)) return;
    setBusy(`${row.key}|${place.adsetId}`);
    try {
      for (const id of place.liveAdIds) {
        const res = await fetch("/api/meta/entity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, level: "ad", status: "PAUSED", source: "pipeline", reason: `Pipeline : ${place.label}` }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Meta a refusé la pause");
      }
      await pipelinePost({ action: "log", what: `${place.todo} « ${row.name} » dans « ${place.adsetName} » · ${place.label}` });
      toast.success(`${row.name} coupée dans ${place.adsetName}`);
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Coupe impossible");
    } finally {
      setBusy(null);
    }
  }

  async function doPromote(row: CreativeRow, adsetId: string) {
    const target = data?.targets.find((item) => item.adsetId === adsetId);
    if (!target || !row.postId) return;
    if (!window.confirm(`Valider « ${row.name} » : son post ID ${row.postId} part dans « ${target.adsetName} » (${target.campaignName}) ?`)) return;
    setBusy(`${row.key}|promote`);
    try {
      const res = await fetch("/api/meta/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: row.accountId,
          sourceCampaignId: target.campaignId,
          sourceAdsetId: target.adsetId,
          createNewCampaign: false,
          createNewAdset: false,
          adsetPerUpload: false,
          autoDivide: null,
          adNamePattern: "{file}",
          headlines: [],
          bodies: [],
          descriptions: [],
          websiteUrl: "",
          displayUrl: "",
          cta: "",
          flexible: false,
          paused: false,
          aiGenerated: false,
          enhancements: {},
          media: [{ kind: "post", postId: row.postId, fileName: row.name }],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Meta a refusé la pub");
      await pipelinePost({ action: "log", what: `Valider → MAIN « ${row.name} » dans « ${target.adsetName} » (post ID)` });
      toast.success(`${row.name} ajoutée dans ${target.adsetName}`);
      setPromote(null);
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Passage en MAIN impossible");
    } finally {
      setBusy(null);
    }
  }

  /** Une créa coupée : archiver chez Meta toutes ses pubs, pour nettoyer les campagnes. */
  async function archive(row: CreativeRow) {
    const ids = row.placements.flatMap((place) => place.adIds);
    if (!ids.length) return;
    if (!window.confirm(`Archiver chez Meta « ${row.name} » (${ids.length} pub${ids.length > 1 ? "s" : ""}) ? Elle disparaît des listes ; ses chiffres restent dans Meta.`)) return;
    setBusy(`${row.key}|archive`);
    try {
      for (const id of ids) {
        const res = await fetch("/api/meta/entity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, level: "ad", status: "ARCHIVED", source: "pipeline", reason: "Pipeline : archivée (créa coupée)" }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Meta a refusé l'archivage");
      }
      await pipelinePost({ action: "log", what: `Archiver « ${row.name} » (${ids.length} pub${ids.length > 1 ? "s" : ""})` });
      toast.success(`${row.name} archivée`);
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archivage impossible");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(row: CreativeRow, status: string) {
    try {
      await pipelinePost({ action: "status.set", key: row.key, status: status === "auto" ? null : status });
      toast.success(status === "auto" ? "Statut automatique" : `Statut forcé : ${status}`);
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Statut impossible");
    }
  }

  async function editSetting(kind: "upsellRate" | "factor") {
    if (!data) return;
    const current = kind === "upsellRate" ? `${Math.round(data.assumptions.upsellRate * 100)}` : `${data.windows[windowDays].factor}`;
    const answer = window.prompt(kind === "upsellRate" ? "Taux d'acceptation de l'upsell à 9,99 $ (en %, vide = 10 % par défaut)" : "Facteur réel (commandes ÷ achats Meta), vide = calculé", current);
    if (answer == null) return;
    const value = answer.trim() === "" ? null : Number(answer.replace(",", "."));
    try {
      await pipelinePost({ action: "settings", [kind]: value == null ? null : kind === "upsellRate" ? value / 100 : value });
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Réglage impossible");
    }
  }

  async function saveThresholds(thresholds: Thresholds) {
    try {
      await pipelinePost({ action: "settings", thresholds });
      toast.success("Réglages enregistrés");
      setSettingsOpen(false);
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Réglages impossibles");
    }
  }

  async function check(item: WeeklyItem, checked: boolean) {
    if (!data?.weekly) return;
    setBusy(`check|${item.id}`);
    try {
      await pipelinePost({ action: "check", id: item.id, weekStart: data.weekly.weekStart, checked, label: `${WEEKLY_TITLE[item.kind]} · ${item.title} · ${item.detail}` });
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Case impossible");
    } finally {
      setBusy(null);
    }
  }

  /** La créa et l'emplacement d'une ligne de la liste de la semaine. */
  const findPlace = (item: WeeklyItem) => {
    const row = data?.creatives.find((creative) => creative.key === item.creativeKey);
    const place = row?.placements.find((placement) => placement.adsetId === item.adsetId);
    return row && place ? { row, place } : null;
  };

  const toggleOpen = () =>
    setOpen((current) => {
      try {
        localStorage.setItem(OPEN_KEY, current ? "0" : "1");
      } catch {
        // stockage refusé : sans gravité
      }
      return !current;
    });

  const sorted = data
    ? [...data.creatives].sort((a, b) => {
        const pick = (row: CreativeRow) => {
          const m = row.margins[windowDays];
          return sort.key === "margin" ? m.margin : sort.key === "pct" ? (m.pct ?? -999) : sort.key === "sales" ? m.sales : m.spend;
        };
        return (pick(a) - pick(b)) * sort.dir;
      })
    : [];
  const sortBy = (key: typeof sort.key) => setSort((current) => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : -1 }));
  // Semaine, MIX, Concept, Variante lus dans le nom (S45_MIX1_HEMIOS_NAVY) : filtres, puis itérations rangées sous leur origine.
  const namingOptions = (key: keyof NamingFilter) =>
    [...new Set((data?.creatives ?? []).map((row) => namingValue(namingOf(row), key)))].sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b, "fr", { numeric: true })));
  const filtered = sorted.filter((row) => (Object.keys(namingFilter) as Array<keyof NamingFilter>).every((key) => !namingFilter[key] || namingValue(namingOf(row), key) === namingFilter[key]));
  const families = groupIterations(filtered);
  const filtering = Object.values(namingFilter).some(Boolean);
  /** La fenêtre en rappel (gris) : 3 j en vue 7 j / 14 j, 7 j en vue 3 j. */
  const other: WindowDays = windowDays === 3 ? 7 : 3;

  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={toggleOpen} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-50">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
          <Layers className="h-4 w-4" />
          Pipeline créa
        </button>
        {data && data.kpis.cutActive.length ? (
          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ color: RED, background: "rgba(225,29,72,0.1)" }}>
            {data.kpis.cutActive.length} à couper
          </span>
        ) : null}
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
        {open && data ? (
          <button type="button" onClick={() => setSettingsOpen((current) => !current)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Les seuils des verdicts et de la rampe des ad sets TEST">
            <Settings2 className="h-3.5 w-3.5" />
            Réglages
          </button>
        ) : null}
      </header>

      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-2 dark:border-white/[0.06]">
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}
          {!data && !error ? <p className="py-4 text-center text-[12px] text-slate-500">Calcul du pipeline…</p> : null}
          {data && settingsOpen ? <ThresholdsPanel key={JSON.stringify(data.thresholds)} thresholds={data.thresholds} onSave={(value) => void saveThresholds(value)} onClose={() => setSettingsOpen(false)} /> : null}
          {data ? (
            <>
              <Kpis data={data} />
              {data.reminder ? (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">
                  <p className="font-semibold">{data.reminder.title}</p>
                  {data.reminder.lines.map((line) => (
                    <p key={line} className="text-[11.5px]">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}

              {windowDays === 7 && data.weekly ? (
                <WeeklyBlock
                  data={data}
                  busy={busy}
                  onCheck={(item, checked) => void check(item, checked)}
                  onCut={(item) => {
                    const found = findPlace(item);
                    if (found) void cut(found.row, found.place);
                  }}
                  onValidate={(item) => {
                    const found = findPlace(item);
                    if (found && item.target) void doPromote(found.row, item.target.adsetId);
                  }}
                  onBriefs={() => setTab("briefs")}
                />
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    ["creas", `Créas actives (${data.creatives.length})`],
                    ["groupes", "Par ad set"],
                    ["briefs", `Briefs (${data.briefs.filter((brief) => brief.status !== "UPLOADÉE").length})`],
                    ["archives", `Archivées (${data.archived.length})`],
                    ["journal", "Journal"],
                  ] as Array<[Tab, string]>
                ).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setTab(id)} className={cn("rounded-full px-3 py-1 text-[12px] font-medium", tab === id ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300")}>
                    {label}
                  </button>
                ))}
                <div className="ml-auto inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                  {([3, 7, 14] as WindowDays[]).map((days) => (
                    <button key={days} type="button" onClick={() => setWindowDays(days)} className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", windowDays === days ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50" : "text-slate-500")}>
                      {WINDOW_LABEL[days]}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Marge nette sur {windowDays} jours complets ({data.windows[windowDays].start.slice(8)}/{data.windows[windowDays].start.slice(5, 7)} → {data.windows[windowDays].end.slice(8)}/{data.windows[windowDays].end.slice(5, 7)}) · facteur réel{" "}
                <button type="button" onClick={() => void editSetting("factor")} className="font-semibold underline decoration-dotted" style={{ color: data.windows[windowDays].factorSource === "calculé" ? undefined : ORANGE }} title={`${data.windows[windowDays].orders} commandes ÷ ${data.windows[windowDays].metaPurchases} achats Meta (${data.windows[windowDays].factorSource}). Clique pour le forcer.`}>
                  {num(data.windows[windowDays].factor)}
                </button>{" "}
                · upsell{" "}
                <button type="button" onClick={() => void editSetting("upsellRate")} className="font-semibold underline decoration-dotted" style={{ color: data.assumptions.upsellDefault ? ORANGE : undefined }} title="Taux d'acceptation de l'upsell à 9,99 $. Clique pour le modifier.">
                  {Math.round(data.assumptions.upsellRate * 100)} %{data.assumptions.upsellDefault ? " (par défaut)" : ""}
                </button>{" "}
                · <span style={{ color: data.assumptions.piecesDefault ? ORANGE : undefined }}>{num(data.assumptions.pieces)} pièces / commande</span> soit {usd(data.assumptions.cogsPerOrder, 2)} de colis · frais {Math.round(data.assumptions.feeRate * 100)} %
              </p>
              {data.warnings.map((warning) => (
                <p key={warning} className="text-[11px] text-amber-700">
                  {warning}
                </p>
              ))}

              {tab === "creas" ? (
                <div className="overflow-x-auto">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {(
                      [
                        ["week", "Semaine"],
                        ["mix", "MIX"],
                        ["concept", "Concept"],
                        ["variante", "Variante"],
                      ] as Array<[keyof NamingFilter, string]>
                    ).map(([key, label]) => (
                      <label key={key} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", namingFilter[key] ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                        {label}
                        <select
                          value={namingFilter[key]}
                          onChange={(event) => setNamingFilter((current) => ({ ...current, [key]: event.target.value }))}
                          className="bg-transparent text-[11px] font-semibold outline-none"
                        >
                          <option value="">{key === "week" || key === "variante" ? "Toutes" : "Tous"}</option>
                          {namingOptions(key).map((value) => (
                            <option key={value} value={value}>
                              {value === NONE ? "— hors convention" : value}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    {filtering ? (
                      <button type="button" onClick={() => setNamingFilter(NO_FILTER)} className="rounded-full px-2 py-0.5 text-slate-500 underline decoration-dotted">
                        Effacer ({filtered.length} / {sorted.length})
                      </button>
                    ) : null}
                  </div>
                  <table className="w-full min-w-[1420px] text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="py-1.5 pr-2 font-semibold">Créa</th>
                        <th className="px-2 font-semibold">Semaine</th>
                        <th className="px-2 font-semibold">MIX</th>
                        <th className="px-2 font-semibold">Concept</th>
                        <th className="px-2 font-semibold">Variante</th>
                        <th className="px-2 font-semibold">Lancée le</th>
                        <th className="px-2 font-semibold">Où elle tourne</th>
                        <th className="px-2 font-semibold">Statut</th>
                        <SortTh label={`Marge ${windowDays} j`} active={sort.key === "margin"} onClick={() => sortBy("margin")} />
                        <SortTh label={`Marge ${windowDays} j %`} active={sort.key === "pct"} onClick={() => sortBy("pct")} />
                        <th className="px-2 font-semibold">{other === 3 ? "Marge 3 j %" : "7 j (rappel)"}</th>
                        <SortTh label="Ventes" active={sort.key === "sales"} onClick={() => sortBy("sales")} />
                        <SortTh label="Dépense" active={sort.key === "spend"} onClick={() => sortBy("spend")} />
                        <th className="px-2 font-semibold">ROAS</th>
                        <th className="px-2 font-semibold">À faire</th>
                        <th className="pl-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                      {families.flatMap(({ row, children }) => [row, ...(folded[row.key] ? [] : children)].map((line, index) => (
                        <CreativeLine
                          key={line.key}
                          row={line}
                          days={windowDays}
                          other={other}
                          busy={busy}
                          iteration={index > 0}
                          family={index === 0 && children.length ? { count: children.length, folded: Boolean(folded[row.key]), onToggle: () => setFolded((current) => ({ ...current, [row.key]: !current[row.key] })) } : null}
                          onCut={(place) => void cut(line, place)}
                          onPromote={(place) => setPromote({ row: line, place })}
                          onStatus={(status) => void setStatus(line, status)}
                        />
                      )))}
                    </tbody>
                  </table>
                  {!sorted.length ? <p className="py-4 text-center text-[12px] text-slate-400">Aucune créa active.</p> : null}
                  {sorted.length && !filtered.length ? <p className="py-4 text-center text-[12px] text-slate-400">Aucune créa pour ces filtres.</p> : null}
                  {WINDOW_HELP[windowDays] ? (
                    <p className="mt-2 rounded-lg bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                      <b>{WINDOW_LABEL[windowDays]} :</b> « {WINDOW_HELP[windowDays]} »
                    </p>
                  ) : null}
                </div>
              ) : null}

              {tab === "groupes" ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="py-1.5 pr-2 font-semibold">Campagne / ad set</th>
                        <th className="px-2 font-semibold">Marge {windowDays} j</th>
                        <th className="px-2 font-semibold">%</th>
                        <th className="px-2 font-semibold">Ventes</th>
                        <th className="px-2 font-semibold">Dépense</th>
                        <th className="px-2 font-semibold">ROAS</th>
                        <th className="px-2 font-semibold">Rampe (budget)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                      {data.groups.map((group) => (
                        <tr key={group.id} className={cn("align-top", !group.live && "opacity-50")}>
                          <td className={cn("py-1.5 pr-2", group.level === "adset" ? "pl-4" : "font-semibold")}>
                            {group.name}
                            {!group.live ? <span className="ml-1 text-[10px] text-slate-400">(coupé)</span> : null}
                          </td>
                          <MarginCells margin={group.margin} />
                          <td className="max-w-[300px] px-2 py-1.5">
                            {group.ramp ? (
                              <>
                                <p className="text-[11.5px] font-bold" style={{ color: group.ramp.status === "MONTER" ? GREEN : group.ramp.status === "COUPER" ? RED : group.ramp.status === "REDESCENDRE" ? ORANGE : "#475569" }}>
                                  {group.ramp.label}
                                </p>
                                {group.ramp.reason ? <p className="text-[10.5px] leading-snug text-slate-500">{group.ramp.reason}</p> : null}
                                <p className="text-[10px] text-slate-400">
                                  {group.ramp.budget} €/j{group.ramp.test ? " · ad set TEST" : ""} · {group.ramp.lastRiseAt ? `dernière hausse le ${when(group.ramp.lastRiseAt)}` : "aucune hausse notée"}
                                </p>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === "briefs" ? <BriefBoard briefs={data.briefs} today={data.windows[3].end} onChanged={() => load(windowDays, true)} /> : null}

              {tab === "archives" ? (
                <div className="space-y-1.5">
                  {data.archived.map((row) => (
                    <details key={row.key} className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] dark:bg-slate-800/50">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="font-semibold">{row.name}</span>
                        <span className="text-slate-400">{row.placements.map((place) => place.adsetName).join(", ")}</span>
                        <span className="ml-auto tabular-nums">
                          14 j : {usd(row.margins[14].margin)} ({num(row.margins[14].pct, 1)} %) · {num(row.margins[14].sales, 1)} ventes · {usd(row.margins[14].spendUsd)} dépensés
                        </span>
                        <Badge badge={row.margins[14].badge} />
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={(event) => {
                            event.preventDefault();
                            void archive(row);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
                          title="Archiver chez Meta toutes les pubs de cette créa"
                        >
                          {busy === `${row.key}|archive` ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          Archiver chez Meta
                        </button>
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                        {row.history.length ? row.history.map((change) => (
                          <li key={`${change.at}-${change.to}`}>
                            {when(change.at)} · {change.from ?? "—"} → {change.to} · {change.who}
                            {change.note ? ` · ${change.note}` : ""}
                          </li>
                        )) : <li>Pas d&apos;historique enregistré (coupée avant le pipeline).</li>}
                      </ul>
                    </details>
                  ))}
                  {!data.archived.length ? <p className="py-4 text-center text-[12px] text-slate-400">Aucune créa archivée sur 14 jours.</p> : null}
                </div>
              ) : null}

              {tab === "journal" ? (
                <ul className="divide-y divide-slate-100 text-[11.5px] dark:divide-white/[0.06]">
                  {data.journal.map((line) => (
                    <li key={`${line.at}-${line.what}`} className="flex flex-wrap gap-x-3 py-1">
                      <span className="w-[230px] shrink-0 text-slate-400">{when(line.at)}</span>
                      <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">{line.what}</span>
                      <span className="text-slate-400">{line.who}</span>
                    </li>
                  ))}
                  {!data.journal.length ? <li className="py-4 text-center text-slate-400">Rien pour l&apos;instant.</li> : null}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {promote && data ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4" onClick={() => setPromote(null)}>
          <div className="w-[min(440px,100%)] rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <p className="text-[14px] font-semibold">Valider → MAIN</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              « {promote.row.name} » part telle quelle (même post ID, likes et commentaires gardés) dans l&apos;ad set MAIN de la semaine.
            </p>
            {!promote.row.postId ? <p className="mt-2 text-[12px] text-rose-600">Post ID introuvable pour cette créa.</p> : null}
            <div className="mt-3 space-y-1">
              {data.targets
                .filter((target) => target.accountId === promote.row.accountId && !promote.row.placements.some((place) => place.adsetId === target.adsetId))
                .map((target) => (
                  <button key={target.adsetId} type="button" disabled={busy !== null || !promote.row.postId} onClick={() => void doPromote(promote.row, target.adsetId)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 disabled:opacity-50 dark:border-white/10">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{target.adsetName}</span>
                      <span className="block truncate text-[11px] text-slate-400">{target.campaignName}</span>
                    </span>
                    {busy === `${promote.row.key}|promote` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  </button>
                ))}
              {!data.targets.some((target) => target.accountId === promote.row.accountId) ? (
                <p className="text-[12px] text-slate-500">Aucun ad set {data.weekly?.weekAdset ?? "MAIN de la semaine"} sur ce compte.</p>
              ) : null}
            </div>
            <button type="button" onClick={() => setPromote(null)} className="mt-3 text-[12px] text-slate-500 hover:text-slate-800">
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SortTh({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th className="px-2 font-semibold">
      <button type="button" onClick={onClick} className={cn("uppercase", active && "text-slate-700 dark:text-slate-200")}>
        {label}
        {active ? " ↕" : ""}
      </button>
    </th>
  );
}

function Badge({ badge }: { badge: Margin["badge"] }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={BADGE_STYLE[badge]}>
      {badge}
    </span>
  );
}

function MarginCells({ margin }: { margin: Margin }) {
  return (
    <>
      <td className="px-2 py-1.5 font-semibold tabular-nums" style={{ color: margin.badge === "DATA" ? undefined : margin.margin >= 0 ? GREEN : RED }}>
        {usd(margin.margin)}
      </td>
      <td className="px-2 py-1.5 tabular-nums">
        <span className="mr-1">{num(margin.pct, 1)} %</span>
        <Badge badge={margin.badge} />
      </td>
      <td className="px-2 py-1.5 tabular-nums">{num(margin.sales, 1)}</td>
      <td className="px-2 py-1.5 tabular-nums">{usd(margin.spendUsd)}</td>
      <td className="px-2 py-1.5 tabular-nums">{num(margin.roas)}</td>
    </>
  );
}

const PRODUCT_STYLE = (product: CreativeRow["product"]) => (product === "?" ? { color: ORANGE, fontWeight: 600 } : undefined);

/** Les cellules de marge d'une ligne : la fenêtre principale, puis l'autre en rappel (3 j avec la flèche, ou 7 j en gris). */
function MarginTrio({ margins, days, other, trend, age, small }: { margins: Record<WindowDays, Margin>; days: WindowDays; other: WindowDays; trend: Trend; age: number | null; small?: boolean }) {
  const m = margins[days];
  const o = margins[other];
  const text = small ? "text-[11.5px]" : "";
  const hover = ([3, 7, 14] as WindowDays[]).map((d) => `${d} j : ${usd(margins[d].margin)} (${num(margins[d].pct, 1)} %) · ${num(margins[d].sales, 1)} ventes · ${margins[d].badge}`).join("\n");
  return (
    <>
      <td className={cn("px-2 py-1.5 font-semibold tabular-nums", text)} style={{ color: m.badge === "DATA" ? undefined : m.margin >= 0 ? GREEN : RED }} title={hover}>
        {usd(m.margin)}
      </td>
      <td className={cn("whitespace-nowrap px-2 py-1.5 tabular-nums", text)} title={hover}>
        <span className="mr-1">{num(m.pct, 1)} %</span>
        <Badge badge={m.badge} />
        {age != null && age < days ? <span className="block text-[10px] text-slate-400">{days} j (J{age})</span> : null}
      </td>
      <td className={cn("whitespace-nowrap px-2 py-1.5 tabular-nums", text, other === 7 && "text-slate-400")} title={hover}>
        {other === 3 ? (
          <>
            {num(o.pct, 1)} % <b style={{ color: TREND_COLOR(trend) }}>{trend ?? ""}</b>
          </>
        ) : (
          <>
            {num(o.pct, 1)} % · {o.badge}
          </>
        )}
      </td>
    </>
  );
}

function CreativeLine({
  row,
  days,
  other,
  busy,
  iteration,
  family,
  onCut,
  onPromote,
  onStatus,
}: {
  row: CreativeRow;
  days: WindowDays;
  other: WindowDays;
  busy: string | null;
  /** Itération (_IT2…) rangée sous sa créa d'origine : ligne en retrait. */
  iteration?: boolean;
  /** Sur la créa d'origine : ses itérations, et le bouton pour les replier. */
  family?: { count: number; folded: boolean; onToggle: () => void } | null;
  onCut: (place: Placement) => void;
  onPromote: (place: Placement) => void;
  onStatus: (status: string) => void;
}) {
  const m = row.margins[days];
  const naming = namingOf(row);
  const places = row.placements.filter((place) => place.live);
  const single = places.length <= 1 ? places[0] : null;
  return (
    <>
      <tr className={cn("align-top", iteration && "bg-slate-50/60 dark:bg-slate-800/30")}>
        <td className={cn("max-w-[240px] py-1.5 pr-2", iteration && "pl-6")}>
          <div className="flex items-start gap-2">
            {iteration ? <span className="shrink-0 text-[11px] text-slate-400">↳</span> : null}
            {row.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900 dark:text-slate-50" title={row.name}>
                {row.name}
              </p>
              {family ? (
                <button type="button" onClick={family.onToggle} className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                  {family.folded ? "▸" : "▾"} {family.count} itération{family.count > 1 ? "s" : ""}
                </button>
              ) : null}
              {single ? <OtherNames row={row} place={single} /> : null}
              <p className="truncate text-[10.5px] text-slate-400">
                {single ? single.adsetName : `${places.length} emplacements`} ·{" "}
                <span style={PRODUCT_STYLE(row.product)} title={[row.product === "?" ? "Produit inconnu (URL de la pub) : calculé à 29,99 $" : "", ...row.placements.flatMap((place) => place.links)].filter(Boolean).join(" · ")}>
                  {row.product}
                </span>
              </p>
            </div>
          </div>
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-[11.5px] font-semibold tabular-nums">{naming ? `S${String(naming.week).padStart(2, "0")}` : <span className="font-normal text-slate-300">—</span>}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-[11.5px]">{naming ? naming.mix : <span className="text-slate-300">—</span>}</td>
        <td className="max-w-[120px] truncate px-2 py-1.5 text-[11.5px] font-semibold" title={naming?.concept}>
          {naming ? naming.concept : <span className="font-normal text-slate-300">—</span>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-[11.5px]">
          {naming ? (
            <>
              {naming.variante}
              {naming.iteration ? <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">IT{naming.iteration}</span> : null}
              {naming.dup ? <span className="ml-1 text-[10px] text-slate-400">_{naming.dup}</span> : null}
            </>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-[11.5px]" title={`Création de la pub chez Meta : ${when(row.launchedAt)}`}>
          {dayLabel(row.launchedAt)} <span className="text-slate-400">· J{row.age}</span>
        </td>
        <td className="px-2 py-1.5 text-[11px]">
          <span className="font-semibold" style={{ color: row.where === "ancien SCALING" ? "#65a30d" : row.where === "les deux" ? BLUE : undefined }}>
            {row.where}
          </span>
        </td>
        <td className="px-2 py-1.5">
          <StatusMenu row={row} onStatus={onStatus} />
        </td>
        <MarginTrio margins={row.margins} days={days} other={other} trend={row.trend} age={row.age} />
        <td className="px-2 py-1.5 tabular-nums">{num(m.sales, 1)}</td>
        <td className="px-2 py-1.5 tabular-nums">{usd(m.spendUsd)}</td>
        <td className="px-2 py-1.5 tabular-nums">{num(m.roas)}</td>
        {single ? (
          <PlacementVerdict row={row} place={single} busy={busy} onCut={onCut} onPromote={onPromote} />
        ) : (
          <td colSpan={2} className="px-2 py-1.5 text-[11px] text-slate-400">
            Verdict par emplacement ↓
          </td>
        )}
      </tr>
      {!single
        ? places.map((place) => {
            const pm = place.margins[days];
            return (
              <tr key={place.adsetId} className="align-top bg-slate-50/60 dark:bg-slate-800/30">
                <td className="py-1 pl-11 pr-2 text-[11px]">
                  <p className="truncate text-slate-600 dark:text-slate-300" title={place.campaignName}>
                    ↳ {place.adsetName}
                  </p>
                  <OtherNames row={row} place={place} />
                  <p className="text-[10px] text-slate-400">
                    depuis le {dayLabel(place.createdAt)} ·{" "}
                    <span style={PRODUCT_STYLE(place.product)} title={place.links.join(" · ") || "Pas d'URL de destination lue"}>
                      {place.product}
                    </span>
                  </p>
                </td>
                <td colSpan={4} />
                <td />
                <td className="px-2 py-1 text-[10.5px] font-bold" style={{ color: STATUS_COLOR[place.kind] }}>
                  {place.legacy ? "ancien SCALING" : place.kind}
                </td>
                <td className="px-2 py-1">
                  <span className="text-[10.5px] font-bold" style={{ color: STATUS_COLOR[place.status] }}>
                    {place.status}
                  </span>
                </td>
                <MarginTrio margins={place.margins} days={days} other={other} trend={place.trend} age={null} small />
                <td className="px-2 py-1 text-[11.5px] tabular-nums">{num(pm.sales, 1)}</td>
                <td className="px-2 py-1 text-[11.5px] tabular-nums">{usd(pm.spendUsd)}</td>
                <td className="px-2 py-1 text-[11.5px] tabular-nums">{num(pm.roas)}</td>
                <PlacementVerdict row={row} place={place} busy={busy} onCut={onCut} onPromote={onPromote} />
              </tr>
            );
          })
        : null}
    </>
  );
}

/** Une copie par post ID qui porte un autre nom que la créa : « pub nommée … ». */
function OtherNames({ row, place }: { row: CreativeRow; place: Placement }) {
  const others = place.adNames.filter((name) => name !== row.name);
  if (!others.length) return null;
  return (
    <p className="truncate text-[10px] text-slate-400" title="Même post ID, autre nom de pub dans cet ad set">
      pub nommée « {others.join(" », « ")} »
    </p>
  );
}

/** Le verdict d'un emplacement et son bouton (ou le message qui le remplace). */
function PlacementVerdict({
  row,
  place,
  busy,
  onCut,
  onPromote,
}: {
  row: CreativeRow;
  place: Placement;
  busy: string | null;
  onCut: (place: Placement) => void;
  onPromote: (place: Placement) => void;
}) {
  const working = busy === `${row.key}|${place.adsetId}`;
  return (
    <>
      <td className="max-w-[320px] px-2 py-1.5">
        <p className="text-[12px] font-bold" style={{ color: TODO_COLOR[place.todo] }}>
          {place.label}
        </p>
        {place.note ? (
          <p className="text-[10.5px] leading-snug text-slate-500">
            <span className="mr-1 rounded bg-lime-100 px-1 py-px text-[9.5px] font-bold text-lime-800">ancien ad set</span>
            {place.note.replace(/^ancien ad set SCALING, /, "")}
          </p>
        ) : null}
        {place.blocked ? <p className="text-[10.5px] leading-snug text-slate-600 dark:text-slate-300">→ {place.blocked}</p> : null}
        {place.why ? <p className="text-[10.5px] leading-snug text-slate-500">{place.why}</p> : null}
        {place.warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-1 text-[10.5px] leading-snug text-amber-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {warning}
          </p>
        ))}
      </td>
      <td className="py-1.5 pl-2 text-right">
        {place.blocked ? null : place.todo === "Couper" || place.todo === "Couper dans TEST" ? (
          <ActionButton color={RED} busy={working} disabled={busy !== null} onClick={() => onCut(place)} label={place.todo === "Couper" ? "Couper" : "Couper dans TEST"} />
        ) : place.todo === "Valider → MAIN" ? (
          <ActionButton color={GREEN} busy={false} disabled={busy !== null} onClick={() => onPromote(place)} label="Valider → MAIN" />
        ) : null}
      </td>
    </>
  );
}

/** Un seul badge de statut ; le menu s'ouvre au clic pour le forcer. */
function StatusMenu({ row, onStatus }: { row: CreativeRow; onStatus: (status: string) => void }) {
  const [open, setOpen] = useState(false);
  const choose = (status: string) => {
    setOpen(false);
    onStatus(status);
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] font-bold ring-1 ring-inset"
        style={{ color: STATUS_COLOR[row.status], boxShadow: `inset 0 0 0 1px ${STATUS_COLOR[row.status]}55` }}
        title={row.manual ? `Forcé à la main (automatique : ${row.autoStatus})` : "Statut automatique (d'après l'ad set). Clique pour le forcer."}
      >
        {row.status}
        {row.manual ? " ✎" : ""}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-40 rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-white/10">
          {row.manual ? (
            <button type="button" onClick={() => choose("auto")} className="block w-full px-3 py-1 text-left text-[11.5px] hover:bg-slate-50 dark:hover:bg-slate-800">
              Automatique ({row.autoStatus})
            </button>
          ) : null}
          {(["TEST", "MAIN", "SCALING", "BIDCAP", "COSTCAP", "OFF"] as CreativeStatus[])
            .filter((status) => status !== row.status)
            .map((status) => (
              <button key={status} type="button" onClick={() => choose(status)} className="block w-full px-3 py-1 text-left text-[11.5px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800" style={{ color: STATUS_COLOR[status] }}>
                Forcer en {status}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({ color, busy, disabled, onClick, label }: { color: string; busy: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-50" style={{ background: color }}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {label}
    </button>
  );
}

/** « À faire cette semaine » : généré depuis les verdicts 7 j, une case à cocher par ligne (notée au journal). */
function WeeklyBlock({
  data,
  busy,
  onCheck,
  onCut,
  onValidate,
  onBriefs,
}: {
  data: PipelineReport;
  busy: string | null;
  onCheck: (item: WeeklyItem, checked: boolean) => void;
  onCut: (item: WeeklyItem) => void;
  onValidate: (item: WeeklyItem) => void;
  onBriefs: () => void;
}) {
  const weekly = data.weekly;
  if (!weekly) return null;
  const kinds: WeeklyKind[] = ["cut", "validate", "cutTest", "candidate", "watch", "brief"];
  const done = weekly.items.filter((item) => item.checked).length;
  return (
    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-white/10">
      <p className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 px-3 py-1.5 text-[12.5px] font-semibold dark:border-white/[0.06]">
        À faire cette semaine ({weekly.week})
        <span className="text-[11px] font-normal text-slate-500">
          {done} / {weekly.items.length} fait{done > 1 ? "s" : ""} · généré depuis les verdicts 7 j
        </span>
      </p>
      <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
        {kinds.map((kind) => {
          const items = weekly.items.filter((item) => item.kind === kind);
          if (kind !== "brief" && kind !== "validate" && !items.length) return null;
          return (
            <div key={kind} className="px-3 py-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKLY_TITLE[kind]}
                {kind === "validate" ? ` · ad set ${weekly.weekAdset}${items[0]?.target ? ` dans « ${items[0].target.campaignName} »` : " à créer"}` : ""}
              </p>
              {kind === "validate" && !items.length ? <p className="py-0.5 text-[11.5px] text-slate-400">Rien à passer en MAIN : aucune créa TEST validée (≥ {data.thresholds.minSales} ventes et marge ≥ {num(data.thresholds.cutMargin, 1)} %).</p> : null}
              {items.map((item) => (
                <div key={item.id} className={cn("flex items-start gap-2 py-1 text-[12px]", item.checked && "opacity-60")}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onCheck(item, !item.checked)}
                    className="mt-0.5 shrink-0 text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:hover:text-slate-100"
                    title={item.checked ? `Fait le ${when(item.checked.at)} par ${item.checked.who} · clique pour décocher` : "Cocher quand c'est fait (noté au journal)"}
                  >
                    {busy === `check|${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : item.checked ? <CheckSquare className="h-4 w-4" style={{ color: GREEN }} /> : <Square className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold", item.checked && "line-through")}>{item.title}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">{item.detail}</p>
                    {item.why ? <p className="text-[10.5px] text-slate-400">{item.why}</p> : null}
                    {item.blocked ? <p className="text-[10.5px] text-slate-600 dark:text-slate-300">→ {item.blocked}</p> : null}
                    {item.kind === "brief" ? (
                      <p className="text-[10.5px] text-slate-500">
                        Itérations cette semaine : {data.kpis.iterationShare == null ? "—" : `${data.kpis.iterationShare} %`} (cible 80 / 20) ·{" "}
                        <button type="button" onClick={onBriefs} className="font-semibold underline decoration-dotted">
                          ouvrir les briefs
                        </button>
                      </p>
                    ) : null}
                    {item.checked ? <p className="text-[10px] text-slate-400">Fait le {when(item.checked.at)} · {item.checked.who}</p> : null}
                  </div>
                  {item.checked || item.blocked ? null : item.kind === "cut" || item.kind === "cutTest" ? (
                    <ActionButton color={RED} busy={busy === `${item.creativeKey}|${item.adsetId}`} disabled={busy !== null} onClick={() => onCut(item)} label={item.kind === "cut" ? "Couper" : "Couper dans TEST"} />
                  ) : item.kind === "validate" && item.target ? (
                    <ActionButton color={GREEN} busy={busy === `${item.creativeKey}|promote`} disabled={busy !== null} onClick={() => onValidate(item)} label={`Ajouter à ${item.target.adsetName}`} />
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Les seuils des verdicts et de la rampe des ad sets TEST. */
function ThresholdsPanel({ thresholds, onSave, onClose }: { thresholds: Thresholds; onSave: (value: Thresholds) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<keyof Thresholds, string>>(() => Object.fromEntries(Object.entries(thresholds).map(([key, value]) => [key, String(value).replace(".", ",")])) as Record<keyof Thresholds, string>);
  const parsed = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value.replace(",", "."))])) as Thresholds;
  const valid = Object.values(parsed).every((value) => Number.isFinite(value) && value >= 0);
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-800/50 dark:ring-white/10">
      <p className="text-[12.5px] font-semibold">Réglages du pipeline et des ad sets TEST</p>
      <p className="text-[11px] text-slate-500">Les verdicts, la liste de la semaine et la rampe des ad sets TEST se recalculent avec ces seuils. Chaque changement est noté au journal.</p>
      <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {THRESHOLD_FIELDS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-2 text-[11.5px] text-slate-600 dark:text-slate-300">
            <span className="min-w-0">{label}</span>
            <input
              value={draft[key]}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
              inputMode="decimal"
              className="h-7 w-16 shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-right text-[12px] tabular-nums dark:border-white/10 dark:bg-slate-900"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={!valid} onClick={() => onSave(parsed)} className="rounded-md bg-slate-900 px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          Enregistrer
        </button>
        <button type="button" onClick={onClose} className="text-[12px] text-slate-500 hover:text-slate-800">
          Fermer
        </button>
      </div>
    </div>
  );
}

/** Les 5 KPI de la semaine (lundi → dimanche, heure de Paris). */
function Kpis({ data }: { data: PipelineReport }) {
  const k = data.kpis;
  const share = k.iterationShare;
  const tiles: Array<{ label: string; value: string; sub: string; color?: string; title?: string }> = [
    { label: "Créas uploadées", value: `${k.uploaded}`, sub: `cible 15-20 · ${k.briefed} briefée${k.briefed > 1 ? "s" : ""}`, color: k.uploaded < 12 ? RED : k.uploaded <= 20 ? GREEN : ORANGE },
    { label: "Itérations", value: share == null ? "—" : `${share} %`, sub: "cible 80 / 20", color: share == null ? undefined : share < 65 || share > 85 ? RED : GREEN },
    { label: "Nouveaux winners", value: `${k.winners.length}`, sub: "TEST → MAIN · cible 1 / 2 semaines", color: k.winners.length ? GREEN : undefined, title: k.winners.map((winner) => `${winner.name} : ${winner.from} → ${winner.to}`).join("\n") || "Aucun cette semaine" },
    ...k.cpa.map((row) => ({
      label: `CPA 7 j · ${row.label}`,
      value: usd(row.cpa, 2),
      sub: `BE ${usd(row.breakeven, 2)} · cible ${usd(row.low, 2)}-${usd(row.high, 2)}`,
      color: row.cpa == null || row.breakeven == null ? undefined : row.high != null && row.cpa <= row.high ? GREEN : row.cpa <= row.breakeven ? ORANGE : RED,
    })),
    { label: "Marge par créa (7 j)", value: `${k.badges.BEST} · ${k.badges.BONNE} · ${k.badges.CUT}`, sub: "BEST · BONNE · CUT", color: k.badges.CUT ? RED : GREEN, title: k.cutActive.length ? `À couper : ${k.cutActive.join(", ")}` : "Aucune créa CUT active" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/50" title={tile.title}>
          <p className="truncate text-[9.5px] font-semibold uppercase tracking-wide text-slate-500">{tile.label}</p>
          <p className="text-[16px] font-semibold tabular-nums" style={{ color: tile.color }}>
            {tile.value}
          </p>
          <p className="truncate text-[10px] text-slate-500">{tile.sub}</p>
        </div>
      ))}
    </div>
  );
}
