"use client";

/* eslint-disable @next/next/no-img-element -- fbcdn URLs are signed and short-lived, the optimizer cannot cache them. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  EyeOff,
  ExternalLink,
  FolderDown,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency, formatCreatedFr, formatNumber } from "@/lib/utils";
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
import { TzBadge } from "@/components/phoenix/source-clocks";
import { SplitBar } from "@/components/phoenix/ui";
import { AccountFlow } from "@/components/ads/account-flow";
import { collectAdsAlerts } from "@/components/ads/alerts-rail";
import { MobilePilot } from "@/components/ads/mobile-pilot";
import { BudgetCell, CreativeName, HoverPreview, StatusToggle, loadCreative } from "@/components/ads/bits";
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

function roasClass(roas: number) {
  if (!roas) return "text-slate-400";
  return roas >= 1.2
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
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
      <Cell width={COL.cpc}>{metrics.cpc ? metrics.cpc.toFixed(2) : "—"}</Cell>
      <Cell width={COL.ctr}>{metrics.ctr ? `${metrics.ctr.toFixed(1)}%` : "—"}</Cell>
      <Cell width={COL.roas} strong className={roasClass(metrics.roas)}>
        {metrics.roas ? metrics.roas.toFixed(2) : "—"}
      </Cell>
      <span className={cn("flex shrink-0 items-center justify-end", COL.actions)}>
        {actions ?? null}
      </span>
    </div>
  );
}

function ColumnHeader() {
  return (
    <div className="flex items-center gap-2 border-b border-slate-900/[0.06] bg-slate-50/60 px-2.5 py-1.5 dark:border-white/[0.06] dark:bg-slate-800/30">
      <span className="min-w-0 flex-1" />
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        <span className={cn("hidden shrink-0 text-right lg:block", COL.budget)}>Budget/j</span>
        <span className={cn("shrink-0 text-right", COL.spend)}>Dépense</span>
        <span className={cn("shrink-0 text-right", COL.purchases)}>Achats</span>
        <span className={cn("shrink-0 text-right", COL.cpc)}>CPC</span>
        <span className={cn("shrink-0 text-right", COL.ctr)}>CTR</span>
        <span className={cn("shrink-0 text-right", COL.roas)}>ROAS</span>
        <span className={cn("shrink-0", COL.actions)} />
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: "campagne" | "adset" | "creative" }) {
  const label = kind === "campagne" ? "CAMPAGNE" : kind === "adset" ? "ADSET" : "CRÉA";
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide",
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
      className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400"
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
    "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[9px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40",
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
}: {
  ad: AdNode;
  busy?: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onHide?: () => void;
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
      {onHide ? (
        <ActionChip
          label="Cacher"
          title="Masquer ici seulement — ne supprime rien sur Meta"
          onClick={onHide}
        >
          <EyeOff className="h-2.5 w-2.5" />
        </ActionChip>
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

function IconAction({
  title,
  busy,
  onClick,
  children,
}: {
  title: string;
  busy?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="rounded-md p-1 text-slate-400 opacity-60 transition-all hover:bg-slate-100 hover:text-slate-800 hover:opacity-100 disabled:opacity-40 group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : children}
    </button>
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
function patchTree(
  tree: AdsTree,
  level: EntityLevel,
  id: string,
  patch: { status?: EntityStatus; dailyBudget?: number }
): AdsTree {
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
  const [preset, setPreset] = useState<PresetKey>("today");
  const [range, setRange] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { start: today, end: today };
  });
  const [reloadKey, setReloadKey] = useState(0);
  const hardRefresh = useRef(false);
  const presetsWarmed = useRef(false);

  const [tree, setTree] = useState<AdsTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [hiddenAdIds, setHiddenAdIds] = useState<Set<string>>(() => new Set());
  const [phaseTab, setPhaseTab] = useState<PhaseTab>("hyperscaling");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [panelAd, setPanelAd] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [autoDetect, setAutoDetect] = useState(true);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [spendTab, setSpendTab] = useState<"phase" | "account">("phase");
  const [agencyToken, setAgencyToken] = useState("");
  const [agencyLabel, setAgencyLabel] = useState("");
  const [agencyBusy, setAgencyBusy] = useState(false);
  const [storedTokens, setStoredTokens] = useState<Array<{ id: string; label: string; hint: string }>>([]);
  const [shopify, setShopify] = useState<{
    netSales: number;
    orders: number;
    returns: number;
    currency: string;
  } | null>(null);
  const [shopifyLoading, setShopifyLoading] = useState(true);

  useEffect(() => {
    setHiddenAdIds(loadHiddenAdIds());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);

    (async () => {
      try {
        const params = new URLSearchParams(
          preset === "custom" ? { start: range.start, end: range.end } : { preset }
        );
        if (hardRefresh.current) {
          params.set("refresh", "1");
          hardRefresh.current = false;
        }

        const res = await fetch(`/api/meta/tree?${params}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Synchronisation impossible");
        setTree(body as AdsTree);
        setError(null);

        // One-shot warm of sibling presets (structure already cached server-side).
        if (!presetsWarmed.current) {
          presetsWarmed.current = true;
          const warm = (["today", "yesterday", "last_3d", "last_7d"] as PresetKey[]).filter(
            (key) => key !== preset
          );
          void Promise.allSettled(
            warm.map((key) => fetch(`/api/meta/tree?preset=${key}`).then((r) => r.json()))
          );
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Synchronisation impossible");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preset, range.start, range.end, reloadKey]);

  useEffect(() => {
    let cancelled = false;
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
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    const window = frRange(preset, range);
    setShopifyLoading(true);

    (async () => {
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

    return () => {
      cancelled = true;
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
      patch: { status?: EntityStatus; dailyBudget?: number },
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

  const otherCount = useMemo(
    () => tree?.groups.find((group) => group.bucket === "other")?.campaignCount ?? 0,
    [tree]
  );

  const totals = useMemo(() => sum(groups.map((group) => group.metrics)), [groups]);
  const dailyBudget = groups.reduce((acc, group) => acc + group.dailyBudget, 0);
  const shown = frRange(preset, range);
  // Spend Meta suit la vue (Actifs / recherche) — sinon le KPI et « Spend · Actifs » divergent.
  const metaSpend = totals.spend;
  const shopifyRevenue = shopify?.netSales ?? 0;
  const shopifyRoas = metaSpend > 0 && shopify ? shopifyRevenue / metaSpend : 0;

  const adsAlerts = useMemo(() => collectAdsAlerts(groups), [groups]);
  const hsAdIds = useMemo(() => new Set(adsAlerts.hs.map((item) => item.adId)), [adsAlerts]);
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
    <div className="flex w-full flex-col gap-2.5 pb-8">
      {/* Header: stack on mobile, row on desktop */}
      <div className="order-1 flex flex-col gap-2 lg:order-1 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Ads Meta
          </h1>
          <p className="truncate text-[11px] text-slate-400">
            {tree
              ? `${tree.stats.accounts} comptes · sync ${(tree.syncMs / 1000).toFixed(1)} s · ${tree.tokensWorking}/${tree.tokensTotal} tokens`
              : "Synchronisation…"}
            {refreshing && tree ? " · maj…" : ""}
          </p>
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
              {activeOnly ? "Spend Meta · Actifs" : query.trim() ? "Spend Meta · Recherche" : "Spend Meta"}
            </p>
            <span className="hidden sm:inline">
              <TzBadge source="meta" />
            </span>
          </div>
          <p className="mt-0.5 truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-50 sm:text-[17px]">
            {loading && !tree ? "—" : formatCurrency(metaSpend)}
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
        </div>

        <div className="min-w-0 rounded-xl bg-white px-2 py-1.5 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400">
            ROAS
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[15px] font-semibold leading-none tracking-tight tabular-nums sm:text-[17px]",
              !shopify || !metaSpend
                ? "text-slate-400"
                : shopifyRoas >= 1.2
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
            )}
          >
            {shopifyLoading || (loading && !tree)
              ? "—"
              : shopify && metaSpend
                ? shopifyRoas.toFixed(2)
                : "—"}
          </p>
        </div>
      </div>

      <div className="order-6 grid gap-2 md:grid-cols-2 lg:order-4">
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
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <div className="hidden min-w-0 rounded-xl bg-slate-50 px-2.5 py-2 sm:block dark:bg-slate-800/60">
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

      {tree?.errors.length ? (
        <div className="order-4 flex gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900 ring-1 ring-amber-500/20 lg:order-6 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">
              {tree.tokensWorking}/{tree.tokensTotal} tokens actifs — de la dépense peut manquer.
            </p>
            <p className="truncate opacity-80">{tree.errors[0]}</p>
          </div>
        </div>
      ) : null}

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
              <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-slate-100/80 p-0.5 dark:bg-slate-800/70">
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
                        "rounded-lg px-2 py-2 text-center transition-colors",
                        selected
                          ? "bg-white shadow-sm dark:bg-slate-900"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                      )}
                    >
                      <p
                        className={cn(
                          "text-[12px] font-semibold",
                          selected ? "text-slate-900 dark:text-slate-50" : ""
                        )}
                      >
                        {BUCKET_LABELS[bucket]}
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-[11px] font-semibold tabular-nums",
                          selected ? "text-slate-700 dark:text-slate-200" : "text-slate-400"
                        )}
                      >
                        {count} camp.
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-[10px] font-semibold tabular-nums",
                          selected ? "text-slate-900 dark:text-slate-50" : "text-slate-400"
                        )}
                        title="Budget journalier total — campagnes ON uniquement"
                      >
                        {budget ? formatCurrency(budget) : "—"}/j
                      </p>
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
                        <div className="flex items-center gap-2 border-b border-slate-900/[0.05] px-2.5 py-2 dark:border-white/[0.05]">
                          <span className={cn("h-8 w-1 shrink-0 rounded-full", tone.rail)} />
                          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                            {BUCKET_LABELS[group.bucket]}
                          </p>
                          <span
                            className="shrink-0 text-[12px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
                            title="Budget journalier total — campagnes ON"
                          >
                            {group.dailyBudget ? formatCurrency(group.dailyBudget) : "—"}
                            <span className="ml-0.5 text-[10px] font-medium text-emerald-600/70 dark:text-emerald-400/70">
                              /j
                            </span>
                          </span>
                        </div>
                        <ColumnHeader />
                        {group.accounts.map((account) => (
                          <AccountRow
                            key={`${group.bucket}:${account.id}`}
                            account={account}
                            bucket={group.bucket}
                            open={open}
                            busy={busy}
                            onToggle={toggle}
                            onWrite={write}
                            onZip={downloadZip}
                            onAdDownload={downloadAd}
                            onOpenAd={setPanelAd}
                            hsAdIds={hsAdIds}
                            deadAdIds={deadAdIds}
                            deadCampaignIds={deadCampaignIds}
                            onHideAd={hideAd}
                          />
                        ))}
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
                        <div className="border-b border-slate-900/[0.05] px-2.5 py-2 text-[12px] font-semibold dark:border-white/[0.05]">
                          {BUCKET_LABELS.other} ({group.campaignCount})
                        </div>
                        <ColumnHeader />
                        {group.accounts.map((account) => (
                          <AccountRow
                            key={`other:${account.id}`}
                            account={account}
                            bucket="other"
                            open={open}
                            busy={busy}
                            onToggle={toggle}
                            onWrite={write}
                            onZip={downloadZip}
                            onAdDownload={downloadAd}
                            onOpenAd={setPanelAd}
                            hsAdIds={hsAdIds}
                            deadAdIds={deadAdIds}
                            deadCampaignIds={deadCampaignIds}
                            onHideAd={hideAd}
                          />
                        ))}
                      </section>
                    ))
                : null}
            </div>
          </div>
        </div>
      ) : null}

      <CreativePanel adId={panelAd} onOpenChange={(next) => !next && setPanelAd(null)} />
    </div>
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
    patch: { status?: EntityStatus; dailyBudget?: number },
    label: string
  ) => Promise<void>;
  onZip: (ids: string[], label: string, key: string) => Promise<void>;
  onAdDownload: (ad: AdNode) => Promise<void>;
  onOpenAd: (id: string) => void;
  onHideAd: (id: string) => void;
  hsAdIds: Set<string>;
  deadAdIds: Set<string>;
  deadCampaignIds: Set<string>;
};

