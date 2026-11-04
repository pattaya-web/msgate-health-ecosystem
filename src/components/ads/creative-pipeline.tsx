"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BriefBoard } from "@/components/ads/brief-board";
import type { CreativeRow, Margin, PipelineReport, Placement, Todo, WindowDays } from "@/lib/creative-pipeline/build";
import type { CreativeStatus } from "@/lib/creative-pipeline/store";

/**
 * Le « Pipeline créa » de l'Ads Manager, sous la rampe de scaling : les 5 KPI
 * de la semaine, le rappel du jour, chaque créa active avec sa marge nette,
 * son statut et un seul verbe « À faire » (Couper / Promouvoir derrière un
 * bouton avec confirmation), les briefs en Kanban, les archivées et le
 * journal. Les calculs sont faits par le serveur (src/lib/creative-pipeline).
 */

type Tab = "creas" | "groupes" | "briefs" | "archives" | "journal";
const OPEN_KEY = "msgate-pipeline-open";

/* Couleurs en dur : le thème admin repeint le vert en bleu. */
const GREEN = "#15803d";
const ORANGE = "#b45309";
const RED = "#e11d48";
const BADGE_STYLE: Record<Margin["badge"], { color: string; background: string }> = {
  BEST: { color: "#14532d", background: "rgba(21,128,61,0.16)" },
  BONNE: { color: GREEN, background: "rgba(22,163,74,0.1)" },
  CUT: { color: RED, background: "rgba(225,29,72,0.1)" },
  DATA: { color: "#64748b", background: "rgba(100,116,139,0.1)" },
};
const STATUS_COLOR: Record<CreativeStatus, string> = { BRIEF: "#64748b", "EN PROD": "#64748b", "PRÊTE": "#64748b", TEST: "#4f46e5", SCALING: GREEN, HYPER: "#7c3aed", COSTCAP: "#0e7490", OFF: "#94a3b8" };
const TODO_COLOR: Record<Todo, string> = {
  Couper: RED,
  Attendre: ORANGE,
  Surveiller: ORANGE,
  Laisser: "#475569",
  "Laisser jusqu'à J7": "#475569",
  "Promouvoir en SCALING": GREEN,
  "Post ID dans le HYPER": "#7c3aed",
  "Éligible COSTCAP": "#0e7490",
  "—": "#94a3b8",
};

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

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
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
  const [promote, setPromote] = useState<{ row: CreativeRow; place: Placement; to: "SCALING" | "HYPER" } | null>(null);

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
    if (!window.confirm(`Couper « ${row.name} » dans « ${place.adsetName} » ? ${place.liveAdIds.length > 1 ? `Ses ${place.liveAdIds.length} pubs passent` : "La pub passe"} en pause chez Meta.\n\nRaison : ${place.why}`)) return;
    setBusy(`${row.key}|${place.adsetId}`);
    try {
      for (const id of place.liveAdIds) {
        const res = await fetch("/api/meta/entity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, level: "ad", status: "PAUSED", source: "pipeline", reason: `Pipeline : Couper · ${place.why}` }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Meta a refusé la pause");
      }
      await pipelinePost({ action: "log", what: `Couper « ${row.name} » dans « ${place.adsetName} » · ${place.why}` });
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
    if (!window.confirm(`Ajouter « ${row.name} » (post ID ${row.postId}) dans « ${target.adsetName} » (${target.campaignName}) ? La pub part en live.`)) return;
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
      await pipelinePost({ action: "log", what: `Promouvoir « ${row.name} » → ${target.status} « ${target.adsetName} » (post ID)` });
      toast.success(`${row.name} ajoutée dans ${target.adsetName}`);
      setPromote(null);
      await load(windowDays, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Promotion impossible");
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
      </header>

      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-2 dark:border-white/[0.06]">
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}
          {!data && !error ? <p className="py-4 text-center text-[12px] text-slate-500">Calcul du pipeline…</p> : null}
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
                      {days} j
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
                  <table className="w-full min-w-[960px] text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="py-1.5 pr-2 font-semibold">Créa</th>
                        <th className="px-2 font-semibold">Statut</th>
                        <SortTh label={`Marge ${windowDays} j`} active={sort.key === "margin"} onClick={() => sortBy("margin")} />
                        <SortTh label="%" active={sort.key === "pct"} onClick={() => sortBy("pct")} />
                        <SortTh label="Ventes" active={sort.key === "sales"} onClick={() => sortBy("sales")} />
                        <SortTh label="Dépense" active={sort.key === "spend"} onClick={() => sortBy("spend")} />
                        <th className="px-2 font-semibold">ROAS</th>
                        <th className="px-2 font-semibold">À faire</th>
                        <th className="pl-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                      {sorted.map((row) => (
                        <CreativeLine
                          key={row.key}
                          row={row}
                          days={windowDays}
                          busy={busy}
                          onCut={(place) => void cut(row, place)}
                          onPromote={(place, to) => setPromote({ row, place, to })}
                          onStatus={(status) => void setStatus(row, status)}
                        />
                      ))}
                    </tbody>
                  </table>
                  {!sorted.length ? <p className="py-4 text-center text-[12px] text-slate-400">Aucune créa active.</p> : null}
                </div>
              ) : null}

              {tab === "groupes" ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="py-1.5 pr-2 font-semibold">Campagne / ad set</th>
                        <th className="px-2 font-semibold">Marge {windowDays} j</th>
                        <th className="px-2 font-semibold">%</th>
                        <th className="px-2 font-semibold">Ventes</th>
                        <th className="px-2 font-semibold">Dépense</th>
                        <th className="px-2 font-semibold">ROAS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                      {data.groups.map((group) => (
                        <tr key={group.id} className={cn(!group.live && "opacity-50")}>
                          <td className={cn("py-1.5 pr-2", group.level === "adset" ? "pl-4" : "font-semibold")}>
                            {group.name}
                            {!group.live ? <span className="ml-1 text-[10px] text-slate-400">(coupé)</span> : null}
                          </td>
                          <MarginCells margin={group.margin} />
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
            <p className="text-[14px] font-semibold">{promote.to === "HYPER" ? "Post ID dans le HYPER" : "Promouvoir en SCALING"}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              « {promote.row.name} » est ajoutée telle quelle (même post ID, likes et commentaires gardés) dans l&apos;ad set choisi.
            </p>
            {!promote.row.postId ? <p className="mt-2 text-[12px] text-rose-600">Post ID introuvable pour cette créa.</p> : null}
            <div className="mt-3 space-y-1">
              {data.targets
                .filter((target) => target.accountId === promote.row.accountId && target.status === promote.to && !promote.row.placements.some((place) => place.adsetId === target.adsetId))
                .map((target) => (
                  <button key={target.adsetId} type="button" disabled={busy !== null || !promote.row.postId} onClick={() => void doPromote(promote.row, target.adsetId)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 disabled:opacity-50 dark:border-white/10">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{target.adsetName}</span>
                      <span className="block truncate text-[11px] text-slate-400">{target.campaignName}</span>
                    </span>
                    {busy === `${promote.row.key}|promote` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  </button>
                ))}
              {!data.targets.some((target) => target.accountId === promote.row.accountId && target.status === promote.to) ? (
                <p className="text-[12px] text-slate-500">Aucun ad set {promote.to} actif sur ce compte.</p>
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

function CreativeLine({
  row,
  days,
  busy,
  onCut,
  onPromote,
  onStatus,
}: {
  row: CreativeRow;
  days: WindowDays;
  busy: string | null;
  onCut: (place: Placement) => void;
  onPromote: (place: Placement, to: "SCALING" | "HYPER") => void;
  onStatus: (status: string) => void;
}) {
  const m = row.margins[days];
  const hover = ([3, 7, 14] as WindowDays[]).map((d) => `${d} j : ${usd(row.margins[d].margin)} (${num(row.margins[d].pct, 1)} %) · ${num(row.margins[d].sales, 1)} ventes · ${row.margins[d].badge}`).join("\n");
  const places = row.placements.filter((place) => place.live);
  const single = places.length <= 1 ? places[0] : null;
  return (
    <>
      <tr className="align-top">
        <td className="max-w-[260px] py-1.5 pr-2">
          <div className="flex items-start gap-2">
            {row.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900 dark:text-slate-50" title={row.name}>
                {row.name}
              </p>
              <p className="truncate text-[10.5px] text-slate-400">
                {single ? single.adsetName : `${places.length} emplacements`} ·{" "}
                <span style={PRODUCT_STYLE(row.product)} title={[row.product === "?" ? "Produit inconnu (URL de la pub) : calculé à 29,99 $" : "", ...row.placements.flatMap((place) => place.links)].filter(Boolean).join(" · ")}>
                  {row.product}
                </span>
              </p>
            </div>
          </div>
        </td>
        <td className="px-2 py-1.5">
          <StatusMenu row={row} onStatus={onStatus} />
        </td>
        <td className="px-2 py-1.5 font-semibold tabular-nums" style={{ color: m.badge === "DATA" ? undefined : m.margin >= 0 ? GREEN : RED }} title={hover}>
          {usd(m.margin)}
        </td>
        <td className="px-2 py-1.5 tabular-nums" title={hover}>
          <span className="mr-1">{num(m.pct, 1)} %</span>
          <Badge badge={m.badge} />
        </td>
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
                  <p className="text-[10px] text-slate-400">
                    depuis le {new Date(place.createdAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" })} ·{" "}
                    <span style={PRODUCT_STYLE(place.product)} title={place.links.join(" · ") || "Pas d'URL de destination lue"}>
                      {place.product}
                    </span>
                  </p>
                </td>
                <td className="px-2 py-1">
                  <span className="text-[10.5px] font-bold" style={{ color: STATUS_COLOR[place.status] }}>
                    {place.status}
                  </span>
                </td>
                <td className="px-2 py-1 text-[11.5px] font-semibold tabular-nums" style={{ color: pm.badge === "DATA" ? undefined : pm.margin >= 0 ? GREEN : RED }}>
                  {usd(pm.margin)}
                </td>
                <td className="px-2 py-1 text-[11.5px] tabular-nums">
                  <span className="mr-1">{num(pm.pct, 1)} %</span>
                  <Badge badge={pm.badge} />
                </td>
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
  onPromote: (place: Placement, to: "SCALING" | "HYPER") => void;
}) {
  const working = busy === `${row.key}|${place.adsetId}`;
  return (
    <>
      <td className="max-w-[260px] px-2 py-1.5">
        <p className="text-[12px] font-bold" style={{ color: TODO_COLOR[place.todo] }}>
          {place.todo}
        </p>
        {place.why ? <p className="text-[10.5px] leading-snug text-slate-500">{place.why}</p> : null}
        {place.blocked ? <p className="text-[10.5px] leading-snug text-slate-500">→ {place.blocked}</p> : null}
        {place.warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-1 text-[10.5px] leading-snug text-amber-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {warning}
          </p>
        ))}
      </td>
      <td className="py-1.5 pl-2 text-right">
        {place.blocked ? null : place.todo === "Couper" ? (
          <ActionButton color={RED} busy={working} disabled={busy !== null} onClick={() => onCut(place)} label="Couper" />
        ) : place.todo === "Promouvoir en SCALING" ? (
          <ActionButton color={GREEN} busy={false} disabled={busy !== null} onClick={() => onPromote(place, "SCALING")} label="Promouvoir" />
        ) : place.todo === "Post ID dans le HYPER" ? (
          <ActionButton color="#7c3aed" busy={false} disabled={busy !== null} onClick={() => onPromote(place, "HYPER")} label="Mettre dans le HYPER" />
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
          {(["TEST", "SCALING", "HYPER", "COSTCAP", "OFF"] as CreativeStatus[])
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

/** Les 5 KPI de la semaine (lundi → dimanche, heure de Paris). */
function Kpis({ data }: { data: PipelineReport }) {
  const k = data.kpis;
  const share = k.iterationShare;
  const tiles: Array<{ label: string; value: string; sub: string; color?: string; title?: string }> = [
    { label: "Créas uploadées", value: `${k.uploaded}`, sub: `cible 15-20 · ${k.briefed} briefée${k.briefed > 1 ? "s" : ""}`, color: k.uploaded < 12 ? RED : k.uploaded <= 20 ? GREEN : ORANGE },
    { label: "Itérations", value: share == null ? "—" : `${share} %`, sub: "cible 80 / 20", color: share == null ? undefined : share < 65 || share > 85 ? RED : GREEN },
    { label: "Nouveaux winners", value: `${k.winners.length}`, sub: "cible 1 toutes les 2 semaines", color: k.winners.length ? GREEN : undefined, title: k.winners.map((winner) => `${winner.name} : ${winner.from} → ${winner.to}`).join("\n") || "Aucun cette semaine" },
    ...k.cpa.map((row) => ({
      label: `CPA 7 j · ${row.label}`,
      value: usd(row.cpa, 2),
      sub: `BE ${usd(row.breakeven, 2)} · cible ${usd(row.low, 2)}-${usd(row.high, 2)}`,
      color: row.cpa == null || row.breakeven == null ? undefined : row.high != null && row.cpa <= row.high ? GREEN : row.cpa <= row.breakeven ? ORANGE : RED,
    })),
    { label: "Marge par créa (7 j)", value: `${k.badges.BEST} · ${k.badges.BONNE} · ${k.badges.CUT}`, sub: "BEST · BONNE · CUT", color: k.badges.CUT ? RED : GREEN, title: k.cutActive.length ? `À couper lundi : ${k.cutActive.join(", ")}` : "Aucune créa CUT active" },
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
