"use client";

import { AlertTriangle, Rocket, X } from "lucide-react";
import { formatCurrency, shortenCreativeName } from "@/lib/utils";
import { BUCKET_LABELS, type CampaignBucket } from "@/lib/meta/buckets";

export type CreativeAlert = {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;
  bucket: CampaignBucket;
  spend: number;
  roas: number;
  cpc: number;
  purchases: number;
};

export type AdsAlerts = {
  hs: CreativeAlert[];
  dead: CreativeAlert[];
};

/** Scaling / Testing créa ready to push to Hyper-scaling. */
export const HS_SPEND_MIN = 50;
export const HS_ROAS_MIN = 1.5;

/** Créa burning budget with no purchase. */
export const DEAD_SPEND_MIN = 40;
export const DEAD_CPC_MIN = 1.5;

function AlertCard({
  item,
  tone,
  onLocate,
}: {
  item: CreativeAlert;
  tone: "hs" | "dead";
  onLocate: (alert: CreativeAlert) => void;
}) {
  const hs = tone === "hs";
  return (
    <button
      type="button"
      onClick={() => onLocate(item)}
      className={
        hs
          ? "min-w-0 rounded-xl bg-emerald-50/90 px-2.5 py-2 text-left ring-1 ring-emerald-500/25 transition hover:bg-emerald-100 dark:bg-emerald-500/10 dark:ring-emerald-400/20 dark:hover:bg-emerald-500/15"
          : "min-w-0 rounded-xl bg-rose-50/90 px-2.5 py-2 text-left ring-1 ring-rose-500/25 transition hover:bg-rose-100 dark:bg-rose-500/10 dark:ring-rose-400/20 dark:hover:bg-rose-500/15"
      }
    >
      <p
        className={
          hs
            ? "truncate text-[12px] font-semibold text-emerald-950 dark:text-emerald-100"
            : "truncate text-[12px] font-semibold text-rose-950 dark:text-rose-100"
        }
      >
        {shortenCreativeName(item.adName, 40)}
      </p>
      <p
        className={
          hs
            ? "mt-0.5 truncate text-[10px] text-emerald-800/70 dark:text-emerald-300/70"
            : "mt-0.5 truncate text-[10px] text-rose-800/70 dark:text-rose-300/70"
        }
      >
        {hs ? `${BUCKET_LABELS[item.bucket]} · ${item.adsetName}` : item.campaignName}
      </p>
      <p
        className={
          hs
            ? "mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-semibold tabular-nums text-emerald-900 dark:text-emerald-100"
            : "mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-semibold tabular-nums text-rose-900 dark:text-rose-100"
        }
      >
        <span>{formatCurrency(item.spend)}</span>
        <span>
          {item.purchases} vente{item.purchases > 1 ? "s" : ""}
        </span>
        {hs ? (
          <span className="text-emerald-600 dark:text-emerald-300">ROAS {item.roas.toFixed(2)}</span>
        ) : (
          <span className="text-rose-600 dark:text-rose-300">CPC {item.cpc.toFixed(2)}</span>
        )}
      </p>
    </button>
  );
}

/** Full-width strip above the campaign groups (desktop). */
export function AlertsRail({
  alerts,
  onLocate,
  onClose,
}: {
  alerts: AdsAlerts;
  onLocate: (alert: CreativeAlert) => void;
  onClose?: () => void;
}) {
  const total = alerts.hs.length + alerts.dead.length;
  if (!total) return null;

  return (
    <div className="hidden overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.08] lg:block dark:bg-slate-900/80 dark:ring-white/[0.08]">
      <div className="flex items-center gap-1.5 border-b border-slate-900/[0.06] px-3 py-2 dark:border-white/[0.06]">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">
          Alertes créas
        </p>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {total}
        </span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Masquer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 p-2.5 lg:grid-cols-2">
        {alerts.hs.length ? (
          <section className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1 px-0.5">
              <Rocket className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Potentiel promotion HS
              </p>
              <span className="ml-auto text-[10px] font-semibold tabular-nums text-emerald-600/80">
                {alerts.hs.length}
              </span>
            </div>
            <div className="grid max-h-[9.5rem] gap-1.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
              {alerts.hs.map((item) => (
                <AlertCard key={`hs-${item.adId}`} item={item} tone="hs" onLocate={onLocate} />
              ))}
            </div>
          </section>
        ) : null}

        {alerts.dead.length ? (
          <section className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1 px-0.5">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
              <p className="text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                Spend sans vente
              </p>
              <span className="ml-auto text-[10px] font-semibold tabular-nums text-rose-600/80">
                {alerts.dead.length}
              </span>
            </div>
            <div className="grid max-h-[9.5rem] gap-1.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
              {alerts.dead.map((item) => (
                <AlertCard key={`dead-${item.adId}`} item={item} tone="dead" onLocate={onLocate} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function collectAdsAlerts(
  groups: Array<{
    bucket: CampaignBucket;
    accounts: Array<{
      id: string;
      name: string;
      campaigns: Array<{
        id: string;
        name: string;
        adsets: Array<{
          id: string;
          name: string;
          ads: Array<{
            id: string;
            name: string;
            status: string;
            effectiveStatus?: string;
            metrics: { spend: number; roas: number; cpc: number; purchases: number };
          }>;
        }>;
      }>;
    }>;
  }>
): AdsAlerts {
  const hs: CreativeAlert[] = [];
  const dead: CreativeAlert[] = [];
  const seenHs = new Set<string>();
  const seenDead = new Set<string>();

  for (const group of groups) {
    for (const account of group.accounts) {
      for (const campaign of account.campaigns) {
        for (const adset of campaign.adsets) {
          for (const ad of adset.ads) {
            // Alertes = créas ON uniquement (pas les pausées / inactives).
            const on =
              ad.status === "ACTIVE" &&
              (!ad.effectiveStatus || ad.effectiveStatus === "ACTIVE");
            if (!on) continue;

            const m = ad.metrics;
            const base: CreativeAlert = {
              adId: ad.id,
              adName: ad.name,
              adsetId: adset.id,
              adsetName: adset.name,
              campaignId: campaign.id,
              campaignName: campaign.name,
              accountId: account.id,
              accountName: account.name,
              bucket: group.bucket,
              spend: m.spend,
              roas: m.roas,
              cpc: m.cpc,
              purchases: m.purchases,
            };

            if (
              (group.bucket === "scaling" || group.bucket === "testing") &&
              m.spend >= HS_SPEND_MIN &&
              m.roas >= HS_ROAS_MIN &&
              !seenHs.has(ad.id)
            ) {
              seenHs.add(ad.id);
              hs.push(base);
            }

            if (
              m.spend >= DEAD_SPEND_MIN &&
              m.purchases <= 0 &&
              m.cpc >= DEAD_CPC_MIN &&
              !seenDead.has(ad.id)
            ) {
              seenDead.add(ad.id);
              dead.push(base);
            }
          }
        }
      }
    }
  }

  hs.sort((a, b) => b.roas - a.roas || b.spend - a.spend);
  dead.sort((a, b) => b.spend - a.spend);
  return { hs, dead };
}