function countAlertsInCampaign(
  campaign: CampaignNode,
  hsAdIds: Set<string>,
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

function AccountRow({
  account,
  bucket,
  ...shared
}: RowShared & { account: AccountNode; bucket: CampaignBucket }) {
  const key = `a:${bucket}:${account.id}`;
  const isOpen = shared.open[key] ?? false;
  const zipKey = `zip-${key}`;

  return (
    <div className="border-b border-slate-900/[0.04] last:border-0 dark:border-white/[0.04]">
      <HoverRow
        className="cursor-pointer pl-2.5"
        onClick={() => shared.onToggle(key)}
      >
        <Chevron open={isOpen} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-slate-800 dark:text-slate-100">{account.name}</span>
          {account.business ? (
            <span className="ml-1.5 rounded-md bg-slate-100 px-1 py-px text-[9px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {account.business}
            </span>
          ) : null}
          <span className="ml-1.5 text-[10px] text-slate-400">
            {account.campaigns.length} camp. · {account.currency}
          </span>
        </span>
        <MetricsRail
          budget={
            <span className="text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {account.dailyBudget ? `$${account.dailyBudget.toFixed(0)}` : "—"}
            </span>
          }
          metrics={account.metrics}
          actions={
            <IconAction
              title="Télécharger toutes les créa du compte"
              busy={shared.busy[zipKey]}
              onClick={() =>
                void shared.onZip(
                  account.campaigns.flatMap(adIdsOfCampaign),
                  account.name,
                  zipKey
                )
              }
            >
              <FolderDown className="h-3 w-3" />
            </IconAction>
          }
        />
      </HoverRow>

      {isOpen
        ? account.campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.id}
              campaign={campaign}
              currency={account.currency}
              {...shared}
            />
          ))
        : null}
    </div>
  );
}

