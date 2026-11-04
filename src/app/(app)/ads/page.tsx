"use client";

/* eslint-disable @next/next/no-img-element -- fbcdn URLs are signed and short-lived, the optimizer cannot cache them. */

import { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { usePublishHermesContext } from "@/components/ask-hermes/page-context";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Archive,
  ChevronRight,
  Copy,
  Download,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency, formatCreatedFr, formatNumber } from "@/lib/utils";
import { adsetsToRefill, liveCreatives, missingCreatives, needsRefill } from "@/lib/meta/refill";
import { RenameDialogHost, askName, openNamingPanel, type NamingAd } from "@/components/ads/rename-dialog";
import { InlineRename } from "@/components/ads/inline-rename";
import { namingContextFor, parseCreativeName } from "@/lib/creative-naming";
import { BUCKET_LABELS, CAMPAIGN_BUCKETS, PHASE_TABS, type CampaignBucket, type PhaseTab } from "@/lib/meta/buckets";
import { isAccountKilled, isCampaignLive } from "@/lib/meta/account-flow";
import { loadHiddenAdIds, saveHiddenAdIds } from "@/lib/meta/hidden-ads";
import type {
  AccountNode,
  AdNode,
  AdsTree,
  AdsetNode,
  BucketGroup,
  CampaignNode,
  EntityLevel,
  EntityStatus,
  Metrics,
} from "@/lib/meta/types";
import { DateRangePicker } from "@/components/phoenix/date-range-picker";
import { useAuth } from "@/lib/auth/auth-context";
import { TzBadge } from "@/components/phoenix/source-clocks";
import { SplitBar } from "@/components/phoenix/ui";
import { AccountFlow } from "@/components/ads/account-flow";
import { HS_SPEND_MIN, PROMO_LABEL, PROMO_ROAS_MIN, collectAdsAlerts, type PromoTarget } from "@/components/ads/alerts-rail";
import { MobilePilot } from "@/components/ads/mobile-pilot";
import { ProductThresholdsContext, RoasBreakevenContext, roasToneFor, useRoasTone } from "@/components/ads/roas-tone";
import { ObjectivesBar } from "@/components/ads/objectives-bar";
import { ScalingRamp } from "@/components/ads/scaling-ramp";
import { CreativePipeline } from "@/components/ads/creative-pipeline";
import { MorningView } from "@/components/ads/morning-view";
import { ProcessDoc } from "@/components/ads/process-doc";
import type { ObjectivesBar as Objectives } from "@/lib/metrics/objectives";
import { BudgetCell, CreativeName, HoverPreview, StatusToggle, loadCreative, setBudgetFx } from "@/components/ads/bits";
import { CreativePanel, assetHref, copyText } from "@/components/ads/creative-panel";

/* ------------------------------------------------------------------ *
 * Presentation constants
 * ------------------------------------------------------------------ */

/** One muted hue per phase — enough to tell them apart, not a rainbow. */
const PHASE: Record<CampaignBucket, { rail: string; dot: string; chip: string }> = {
  hyperscaling: {
    rail: "bg-indigo-500",
    dot: "bg-indigo-500",
    chip: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  scaling: {
    rail: "bg-teal-500",
    dot: "bg-teal-500",
    chip: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  },
  testing: {
    rail: "bg-amber-500",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  other: {
    rail: "bg-slate-300 dark:bg-slate-600",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
};

const PHASE_TAB_SHORT: Record<PhaseTab, string> = {
  hyperscaling: "Main/Hyper",
  scaling: "Scaling",
  testing: "Testing",
};

const PRESETS = [
  { key: "today", label: "Auj." },
  { key: "yesterday", label: "Hier" },
  { key: "last_3d", label: "3 j" },
  { key: "last_7d", label: "7 j" },
  { key: "last_30d", label: "30 j" },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"] | "custom";

/** Calendar day in Paris — Meta accounts and Shopify both report on this clock. */
function parisYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftParis(days: number) {
  const [year, month, day] = parisYmd().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function frRange(preset: PresetKey, custom: { start: string; end: string }) {
  if (preset === "custom") return custom;
  if (preset === "today") return { start: parisYmd(), end: parisYmd() };
  if (preset === "yesterday") return { start: shiftParis(-1), end: shiftParis(-1) };
  if (preset === "last_3d") return { start: shiftParis(-3), end: shiftParis(-1) };
  if (preset === "last_7d") return { start: shiftParis(-7), end: shiftParis(-1) };
  return { start: shiftParis(-30), end: shiftParis(-1) };
}

/* ------------------------------------------------------------------ *
 * Metric helpers — ratios are recomputed, never averaged
 * ------------------------------------------------------------------ */

const zero = (): Metrics => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  cpc: 0,
  ctr: 0,
  purchases: 0,
  addToCart: 0,
  purchaseValue: 0,
  roas: 0,
});

function sum(list: Metrics[]): Metrics {
  const total = zero();
  for (const item of list) {
    total.spend += item.spend;
    total.impressions += item.impressions;
    total.clicks += item.clicks;
    total.purchases += item.purchases;
    total.addToCart = (total.addToCart ?? 0) + (item.addToCart ?? 0);
    total.purchaseValue += item.purchaseValue;
  }
  total.cpc = total.clicks ? total.spend / total.clicks : 0;
  total.ctr = total.impressions ? (total.clicks / total.impressions) * 100 : 0;
  total.roas = total.spend ? total.purchaseValue / total.spend : 0;
  return total;
}

const money = (value: number) => (value >= 1000 ? formatCurrency(value) : `${value.toFixed(0)} $`);

/* ------------------------------------------------------------------ *
 * Row scaffolding — fixed metric rail so every row lines up
 * ------------------------------------------------------------------ */

const COL = {
  budget: "w-[5.5rem]",
  spend: "w-[5.25rem]",
  purchases: "w-12",
  atc: "w-12",
  cpa: "w-14",
  cpc: "w-12",
  ctr: "w-12",
  roas: "w-12",
  actions: "w-14",
} as const;

function Cell({
  children,
  width,
  from,
  strong,
  className,
}: {
  children: React.ReactNode;
  width: string;
  from?: "md" | "lg";
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-right tabular-nums",
        width,
        from === "md" && "hidden md:block",
        from === "lg" && "hidden lg:block",
        strong ? "font-medium text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400",
        className
      )}
    >
      {children}
    </span>
  );
}


/** Right-side metric strip — same widths as ColumnHeader. */
function MetricsRail({
  budget,
  metrics,
  actions,
}: {
  budget?: React.ReactNode;
  metrics: Metrics;
  actions?: React.ReactNode;
}) {
  const roasTone = useRoasTone();
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      <span className={cn("hidden shrink-0 justify-end text-right lg:flex", COL.budget)}>
        {budget ?? <span className="text-emerald-300/50">—</span>}
      </span>
      <Cell width={COL.spend} strong>
        {money(metrics.spend)}
      </Cell>
      <Cell width={COL.purchases}>
        {metrics.purchases ? formatNumber(metrics.purchases) : "—"}
      </Cell>
      <Cell width={COL.atc}>{metrics.addToCart ? formatNumber(metrics.addToCart) : "—"}</Cell>
      <Cell width={COL.cpa}>{cpaOf(metrics) ? cpaOf(metrics).toFixed(2) : "—"}</Cell>
      <Cell width={COL.cpc}>{metrics.cpc ? metrics.cpc.toFixed(2) : "—"}</Cell>
      <Cell width={COL.ctr}>{metrics.ctr ? `${metrics.ctr.toFixed(1)}%` : "—"}</Cell>
      <Cell width={COL.roas} strong className={roasTone(metrics.roas)}>
        {metrics.roas ? metrics.roas.toFixed(2) : "—"}
      </Cell>
      <span className={cn("flex shrink-0 items-center justify-end", COL.actions)}>
        {actions ?? null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tri par colonne, comme dans le Gestionnaire de publicités Meta
 * ------------------------------------------------------------------ */

type SortKey = "budget" | "spend" | "purchases" | "atc" | "cpa" | "cpc" | "ctr" | "roas";

/** CPA = dépense ÷ achats (Meta), dans la devise du compte ; 0 sans achat. */
const cpaOf = (metrics: Metrics) => (metrics.purchases > 0 ? metrics.spend / metrics.purchases : 0);
type SortState = { key: SortKey; dir: "desc" | "asc" } | null;
const SORT_KEY = "msgate-ads-sort";

const SORT_COLUMNS: Array<{ key: SortKey; label: string; width: string; from?: "lg" }> = [
  { key: "budget", label: "Budget/j", width: COL.budget, from: "lg" },
  { key: "spend", label: "Dépense", width: COL.spend },
  { key: "purchases", label: "Achats", width: COL.purchases },
  { key: "atc", label: "ATC", width: COL.atc },
  { key: "cpa", label: "CPA", width: COL.cpa },
  { key: "cpc", label: "CPC", width: COL.cpc },
  { key: "ctr", label: "CTR", width: COL.ctr },
  { key: "roas", label: "ROAS", width: COL.roas },
];

function readSort(): SortState {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null");
    return raw && SORT_COLUMNS.some((column) => column.key === raw.key) && (raw.dir === "desc" || raw.dir === "asc") ? raw : null;
  } catch {
    return null;
  }
}

function sortValue(node: { metrics: Metrics; dailyBudget?: number | null }, key: SortKey) {
  if (key === "budget") return node.dailyBudget || node.metrics.spend;
  if (key === "cpa") return cpaOf(node.metrics);
  if (key === "atc") return node.metrics.addToCart ?? 0;
  return node.metrics[key];
}

/** Trie des lignes sur la colonne choisie ; les cases vides (0) restent en bas dans les deux sens. */
function sortRows<T extends { metrics: Metrics; dailyBudget?: number | null }>(rows: T[], sort: SortState): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (!va || !vb) return (vb ? 1 : 0) - (va ? 1 : 0);
    return sort.dir === "desc" ? vb - va : va - vb;
  });
}

/** Vraiment en diffusion : allumé, et ni sa campagne ni son ad set ne sont coupés. */
const isLive = (row: { status: string; effectiveStatus?: string }) => row.status === "ACTIVE" && (!row.effectiveStatus || row.effectiveStatus === "ACTIVE");

/**
 * Campagnes, ad sets ou créas : ce qui tourne d'abord, ce qui est coupé tout en
 * bas ; chaque groupe suit le tri choisi (la dépense, la plus grosse en haut, par défaut).
 */
function liveFirst<T extends { status: string; effectiveStatus?: string; metrics: Metrics; dailyBudget?: number | null }>(rows: T[], sort: SortState): T[] {
  const sorted = sortRows(rows, sort ?? { key: "spend", dir: "desc" });
  return [...sorted.filter(isLive), ...sorted.filter((row) => !isLive(row))];
}

