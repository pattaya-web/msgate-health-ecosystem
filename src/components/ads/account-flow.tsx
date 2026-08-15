"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Download, Loader2, Pause, X } from "lucide-react";
import { cn, formatCurrency, formatCreatedFr, formatNumber } from "@/lib/utils";
import {
  FLOW_HINTS,
  FLOW_LABELS,
  FLOW_LANES,
  classifyAccounts,
  type FlowAccount,
  type FlowLane,
} from "@/lib/meta/account-flow";
import type {
  AccountNode,
  AdNode,
  CampaignNode,
  EntityLevel,
  EntityStatus,
  Metrics,
} from "@/lib/meta/types";
import { BudgetCell, CreativeName, StatusToggle } from "@/components/ads/bits";

const LANE_TONE: Record<FlowLane, { rail: string; chip: string }> = {
  new: {
    rail: "bg-sky-500",
    chip: "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  live: {
    rail: "bg-slate-700",
    chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  ready: {
    rail: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  warming: {
    rail: "bg-amber-500",
    chip: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  need: {
    rail: "bg-slate-400",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  kill: {
    rail: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  },
};

type WriteFn = (
  level: EntityLevel,
  id: string,
  patch: { status?: EntityStatus; dailyBudget?: number },
  label: string
) => Promise<void>;

type ZipFn = (ids: string[], label: string, key: string) => Promise<void>;

const adIdsOfAdset = (adset: { ads: AdNode[] }) => adset.ads.map((ad) => ad.id);
const adIdsOfCampaign = (campaign: CampaignNode) => campaign.adsets.flatMap(adIdsOfAdset);

function DlBtn({
  busy,
  onClick,
}: {
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title="Télécharger"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
    </button>
  );
}

function money(value: number) {
  return value >= 1000 ? formatCurrency(value) : `${value.toFixed(0)}$`;
}

function MiniStats({ metrics }: { metrics: Metrics }) {
  return (
    <div className="grid grid-cols-5 gap-0.5 text-center tabular-nums">
      <div>
        <p className="text-[7px] font-medium uppercase leading-none text-slate-400">Spend</p>
        <p className="mt-0.5 text-[10px] font-semibold leading-none text-slate-900 dark:text-slate-50">
          {money(metrics.spend)}
        </p>
      </div>
      <div>
        <p className="text-[7px] font-medium uppercase leading-none text-slate-400">Achats</p>
        <p className="mt-0.5 text-[10px] font-semibold leading-none text-slate-900 dark:text-slate-50">
          {metrics.purchases ? formatNumber(metrics.purchases) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[7px] font-medium uppercase leading-none text-slate-400">CPC</p>
        <p className="mt-0.5 text-[10px] font-semibold leading-none text-slate-900 dark:text-slate-50">
          {metrics.cpc ? metrics.cpc.toFixed(2) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[7px] font-medium uppercase leading-none text-slate-400">CTR</p>
        <p className="mt-0.5 text-[10px] font-semibold leading-none text-slate-900 dark:text-slate-50">
          {metrics.ctr ? `${metrics.ctr.toFixed(1)}%` : "—"}
        </p>
      </div>
      <div>
        <p className="text-[7px] font-medium uppercase leading-none text-slate-400">ROAS</p>
        <p
          className={cn(
            "mt-0.5 text-[10px] font-semibold leading-none",
            !metrics.roas
              ? "text-slate-400"
              : metrics.roas >= 1.2
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
          )}
        >
          {metrics.roas ? metrics.roas.toFixed(2) : "—"}
        </p>
      </div>
    </div>
  );
}

function SpendBar({ spent }: { spent: number }) {
  const width = Math.min(100, (spent / 50) * 100);
  const tone =
    spent <= 10 ? "bg-slate-400" : spent < 25 ? "bg-amber-500" : spent <= 50 ? "bg-emerald-500" : "bg-slate-700";

  return (
    <div className="h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Centered popup — dense, scannable, big tap targets. */
function AccountPilotModal({
  row,
  busy,
  onClose,
  onKill,
  onWrite,
  onZip,
}: {
  row: FlowAccount;
  busy: Record<string, boolean>;
  onClose: () => void;
  onKill?: (account: AccountNode) => void;
  onWrite: WriteFn;
  onZip: ZipFn;
}) {
  const { account, lane, reasons, activeCampaigns, paymentCampaigns } = row;
  const [mounted, setMounted] = useState(false);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const campaigns = useMemo(
    () => [...account.campaigns].sort((a, b) => b.metrics.spend - a.metrics.spend),
    [account.campaigns]
  );

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-pilot-title"
        className="relative z-10 flex max-h-[min(88vh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-950 dark:ring-white/10"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-slate-900/[0.06] px-3 py-2.5 dark:border-white/[0.08]">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2
                  id="account-pilot-title"
                  className="truncate text-[14px] font-semibold tracking-tight text-slate-900 dark:text-slate-50"
                >
                  {account.name}
                </h2>
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {account.accountId}
                </span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[9px] font-semibold",
                    LANE_TONE[lane].chip
                  )}
                >
                  {FLOW_LABELS[lane]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-slate-400">
                {account.business || "Sans BM"} · life {formatCurrency(account.lifetimeSpend)} ·{" "}
                {campaigns.length} camp.
                {activeCampaigns ? ` · ${activeCampaigns} on` : ""}
              </p>
              <div className="mt-1.5 max-w-xs">
                <SpendBar spent={account.lifetimeSpend} />
              </div>
              <p className="mt-1 truncate text-[9px] text-slate-500">{reasons[0]}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {paymentCampaigns.length ? (
            <p className="mt-1 truncate text-[9px] text-rose-600 dark:text-rose-300">
              {paymentCampaigns
                .slice(0, 2)
                .map((campaign) => campaign.name)
                .join(" · ")}
            </p>
          ) : null}

          {lane === "kill" && activeCampaigns > 0 && onKill ? (
            <button
              type="button"
              disabled={busy[`kill-${account.id}`]}
              onClick={() => onKill(account)}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-[11px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy[`kill-${account.id}`] ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
              Kill {activeCampaigns} campagnes
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy[`zip-a:${account.id}`]}
            onClick={() =>
              void onZip(
                account.campaigns.flatMap(adIdsOfCampaign),
                account.name,
                `zip-a:${account.id}`
              )
            }
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy[`zip-a:${account.id}`] ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Tout télécharger
          </button>
        </div>

        {/* Column legend */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-900/[0.05] bg-slate-50/80 px-3 py-1 text-[8px] font-semibold uppercase tracking-wide text-slate-400 dark:border-white/[0.05] dark:bg-slate-900/50">
          <span className="w-9 shrink-0 text-center">On</span>
          <span className="min-w-0 flex-1">Campagne / ad set</span>
          <span className="hidden w-[9.5rem] shrink-0 text-center sm:block">Stats</span>
          <span className="w-20 shrink-0 text-right text-emerald-600 dark:text-emerald-400">
            Budget/j
          </span>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5">
          {campaigns.length ? (
            <div className="space-y-1">
              {campaigns.map((campaign) => (
                <CampaignBlock
                  key={campaign.id}
                  campaign={campaign}
                  currency={account.currency}
                  busy={busy}
                  onWrite={onWrite}
                  onZip={onZip}
                  expanded={openCampaign === campaign.id}
                  onToggleExpand={() =>
                    setOpenCampaign((id) => (id === campaign.id ? null : campaign.id))
                  }
                />
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-[11px] text-slate-400">Aucune campagne</p>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-900/[0.06] px-3 py-2 text-center text-[9px] text-slate-400 dark:border-white/[0.08]">
          Toggle on/off · budget · ↓ télécharger · Esc pour fermer
        </div>
      </div>
    </div>,
    document.body
  );
}

function CreativeLine({
  ad,
  busy,
  onWrite,
  onZip,
}: {
  ad: AdNode;
  busy: Record<string, boolean>;
  onWrite: WriteFn;
  onZip: ZipFn;
}) {
  const writable = ad.status === "ACTIVE" || ad.status === "PAUSED";
  const created = formatCreatedFr(ad.createdTime);
  const zipKey = `dl-${ad.id}`;

  return (
    <div className="flex items-center gap-1.5 border-t border-dashed border-slate-900/[0.04] bg-white/40 px-1.5 py-1 pl-6 dark:border-white/[0.04] dark:bg-slate-950/20">
      <div className="flex w-9 shrink-0 justify-center">
        <StatusToggle
          status={ad.status}
          disabled={busy[ad.id] || !writable}
          onToggle={(next) =>
            void onWrite(
              "ad",
              ad.id,
              { status: next },
              next === "ACTIVE" ? "Pub activée" : "Pub en pause"
            )
          }
        />
      </div>
      <div className="min-w-0 flex-1">
        <CreativeName name={ad.name} max={20} className="text-[9px] font-medium" />
        <p className="text-[8px] tabular-nums text-slate-400">
          {created ? `créé ${created}` : "—"}
        </p>
      </div>
      <div className="hidden w-[9.5rem] shrink-0 sm:block">
        <MiniStats metrics={ad.metrics} />
      </div>
      <DlBtn
        busy={busy[zipKey]}
        onClick={() => void onZip([ad.id], ad.name || ad.id, zipKey)}
      />
      <span className="w-14 shrink-0" />
      <span className="w-7 shrink-0" />
    </div>
  );
}

function CampaignBlock({
  campaign,
  currency,
  busy,
  onWrite,
  onZip,
  expanded,
  onToggleExpand,
}: {
  campaign: CampaignNode;
  currency: string;
  busy: Record<string, boolean>;
  onWrite: WriteFn;
  onZip: ZipFn;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const cbo = campaign.budgetLevel === "campaign";
  const writable = campaign.status === "ACTIVE" || campaign.status === "PAUSED";
  const zipKey = `zip-c:${campaign.id}`;

  return (
    <div className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-900/[0.05] dark:bg-slate-900/70 dark:ring-white/[0.06]">
      <div className="flex items-center gap-1.5 px-1.5 py-1.5">
        <div className="flex w-9 shrink-0 justify-center">
          <StatusToggle
            size="lg"
            status={campaign.status}
            disabled={busy[campaign.id] || !writable}
            onToggle={(next) =>
              void onWrite(
                "campaign",
                campaign.id,
                { status: next },
                next === "ACTIVE" ? "Campagne activée" : "Campagne en pause"
              )
            }
          />
        </div>

        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-slate-900 dark:text-slate-50">
            {campaign.name}
          </p>
          <p className="mt-0.5 text-[8px] text-slate-400">
            {campaign.status}
            {campaign.effectiveStatus && campaign.effectiveStatus !== campaign.status
              ? ` · ${campaign.effectiveStatus}`
              : ""}
            {` · ${cbo ? "CBO" : "ABO"} · ${campaign.adsets.length} ad set`}
            {formatCreatedFr(campaign.createdTime)
              ? ` · créé ${formatCreatedFr(campaign.createdTime)}`
              : ""}
          </p>
          <div className="mt-1 sm:hidden">
            <MiniStats metrics={campaign.metrics} />
          </div>
        </button>

        <div className="hidden w-[9.5rem] shrink-0 sm:block">
          <MiniStats metrics={campaign.metrics} />
        </div>

        <div className="w-20 shrink-0">
          <BudgetCell
            tone="quiet"
            value={campaign.dailyBudget}
            currency={currency}
            editable={cbo && writable}
            onSave={(next) =>
              onWrite("campaign", campaign.id, { dailyBudget: next }, "Budget campagne OK")
            }
          />
        </div>

        <DlBtn
          busy={busy[zipKey]}
          onClick={() => void onZip(adIdsOfCampaign(campaign), campaign.name, zipKey)}
        />

        {campaign.adsets.length ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
            aria-label="Ad sets"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="w-7 shrink-0" />
        )}
      </div>

      {expanded
        ? campaign.adsets.map((adset) => {
            const adWritable = adset.status === "ACTIVE" || adset.status === "PAUSED";
            const adsetCreated = formatCreatedFr(adset.createdTime);
            const adsetZip = `zip-s:${adset.id}`;
            return (
              <div key={adset.id} className="border-t border-slate-900/[0.04] dark:border-white/[0.04]">
                <div className="flex items-center gap-1.5 bg-white/70 px-1.5 py-1.5 pl-3 dark:bg-slate-950/40">
                  <div className="flex w-9 shrink-0 justify-center">
                    <StatusToggle
                      size="lg"
                      status={adset.status}
                      disabled={busy[adset.id] || !adWritable}
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
                    <p className="truncate text-[10px] font-medium text-slate-800 dark:text-slate-100">
                      {adset.name}
                    </p>
                    <p className="text-[8px] text-slate-400">
                      {adset.status} · {adset.ads.length} créa
                      {adsetCreated ? ` · créé ${adsetCreated}` : ""}
                    </p>
                    <div className="mt-1 sm:hidden">
                      <MiniStats metrics={adset.metrics} />
                    </div>
                  </div>
                  <div className="hidden w-[9.5rem] shrink-0 sm:block">
                    <MiniStats metrics={adset.metrics} />
                  </div>
                  <div className="w-20 shrink-0">
                    <BudgetCell
                      value={adset.dailyBudget}
                      currency={currency}
                      editable={!cbo && adWritable}
                      onSave={(next) =>
                        onWrite("adset", adset.id, { dailyBudget: next }, "Budget ad set OK")
                      }
                    />
                  </div>
                  <DlBtn
                    busy={busy[adsetZip]}
                    onClick={() => void onZip(adIdsOfAdset(adset), adset.name, adsetZip)}
                  />
                  <span className="w-7 shrink-0" />
                </div>

                {adset.ads.map((ad) => (
                  <CreativeLine
                    key={ad.id}
                    ad={ad}
                    busy={busy}
                    onWrite={onWrite}
                    onZip={onZip}
                  />
                ))}
              </div>
            );
          })
        : null}
    </div>
  );
}

function AccountCard({
  row,
  onOpen,
}: {
  row: FlowAccount;
  onOpen: () => void;
}) {
  const { account, reasons, activeCampaigns } = row;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-left ring-1 ring-slate-900/[0.05] transition-colors active:bg-slate-100 dark:bg-slate-900/80 dark:ring-white/[0.06] dark:active:bg-slate-800"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-slate-800 dark:text-slate-100">
          {account.name}
        </p>
        <p className="truncate text-[10px] text-slate-400">
          {account.business || "Sans BM"} · {account.campaigns.length} camp.
          {activeCampaigns ? ` · ${activeCampaigns} on` : ""}
        </p>
        <div className="mt-1.5">
          <SpendBar spent={account.lifetimeSpend} />
        </div>
        <p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">{reasons[0]}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
          {formatCurrency(account.lifetimeSpend)}
        </span>
        <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-slate-400">
          piloter
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

/**
 * Compact collapsible panel: closed by default, open to pick a lane
 * then open a centered pilot popup for on/off + budget on every account.
 */
export function AccountFlow({
  accounts,
  busy,
  onKill,
  onWrite,
  onZip,
}: {
  accounts: AccountNode[];
  busy: Record<string, boolean>;
  onKill: (account: AccountNode) => void;
  onWrite: WriteFn;
  onZip: ZipFn;
}) {
  const board = useMemo(() => classifyAccounts(accounts), [accounts]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [lane, setLane] = useState<FlowLane | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const alertCount = board.new.length + board.kill.length + board.need.length;
  const summary = FLOW_LANES.filter((id) => board[id].length > 0).slice(0, 4);
  const activeLane = lane && board[lane] ? lane : null;
  const rows = activeLane ? board[activeLane] : [];

  const selected = useMemo(() => {
    if (!selectedId) return null;
    for (const id of FLOW_LANES) {
      const hit = board[id].find((row) => row.account.id === selectedId);
      if (hit) return hit;
    }
    return null;
  }, [board, selectedId]);

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
      <button
        type="button"
        onClick={() => setPanelOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
            panelOpen && "rotate-90"
          )}
        />
        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
          Flux comptes
        </span>
        {alertCount > 0 ? (
          <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
            {alertCount}
          </span>
        ) : null}
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {summary.map((id) => (
            <span
              key={id}
              className={cn(
                "hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums sm:inline",
                LANE_TONE[id].chip
              )}
            >
              {FLOW_LABELS[id]} {board[id].length}
            </span>
          ))}
        </div>
        <span className="shrink-0 text-[10px] text-slate-400">
          {panelOpen ? "fermer" : "ouvrir"}
        </span>
      </button>

      {panelOpen ? (
        <div className="space-y-2 border-t border-slate-900/[0.05] px-2.5 py-2 dark:border-white/[0.05]">
          <p className="text-[10px] text-slate-400">
            Tap un compte → popup centrale (on/off + budget)
          </p>

          <div className="flex flex-wrap gap-1.5">
            {FLOW_LANES.map((id) => {
              const count = board[id].length;
              const selectedLane = activeLane === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLane(selectedLane ? null : id)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ring-1 transition-colors",
                    selectedLane
                      ? "bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100"
                      : cn("ring-transparent", LANE_TONE[id].chip)
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      selectedLane ? "bg-white/80 dark:bg-slate-700" : LANE_TONE[id].rail
                    )}
                  />
                  {FLOW_LABELS[id]}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {activeLane ? (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400">{FLOW_HINTS[activeLane]}</p>
              <div className="max-h-[min(40vh,280px)] space-y-1.5 overflow-y-auto overscroll-contain">
                {rows.length ? (
                  rows.map((row) => (
                    <AccountCard
                      key={row.account.id}
                      row={row}
                      onOpen={() => setSelectedId(row.account.id)}
                    />
                  ))
                ) : (
                  <p className="py-6 text-center text-[11px] text-slate-400">Aucun compte</p>
                )}
              </div>
            </div>
          ) : (
            <p className="py-3 text-center text-[11px] text-slate-400">
              Clique Ready, Warming, Need…
            </p>
          )}
        </div>
      ) : null}

      {selected ? (
        <AccountPilotModal
          row={selected}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onKill={onKill}
          onWrite={onWrite}
          onZip={onZip}
        />
      ) : null}
    </div>
  );
}