function CampaignRow({
  campaign,
  currency,
  ...shared
}: RowShared & { campaign: CampaignNode; currency: string }) {
  const key = `c:${campaign.id}`;
  const isOpen = shared.open[key] ?? false;
  const zipKey = `zip-${key}`;
  const dead = shared.deadCampaignIds.has(campaign.id);
  const alerts = countAlertsInCampaign(campaign, shared.hsAdIds, shared.deadAdIds);

  return (
    <div>
      <HoverRow
        className={cn(
          "cursor-pointer pl-6",
          dead
            ? "bg-rose-50/80 ring-1 ring-inset ring-rose-500/20 dark:bg-rose-500/10 dark:ring-rose-400/20"
            : "bg-slate-50/30 dark:bg-slate-800/10"
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
            <span className="min-w-0 truncate text-[12px] font-medium text-slate-800 dark:text-slate-100">
              {campaign.name}
            </span>
            {alerts.hs ? (
              <span className="shrink-0 rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                {alerts.hs} HS
              </span>
            ) : null}
            {alerts.dead ? (
              <span className="shrink-0 rounded-md bg-rose-600/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                {alerts.dead} sans vente
              </span>
            ) : null}
            <CreatedPill value={campaign.createdTime} />
          </div>
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
        ? campaign.adsets.map((adset) => (
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

function AdsetRow({
  adset,
  currency,
  cbo,
  ...shared
}: RowShared & { adset: AdsetNode; currency: string; cbo: boolean }) {
  const key = `s:${adset.id}`;
  const isOpen = shared.open[key] ?? false;
  const zipKey = `zip-${key}`;

  return (
    <div>
      <HoverRow className="cursor-pointer pl-10" onClick={() => shared.onToggle(key)}>
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
          <ActionChip
            label="Créa"
            tone="green"
            title="Télécharger les créa de l'ad set"
            busy={shared.busy[zipKey]}
            onClick={() => void shared.onZip(adIdsOfAdset(adset), adset.name, zipKey)}
          >
            <Download className="h-2.5 w-2.5" />
          </ActionChip>
          <span className="hidden shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 ring-1 ring-emerald-500/30 sm:inline dark:text-emerald-300">
            {adset.activeAds} créa. active{adset.activeAds > 1 ? "s" : ""}
          </span>
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
        ? adset.ads.map((ad) => <AdRow key={ad.id} ad={ad} {...shared} />)
        : null}
    </div>
  );
}

function AdRow({ ad, ...shared }: RowShared & { ad: AdNode }) {
  const dead = shared.deadAdIds.has(ad.id);
  const hs = shared.hsAdIds.has(ad.id);
  const paused = ad.status !== "ACTIVE";
  const m = ad.metrics;

  return (
    <HoverRow
      data-ad-id={ad.id}
      className={cn(
        "flex-wrap items-start gap-y-1.5 pl-14 transition-shadow duration-300",
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
          <CreativeName
            name={ad.name}
            className={cn("min-w-0 flex-1", paused && "text-slate-500 dark:text-slate-400")}
          />
          {paused ? (
            <span className="shrink-0 rounded-md bg-slate-400/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
              Off
            </span>
          ) : null}
          {hs && !paused ? (
            <span
              title={`Potentiel promo HS · ${formatCurrency(m.spend)} · ${m.purchases} vente${m.purchases > 1 ? "s" : ""} · ROAS ${m.roas.toFixed(2)}`}
              className="shrink-0 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white"
            >
              Promo HS
            </span>
          ) : null}
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
          onHide={() => shared.onHideAd(ad.id)}
        />
      </div>
      <MetricsRail metrics={ad.metrics} />
    </HoverRow>
  );
}