/** Les créas d'un ad set : les actives d'abord, les off tout en bas. */
function orderAds(ads: AdNode[], sort: SortState): AdNode[] {
  return liveFirst(ads, sort);
}

function ColumnHeader({ sort, onSort }: { sort: SortState; onSort: (key: SortKey) => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-900/[0.06] bg-slate-50/60 px-2.5 py-1.5 dark:border-white/[0.06] dark:bg-slate-800/30">
      <span className="min-w-0 flex-1" />
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        {SORT_COLUMNS.map((column) => {
          const active = sort?.key === column.key;
          return (
            <button
              key={column.key}
              type="button"
              onClick={() => onSort(column.key)}
              title={active ? (sort?.dir === "desc" ? "Du plus grand au plus petit · cliquer pour inverser" : "Du plus petit au plus grand · cliquer pour retirer le tri") : "Trier du plus grand au plus petit"}
              className={cn(
                "shrink-0 items-center justify-end gap-0.5 text-right uppercase hover:text-emerald-800 dark:hover:text-emerald-200",
                column.width,
                column.from === "lg" ? "hidden lg:flex" : "flex",
                active && "text-emerald-800 underline underline-offset-2 dark:text-emerald-200"
              )}
            >
              {column.label}
              {active ? <span aria-hidden>{sort?.dir === "desc" ? "▼" : "▲"}</span> : null}
            </button>
          );
        })}
        <span className={cn("shrink-0", COL.actions)} />
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: "campagne" | "adset" | "creative" }) {
  const label = kind === "campagne" ? "C" : kind === "adset" ? "S" : "A";
  const title = kind === "campagne" ? "Campagne" : kind === "adset" ? "Ad set" : "Créa";
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[7px] font-bold leading-none",
        kind === "campagne" && "bg-indigo-600 text-white",
        kind === "adset" && "bg-violet-600 text-white",
        kind === "creative" && "bg-slate-600 text-white"
      )}
    >
      {label}
    </span>
  );
}

function CreatedPill({ value }: { value: string }) {
  const label = formatCreatedFr(value);
  if (!label) return null;
  return (
    <span
      title={`Créé le ${label}`}
      className="shrink-0 rounded bg-slate-100 px-1 py-px text-[8px] tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400"
    >
      {label}
    </span>
  );
}

function ActionChip({
  label,
  title,
  tone = "slate",
  busy,
  onClick,
  href,
  children,
}: {
  label: string;
  title?: string;
  tone?: "slate" | "green" | "violet" | "solid";
  busy?: boolean;
  onClick?: () => void;
  href?: string | null;
  children: React.ReactNode;
}) {
  const className = cn(
    "inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[8px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40",
    tone === "solid" && "bg-emerald-600 text-white hover:bg-emerald-700",
    tone === "green" &&
      "text-emerald-700 ring-1 ring-emerald-500/40 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10",
    tone === "violet" &&
      "text-violet-700 ring-1 ring-violet-500/40 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/10",
    tone === "slate" &&
      "text-slate-600 ring-1 ring-slate-900/10 hover:bg-slate-100 dark:text-slate-300 dark:ring-white/10 dark:hover:bg-slate-800"
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title || label}
        onClick={(event) => event.stopPropagation()}
        className={className}
      >
        {children}
        {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      title={title || label}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={className}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : children}
      {label}
    </button>
  );
}

function CreativeActions({
  ad,
  busy,
  onOpen,
  onDownload,
  onHide,
  onRename,
  onArchive,
}: {
  ad: AdNode;
  busy?: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onHide?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
}) {
  const run = async (kind: "post" | "link") => {
    const creative = await loadCreative(ad.id);
    if (!creative) {
      toast.error("Créa indisponible");
      return;
    }
    if (kind === "post") {
      if (!creative.postId) {
        toast.error("Pas de post ID");
        return;
      }
      void copyText(creative.postId, "Post ID copié");
      return;
    }
    if (!creative.link) {
      toast.error("Pas de lien");
      return;
    }
    window.open(creative.link, "_blank", "noopener,noreferrer");
  };

  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      <ActionChip label="Post ID" title="Copier le post ID" onClick={() => void run("post")}>
        <Copy className="h-2.5 w-2.5" />
      </ActionChip>
      <ActionChip label="Lien" tone="green" title="Ouvrir le lien" onClick={() => void run("link")}>
        <ExternalLink className="h-2.5 w-2.5" />
      </ActionChip>
      <ActionChip label="Adcopy" tone="violet" title="Voir l'ad copy" onClick={onOpen}>
        <MessageSquare className="h-2.5 w-2.5" />
      </ActionChip>
      <ActionChip
        label="DL"
        title="Télécharger la créa"
        busy={busy}
        onClick={onDownload}
      >
        <Download className="h-2.5 w-2.5" />
      </ActionChip>
      {onRename ? (
        <ActionChip label="Renommer" title="Renommer la pub sur Meta" onClick={onRename}>
          <Pencil className="h-2.5 w-2.5" />
        </ActionChip>
      ) : null}
      {onHide ? (
        <ActionChip
          label="Cacher"
          title="Masquer ici seulement — ne supprime rien sur Meta"
          onClick={onHide}
        >
          <EyeOff className="h-2.5 w-2.5" />
        </ActionChip>
      ) : null}
      {onArchive ? (
        <ActionChip label="Archiver" title="Archiver la pub coupée sur Meta : elle disparaît des listes" onClick={onArchive}>
          <Archive className="h-2.5 w-2.5" />
        </ActionChip>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Promo HS : les stats de la créa jour par jour avant de la passer en HS
 * ------------------------------------------------------------------ */

type DayStat = { label: string; date: string; metrics: Metrics | null };

/** Un arbre Meta par jour (aujourd'hui, J-1, J-2, J-3), chargé une fois puis gardé 10 min. */
const dayTrees = new Map<string, { at: number; promise: Promise<Map<string, Metrics>> }>();

function adMetricsOn(date: string): Promise<Map<string, Metrics>> {
  const cached = dayTrees.get(date);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.promise;
  const promise = fetch(`/api/meta/tree?start=${date}&end=${date}`)
    .then((res) => (res.ok ? (res.json() as Promise<AdsTree>) : null))
    .then((tree) => {
      const byAd = new Map<string, Metrics>();
      for (const account of tree?.accounts ?? [])
        for (const campaign of account.campaigns)
          for (const adset of campaign.adsets) for (const ad of adset.ads) byAd.set(ad.id, ad.metrics);
      return byAd;
    });
  promise.catch(() => dayTrees.delete(date));
  dayTrees.set(date, { at: Date.now(), promise });
  return promise;
}

const shortDay = (date: string) => {
  const text = new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function HsBadge({ adId, metrics, target }: { adId: string; metrics: Metrics; target: PromoTarget }) {
  const roasTone = useRoasTone();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<DayStat[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setOpen(true);
    if (days) return;
    const dates = [0, -1, -2, -3].map((shift) => shiftParis(shift));
    Promise.all(dates.map(adMetricsOn))
      .then((maps) =>
        setDays(
          dates.map((date, i) => ({
            label: i === 0 ? "Aujourd'hui" : i === 1 ? "Hier" : shortDay(date),
            date,
            metrics: maps[i].get(adId) ?? null,
          }))
        )
      )
      .catch(() => setFailed(true));
  };

  const past = days?.slice(1).map((day) => day.metrics).filter(Boolean) as Metrics[] | undefined;
  const total = past?.length ? sum(past) : null;
  const row = (label: string, m: Metrics | null, strong?: boolean) => (
    <tr key={label} className={cn(strong && "border-t border-slate-900/10 font-semibold dark:border-white/10")}>
      <td className="py-0.5 pr-3 text-left">{label}</td>
      <td className="py-0.5 pl-2 text-right">{m?.spend ? money(m.spend) : "—"}</td>
      <td className="py-0.5 pl-2 text-right">{m?.purchases || "—"}</td>
      <td className={cn("py-0.5 pl-2 text-right font-semibold", roasTone(m?.roas ?? 0))}>{m?.roas ? m.roas.toFixed(2) : "—"}</td>
      <td className="py-0.5 pl-2 text-right">{m && cpaOf(m) ? cpaOf(m).toFixed(2) : "—"}</td>
      <td className="py-0.5 pl-2 text-right">{m?.cpc ? m.cpc.toFixed(2) : "—"}</td>
      <td className="py-0.5 pl-2 text-right">{m?.ctr ? `${m.ctr.toFixed(1)}%` : "—"}</td>
    </tr>
  );

  return (
    <span className="relative shrink-0" onMouseEnter={load} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (open) setOpen(false);
          else load();
        }}
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white",
          target === "hyper" ? "bg-emerald-600" : "bg-sky-600"
        )}
      >
        {PROMO_LABEL[target]}
      </button>
      {open ? (
        <span
          onClick={(event) => event.stopPropagation()}
          className="absolute left-0 top-full z-40 mt-1 block w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-3 text-[11px] text-slate-700 shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/10"
        >
          <span className="mb-1.5 block font-semibold text-slate-900 dark:text-slate-50">
            {target === "hyper" ? "Avant de passer en Hyper (Ultra)" : "Avant de passer en Scaling / Testing"} : la créa jour par jour
          </span>
          <span className="mb-2 block text-[10px] text-slate-500">
            {target === "hyper"
              ? `Scaling / Testing → Hyper si la créa tient un ROAS de ${PROMO_ROAS_MIN.hyper.toFixed(2)} ou plus`
              : `Testing → Scaling / Testing dès un ROAS de ${PROMO_ROAS_MIN.scaling.toFixed(2)}`}{" "}
            (au moins {money(HS_SPEND_MIN)} dépensés). Sur la période affichée : {money(metrics.spend)}, ROAS {metrics.roas.toFixed(2)}. Vérifie que ça tient sur 3 jours.
          </span>
          {failed ? (
            <span className="block text-rose-600">Stats Meta indisponibles, réessaie.</span>
          ) : !days ? (
            <span className="flex items-center gap-1.5 text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Chargement des 3 derniers jours…
            </span>
          ) : (
            <table className="w-full tabular-nums">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-slate-400">
                  <th className="pb-1 text-left font-semibold">Jour</th>
                  <th className="pb-1 pl-2 text-right font-semibold">Dépense</th>
                  <th className="pb-1 pl-2 text-right font-semibold">Achats</th>
                  <th className="pb-1 pl-2 text-right font-semibold">ROAS</th>
                  <th className="pb-1 pl-2 text-right font-semibold">CPA</th>
                  <th className="pb-1 pl-2 text-right font-semibold">CPC</th>
                  <th className="pb-1 pl-2 text-right font-semibold">CTR</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => row(day.label, day.metrics))}
                {row("Total 3 j (sans auj.)", total, true)}
              </tbody>
            </table>
          )}
        </span>
      ) : null}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={cn(
        "h-3 w-3 shrink-0 text-slate-400 transition-transform duration-150",
        open && "rotate-90"
      )}
    />
  );
}

