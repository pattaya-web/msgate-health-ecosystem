"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, EyeOff, Loader2, X } from "lucide-react";
import { cn, formatCurrency, formatCreatedFr, formatNumber, shortenCreativeName } from "@/lib/utils";
import { PHASE_TABS, BUCKET_LABELS, type CampaignBucket, type PhaseTab } from "@/lib/meta/buckets";
import { isAccountKilled, isCampaignLive } from "@/lib/meta/account-flow";
import type {
  AccountNode,
  AdNode,
  AdsetNode,
  BucketGroup,
  CampaignNode,
  EntityLevel,
  EntityStatus,
  Metrics,
} from "@/lib/meta/types";
import { BudgetCell, StatusToggle } from "@/components/ads/bits";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const PHASE_CHIP: Record<CampaignBucket, string> = {
  hyperscaling: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  scaling: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  testing: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  other: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function roasTone(roas: number) {
  if (!roas) return "text-slate-400";
  return roas >= 1.2
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

const money = (value: number) => (value >= 1000 ? formatCurrency(value) : `${value.toFixed(0)}$`);

/** Same columns as desktop: Spend · Achats · CPC · CTR · ROAS */
function StatRow({
  metrics,
  large,
  compact,
}: {
  metrics: Metrics;
  large?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-5 gap-0.5 text-center tabular-nums">
      {(
        [
          { label: "Spend", value: money(metrics.spend), className: "text-slate-900 dark:text-slate-50" },
          {
            label: "Achats",
            value: metrics.purchases ? formatNumber(metrics.purchases) : "—",
            className: "text-slate-900 dark:text-slate-50",
          },
          {
            label: "CPC",
            value: metrics.cpc ? metrics.cpc.toFixed(2) : "—",
            className: "text-slate-900 dark:text-slate-50",
          },
          {
            label: "CTR",
            value: metrics.ctr ? `${metrics.ctr.toFixed(1)}%` : "—",
            className: "text-slate-900 dark:text-slate-50",
          },
          {
            label: "ROAS",
            value: metrics.roas ? metrics.roas.toFixed(2) : "—",
            className: roasTone(metrics.roas),
          },
        ] as const
      ).map((cell) => (
        <div key={cell.label}>
          <p
            className={cn(
              "font-medium uppercase leading-none text-slate-400",
              compact ? "text-[7px]" : "text-[8px]"
            )}
          >
            {cell.label}
          </p>
          <p
            className={cn(
              "mt-0.5 font-semibold leading-none",
              compact ? "text-[10px]" : large ? "text-[13px]" : "text-[12px]",
              cell.className
            )}
          >
            {cell.value}
          </p>
        </div>
      ))}
    </div>
  );
}

type FlatCampaign = {
  key: string;
  bucket: CampaignBucket;
  account: AccountNode;
  campaign: CampaignNode;
};

function flattenCampaigns(groups: BucketGroup[]): FlatCampaign[] {
  const byCampaign = new Map<string, FlatCampaign>();

  for (const group of groups) {
    for (const account of group.accounts) {
      if (isAccountKilled(account)) continue;

      const live = account.campaigns.filter(isCampaignLive);
      if (!live.length) continue;

      for (const campaign of live) {
        if (byCampaign.has(campaign.id)) continue;
        byCampaign.set(campaign.id, {
          key: campaign.id,
          bucket: group.bucket,
          account,
          campaign,
        });
      }
    }
  }

  return [...byCampaign.values()].sort(
    (a, b) => b.campaign.metrics.spend - a.campaign.metrics.spend
  );
}

type WriteFn = (
  level: EntityLevel,
  id: string,
  patch: { status?: EntityStatus; dailyBudget?: number },
  label: string
) => Promise<void>;

type ZipFn = (ids: string[], label: string, key: string) => Promise<void>;

const adIdsOfAdset = (adset: AdsetNode) => adset.ads.map((ad) => ad.id);
const adIdsOfCampaign = (campaign: CampaignNode) => campaign.adsets.flatMap(adIdsOfAdset);

function DownloadBtn({
  busy,
  onClick,
  label = "Créa",
}: {
  busy?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      title="Télécharger les créa"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-6 items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 text-[9px] font-semibold text-emerald-700 disabled:opacity-50 dark:bg-emerald-500/15 dark:text-emerald-300"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Sheet shell (full-screen on phone)
 * ------------------------------------------------------------------ */

function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  layer = 80,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Higher for nested sheets (ad set over campaign). */
  layer?: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col justify-end bg-slate-950/40 lg:hidden"
      style={{ zIndex: layer }}
    >
      <button type="button" aria-label="Fermer" className="min-h-[12vh] shrink-0" onClick={onClose} />
      <div className="flex max-h-[88vh] min-h-0 flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950">
        <div className="relative flex shrink-0 items-center gap-1.5 border-b border-slate-900/[0.06] px-2.5 pb-2 pt-3 dark:border-white/[0.08]">
          <div className="absolute left-1/2 top-1.5 h-0.5 w-8 -translate-x-1/2 rounded-full bg-slate-200 dark:bg-slate-700" />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {title}
            </p>
            {subtitle ? (
              <p className="truncate text-[10px] text-slate-400">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 pt-1.5">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-slate-900/[0.06] bg-white px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-white/[0.08] dark:bg-slate-950">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ *
 * Centered popup (mobile ad set)
 * ------------------------------------------------------------------ */

function CenterPop({
  title,
  meta,
  roas,
  spend,
  onClose,
  children,
  layer = 90,
}: {
  title: string;
  meta?: string;
  roas?: number;
  spend?: string;
  onClose: () => void;
  children: React.ReactNode;
  layer?: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-slate-950/45 p-3 lg:hidden"
      style={{ zIndex: layer }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(82vh,560px)] w-full max-w-[340px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-950 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-2 border-b border-slate-900/[0.06] px-3 py-2.5 dark:border-white/[0.08]">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <p className="min-w-0 truncate text-[12px] font-semibold leading-snug text-slate-900 dark:text-slate-50">
                {title}
              </p>
              {roas != null ? (
                <span className={cn("shrink-0 text-[10px] font-semibold tabular-nums", roasTone(roas))}>
                  {roas ? `${roas.toFixed(2)}x` : "—"}
                </span>
              ) : null}
            </div>
            {meta ? <p className="mt-0.5 truncate text-[9px] text-slate-400">{meta}</p> : null}
          </div>
          {spend ? (
            <span className="shrink-0 pt-0.5 text-right text-[13px] font-semibold tabular-nums text-slate-900 dark:text-slate-50">
              {spend}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"
            aria-label="Fermer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ *
 * Creative row
 * ------------------------------------------------------------------ */

function AdPilot({
  ad,
  busy,
  onWrite,
  onOpen,
  onZip,
  onHide,
}: {
  ad: AdNode;
  busy: Record<string, boolean>;
  onWrite: WriteFn;
  onOpen: (adId: string) => void;
  onZip: ZipFn;
  onHide?: (adId: string) => void;
}) {
  const zipKey = `dl-${ad.id}`;
  const m = ad.metrics;
  const paused = ad.status !== "ACTIVE";
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 border-b border-slate-900/[0.04] py-1.5 last:border-0 dark:border-white/[0.04]",
        paused && "opacity-55 grayscale-[0.4]"
      )}
    >
      <StatusToggle
        status={ad.status}
        disabled={busy[ad.id]}
        onToggle={(next) =>
          void onWrite(
            "ad",
            ad.id,
            { status: next },
            next === "ACTIVE" ? "Pub activée" : "Pub en pause"
          )
        }
      />
      <button
        type="button"
        onClick={() => onOpen(ad.id)}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-[10px] font-medium",
          paused ? "text-slate-500 dark:text-slate-400" : "text-slate-800 dark:text-slate-100"
        )}
        title={ad.name}
      >
        {shortenCreativeName(ad.name?.trim() || ad.id, 14)}
        {paused ? " · off" : ""}
      </button>
      <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
        <span className="text-[10px] font-semibold text-slate-800 dark:text-slate-100">
          {money(m.spend)}
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          {m.purchases ? formatNumber(m.purchases) : "—"}
        </span>
        <span className={cn("text-[10px] font-semibold", roasTone(m.roas))}>
          {m.roas ? m.roas.toFixed(2) : "—"}
        </span>
      </div>
      {onHide ? (
        <button
          type="button"
          title="Cacher ici (pas Meta)"
          onClick={() => onHide(ad.id)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <EyeOff className="h-3 w-3" />
        </button>
      ) : null}
      <DownloadBtn
        busy={busy[zipKey]}
        onClick={() => void onZip([ad.id], ad.name || ad.id, zipKey)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ad set popup → créas
 * ------------------------------------------------------------------ */

function AdsetSheet({
  adset,
  accountName,
  currency,
  cbo,
  busy,
  onClose,
  onWrite,
  onOpenAd,
  onZip,
  onHideAd,
}: {
  adset: AdsetNode;
  accountName: string;
  currency: string;
  cbo: boolean;
  busy: Record<string, boolean>;
  onClose: () => void;
  onWrite: WriteFn;
  onOpenAd: (adId: string) => void;
  onZip: ZipFn;
  onHideAd?: (adId: string) => void;
}) {
  const ads = useMemo(
    () =>
      [...adset.ads]
        .filter((ad) => Boolean(ad.id))
        .sort((a, b) => b.metrics.spend - a.metrics.spend),
    [adset.ads]
  );
  const created = formatCreatedFr(adset.createdTime);

  return (
    <CenterPop
      title={adset.name}
      meta={`${accountName} · ${ads.length} créa${created ? ` · ${created}` : ""}`}
      roas={adset.metrics.roas}
      spend={money(adset.metrics.spend)}
      onClose={onClose}
    >
      {ads.length ? (
        ads.map((ad) => (
          <AdPilot
            key={ad.id}
            ad={ad}
            busy={busy}
            onWrite={onWrite}
            onOpen={onOpenAd}
            onZip={onZip}
            onHide={onHideAd}
          />
        ))
      ) : (
        <p className="py-6 text-center text-[10px] text-slate-400">Aucune créa</p>
      )}
    </CenterPop>
  );
}

/* ------------------------------------------------------------------ *
 * Campaign sheet → ad sets (clickable)
 * ------------------------------------------------------------------ */

function AdsetPilotRow({
  adset,
  currency,
  cbo,
  busy,
  onWrite,
  onOpen,
}: {
  adset: AdsetNode;
  currency: string;
  cbo: boolean;
  busy: Record<string, boolean>;
  onWrite: WriteFn;
  onOpen: () => void;
}) {
  const created = formatCreatedFr(adset.createdTime);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-left transition-colors active:bg-emerald-50 dark:bg-slate-900/80 dark:active:bg-emerald-500/10"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <StatusToggle
          status={adset.status}
          disabled={busy[adset.id]}
          onToggle={(next) =>
            void onWrite(
              "adset",
              adset.id,
              { status: next },
              next === "ACTIVE" ? "Ad set activé" : "Ad set en pause"
            )
          }
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <p className="min-w-0 truncate text-[10px] font-medium text-slate-800 dark:text-slate-100">
            {adset.name}
          </p>
          <span className={cn("shrink-0 text-[10px] font-semibold tabular-nums", roasTone(adset.metrics.roas))}>
            {adset.metrics.roas ? `${adset.metrics.roas.toFixed(2)}x` : "—"}
          </span>
        </div>
        <p className="mt-0.5 text-[8px] tabular-nums text-slate-400">
          {adset.ads.length} créa
          {created ? ` · ${created}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
        {money(adset.metrics.spend)}
      </span>
      <div onClick={(event) => event.stopPropagation()}>
        <BudgetCell
          value={adset.dailyBudget}
          currency={currency}
          editable={!cbo}
          onSave={(next) => onWrite("adset", adset.id, { dailyBudget: next }, "Budget ad set OK")}
        />
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
    </button>
  );
}

function CampaignSheet({
  row,
  busy,
  onClose,
  onWrite,
  onOpenAd,
  onZip,
  onHideAd,
}: {
  row: FlatCampaign;
  busy: Record<string, boolean>;
  onClose: () => void;
  onWrite: WriteFn;
  onOpenAd: (adId: string) => void;
  onZip: ZipFn;
  onHideAd?: (adId: string) => void;
}) {
  const { campaign, account, bucket } = row;
  const [adsetId, setAdsetId] = useState<string | null>(null);
  const selectedAdset = adsetId
    ? campaign.adsets.find((item) => item.id === adsetId) || null
    : null;
  const zipKey = `zip-c:${campaign.id}`;

  return (
    <>
      <Sheet
        open
        title={campaign.name}
        subtitle={`${account.name}${formatCreatedFr(campaign.createdTime) ? ` · créé ${formatCreatedFr(campaign.createdTime)}` : ""}`}
        onClose={onClose}
      >
        <div className="space-y-1.5">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
            <div className="flex items-center gap-1.5">
              <StatusToggle
                status={campaign.status}
                disabled={busy[campaign.id]}
                onToggle={(next) =>
                  void onWrite(
                    "campaign",
                    campaign.id,
                    { status: next },
                    next === "ACTIVE" ? "Campagne activée" : "Campagne en pause"
                  )
                }
              />
              <span className={cn("rounded px-1 py-px text-[9px] font-semibold", PHASE_CHIP[bucket])}>
                {BUCKET_LABELS[bucket]}
              </span>
              <DownloadBtn
                busy={busy[zipKey]}
                onClick={() => void onZip(adIdsOfCampaign(campaign), campaign.name, zipKey)}
              />
              <span className="ml-auto">
                <BudgetCell
                  tone="quiet"
                  value={campaign.dailyBudget}
                  currency={account.currency}
                  editable={campaign.budgetLevel === "campaign"}
                  onSave={(next) =>
                    onWrite("campaign", campaign.id, { dailyBudget: next }, "Budget campagne OK")
                  }
                />
              </span>
            </div>
            <div className="mt-1.5">
              <StatRow metrics={campaign.metrics} large />
            </div>
          </div>

          {campaign.adsets.map((adset) => (
            <AdsetPilotRow
              key={adset.id}
              adset={adset}
              currency={account.currency}
              cbo={campaign.budgetLevel === "campaign"}
              busy={busy}
              onWrite={onWrite}
              onOpen={() => setAdsetId(adset.id)}
            />
          ))}
        </div>
      </Sheet>

      {selectedAdset ? (
        <AdsetSheet
          adset={selectedAdset}
          accountName={account.name}
          currency={account.currency}
          cbo={campaign.budgetLevel === "campaign"}
          busy={busy}
          onClose={() => setAdsetId(null)}
          onWrite={onWrite}
          onOpenAd={onOpenAd}
          onZip={onZip}
          onHideAd={onHideAd}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Main mobile surface
 * ------------------------------------------------------------------ */

export function MobilePilot({
  groups,
  busy,
  onWrite,
  onOpenAd,
  onZip,
  onHideAd,
}: {
  groups: BucketGroup[];
  busy: Record<string, boolean>;
  onWrite: WriteFn;
  onOpenAd: (adId: string) => void;
  onZip: ZipFn;
  onHideAd?: (adId: string) => void;
}) {
  const campaigns = useMemo(() => flattenCampaigns(groups), [groups]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [phaseTab, setPhaseTab] = useState<PhaseTab>("hyperscaling");

  const visible = useMemo(
    () => campaigns.filter((row) => row.bucket === phaseTab),
    [campaigns, phaseTab]
  );

  const selected = selectedKey
    ? campaigns.find((row) => row.key === selectedKey) || null
    : null;

  const phaseCounts = useMemo(() => {
    const counts: Record<PhaseTab, { camp: number; budget: number }> = {
      hyperscaling: { camp: 0, budget: 0 },
      scaling: { camp: 0, budget: 0 },
      testing: { camp: 0, budget: 0 },
    };
    for (const row of campaigns) {
      if (row.bucket === "hyperscaling" || row.bucket === "scaling" || row.bucket === "testing") {
        counts[row.bucket].camp += 1;
        counts[row.bucket].budget += row.campaign.dailyBudget || 0;
      }
    }
    return counts;
  }, [campaigns]);

  return (
    <div className="space-y-2.5 lg:hidden">
      <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-slate-100/80 p-0.5 dark:bg-slate-800/70">
        {PHASE_TABS.map((bucket) => (
          <button
            key={bucket}
            type="button"
            onClick={() => setPhaseTab(bucket)}
            className={cn(
              "rounded-lg px-1.5 py-2 text-center transition-colors",
              phaseTab === bucket
                ? "bg-white shadow-sm dark:bg-slate-900"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
            )}
          >
            <p
              className={cn(
                "text-[10px] font-semibold leading-tight",
                phaseTab === bucket ? "text-slate-900 dark:text-slate-50" : ""
              )}
            >
              {BUCKET_LABELS[bucket]}
            </p>
            <p
              className={cn(
                "mt-0.5 text-[10px] font-semibold tabular-nums",
                phaseTab === bucket ? "text-slate-700 dark:text-slate-200" : "text-slate-400"
              )}
            >
              {phaseCounts[bucket].camp}
            </p>
            <p
              className={cn(
                "mt-0.5 text-[9px] font-semibold tabular-nums",
                phaseTab === bucket ? "text-slate-900 dark:text-slate-50" : "text-slate-400"
              )}
            >
              {phaseCounts[bucket].budget
                ? `${formatCurrency(phaseCounts[bucket].budget)}/j`
                : "—"}
            </p>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
        {visible.length ? (
          visible.map((row) => {
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => setSelectedKey(row.key)}
                className="w-full border-b border-slate-900/[0.04] px-2.5 py-2 text-left last:border-0 transition-colors active:bg-emerald-50 hover:bg-emerald-50/90 dark:border-white/[0.04] dark:active:bg-emerald-500/15 dark:hover:bg-emerald-500/[0.12]"
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5">
                      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <p className="min-w-0 max-w-full truncate text-[12px] font-semibold leading-snug text-slate-900 dark:text-slate-50">
                          {row.campaign.name}
                        </p>
                        {formatCreatedFr(row.campaign.createdTime) ? (
                          <span className="shrink-0 text-[9px] tabular-nums text-slate-400">
                            {formatCreatedFr(row.campaign.createdTime)}
                          </span>
                        ) : null}
                        {row.campaign.dailyBudget > 0 ? (
                          <span className="shrink-0 rounded-md bg-[#ecfdf5] px-1 py-px text-[9px] font-semibold tabular-nums text-emerald-700 ring-1 ring-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-300">
                            ${Math.round(row.campaign.dailyBudget)}/j
                          </span>
                        ) : null}
                      </div>
                      <span className="mt-0.5 max-w-[5.5rem] shrink-0 truncate rounded bg-slate-100 px-1 py-px text-[9px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {row.account.name}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                </div>
                <div className="mt-1.5 pl-3.5">
                  <StatRow metrics={row.campaign.metrics} />
                </div>
              </button>
            );
          })
        ) : (
          <p className="py-12 text-center text-xs text-slate-400">
            Aucune campagne active — {BUCKET_LABELS[phaseTab]}
          </p>
        )}
      </div>

      {selected ? (
        <CampaignSheet
          row={selected}
          busy={busy}
          onClose={() => setSelectedKey(null)}
          onWrite={onWrite}
          onOpenAd={onOpenAd}
          onZip={onZip}
          onHideAd={onHideAd}
        />
      ) : null}
    </div>
  );
}
