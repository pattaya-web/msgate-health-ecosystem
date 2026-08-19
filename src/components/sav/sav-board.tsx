"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BadgeDollarSign,
  Clock,
  Loader2,
  Mail,
  RefreshCw,
  ScanSearch,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { KpiCard, PanelTitle, Surface } from "@/components/phoenix/ui";
import { ErrorState, LoadingState } from "@/components/shared/page-states";
import { cn, formatNumber } from "@/lib/utils";
import type { SavInboxPayload, SavThread, SavThreadReview, SavVerdict } from "@/lib/sav/types";

const PRESETS = [
  { key: "7", label: "7 jours" },
  { key: "14", label: "14 jours" },
  { key: "30", label: "30 jours" },
] as const;

/** Un verdict n'a de sens que s'il se lit d'un coup d'œil dans la liste. */
const VERDICTS: Record<SavVerdict, { label: string; className: string }> = {
  ok: {
    label: "OK",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  },
  partial: {
    label: "Incomplet",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  },
  off: {
    label: "À côté",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200",
  },
};

function VerdictBadge({ verdict }: { verdict: SavVerdict }) {
  const tone = VERDICTS[verdict];
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        tone.className
      )}
    >
      {tone.label}
    </span>
  );
}

function rangeFor(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function formatDelay(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} j`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SavBoard() {
  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<SavInboxPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SavThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [onlyRefunds, setOnlyRefunds] = useState(false);
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [reviews, setReviews] = useState<Record<string, SavThreadReview>>({});
  const [reviewingPeriod, setReviewingPeriod] = useState(false);
  const [reviewingThread, setReviewingThread] = useState(false);

  const load = useCallback(
    async (force?: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const { start, end } = rangeFor(days);
        const res = await fetch(
          `/api/sav/inbox?start=${start}&end=${end}${force ? "&refresh=1" : ""}`
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Boîte SAV indisponible");
        setData(body as SavInboxPayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Boîte SAV indisponible");
      } finally {
        setLoading(false);
      }
    },
    [days]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- même schéma que la page Phoenix
    void load();
  }, [load]);

  const openThread = useCallback(async (thread: SavThread) => {
    setSelected(thread);
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/sav/thread?id=${encodeURIComponent(thread.id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Fil indisponible");
      setSelected(body.thread as SavThread);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fil indisponible");
    } finally {
      setThreadLoading(false);
    }
  }, []);

  /** Les verdicts sont conservés par fil : un rafraîchissement ne les efface pas. */
  const runReview = useCallback(
    async (payload: { threadId?: string; start?: string; end?: string }) => {
      const res = await fetch("/api/sav/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Analyse indisponible");

      const rows = (body.reviews || []) as SavThreadReview[];
      setReviews((prev) => {
        const next = { ...prev };
        for (const review of rows) next[review.threadId] = review;
        return next;
      });
      return body as { reviews: SavThreadReview[]; remaining?: number; failed?: number };
    },
    []
  );

  const reviewPeriod = useCallback(async () => {
    setReviewingPeriod(true);
    try {
      const result = await runReview(rangeFor(days));
      const flagged = result.reviews.filter(
        (review) => review.worst === "off" || review.worst === "partial"
      ).length;
      toast.success(
        flagged
          ? `${flagged} fil(s) à revoir sur ${result.reviews.length} analysés.`
          : `${result.reviews.length} fil(s) analysés, rien à signaler.`
      );
      if (result.remaining) {
        toast.message(`${result.remaining} fil(s) restants — relance pour continuer.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analyse indisponible");
    } finally {
      setReviewingPeriod(false);
    }
  }, [days, runReview]);

  const reviewSelected = useCallback(async () => {
    if (!selected) return;
    setReviewingThread(true);
    try {
      await runReview({ threadId: selected.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analyse indisponible");
    } finally {
      setReviewingThread(false);
    }
  }, [runReview, selected]);

  const threads = useMemo(() => {
    let rows = data?.threads ?? [];
    if (onlyRefunds) rows = rows.filter((row) => row.refundHint);
    if (onlyAwaiting) rows = rows.filter((row) => row.awaitingReply);
    if (onlyFlagged) {
      rows = rows.filter((row) => {
        const worst = reviews[row.id]?.worst;
        return worst === "off" || worst === "partial";
      });
    }
    return rows;
  }, [data, onlyRefunds, onlyAwaiting, onlyFlagged, reviews]);

  /** Verdict par message sortant, pour l'afficher au bon endroit dans le fil. */
  const selectedVerdicts = useMemo(() => {
    const map = new Map<string, { verdict: SavVerdict; reason: string }>();
    if (!selected) return map;
    for (const exchange of reviews[selected.id]?.exchanges ?? []) {
      map.set(exchange.replyMessageId, {
        verdict: exchange.verdict,
        reason: exchange.reason,
      });
    }
    return map;
  }, [reviews, selected]);

  const metrics = data?.metrics;

  if (loading && !data) return <LoadingState className="min-h-[420px]" />;
  if (error && !data) return <ErrorState title="Boîte SAV indisponible" description={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            SAV
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Boîte support · activité et suivi des réponses
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => setDays(Number(preset.key))}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                days === Number(preset.key)
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
              )}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Rafraîchir
          </button>
          <button
            type="button"
            onClick={() => void reviewPeriod()}
            disabled={reviewingPeriod || loading}
            title="Fait relire les réponses du SAV et signale celles qui ne répondent pas à la demande"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950"
          >
            {reviewingPeriod ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanSearch className="h-3.5 w-3.5" />
            )}
            Analyser
          </button>
        </div>
      </div>

      {data?.warnings.length ? (
        <Surface accent="amber" className="flex items-start gap-2 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1 text-xs text-amber-900 dark:text-amber-200">
            {data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </Surface>
      ) : null}

      {metrics ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            label="Mails reçus"
            value={formatNumber(metrics.totalReceived)}
            accent="sky"
            sub={`${metrics.threads} fils`}
          />
          <KpiCard
            label="Réponses envoyées"
            value={formatNumber(metrics.totalSent)}
            accent="emerald"
            sub={`${metrics.avgSentPerActiveDay}/jour travaillé`}
          />
          <KpiCard
            label="Jours actifs"
            value={`${metrics.activeDays}/${metrics.byDay.length}`}
            accent="violet"
            sub="jours avec au moins un envoi"
          />
          <KpiCard
            label="Délai 1re réponse"
            value={formatDelay(metrics.medianFirstReplyMinutes)}
            accent="indigo"
            sub={`pire : ${formatDelay(metrics.slowestFirstReplyMinutes)}`}
          />
          <KpiCard
            label="Sans réponse"
            value={formatNumber(metrics.awaiting)}
            accent={metrics.awaiting > 0 ? "rose" : "slate"}
            sub="fils en attente"
          />
        </div>
      ) : null}

      {metrics ? (
        <Surface plain className="p-3">
          <PanelTitle accent="emerald">Activité par jour</PanelTitle>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.byDay} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value: string) => value.slice(5)}
                  tick={{ fontSize: 10 }}
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12 }}
                  labelFormatter={(value) => `Jour ${value}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="received" name="Reçus" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sent" name="Envoyés" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Surface>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Surface plain className="p-3">
          <PanelTitle
            accent="sky"
            right={
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setOnlyAwaiting((v) => !v)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                    onlyAwaiting
                      ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
                      : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"
                  )}
                >
                  Sans réponse
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyRefunds((v) => !v)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                    onlyRefunds
                      ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"
                  )}
                >
                  Refunds
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyFlagged((v) => !v)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                    onlyFlagged
                      ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200"
                      : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"
                  )}
                >
                  À revoir
                </button>
              </div>
            }
          >
            Fils ({threads.length})
          </PanelTitle>

          <div className="mt-2 max-h-[560px] space-y-1.5 overflow-y-auto pr-1">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => void openThread(thread)}
                className={cn(
                  "w-full rounded-xl border p-2.5 text-left transition-colors",
                  selected?.id === thread.id
                    ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/40"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {thread.clientName || thread.client}
                  </span>
                  {reviews[thread.id]?.worst ? (
                    <VerdictBadge verdict={reviews[thread.id].worst as SavVerdict} />
                  ) : null}
                  {thread.refundHint ? (
                    <BadgeDollarSign className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  ) : null}
                  {thread.awaitingReply ? (
                    <span className="shrink-0 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-200">
                      {thread.waitingHours}h
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-300">
                  {thread.subject}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {thread.inboundCount}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Send className="h-3 w-3" />
                    {thread.outboundCount}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDelay(thread.firstReplyMinutes)}
                  </span>
                  <span className="ml-auto">{formatDateTime(thread.lastMessageAt)}</span>
                </div>
              </button>
            ))}
            {!threads.length ? (
              <p className="py-8 text-center text-xs text-slate-400">Aucun fil sur cette période.</p>
            ) : null}
          </div>
        </Surface>

        <Surface plain className="p-3">
          <PanelTitle
            accent="violet"
            right={
              selected ? (
                <button
                  type="button"
                  onClick={() => void reviewSelected()}
                  disabled={reviewingThread || threadLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-2 py-0.5 text-[10px] font-medium text-violet-700 disabled:opacity-50 dark:border-violet-800 dark:text-violet-200"
                >
                  {reviewingThread ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ScanSearch className="h-3 w-3" />
                  )}
                  Analyser ce fil
                </button>
              ) : null
            }
          >
            {selected ? `Historique · ${selected.clientName || selected.client}` : "Historique"}
          </PanelTitle>

          {!selected ? (
            <p className="py-16 text-center text-xs text-slate-400">
              Sélectionne un fil pour voir comment il a été traité.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] dark:bg-slate-900">
                <p className="font-medium text-slate-700 dark:text-slate-200">{selected.subject}</p>
                <p className="mt-0.5 text-slate-500">
                  {selected.client} · {selected.inboundCount} reçus · {selected.outboundCount} envoyés ·
                  1re réponse {formatDelay(selected.firstReplyMinutes)}
                </p>
              </div>

              {threadLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                </div>
              ) : null}

              <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                {selected.messages.map((message) => {
                  const verdict = selectedVerdicts.get(message.id);
                  return (
                  <div
                    key={message.id}
                    className={cn(
                      "rounded-xl border p-2.5",
                      message.direction === "in"
                        ? "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30"
                        : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
                    )}
                  >
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide">
                      <span
                        className={
                          message.direction === "in"
                            ? "text-sky-700 dark:text-sky-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }
                      >
                        {message.direction === "in" ? "Client" : "SAV"}
                      </span>
                      <span className="ml-auto font-normal normal-case text-slate-400">
                        {formatDateTime(message.date)}
                      </span>
                    </div>
                    <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
                      {message.body || message.preview || "(corps vide)"}
                    </pre>
                    {verdict ? (
                      <div className="mt-2 flex items-start gap-1.5 border-t border-slate-200/70 pt-2 dark:border-slate-700/70">
                        <VerdictBadge verdict={verdict.verdict} />
                        <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {verdict.reason}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