const rowClass =
  "group relative flex items-center gap-2 py-1.5 pr-2 text-[11px] transition-colors duration-150";

const rowHoverClass =
  "hover:bg-[#ecfdf5]/95 hover:ring-1 hover:ring-inset hover:ring-[#6ee7b7]/40 dark:hover:bg-emerald-400/[0.12] dark:hover:ring-emerald-300/30";

/** Soft emerald wash + custom light-emerald cursor that sits exactly on the pointer. */
function HoverRow({
  className,
  onClick,
  children,
  "data-ad-id": dataAdId,
}: {
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
  "data-ad-id"?: string;
}) {
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      data-ad-id={dataAdId}
      className={cn(
        rowClass,
        rowHoverClass,
        "cursor-none [&_a]:cursor-pointer [&_button]:cursor-pointer [&_input]:cursor-text",
        className
      )}
      onClick={onClick}
      onMouseMove={(event) => {
        setDot({ x: event.clientX, y: event.clientY });
      }}
      onMouseLeave={() => setDot(null)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-full bg-transparent transition-all group-hover:bg-[#34d399]"
      />
      {children}
      {dot && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-[90]"
              style={{ left: dot.x, top: dot.y, transform: "translate(-50%, -50%)" }}
            >
              {/* Soft outer glow */}
              <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#6ee7b7]/35 blur-[3px]" />
              {/* Light emerald disc */}
              <span className="relative block h-3 w-3 rounded-full bg-[#a7f3d0] ring-2 ring-white/90 shadow-[0_0_10px_rgba(110,231,183,0.85),0_1px_2px_rgba(16,185,129,0.35)]" />
              {/* Bright core */}
              <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Filtering
 * ------------------------------------------------------------------ */

type Filters = {
  query: string;
  activeOnly: boolean;
  /** Local hide list — never sent to Meta. */
  hiddenAdIds?: Set<string>;
};

const hit = (value: string, query: string) => value.toLowerCase().includes(query);

function filterGroups(groups: BucketGroup[], filters: Filters): BucketGroup[] {
  const { query, activeOnly, hiddenAdIds } = filters;
  const hasHidden = Boolean(hiddenAdIds?.size);
  if (!query && !activeOnly && !hasHidden) return groups;

  const keepStatus = (status: EntityStatus) => !activeOnly || status === "ACTIVE";

  return groups
    .map((group) => {
      const accounts = group.accounts
        .map((account) => {
          if (activeOnly && isAccountKilled(account)) return null;

          const accountHit = Boolean(query) && hit(account.name, query);

          const campaigns = account.campaigns
            .map((campaign) => {
              if (activeOnly && !isCampaignLive(campaign)) return null;
              if (!keepStatus(campaign.status)) return null;
              const campaignHit = accountHit || !query || hit(campaign.name, query);

              const adsets = campaign.adsets
                .map((adset) => {
                  if (!keepStatus(adset.status)) return null;
                  if (activeOnly && adset.effectiveStatus && adset.effectiveStatus !== "ACTIVE") {
                    return null;
                  }
                  const adsetHit = campaignHit || hit(adset.name, query);
                  // Actifs = campagnes / ad sets ON. Les créas pausées restent visibles (gris).
                  const ads = adset.ads.filter((ad) => {
                    if (hiddenAdIds?.has(ad.id)) return false;
                    return adsetHit || !query || hit(ad.name, query);
                  });
                  if (!adsetHit && !ads.length) return null;
                  return { ...adset, ads, metrics: sum(ads.map((ad) => ad.metrics)) };
                })
                .filter(Boolean) as AdsetNode[];

              if (!campaignHit && !adsets.length) return null;
              return { ...campaign, adsets, metrics: sum(adsets.map((adset) => adset.metrics)) };
            })
            .filter(Boolean) as CampaignNode[];

          if (!campaigns.length) return null;
          return {
            ...account,
            campaigns,
            metrics: sum(campaigns.map((c) => c.metrics)),
            // Budget/j du compte = somme des campagnes ON encore visibles
            dailyBudget: campaigns.reduce((acc, campaign) => acc + (campaign.dailyBudget || 0), 0),
          };
        })
        .filter(Boolean) as AccountNode[];

      const campaigns = accounts.flatMap((account) => account.campaigns);
      return {
        ...group,
        accounts,
        accountCount: accounts.length,
        campaignCount: campaigns.length,
        activeCampaigns: campaigns.filter(isCampaignLive).length,
        metrics: sum(accounts.map((account) => account.metrics)),
        dailyBudget: campaigns.reduce((acc, campaign) => acc + (campaign.dailyBudget || 0), 0),
      };
    })
    .filter((group) => group.accountCount > 0);
}

/** Immutably applies a change to one node, wherever it sits in the tree. */
/**
 * Les modifications faites depuis l'outil (pause, activation, budget, nom),
 * gardées dans le navigateur 20 minutes : tant que Meta ne les renvoie pas
 * encore (copie du serveur en retard, lecture partie avant le clic), elles
 * restent appliquées à l'écran. Changer d'onglet ou actualiser ne les efface plus.
 */
const PENDING_KEY = "msgate-meta-pending";
/** La dernière liste reçue, affichée aussitôt à l'ouverture pendant que la synchro tourne. */
const LAST_TREE_KEY = "msgate-ads-last-tree";

function readLastTree(key: string): { tree: AdsTree; fx: Record<string, number> } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_TREE_KEY) || "null") as { key: string; tree: AdsTree; fx: Record<string, number> } | null;
    return saved && saved.key === key ? saved : null;
  } catch {
    return null;
  }
}

function writeLastTree(key: string, tree: AdsTree, fx: Record<string, number>) {
  try {
    localStorage.setItem(LAST_TREE_KEY, JSON.stringify({ key, tree, fx }));
  } catch {
    // trop gros ou refusé : on s'en passe, la synchro affichera la liste
  }
}
const PENDING_TTL_MS = 20 * 60_000;
type PendingWrite = { level: EntityLevel; id: string; patch: { status?: EntityStatus; dailyBudget?: number; name?: string }; at: number };

function readPending(): PendingWrite[] {
  try {
    const rows = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingWrite[];
    return Array.isArray(rows) ? rows.filter((row) => Date.now() - row.at < PENDING_TTL_MS) : [];
  } catch {
    return [];
  }
}

function writePending(rows: PendingWrite[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rows));
  } catch {
    // stockage refusé : la modification reste vraie chez Meta, seul l'affichage peut retarder
  }
}

function rememberPending(level: EntityLevel, id: string, patch: PendingWrite["patch"]) {
  const others = readPending().filter((row) => !(row.id === id && row.level === level && Object.keys(row.patch).join() === Object.keys(patch).join()));
  writePending([...others, { level, id, patch, at: Date.now() }]);
}

/** Le nœud (campagne, ad set ou pub) d'un identifiant, dans l'arbre reçu. */
function findNode(tree: AdsTree, level: EntityLevel, id: string): Record<string, unknown> | null {
  const accounts = tree.accounts?.length ? tree.accounts : tree.groups.flatMap((group) => group.accounts);
  for (const account of accounts) {
    for (const campaign of account.campaigns) {
      if (level === "campaign" && campaign.id === id) return campaign as unknown as Record<string, unknown>;
      for (const adset of campaign.adsets) {
        if (level === "adset" && adset.id === id) return adset as unknown as Record<string, unknown>;
        if (level === "ad") for (const ad of adset.ads) if (ad.id === id) return ad as unknown as Record<string, unknown>;
      }
    }
  }
  return null;
}

/** Réapplique les modifications encore en attente ; celles que Meta renvoie déjà sont oubliées. */
function applyPending(tree: AdsTree): AdsTree {
  const pending = readPending();
  if (!pending.length) return tree;
  let next = tree;
  const keep: PendingWrite[] = [];
  for (const row of pending) {
    const node = findNode(tree, row.level, row.id);
    const confirmed = node && Object.entries(row.patch).every(([key, value]) => node[key] === value);
    if (confirmed) continue;
    keep.push(row);
    if (node || (row.level === "ad" && row.patch.status === "ARCHIVED")) next = patchTree(next, row.level, row.id, row.patch);
  }
  writePending(keep);
  return next;
}

function patchTree(
  tree: AdsTree,
  level: EntityLevel,
  id: string,
  patch: { status?: EntityStatus; dailyBudget?: number; name?: string }
): AdsTree {
  // Une pub retirée (archivée) disparaît tout de suite de la liste.
  if (level === "ad" && patch.status === "ARCHIVED") {
    const dropAd = (account: AccountNode) => ({
      ...account,
      campaigns: account.campaigns.map((campaign) => ({
        ...campaign,
        adsets: campaign.adsets.map((adset) => ({ ...adset, ads: adset.ads.filter((ad) => ad.id !== id) })),
      })),
    });
    return { ...tree, accounts: (tree.accounts || []).map(dropAd), groups: tree.groups.map((group) => ({ ...group, accounts: group.accounts.map(dropAd) })) };
  }
  const applyAd = (ad: AdNode) => {
    if (ad.id !== id) return ad;
    const next = { ...ad, ...patch };
    // Keep UI in sync so a just-paused créa goes grey immediately.
    if (patch.status) next.effectiveStatus = patch.status;
    return next;
  };

  const applyAdset = (adset: AdsetNode): AdsetNode => ({
    ...adset,
    ...(level === "adset" && adset.id === id ? patch : {}),
    ads: level === "ad" ? adset.ads.map(applyAd) : adset.ads,
  });

  const applyCampaign = (campaign: CampaignNode): CampaignNode => ({
    ...campaign,
    ...(level === "campaign" && campaign.id === id ? patch : {}),
    adsets: level === "campaign" ? campaign.adsets : campaign.adsets.map(applyAdset),
  });

  const applyAccount = (account: AccountNode) => ({
    ...account,
    campaigns: account.campaigns.map(applyCampaign),
  });

  return {
    ...tree,
    accounts: (tree.accounts || []).map(applyAccount),
    groups: tree.groups.map((group) => ({
      ...group,
      accounts: group.accounts.map(applyAccount),
    })),
  };
}

const adIdsOfAdset = (adset: AdsetNode) => adset.ads.map((ad) => ad.id);
const adIdsOfCampaign = (campaign: CampaignNode) => campaign.adsets.flatMap(adIdsOfAdset);

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function AdsPage() {
  // Associé (ou admin en « Vue Alison ») : mêmes outils, sur ses comptes seulement (filtré côté serveur).
  const { isAssociate } = useAuth();
  const [fx, setFx] = useState<Record<string, number>>({});
  const [preset, setPreset] = useState<PresetKey>("today");
  const [range, setRange] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { start: today, end: today };
  });
  const [reloadKey, setReloadKey] = useState(0);
  const hardRefresh = useRef(false);
  const shownOnce = useRef(false);

  // Le bouton Actualiser de l'en-tête : ici, il relance une synchro Meta complète au lieu de recharger la page.
  useEffect(() => {
    const onRefresh = (event: Event) => {
      event.preventDefault();
      hardRefresh.current = true;
      setReloadKey((key) => key + 1);
    };
    window.addEventListener("msgate:refresh", onRefresh);
    return () => window.removeEventListener("msgate:refresh", onRefresh);
  }, []);

  const [tree, setTree] = useState<AdsTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [hiddenAdIds, setHiddenAdIds] = useState<Set<string>>(() => new Set());
  // Tant qu'on n'a pas cliqué, l'onglet ouvert est le premier palier qui a des campagnes.
  const [chosenPhaseTab, setPhaseTab] = useState<PhaseTab | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Tri par colonne : 1er clic = du plus grand au plus petit, 2e = l'inverse, 3e = ordre de Meta. Gardé sur cet appareil.
  const [sort, setSort] = useState<SortState>(null);
  useEffect(() => {
    const saved = readSort();
    if (saved) setTimeout(() => setSort(saved), 0);
  }, []);
  const changeSort = (key: SortKey) => {
    const next: SortState = sort?.key !== key ? { key, dir: "desc" } : sort.dir === "desc" ? { key, dir: "asc" } : null;
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(next));
    } catch {
      // stockage indisponible : le tri vaut pour cette visite
    }
  };
  const [panelAd, setPanelAd] = useState<string | null>(null);
  // Sans useMemo : le contexte Hermes compare une version sérialisée, et le compilateur React mémoïse lui-même.
  const hermesAd = (() => {
    if (!panelAd || !tree) return null;
    for (const account of tree.accounts ?? []) {
      for (const campaign of account.campaigns ?? []) {
        for (const adset of campaign.adsets ?? []) {
          const ad = adset.ads?.find((entry) => entry.id === panelAd);
          if (ad) return { storeName: account.name, campaignId: campaign.id, campaignName: campaign.name, adsetId: adset.id, adsetName: adset.name, adId: ad.id, adName: ad.name };
        }
      }
    }
    return null;
  })();
  usePublishHermesContext("ads", hermesAd);
  const [showOther, setShowOther] = useState(false);
  const [autoDetect, setAutoDetect] = useState(true);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [spendTab, setSpendTab] = useState<"phase" | "account">("phase");
  const [agencyToken, setAgencyToken] = useState("");
  const [agencyLabel, setAgencyLabel] = useState("");
  const [agencyBusy, setAgencyBusy] = useState(false);
  const [storedTokens, setStoredTokens] = useState<Array<{ id: string; label: string; hint: string }>>([]);
  const [objectives, setObjectives] = useState<Objectives | null>(null);
  /** L'onglet du haut : « Matin » (ce qu'il faut faire aujourd'hui), l'Ads Manager complet ou le document « Process ». Le dernier choix est retenu. */
  const [view, setView] = useState<"matin" | "tout" | "process">("matin");
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem("msgate-ads-view");
        if (saved === "tout" || saved === "process") setView(saved);
      } catch {
        // stockage refusé : sans gravité
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const chooseView = (next: "matin" | "tout" | "process") => {
    setView(next);
    try {
      localStorage.setItem("msgate-ads-view", next);
    } catch {
      // stockage refusé : sans gravité
    }
  };
  const [objectivesLoading, setObjectivesLoading] = useState(false);
  const [shopify, setShopify] = useState<{
    netSales: number;
    orders: number;
    returns: number;
    currency: string;
  } | null>(null);
  const [shopifyLoading, setShopifyLoading] = useState(true);

  // Relu au tick suivant : le rendu serveur et l'hydratation partent d'une liste vide.
  useEffect(() => {
    const timer = setTimeout(() => setHiddenAdIds(loadHiddenAdIds()), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Lancé au tick suivant : pas de setState synchrone dans le corps de l'effet (règle du compilateur React).
    const timer = setTimeout(() => {
    setRefreshing(true);

    void (async () => {
      try {
        const params = new URLSearchParams(
          preset === "custom" ? { start: range.start, end: range.end } : { preset }
        );
        const lastKey = params.toString();
        // Ouverture : la dernière liste vue s'affiche tout de suite, la synchro la remplace dès qu'elle arrive.
        if (!shownOnce.current) {
          const last = readLastTree(lastKey);
          if (last) {
            shownOnce.current = true;
            setTree(applyPending(last.tree));
            setBudgetFx(last.fx ?? {});
            setFx(last.fx ?? {});
            setLoading(false);
          }
        }
        if (hardRefresh.current) {
          params.set("refresh", "1");
          hardRefresh.current = false;
        }

        const res = await fetch(`/api/meta/tree?${params}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Synchronisation impossible");
        shownOnce.current = true;
        setBudgetFx((body as { fx?: Record<string, number> }).fx ?? {});
        setTree(applyPending(body as AdsTree));
        setFx((body as { fx?: Record<string, number> }).fx ?? {});
        writeLastTree(lastKey, body as AdsTree, (body as { fx?: Record<string, number> }).fx ?? {});
        setError(null);

      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Synchronisation impossible");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [preset, range.start, range.end, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    if (isAssociate) return;
    (async () => {
      try {
        const res = await fetch("/api/meta/registry");
        const body = await res.json();
        if (cancelled || !res.ok) return;
        setAutoDetect(Boolean(body.autoDetect));
        setStoredTokens(body.tokens || []);
      } catch {
        // registry is optional on first paint
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, isAssociate]);

  useEffect(() => {
    let cancelled = false;
    const window = frRange(preset, range);
    // Lancé au tick suivant : pas de setState synchrone dans le corps de l'effet.
    const timer = setTimeout(() => {
    setShopifyLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/shopify/daily?start=${window.start}&end=${window.end}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Shopify indisponible");
        setShopify({
          netSales: Number(body.totals?.netSales) || 0,
          orders: Number(body.totals?.orders) || 0,
          returns: Number(body.totals?.returns) || 0,
          currency: body.currency || "USD",
        });
      } catch {
        if (!cancelled) setShopify(null);
      } finally {
        if (!cancelled) setShopifyLoading(false);
      }
    })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [preset, range.start, range.end]);

  // La barre « Objectifs » : ROAS réel global, CPA, site, CPC, dépense et profit, avec les seuils
  // recalculés depuis la grille fournisseur. Ses seuils au ROAS Meta colorent les campagnes, ad sets et créas.
  useEffect(() => {
    let cancelled = false;
    const window = frRange(preset, range);
    const timer = setTimeout(() => {
      setObjectivesLoading(true);
      void fetch(`/api/metrics/objectives?start=${window.start}&end=${window.end}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: Objectives | null) => {
          if (!cancelled && body?.thresholds) setObjectives(body);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setObjectivesLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [preset, range.start, range.end]);

  const toggle = useCallback(
    (key: string) => setOpen((current) => ({ ...current, [key]: !current[key] })),
    []
  );

  const hideAd = useCallback((adId: string) => {
    setHiddenAdIds((current) => {
      const next = new Set(current);
      next.add(adId);
      saveHiddenAdIds(next);
      return next;
    });
    toast.success("Créa cachée ici (pas sur Meta)", {
      action: {
        label: "Annuler",
        onClick: () => {
          setHiddenAdIds((current) => {
            const next = new Set(current);
            next.delete(adId);
            saveHiddenAdIds(next);
            return next;
          });
        },
      },
    });
  }, []);

  const restoreHiddenAds = useCallback(() => {
    setHiddenAdIds(() => {
      const next = new Set<string>();
      saveHiddenAdIds(next);
      return next;
    });
    toast.success("Créas cachées restaurées");
  }, []);

  const write = useCallback(
    async (
      level: EntityLevel,
      id: string,
      patch: { status?: EntityStatus; dailyBudget?: number; name?: string },
      label: string
    ) => {
      const snapshot = tree;
      if (!snapshot) return;

      setBusy((current) => ({ ...current, [id]: true }));
      setTree(patchTree(snapshot, level, id, patch));

      try {
        const res = await fetch("/api/meta/entity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, level, ...patch }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Meta a refusé la modification");
        rememberPending(level, id, patch);
        toast.success(label);
      } catch (err) {
        setTree(snapshot);
        toast.error(err instanceof Error ? err.message : "Modification impossible");
      } finally {
        setBusy((current) => ({ ...current, [id]: false }));
      }
    },
    [tree]
  );

  /**
   * Renomme une pub par la même route que « Renommer » (/api/meta/entity), en
   * patchant l'arbre courant : plusieurs renommages à la suite (« Renommer
   * tout l'ad set », « Normaliser ») ne s'écrasent pas entre eux.
   */
  const renameAd = useCallback(async (id: string, name: string) => {
    const res = await fetch("/api/meta/entity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, level: "ad", name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Meta a refusé le renommage");
    rememberPending("ad", id, { name });
    setTree((current) => (current ? patchTree(current, "ad", id, { name }) : current));
  }, []);

  const downloadZip = useCallback(async (ids: string[], label: string, key: string) => {
    if (!ids.length) {
      toast.error("Aucune publicité dans cette sélection.");
      return;
    }
    setBusy((current) => ({ ...current, [key]: true }));
    const notice = toast.loading(`Archive de ${ids.length} créa…`);

    try {
      const res = await fetch("/api/meta/creatives/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Archive impossible");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${label}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Archive téléchargée", { id: notice });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive impossible", { id: notice });
    } finally {
      setBusy((current) => ({ ...current, [key]: false }));
    }
  }, []);

  /** One ad: hand over the file itself rather than a one-entry archive. */
  const downloadAd = useCallback(
    async (ad: AdNode) => {
      setBusy((current) => ({ ...current, [`dl-${ad.id}`]: true }));
      const creative = await loadCreative(ad.id);
      setBusy((current) => ({ ...current, [`dl-${ad.id}`]: false }));

      const single = creative?.assets.length === 1 ? creative.assets[0] : null;
      const href = single ? assetHref(single, creative?.adName || ad.name) : null;
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.click();
        return;
      }
      await downloadZip([ad.id], ad.name || ad.id, `dl-${ad.id}`);
    },
    [downloadZip]
  );

  const killAccount = useCallback(
    async (account: AccountNode) => {
      const ids = account.campaigns
        .filter((campaign) => campaign.status === "ACTIVE")
        .map((campaign) => campaign.id);
      if (!ids.length || !tree) return;

      const key = `kill-${account.id}`;
      const snapshot = tree;
      setBusy((current) => ({ ...current, [key]: true }));
      setTree(ids.reduce((next, id) => patchTree(next, "campaign", id, { status: "PAUSED" }), tree));

      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            const res = await fetch("/api/meta/entity", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, level: "campaign", status: "PAUSED" }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "Meta a refusé la pause");
            rememberPending("campaign", id, { status: "PAUSED" });
          })
        );
        void results;
        toast.success(`${account.name} — ${ids.length} campagne${ids.length > 1 ? "s" : ""} coupée${ids.length > 1 ? "s" : ""}`);
      } catch (err) {
        setTree(snapshot);
        toast.error(err instanceof Error ? err.message : "Impossible de couper le compte");
      } finally {
        setBusy((current) => ({ ...current, [key]: false }));
      }
    },
    [tree]
  );

  const addAgencyToken = useCallback(async () => {
    if (!agencyLabel.trim()) {
      toast.error("Indique le nom du BM");
      return;
    }
    if (!agencyToken.trim()) {
      toast.error("Colle le token Meta envoyé par l'agence");
      return;
    }
    setAgencyBusy(true);
    try {
      const res = await fetch("/api/meta/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-token",
          token: agencyToken,
          label: agencyLabel.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Token refusé");
      setStoredTokens(body.tokens || []);
      setAgencyToken("");
      setAgencyLabel("");
      toast.success(body.created ? "Token ajouté — sync en cours" : "Token déjà présent");
      setRefreshing(true);
      setReloadKey((key) => key + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Token impossible");
    } finally {
      setAgencyBusy(false);
    }
  }, [agencyToken, agencyLabel]);

  const toggleAutoDetect = useCallback(async () => {
    const next = !autoDetect;
    setAutoDetect(next);
    try {
      const res = await fetch("/api/meta/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto-detect", enabled: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Impossible");
      setAutoDetect(Boolean(body.autoDetect));
    } catch (err) {
      setAutoDetect(!next);
      toast.error(err instanceof Error ? err.message : "Impossible");
    }
  }, [autoDetect]);

  const acknowledgeNew = useCallback(async () => {
    try {
      const res = await fetch("/api/meta/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acknowledge" }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Impossible");
      }
      toast.success("Nouveaux comptes marqués comme vus");
      setRefreshing(true);
      setReloadKey((key) => key + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible");
    }
  }, []);

  const flowAccounts = useMemo(() => {
    const source = tree?.accounts?.length
      ? tree.accounts
      : (tree?.groups || []).flatMap((group) => group.accounts);

    const byId = new Map<string, AccountNode>();
    for (const account of source) {
      const current = byId.get(account.accountId);
      const campaigns = current
        ? [
            ...current.campaigns,
            ...account.campaigns.filter((campaign) => !current.campaigns.some((row) => row.id === campaign.id)),
          ]
        : account.campaigns;
      byId.set(account.accountId, {
        ...account,
        lifetimeSpend: account.lifetimeSpend ?? 0,
        disableReason: account.disableReason ?? 0,
        isNew: Boolean(account.isNew || current?.isNew),
        campaigns: campaigns.map((campaign) => ({ ...campaign, issues: campaign.issues || [] })),
      });
    }
    return [...byId.values()];
  }, [tree]);

  const groups = useMemo(
    () =>
      filterGroups(tree?.groups || [], {
        query: query.trim().toLowerCase(),
        activeOnly,
        hiddenAdIds,
      }).filter((group) => showOther || group.bucket !== "other"),
    [tree, query, activeOnly, showOther, hiddenAdIds]
  );

  /** « Normaliser » : les pubs affichées (filtres compris) dont le nom ne suit pas la convention, par ad set. */
  const openNormalize = useCallback(() => {
    const adsets = new Map<string, { adsetId: string; adsetName: string; ads: NamingAd[] }>();
    for (const group of groups) {
      for (const account of group.accounts) {
        for (const campaign of account.campaigns) {
          for (const adset of campaign.adsets) {
            const entry = adsets.get(adset.id) ?? { adsetId: adset.id, adsetName: adset.name, ads: [] };
            for (const ad of adset.ads) if (!entry.ads.some((row) => row.id === ad.id)) entry.ads.push({ id: ad.id, name: ad.name, createdTime: ad.createdTime });
            adsets.set(adset.id, entry);
          }
        }
      }
    }
    openNamingPanel({ kind: "normalize", adsets: [...adsets.values()].filter((adset) => adset.ads.some((ad) => !parseCreativeName(ad.name))), onRename: renameAd });
  }, [groups, renameAd]);

  const phaseTab: PhaseTab =
    chosenPhaseTab ?? PHASE_TABS.find((bucket) => groups.some((group) => group.bucket === bucket)) ?? "hyperscaling";

  const otherCount = useMemo(
    () => tree?.groups.find((group) => group.bucket === "other")?.campaignCount ?? 0,
    [tree]
  );

  const totals = useMemo(() => sum(groups.map((group) => group.metrics)), [groups]);
  const dailyBudget = groups.reduce((acc, group) => acc + group.dailyBudget, 0);
  // Les ad sets allumés avec moins de 3 créas actives, tous comptes confondus : à réalimenter.
  const refillAdsets = flowAccounts.flatMap((account) => account.campaigns.flatMap((campaign) => adsetsToRefill(campaign)));
  const shown = frRange(preset, range);
  // Spend Meta suit la vue (Actifs / recherche) — sinon le KPI et « Spend · Actifs » divergent.
  // Les comptes peuvent être en euros et Shopify en dollars : le KPI et le ROAS se font en dollars.
  const metaSpend = useMemo(
    () =>
      groups.reduce(
        (sum, group) => sum + group.accounts.reduce((acc, account) => acc + account.metrics.spend * (fx[(account.currency || "USD").toUpperCase()] ?? 1), 0),
        0
      ),
    [groups, fx]
  );
  void totals;
  // La vraie dépense de la période : tous les comptes, campagnes coupées comprises (jamais le seul filtre « Actifs »).
  const metaSpendTotal = useMemo(
    () => (tree?.accounts ?? []).reduce((sum, account) => sum + account.metrics.spend * (fx[(account.currency || "USD").toUpperCase()] ?? 1), 0),
    [tree, fx]
  );
  const shopifyRevenue = shopify?.netSales ?? 0;
  const shopifyRoas = metaSpendTotal > 0 && shopify ? shopifyRevenue / metaSpendTotal : 0;

  const adsAlerts = useMemo(() => collectAdsAlerts(groups), [groups]);
  const hsAdIds = useMemo(() => new Map(adsAlerts.hs.map((item) => [item.adId, item.target] as const)), [adsAlerts]);
  const deadAdIds = useMemo(() => new Set(adsAlerts.dead.map((item) => item.adId)), [adsAlerts]);
  const deadCampaignIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of groups) {
      for (const account of group.accounts) {
        for (const campaign of account.campaigns) {
          if (campaign.adsets.some((adset) => adset.ads.some((ad) => deadAdIds.has(ad.id)))) {
            ids.add(campaign.id);
          }
        }
      }
    }
    return ids;
  }, [groups, deadAdIds]);

  const spendByPhase = useMemo(
    () =>
      CAMPAIGN_BUCKETS.map((bucket) => {
        const group = groups.find((item) => item.bucket === bucket);
        return {
          label: BUCKET_LABELS[bucket],
          value: group?.metrics.spend ?? 0,
          color:
            bucket === "hyperscaling"
              ? "#6366f1"
              : bucket === "scaling"
                ? "#14b8a6"
                : bucket === "testing"
                  ? "#f59e0b"
                  : "#94a3b8",
        };
      }),
    [groups]
  );

  const spendByAccount = useMemo(() => {
    const byId = new Map<string, { name: string; spend: number }>();
    for (const group of groups) {
      for (const account of group.accounts) {
        const current = byId.get(account.accountId);
        if (current) current.spend += account.metrics.spend;
        else byId.set(account.accountId, { name: account.name, spend: account.metrics.spend });
      }
    }
    const ranked = [...byId.values()].sort((a, b) => b.spend - a.spend);
    const top = ranked.slice(0, 8);
    const rest = ranked.slice(8).reduce((acc, item) => acc + item.spend, 0);
    const palette = ["#334155", "#475569", "#64748b", "#0f766e", "#4338ca", "#b45309", "#9f1239", "#365314"];
    const items = top.map((account, index) => ({
      label: account.name,
      value: account.spend,
      color: palette[index % palette.length],
    }));
    if (rest > 0) items.push({ label: "Autres comptes", value: rest, color: "#cbd5e1" });
    return items;
  }, [groups]);

  return (
    <RoasBreakevenContext.Provider value={objectives?.thresholds.meta ?? null}>
    <ProductThresholdsContext.Provider value={(objectives?.products ?? []).filter((product) => product.pattern).map((product) => ({ pattern: product.pattern, thresholds: product.meta }))}>
    <div className="mb-2.5 inline-flex gap-0.5 rounded-xl bg-slate-100/80 p-0.5 dark:bg-slate-800/70">
      {(
        [
          ["matin", "Matin"],
          ["tout", "Ads Manager"],
          ["process", "Process"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => chooseView(id)}
          className={cn(
            "rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-all",
            view === id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50" : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
          )}
        >
          {label}
        </button>
      ))}
    </div>
    {view === "matin" ? (
      <MorningView
        onApplied={(level, id, patch) => {
          if (tree) setTree(patchTree(tree, level, id, patch));
          rememberPending(level, id, patch);
        }}
      />
    ) : null}
    {view === "process" ? <ProcessDoc /> : null}
    <div className={cn("flex w-full flex-col gap-2.5 pb-8", view !== "tout" && "hidden")}>
      {/* Header: stack on mobile, row on desktop */}
      <div className="order-1 flex flex-col gap-2 lg:order-1 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Ads Meta
            {tree?.errors.length ? (
              <span
                title={`${tree.tokensWorking}/${tree.tokensTotal} tokens — ${tree.errors[0]}`}
                className="inline-flex"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              </span>
            ) : null}
            {refreshing && tree ? (
              <span className="text-[11px] font-normal text-slate-400">maj…</span>
            ) : null}
          </h1>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 sm:ml-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <div className="-mx-0.5 flex max-w-full gap-0.5 overflow-x-auto px-0.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:overflow-visible sm:pb-0">
            <div className="inline-flex shrink-0 gap-0.5 rounded-xl bg-slate-100/80 p-0.5 dark:bg-slate-800/70">
              {PRESETS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setPreset(item.key)}
                  className={cn(
                    "rounded-lg px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-all",
                    preset === item.key
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <DateRangePicker
              className="h-8 min-w-0 flex-1 truncate px-2 text-[10px] sm:h-9 sm:flex-none sm:text-xs"
              value={shown}
              onChange={(next) => {
                setPreset("custom");
                setRange(next);
              }}
            />

            <button
              type="button"
              onClick={() => {
                hardRefresh.current = true;
                setReloadKey((key) => key + 1);
              }}
              disabled={refreshing}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-2.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 sm:h-9 sm:px-3 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Sync</span>
            </button>
          </div>
        </div>
      </div>

      <div className="order-1 lg:order-1">
        <ObjectivesBar
          data={objectives}
          loading={objectivesLoading}
          periodLabel={preset === "today" ? "aujourd'hui" : preset === "yesterday" ? "hier" : preset === "last_3d" ? "3 j" : preset === "last_7d" ? "7 j" : preset === "last_30d" ? "30 j" : "période"}
        />
        <div className="mt-1.5">
          {view === "tout" ? (
          <ScalingRamp
            onApplied={(level, id, patch) => {
              if (tree) setTree(patchTree(tree, level, id, patch));
              rememberPending(level, id, patch);
            }}
          />
          ) : null}
        </div>
        <div className="mt-1.5">{view === "tout" ? <CreativePipeline /> : null}</div>
      </div>

      <div
        className={cn(
          "order-5 rounded-xl bg-white ring-1 ring-slate-900/[0.06] transition-opacity duration-200 lg:order-2 dark:bg-slate-900/70 dark:ring-white/[0.06]",
          refreshing ? "opacity-70" : "opacity-100"
        )}
      >
        <button
          type="button"
          onClick={() => setSpendOpen((value) => !value)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
              spendOpen && "rotate-90"
            )}
          />
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
            Répartition du spend
          </span>
          <TzBadge source="meta" />
          <span className="ml-auto text-[11px] tabular-nums text-slate-400">
            {loading && !tree ? "—" : formatCurrency(metaSpend)}
          </span>
          <span className="ml-auto hidden text-[10px] text-slate-400 sm:inline">
            {spendOpen ? "fermer" : "ouvrir"}
          </span>
        </button>

        {spendOpen ? (
          <div className="space-y-2 border-t border-slate-900/[0.05] px-2.5 py-2 dark:border-white/[0.05]">
            <div className="inline-flex rounded-lg bg-slate-100/80 p-0.5 dark:bg-slate-800/70">
              <button
                type="button"
                onClick={() => setSpendTab("phase")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  spendTab === "phase"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                )}
              >
                Par phase
              </button>
              <button
                type="button"
                onClick={() => setSpendTab("account")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  spendTab === "account"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                )}
              >
                Par compte
              </button>
            </div>
            {tree ? (
              <SplitBar
                items={spendTab === "phase" ? spendByPhase : spendByAccount}
                total={metaSpend}
                format={formatCurrency}
                columns={1}
              />
            ) : (
              <div className="h-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            )}
          </div>
        ) : null}
      </div>

      <div className="order-2 grid grid-cols-3 gap-1.5 lg:order-3">
        <div className="min-w-0 rounded-xl bg-white px-2 py-1.5 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
          <div className="flex items-center gap-1">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400">
              Spend Meta · total
            </p>
            <span className="hidden sm:inline">
              <TzBadge source="meta" />
            </span>
          </div>
          <p className="mt-0.5 truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-50 sm:text-[17px]">
            {loading && !tree ? "—" : formatCurrency(metaSpendTotal)}
          </p>
          <p className="mt-0.5 truncate text-[9.5px] tabular-nums text-slate-400" title="Toute la dépense des comptes sur la période, campagnes coupées comprises. En dessous : la part des campagnes affichées (filtre Actifs / recherche).">
            {loading && !tree ? " " : `dont ${activeOnly ? "actifs" : query.trim() ? "recherche" : "affiché"} ${formatCurrency(metaSpend)}`}
          </p>
        </div>

        <div className="min-w-0 rounded-xl bg-white px-2 py-1.5 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
          <div className="flex items-center gap-1">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400">
              Shopify
            </p>
            <span className="hidden sm:inline">
              <TzBadge source="shopify" />
            </span>
          </div>
          <p className="mt-0.5 truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-50 sm:text-[17px]">
            {shopifyLoading ? "—" : shopify ? formatCurrency(shopify.netSales) : "—"}
          </p>
          <p className="mt-0.5 truncate text-[9.5px] tabular-nums text-slate-400">
            {shopify ? `${formatNumber(shopify.orders)} commande${shopify.orders > 1 ? "s" : ""}` : "\u00a0"}
          </p>
        </div>

        <div className="min-w-0 rounded-xl bg-white px-2 py-1.5 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400">
            ROAS
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums sm:text-[17px]",
              !shopify || !metaSpendTotal ? "text-slate-400" : roasToneFor(shopifyRoas, objectives?.thresholds ?? null)
            )}
          >
            {shopifyLoading || (loading && !tree)
              ? "—"
              : shopify && metaSpendTotal
                ? shopifyRoas.toFixed(2)
                : "—"}
          </p>
          <p className="mt-0.5 truncate text-[9.5px] tabular-nums text-slate-400">
            {objectives?.thresholds.breakeven != null ? `ROAS réel : Shopify ÷ spend total · minimum ${objectives.thresholds.breakeven.toFixed(2)}` : " "}
          </p>
        </div>
      </div>

      {/* Les comptes (prêts, en warm, à surveiller, morts) : tout en bas, après les campagnes. */}
      <div className="order-7 grid gap-2 md:grid-cols-2 lg:order-7">
        {isAssociate ? null : (
        <div className="hidden rounded-xl bg-white ring-1 ring-slate-900/[0.06] md:block dark:bg-slate-900/70 dark:ring-white/[0.06]">
          <button
            type="button"
            onClick={() => setAgencyOpen((value) => !value)}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
                agencyOpen && "rotate-90"
              )}
            />
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Agence · BM
            </span>
            {(tree?.stats.newAccounts ?? 0) > 0 ? (
              <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
                {tree?.stats.newAccounts} new
              </span>
            ) : null}
            {storedTokens.length ? (
              <span className="truncate text-[10px] text-slate-400">
                {storedTokens.length} token{storedTokens.length > 1 ? "s" : ""}
              </span>
            ) : null}
            <span className="ml-auto hidden text-[10px] text-slate-400 sm:inline">
              {agencyOpen ? "fermer" : "nom BM + token"}
            </span>
          </button>

          {agencyOpen ? (
            <div className="space-y-2 border-t border-slate-900/[0.05] px-2.5 py-2 dark:border-white/[0.05]">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void toggleAutoDetect()}
                  className={cn(
                    "h-6 rounded-md px-1.5 text-[10px] font-medium transition-colors",
                    autoDetect
                      ? "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                      : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  )}
                >
                  Auto-detect {autoDetect ? "on" : "off"}
                </button>
                {(tree?.stats.newAccounts ?? 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => void acknowledgeNew()}
                    className="h-6 rounded-md px-1.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-900/10 dark:text-slate-300 dark:ring-white/10"
                  >
                    Marquer vus
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowOther((value) => !value)}
                  className={cn(
                    "h-6 rounded-md px-1.5 text-[10px] font-medium transition-colors",
                    showOther
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  )}
                >
                  Non catégorisé {otherCount ? `(${otherCount})` : ""}
                </button>
              </div>

              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <input
                  value={agencyLabel}
                  onChange={(event) => setAgencyLabel(event.target.value)}
                  placeholder="Nom du BM"
                  className="h-8 w-full rounded-lg bg-slate-50 px-2.5 text-[11px] text-slate-700 outline-none ring-1 ring-transparent focus:bg-white focus:ring-slate-900/10 sm:w-44 dark:bg-slate-800 dark:text-slate-200"
                />
                <input
                  value={agencyToken}
                  onChange={(event) => setAgencyToken(event.target.value)}
                  placeholder="Coller le token Meta…"
                  className="h-8 min-w-0 flex-1 rounded-lg bg-slate-50 px-2.5 font-mono text-[11px] text-slate-700 outline-none ring-1 ring-transparent focus:bg-white focus:ring-slate-900/10 dark:bg-slate-800 dark:text-slate-200"
                />
                <button
                  type="button"
                  disabled={agencyBusy || !agencyToken.trim() || !agencyLabel.trim()}
                  onClick={() => void addAgencyToken()}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[11px] font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  {agencyBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Ajouter
                </button>
              </div>

              {storedTokens.length ? (
                <p className="truncate text-[10px] text-slate-400">
                  {storedTokens.map((row) => row.label).join(" · ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        )}

        <AccountFlow
          accounts={flowAccounts}
          busy={busy}
          onKill={killAccount}
          onWrite={write}
          onZip={downloadZip}
        />
      </div>

      <div className="order-3 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.06] lg:order-5 dark:bg-slate-900/70 dark:ring-white/[0.06]">
        <div className="space-y-2 px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="min-w-0 rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                Achats
              </p>
              <p className="mt-0.5 text-[17px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-50">
                {formatNumber(totals.purchases)}
              </p>
            </div>

            <div
              className="min-w-0 rounded-xl bg-[#ecfdf5] px-2.5 py-2 dark:bg-emerald-500/10"
              title="Budget journalier total des campagnes ON affichées"
            >
              <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">
                Budget / jour
              </p>
              <p className="mt-0.5 truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums text-emerald-900 sm:text-[17px] dark:text-emerald-100">
                {formatCurrency(dailyBudget)}
              </p>
            </div>
          </div>

          {refillAdsets.length ? (
            <div
              className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 ring-1 ring-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100"
              title={refillAdsets.map((adset) => `${adset.name} : ${liveCreatives(adset)} créa`).join(" · ")}
            >
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0">
                <span className="font-semibold">
                  {refillAdsets.length} ad set{refillAdsets.length > 1 ? "s" : ""} à réalimenter
                </span>{" "}
                (moins de 3 créas actives) : {refillAdsets.slice(0, 4).map((adset) => `${adset.name} (+${missingCreatives(adset)})`).join(" · ")}
                {refillAdsets.length > 4 ? ` · +${refillAdsets.length - 4}` : ""}
              </span>
            </div>
          ) : null}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveOnly((value) => !value)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-colors",
                activeOnly
                  ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/20"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  activeOnly ? "bg-white" : "bg-slate-400"
                )}
              />
              Actifs
            </button>
            {hiddenAdIds.size ? (
              <button
                type="button"
                onClick={restoreHiddenAds}
                title="Réafficher les créas masquées localement (rien sur Meta)"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <EyeOff className="h-3 w-3" />
                {hiddenAdIds.size} cachée{hiddenAdIds.size > 1 ? "s" : ""}
              </button>
            ) : null}
            <button
              type="button"
              onClick={openNormalize}
              title="Lister les pubs affichées hors convention (S45_MIX1_CONCEPT_VARIANTE) et les renommer une par une"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Pencil className="h-3 w-3" />
              Normaliser
            </button>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Produit, ad set, pub…"
                className="h-8 w-full rounded-lg bg-slate-50 pl-8 pr-2.5 text-[11px] text-slate-700 outline-none ring-1 ring-transparent transition-all placeholder:text-slate-400 focus:bg-white focus:ring-emerald-500/30 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
          </div>
        </div>
      </div>

      {loading && !tree ? (
        <div className="order-4 flex h-40 items-center justify-center rounded-2xl bg-white ring-1 ring-slate-900/[0.06] lg:order-6 dark:bg-slate-900/70">
          <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
        </div>
      ) : null}

      {error && !tree ? (
        <div className="order-4 rounded-2xl bg-white p-6 text-center ring-1 ring-slate-900/[0.06] lg:order-6 dark:bg-slate-900/70">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Meta indisponible</p>
          <p className="mt-1 text-xs text-slate-500">{error}</p>
        </div>
      ) : null}

      {tree ? (
        <div className="order-4 space-y-2.5 lg:order-6">
          <RenameDialogHost />
          <MobilePilot
            groups={groups}
            busy={busy}
            onWrite={write}
            onOpenAd={setPanelAd}
            onZip={downloadZip}
            onHideAd={hideAd}
          />

          <div
            className={cn(
              "hidden space-y-2.5 transition-opacity duration-200 lg:block",
              refreshing ? "opacity-70" : "opacity-100"
            )}
          >
            <div className="min-w-0 space-y-2.5">
              <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-slate-100/80 p-0.5 dark:bg-slate-800/70">
                {PHASE_TABS.map((bucket) => {
                  const group = groups.find((item) => item.bucket === bucket);
                  const count = group?.campaignCount ?? 0;
                  const budget = group?.dailyBudget ?? 0;
                  const selected = phaseTab === bucket;
                  return (
                    <button
                      key={bucket}
                      type="button"
                      onClick={() => setPhaseTab(bucket)}
                      className={cn(
                        "flex min-w-0 items-center justify-center gap-1 overflow-hidden rounded-md px-1.5 py-1 whitespace-nowrap transition-colors",
                        selected
                          ? "bg-white shadow-sm dark:bg-slate-900"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                      )}
                    >
                      <span
                        className={cn(
                          "text-[10px] font-semibold",
                          selected ? "text-slate-900 dark:text-slate-50" : ""
                        )}
                      >
                        {PHASE_TAB_SHORT[bucket]}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] tabular-nums",
                          selected ? "text-slate-600 dark:text-slate-300" : "text-slate-400"
                        )}
                      >
                        {count}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-semibold tabular-nums",
                          selected ? "text-slate-900 dark:text-slate-50" : "text-slate-400"
                        )}
                        title="Budget journalier total — campagnes ON uniquement"
                      >
                        {budget ? formatCurrency(budget) : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!error
                ? (() => {
                    const group = groups.find((item) => item.bucket === phaseTab);
                    if (!group) {
                      return (
                        <p className="py-10 text-center text-xs text-slate-400">
                          Aucune campagne — {BUCKET_LABELS[phaseTab]}
                        </p>
                      );
                    }
                    const tone = PHASE[group.bucket];
                    return (
                      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/10 dark:bg-slate-900/70 dark:ring-white/10">
                        <div className="flex items-center gap-2 border-b border-slate-900/[0.05] px-2.5 py-1 dark:border-white/[0.05]">
                          <span className={cn("h-4 w-1 shrink-0 rounded-full", tone.rail)} />
                          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-900 dark:text-slate-50">
                            {BUCKET_LABELS[group.bucket]}
                          </p>
                          <span
                            className="shrink-0 text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
                            title="Budget journalier total — campagnes ON"
                          >
                            {group.dailyBudget ? formatCurrency(group.dailyBudget) : "—"}
                            <span className="ml-0.5 text-[9px] font-medium text-emerald-600/70 dark:text-emerald-400/70">
                              /j
                            </span>
                          </span>
                        </div>
                        <ColumnHeader sort={sort} onSort={changeSort} />
                        {sortAccounts(group.accounts, sort).flatMap((account) => [
                          <AccountHeader key={`acc-${account.accountId}`} account={account} />,
                          ...liveFirst(account.campaigns, sort).map((campaign) => (
                            <CampaignRow
                              key={campaign.id}
                              campaign={campaign}
                              account={account}
                              open={open}
                              busy={busy}
                              onToggle={toggle}
                              onWrite={write}
                              onRenameAd={renameAd}
                              onZip={downloadZip}
                              onAdDownload={downloadAd}
                              onOpenAd={setPanelAd}
                              hsAdIds={hsAdIds}
                              deadAdIds={deadAdIds}
                              deadCampaignIds={deadCampaignIds}
                              onHideAd={hideAd}
                              sort={sort}
                            />
                          )),
                        ])}
                      </section>
                    );
                  })()
                : null}

              {!error && showOther
                ? groups
                    .filter((group) => group.bucket === "other")
                    .map((group) => (
                      <section
                        key="other"
                        className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70"
                      >
                        <div className="border-b border-slate-900/[0.05] px-2.5 py-1 text-[11px] font-semibold dark:border-white/[0.05]">
                          {BUCKET_LABELS.other} ({group.campaignCount})
                        </div>
                        <ColumnHeader sort={sort} onSort={changeSort} />
                        {sortAccounts(group.accounts, sort).flatMap((account) => [
                          <AccountHeader key={`acc-${account.accountId}`} account={account} />,
                          ...liveFirst(account.campaigns, sort).map((campaign) => (
                            <CampaignRow
                              key={campaign.id}
                              campaign={campaign}
                              account={account}
                              open={open}
                              busy={busy}
                              onToggle={toggle}
                              onWrite={write}
                              onRenameAd={renameAd}
                              onZip={downloadZip}
                              onAdDownload={downloadAd}
                              onOpenAd={setPanelAd}
                              hsAdIds={hsAdIds}
                              deadAdIds={deadAdIds}
                              deadCampaignIds={deadCampaignIds}
                              onHideAd={hideAd}
                              sort={sort}
                            />
                          )),
                        ])}
                      </section>
                    ))
                : null}
            </div>
          </div>
        </div>
      ) : null}

      <CreativePanel adId={panelAd} onOpenChange={(next) => !next && setPanelAd(null)} />
    </div>
    </ProductThresholdsContext.Provider>
    </RoasBreakevenContext.Provider>
  );
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

type RowShared = {
  open: Record<string, boolean>;
  busy: Record<string, boolean>;
  onToggle: (key: string) => void;
  onWrite: (
    level: EntityLevel,
    id: string,
    patch: { status?: EntityStatus; dailyBudget?: number; name?: string },
    label: string
  ) => Promise<void>;
  /** Renomme une pub chez Meta (même route que onWrite), sans écraser les autres renommages en cours. */
  onRenameAd: (id: string, name: string) => Promise<void>;
  onZip: (ids: string[], label: string, key: string) => Promise<void>;
  onAdDownload: (ad: AdNode) => Promise<void>;
  onOpenAd: (id: string) => void;
  onHideAd: (id: string) => void;
  hsAdIds: Map<string, PromoTarget>;
  deadAdIds: Set<string>;
  deadCampaignIds: Set<string>;
  sort: SortState;
};

/** Renomme une campagne, un ad set ou une pub, après saisie du nouveau nom. */
const RENAME_TITLE: Record<EntityLevel, string> = { campaign: "Renommer la campagne", adset: "Renommer l'ad set", ad: "Renommer la pub" };

function askRename(shared: RowShared, level: EntityLevel, id: string, current: string, naming?: { adsetName: string; createdTime: string }) {
  // Une pub : la fenêtre pré-remplit S{semaine du lancement}_{MIX de l'ad set}_ ; il reste CONCEPT et VARIANTE.
  void askName(RENAME_TITLE[level], current, naming ? namingContextFor(naming.adsetName, naming.createdTime) : undefined).then((next) => {
    if (next) void shared.onWrite(level, id, { name: next }, "Renommé sur Meta");
  });
}

function RenameChip({ onClick }: { onClick: () => void }) {
  return (
    <ActionChip label="Renommer" title="Renommer sur Meta" onClick={onClick}>
      <Pencil className="h-2.5 w-2.5" />
    </ActionChip>
  );
}

function countAlertsInCampaign(
  campaign: CampaignNode,
  hsAdIds: Map<string, PromoTarget>,
  deadAdIds: Set<string>
) {
  let hs = 0;
  let dead = 0;
  for (const adset of campaign.adsets) {
    for (const ad of adset.ads) {
      if (hsAdIds.has(ad.id)) hs += 1;
      if (deadAdIds.has(ad.id)) dead += 1;
    }
  }
  return { hs, dead };
}

/** Une campagne d'un autre produit (39,99 $…) est colorée avec les seuils de ce produit. */
function CampaignRow(props: RowShared & { campaign: CampaignNode; account: AccountNode }) {
  const products = useContext(ProductThresholdsContext);
  const hit = products.find((product) => new RegExp(product.pattern, "i").test(props.campaign.name));
  const row = <CampaignRowInner {...props} />;
  return hit ? <RoasBreakevenContext.Provider value={hit.thresholds}>{row}</RoasBreakevenContext.Provider> : row;
}

function CampaignRowInner({
  campaign,
  account,
  ...shared
}: RowShared & { campaign: CampaignNode; account: AccountNode }) {
  const key = `c:${campaign.id}`;
  const isOpen = shared.open[key] ?? false;
  const zipKey = `zip-${key}`;
  const dead = shared.deadCampaignIds.has(campaign.id);
  const alerts = countAlertsInCampaign(campaign, shared.hsAdIds, shared.deadAdIds);
  const refillCount = adsetsToRefill(campaign).length;
  const currency = account.currency;

  return (
    <div className="border-b border-slate-900/[0.04] last:border-0 dark:border-white/[0.04]">
      <HoverRow
        className={cn(
          "cursor-pointer pl-2.5",
          dead
            ? "bg-rose-50/80 ring-1 ring-inset ring-rose-500/20 dark:bg-rose-500/10 dark:ring-rose-400/20"
            : "bg-slate-50/40 dark:bg-slate-800/15"
        )}
        onClick={() => shared.onToggle(key)}
      >
        <Chevron open={isOpen} />
        <KindBadge kind="campagne" />
        <StatusToggle
          status={campaign.status}
          disabled={shared.busy[campaign.id]}
          onToggle={(next) =>
            void shared.onWrite(
              "campaign",
              campaign.id,
              { status: next },
              next === "ACTIVE" ? "Campagne activée" : "Campagne en pause"
            )
          }
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-semibold text-slate-900 dark:text-slate-50">
              {campaign.name}
            </span>
            <span
              title={account.name}
              className="hidden max-w-[6.5rem] shrink-0 truncate rounded bg-slate-100 px-1 py-px text-[9px] font-medium text-slate-500 sm:inline dark:bg-slate-800 dark:text-slate-400"
            >
              {account.name}
            </span>
            {alerts.hs ? (
              <span className="shrink-0 rounded bg-emerald-600/90 px-1 py-px text-[7px] font-bold uppercase tracking-wide text-white">
                {alerts.hs} promo
              </span>
            ) : null}
            {alerts.dead ? (
              <span className="shrink-0 rounded bg-rose-600/90 px-1 py-px text-[7px] font-bold uppercase tracking-wide text-white">
                {alerts.dead} sans vente
              </span>
            ) : null}
            {refillCount ? (
              <span
                title="Ad sets allumés avec moins de 3 créas actives : à réalimenter"
                className="shrink-0 rounded bg-amber-500 px-1 py-px text-[7px] font-bold uppercase tracking-wide text-white"
              >
                {refillCount} à refill
              </span>
            ) : null}
          </div>
          <RenameChip onClick={() => askRename(shared, "campaign", campaign.id, campaign.name)} />
          <ActionChip
            label="Créa"
            tone="solid"
            title="Télécharger les créa de la campagne"
            busy={shared.busy[zipKey]}
            onClick={() => void shared.onZip(adIdsOfCampaign(campaign), campaign.name, zipKey)}
          >
            <Download className="h-2.5 w-2.5" />
          </ActionChip>
        </div>
        <MetricsRail
          budget={
            <BudgetCell
              tone="quiet"
              value={campaign.dailyBudget}
              currency={currency}
              editable={campaign.budgetLevel === "campaign"}
              onSave={(next) =>
                shared.onWrite("campaign", campaign.id, { dailyBudget: next }, "Budget campagne mis à jour")
              }
            />
          }
          metrics={campaign.metrics}
        />
      </HoverRow>

      {isOpen
        ? liveFirst(campaign.adsets, shared.sort).map((adset) => (
            <AdsetRow
              key={adset.id}
              adset={adset}
              currency={currency}
              cbo={campaign.budgetLevel === "campaign"}
              {...shared}
            />
          ))
        : null}
    </div>
  );
}

/** Les comptes d'une phase : selon la colonne triée, sinon le plus dépensier d'abord. */
function sortAccounts(accounts: AccountNode[], sort: SortState) {
  const withCampaigns = accounts.filter((account) => account.campaigns.length);
  return sort ? sortRows(withCampaigns, sort) : withCampaigns.sort((a, b) => b.metrics.spend - a.metrics.spend);
}

/** Le titre d'un compte pub dans une phase : ses campagnes suivent, jusqu'au compte suivant. */
function AccountHeader({ account }: { account: AccountNode }) {
  const budget = account.campaigns.filter((campaign) => campaign.status === "ACTIVE").reduce((sum, campaign) => sum + (campaign.dailyBudget || 0), 0);
  return (
    <div className="flex items-center gap-2 border-y border-slate-900/[0.06] bg-slate-50/90 px-2.5 py-1.5 dark:border-white/[0.06] dark:bg-slate-800/60">
      <span className="h-3.5 w-1 shrink-0 rounded-full bg-[#1877F2]" />
      <p className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200" title={`Compte pub ${account.accountId}`}>
        {account.name}
      </p>
      <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
        {account.campaigns.length} campagne{account.campaigns.length > 1 ? "s" : ""}
        {budget ? ` · ${formatCurrency(budget)}/j` : ""}
      </span>
    </div>
  );
}

function AdsetRow({
  adset,
  currency,
  cbo,
  ...shared
}: RowShared & { adset: AdsetNode; currency: string; cbo: boolean }) {
  const key = `s:${adset.id}`;
  const isOpen = shared.open[key] ?? false;
  const zipKey = `zip-${key}`;
  const live = liveCreatives(adset);
  const refill = needsRefill(adset);

  return (
    <div>
      <HoverRow className="cursor-pointer pl-7" onClick={() => shared.onToggle(key)}>
        <Chevron open={isOpen} />
        <KindBadge kind="adset" />
        <StatusToggle
          status={adset.status}
          disabled={shared.busy[adset.id]}
          onToggle={(next) =>
            void shared.onWrite(
              "adset",
              adset.id,
              { status: next },
              next === "ACTIVE" ? "Ad set activé" : "Ad set en pause"
            )
          }
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700 dark:text-slate-200">
            {adset.name}
          </span>
          <CreatedPill value={adset.createdTime} />
          <RenameChip onClick={() => askRename(shared, "adset", adset.id, adset.name)} />
          {adset.ads.length ? (
            <ActionChip
              label="Renommer les pubs"
              title="Renommer tout l'ad set : S45_MIX1_CONCEPT_V1, V2, V3… (CONCEPT tapé une fois, aperçu avant)"
              onClick={() =>
                openNamingPanel({
                  kind: "adset",
                  adsetName: adset.name,
                  ads: adset.ads.map((ad) => ({ id: ad.id, name: ad.name, createdTime: ad.createdTime })),
                  onRename: shared.onRenameAd,
                })
              }
            >
              <Pencil className="h-2.5 w-2.5" />
            </ActionChip>
          ) : null}
          {(() => {
            const off = adset.ads.filter((ad) => ad.status !== "ACTIVE");
            if (!off.length) return null;
            return (
              <ActionChip
                label={`Archiver les off (${off.length})`}
                title="Archiver chez Meta toutes les pubs coupées de cet ad set"
                onClick={() => {
                  if (!window.confirm(`Archiver chez Meta les ${off.length} pub${off.length > 1 ? "s" : ""} coupée${off.length > 1 ? "s" : ""} de « ${adset.name} » ?\n\n${off.map((ad) => `• ${ad.name}`).join("\n")}`)) return;
                  void (async () => {
                    let done = 0;
                    for (const ad of off) {
                      const res = await fetch("/api/meta/entity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ad.id, level: "ad", status: "ARCHIVED" }) });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        toast.error(`${ad.name} : ${body.error || "Meta a refusé l'archivage"}`);
                        continue;
                      }
                      shared.onHideAd(ad.id);
                      done += 1;
                    }
                    if (done) toast.success(`${done} pub${done > 1 ? "s" : ""} archivée${done > 1 ? "s" : ""}`);
                  })();
                }}
              >
                <Archive className="h-2.5 w-2.5" />
              </ActionChip>
            );
          })()}
          <ActionChip
            label="Créa"
            tone="green"
            title="Télécharger les créa de l'ad set"
            busy={shared.busy[zipKey]}
            onClick={() => void shared.onZip(adIdsOfAdset(adset), adset.name, zipKey)}
          >
            <Download className="h-2.5 w-2.5" />
          </ActionChip>
          {refill ? (
            <span
            title={`${live} créa active${live > 1 ? "s" : ""} sur 3 : il en manque ${missingCreatives(adset)} (un ad set tourne avec 3 à 4 créas)`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-white"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Refill +{missingCreatives(adset)} créa{missingCreatives(adset) > 1 ? "s" : ""}
          </span>
          ) : (
            <span className="hidden shrink-0 rounded px-1 py-px text-[8px] font-medium text-emerald-700 ring-1 ring-emerald-500/30 sm:inline dark:text-emerald-300">
              {live} créa
            </span>
          )}
        </div>
        <MetricsRail
          budget={
            <BudgetCell
              value={adset.dailyBudget}
              currency={currency}
              editable={!cbo}
              onSave={(next) =>
                shared.onWrite("adset", adset.id, { dailyBudget: next }, "Budget ad set mis à jour")
              }
            />
          }
          metrics={adset.metrics}
        />
      </HoverRow>

      {isOpen
        ? orderAds(adset.ads, shared.sort).map((ad) => <AdRow key={ad.id} ad={ad} adsetName={adset.name} {...shared} />)
        : null}
    </div>
  );
}

function AdRow({ ad, adsetName, ...shared }: RowShared & { ad: AdNode; adsetName: string }) {
  const dead = shared.deadAdIds.has(ad.id);
  const hs = shared.hsAdIds.get(ad.id);
  const paused = ad.status !== "ACTIVE";
  const m = ad.metrics;

  return (
    <HoverRow
      data-ad-id={ad.id}
      className={cn(
        "flex-wrap items-start gap-y-1.5 pl-11 transition-shadow duration-300",
        paused && "opacity-55 grayscale-[0.45]",
        dead && !paused && "bg-rose-50/90 ring-1 ring-inset ring-rose-500/25 dark:bg-rose-500/15 dark:ring-rose-400/25",
        dead && paused && "bg-slate-100/80 ring-1 ring-inset ring-slate-400/25 dark:bg-slate-800/50 dark:ring-slate-500/25",
        hs && !dead && !paused && "bg-emerald-50/70 ring-1 ring-inset ring-emerald-500/20 dark:bg-emerald-500/10 dark:ring-emerald-400/20"
      )}
    >
      <HoverPreview
        adId={ad.id}
        thumbnail={ad.thumbnailUrl}
        onOpen={() => shared.onOpenAd(ad.id)}
        className="mt-0.5 shrink-0"
      >
        <button
          type="button"
          onClick={() => shared.onOpenAd(ad.id)}
          className="block h-6 w-6 overflow-hidden rounded-md bg-slate-100 ring-1 ring-slate-900/[0.06] dark:bg-slate-800"
        >
          {ad.thumbnailUrl ? (
            <img src={ad.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="m-1 h-4 w-4 text-slate-300" />
          )}
        </button>
      </HoverPreview>
      <KindBadge kind="creative" />
      <StatusToggle
        status={ad.status}
        disabled={shared.busy[ad.id]}
        onToggle={(next) =>
          void shared.onWrite(
            "ad",
            ad.id,
            { status: next },
            next === "ACTIVE" ? "Publicité activée" : "Publicité en pause"
          )
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <InlineRename id={ad.id} name={ad.name} onSave={(next) => shared.onRenameAd(ad.id, next)}>
            <CreativeName
              name={ad.name}
              max={48}
              className={cn("min-w-0", paused && "text-slate-500 dark:text-slate-400")}
            />
          </InlineRename>
          {paused ? (
            <span className="shrink-0 rounded-md bg-slate-400/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
              Off
            </span>
          ) : null}
          {hs && !paused ? <HsBadge adId={ad.id} metrics={m} target={hs} /> : null}
          {dead ? (
            <span
              title={`Spend sans vente · ${formatCurrency(m.spend)} · CPC ${m.cpc.toFixed(2)}`}
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white",
                paused ? "bg-slate-500" : "bg-rose-600"
              )}
            >
              Sans vente
            </span>
          ) : null}
          <CreatedPill value={ad.createdTime} />
        </div>
        <CreativeActions
          ad={ad}
          busy={shared.busy[`dl-${ad.id}`]}
          onOpen={() => shared.onOpenAd(ad.id)}
          onDownload={() => void shared.onAdDownload(ad)}
          onRename={() => askRename(shared, "ad", ad.id, ad.name, { adsetName, createdTime: ad.createdTime })}
          onArchive={
            ad.status !== "ACTIVE"
              ? () => {
                  if (window.confirm(`Archiver « ${ad.name} » chez Meta ?\nElle disparaît des listes ; ses chiffres restent consultables dans Meta.`)) {
                    void shared.onWrite("ad", ad.id, { status: "ARCHIVED" }, "Pub archivée");
                  }
                }
              : undefined
          }
        />
      </div>
      <MetricsRail metrics={ad.metrics} />
    </HoverRow>
  );
}
