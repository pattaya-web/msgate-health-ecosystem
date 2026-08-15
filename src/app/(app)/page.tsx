"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowUpRight,
  Building2,
  Clock,
  CreditCard,
  DoorOpen,
  Landmark,
  RefreshCw,
  Shield,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { HealthGauge } from "@/components/dashboard/health-gauge";
import { RoasLegend, RoasScoreCard } from "@/components/business/roas-score-card";
import { EmptyState, LoadingState } from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { getRoasLevel, roasLevelMeta } from "@/lib/business/roas";
import { syncAirtableToStore } from "@/lib/sync/client-sync";
import { mockProvider } from "@/lib/providers/mock-provider";
import {
  cn,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "@/lib/utils";
import type { Alert, BusinessDailyMetric, DashboardData, RecoveryCase } from "@/types";

type Period = "7d" | "30d" | "90d";

function infraStatus(
  key: string,
  value: number
): "healthy" | "monitor" | "critical" {
  switch (key) {
    case "active_ibos":
      if (value >= 6) return "healthy";
      if (value >= 4) return "monitor";
      return "critical";
    case "banks":
      if (value >= 12) return "healthy";
      if (value >= 8) return "monitor";
      return "critical";
    case "mids":
      if (value >= 10) return "healthy";
      if (value >= 6) return "monitor";
      return "critical";
    case "mids_underwriting":
      if (value === 0) return "healthy";
      if (value <= 2) return "monitor";
      return "critical";
    case "banks_opening":
      if (value <= 2) return "healthy";
      if (value <= 4) return "monitor";
      return "critical";
    default:
      return "monitor";
  }
}

const infraCards = [
  {
    key: "active_ibos" as const,
    label: "IBO actifs",
    icon: Building2,
    href: "/ecosystem?type=ibo",
  },
  {
    key: "banks" as const,
    label: "Banques",
    icon: Landmark,
    href: "/ecosystem?type=bank",
  },
  {
    key: "mids" as const,
    label: "MIDs",
    icon: CreditCard,
    href: "/ecosystem?type=mid",
  },
  {
    key: "mids_underwriting" as const,
    label: "MIDs underwriting",
    icon: Clock,
    href: "/ecosystem?type=mid&status=underwriting",
  },
  {
    key: "banks_opening" as const,
    label: "Banques à ouvrir",
    icon: DoorOpen,
    href: "/ecosystem?type=bank&status=opening",
  },
];

function alertLevelBadge(level: Alert["level"]) {
  if (level === "critical") return "destructive" as const;
  if (level === "warning") return "warning" as const;
  return "default" as const;
}

function recoveryProgress(recoveryCase: RecoveryCase) {
  const total = recoveryCase.steps.length;
  const done = recoveryCase.steps.filter((s) => s.status === "done").length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export default function DashboardPage() {
  const { canWrite } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [daily, setDaily] = useState<BusinessDailyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>("30d");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string>("");

  const loadDashboard = useCallback(async () => {
    try {
      const [dashboard, dailyMetrics] = await Promise.all([
        mockProvider.getDashboard(),
        mockProvider.getBusinessDailyMetrics(),
      ]);
      setData(dashboard);
      const sortedDaily = [...dailyMetrics].sort(
        (a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()
      );
      setDaily(sortedDaily);
      setSelectedDayId((prev) => prev || sortedDaily[0]?.id || "");
    } catch {
      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await syncAirtableToStore();
      } catch {
        // seed still available locally
      }
      await loadDashboard();
    })();
  }, [loadDashboard]);

  // Auto sync Airtable on configured interval
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const settings = await mockProvider.getSettings();
      const ms = Math.max(1, settings.sync_frequency_minutes || 30) * 60 * 1000;
      timer = setInterval(async () => {
        if (cancelled) return;
        try {
          await syncAirtableToStore();
          await loadDashboard();
        } catch {
          // silent background failure
        }
      }, ms);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [loadDashboard]);

  const selectedDay = useMemo(
    () => daily.find((d) => d.id === selectedDayId) ?? daily[0],
    [daily, selectedDayId]
  );

  const dailyChart = useMemo(
    () =>
      [...daily]
        .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())
        .map((d) => ({
          day: format(parseISO(d.date), "MMM d"),
          otp: d.roas_otp,
          rebill: d.roas_rebill,
          combined: d.roas_combined,
        })),
    [daily]
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const payload = await syncAirtableToStore();
      await loadDashboard();
      toast.success(
        payload.source === "airtable"
          ? "Airtable synced"
          : "Seed refreshed — add AIRTABLE keys for live updates"
      );
    } catch {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleResolveAlert(alert: Alert) {
    if (!canWrite) {
      toast.error("You do not have permission to resolve alerts");
      return;
    }
    setResolvingId(alert.id);
    try {
      await mockProvider.resolveAlert(alert.id);
      toast.success("Alert resolved");
      await loadDashboard();
    } catch {
      toast.error("Failed to resolve alert");
    } finally {
      setResolvingId(null);
    }
  }

  if (loading) {
    return <LoadingState className="min-h-[480px]" />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        description="Unable to load ecosystem overview data."
        action={
          <Button onClick={() => loadDashboard()} variant="outline">
            Retry
          </Button>
        }
      />
    );
  }

  const chartData = data.businessTrend.map((week) => ({
    week: new Date(week.week_start).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    active_subscribers: week.active_subscribers,
    new_subscribers: week.new_subscribers,
    churn_rate: week.churn_rate,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Dashboard
          </h1>
          <p className="mt-0.5 max-w-xl text-xs text-slate-500 sm:text-sm">
            Business KPIs first, then ecosystem health, infrastructure and recovery.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">
            Last sync {formatRelativeTime(data.lastSyncAt)} ago
          </span>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7d</SelectItem>
              <SelectItem value="30d">30d</SelectItem>
              <SelectItem value="90d">90d</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
          <Badge variant={data.syncStatus === "live" ? "success" : "secondary"}>
            {data.syncStatus === "live" ? "Live" : "Synced"}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="business" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-2xl bg-slate-100/80 p-1.5">
          <TabsTrigger
            value="business"
            className="rounded-xl px-4 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            Business Overview
          </TabsTrigger>
          <TabsTrigger
            value="ecosystem"
            className="rounded-xl px-4 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <Shield className="mr-2 h-4 w-4" />
            Ecosystem Overview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="business" className="mt-6 space-y-6 focus-visible:outline-none">
      <div className="space-y-6">
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="sm:col-span-2 lg:col-span-4">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">ROAS scoring</CardTitle>
                  <CardDescription>
                    Decisions are based on <strong>7-day</strong> ROAS only. Daily view is for
                    monitoring.
                  </CardDescription>
                </div>
                <RoasLegend />
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="7d">
                <TabsList>
                  <TabsTrigger value="7d">7 days (decisions)</TabsTrigger>
                  <TabsTrigger value="day">By day</TabsTrigger>
                </TabsList>
                <TabsContent value="7d" className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <RoasScoreCard
                      title="OTP / Direct"
                      value={data.business.roas_otp_7d}
                      hint="1.8 = direct paie les ads · rebill = profit pur"
                      subtitle={`Seuil mort < 1.0 · Confort ${1.3}x`}
                    />
                    <RoasScoreCard
                      title="Rebill"
                      value={data.business.roas_rebill_7d}
                      colorize={false}
                      subtitle="Initial + recurring + salvage"
                    />
                    <RoasScoreCard
                      title="Combined"
                      value={data.business.roas_combined_7d}
                      breakdown={{
                        otp: data.business.roas_otp_7d,
                        rebill: data.business.roas_rebill_7d,
                      }}
                      hint="Somme simple OTP + Rebill sur 7 jours"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    {roasLevelMeta(getRoasLevel(data.business.roas_otp_7d)).description}
                  </p>
                </TabsContent>
                <TabsContent value="day" className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={selectedDay?.id} onValueChange={setSelectedDayId}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select day" />
                      </SelectTrigger>
                      <SelectContent>
                        {daily.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {format(parseISO(d.date), "EEE, MMM d")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Badge variant="outline">Informational — not for decisions</Badge>
                  </div>
                  {selectedDay ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <RoasScoreCard title="OTP / Direct" value={selectedDay.roas_otp} />
                      <RoasScoreCard
                        title="Rebill"
                        value={selectedDay.roas_rebill}
                        colorize={false}
                        subtitle="Initial + recurring + salvage"
                      />
                      <RoasScoreCard
                        title="Combined"
                        value={selectedDay.roas_combined}
                        breakdown={{
                          otp: selectedDay.roas_otp,
                          rebill: selectedDay.roas_rebill,
                        }}
                        hint="OTP + Rebill du jour"
                      />
                    </div>
                  ) : null}
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} domain={[0, "auto"]} />
                        <Tooltip
                          formatter={(value, name) => {
                            const num = typeof value === "number" ? value : Number(value ?? 0);
                            return [
                              `${num.toFixed(2)}x`,
                              name === "otp" ? "OTP" : name === "rebill" ? "Rebill" : "Combined",
                            ];
                          }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="otp" name="OTP" stroke="#059669" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="rebill" name="Rebill" stroke="#34d399" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="combined" name="Combined" stroke="#2563eb" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Revenue (latest week)</CardDescription>
              <CardTitle className="text-xl">
                {formatCurrency(data.business.revenue)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Spend (latest week)</CardDescription>
              <CardTitle className="text-xl">{formatCurrency(data.business.spend)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active subscribers</CardDescription>
              <CardTitle className="text-xl">
                {formatNumber(data.business.active_subscribers)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>New subscribers</CardDescription>
              <CardTitle className="text-xl">
                {formatNumber(data.business.new_subscribers)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Churn rate</CardDescription>
              <CardTitle className="text-xl">
                {formatPercent(data.business.churn_rate)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Retention rate</CardDescription>
              <CardTitle className="text-xl">
                {formatPercent(data.business.retention_rate)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Net growth</CardDescription>
              <CardTitle
                className={cn(
                  "text-xl",
                  data.business.net_growth >= 0 ? "text-emerald-600" : "text-rose-600"
                )}
              >
                {data.business.net_growth >= 0 ? "+" : ""}
                {formatNumber(data.business.net_growth)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>8-week trend</CardTitle>
            <CardDescription>
              Active subscribers, new subscribers, and churn rate
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#64748B" }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12, fill: "#64748B" }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 12, fill: "#64748B" }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #E2E8F0",
                      fontSize: 12,
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="active_subscribers"
                    name="Active subscribers"
                    stroke="#059669"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="new_subscribers"
                    name="New subscribers"
                    stroke="#10B981"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="churn_rate"
                    name="Churn rate"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="ecosystem" className="mt-5 space-y-5 focus-visible:outline-none">
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Composite score based on active health rules and penalties</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
            <HealthGauge score={data.health.score} status={data.health.status} />
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-600">{data.health.explanation}</p>
              {data.health.appliedPenalties.length > 0 ? (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Applied penalties
                  </h4>
                  <ul className="space-y-1.5">
                    {data.health.appliedPenalties.map((penalty) => (
                      <li
                        key={`${penalty.rule}-${penalty.detail}`}
                        className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm"
                      >
                        <div>
                          <span className="font-medium text-slate-800">{penalty.rule}</span>
                          <p className="text-xs text-slate-500">{penalty.detail}</p>
                        </div>
                        <span className="shrink-0 font-medium text-rose-600">
                          −{penalty.penalty}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-emerald-600">No penalties applied — ecosystem is healthy.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {infraCards.map(({ key, label, icon: Icon, href }) => {
          const value = data.infrastructure[key];
          const status = infraStatus(key, value);
          return (
            <Card key={key} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Icon className="h-4 w-4" />
                  </div>
                  <StatusBadge status={status} />
                </div>
                <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="text-2xl font-semibold text-slate-900">{formatNumber(value)}</div>
                <Link
                  href={href}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
                >
                  View details
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Active Alerts</CardTitle>
              <CardDescription>{data.alerts.length} require attention</CardDescription>
            </div>
            <Link href="/alerts">
              <Button variant="ghost" size="sm">
                View all
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.alerts.length === 0 ? (
              <EmptyState
                title="No active alerts"
                description="All monitored signals are within thresholds."
              />
            ) : (
              data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={alertLevelBadge(alert.level)}>{alert.level}</Badge>
                        <span className="text-xs text-slate-400">{alert.category}</span>
                      </div>
                      <h4 className="mt-1.5 text-sm font-medium text-slate-900">{alert.title}</h4>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{alert.description}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={
                            alert.recovery_case_id
                              ? `/recovery/${alert.recovery_case_id}`
                              : `/alerts?id=${alert.id}`
                          }
                        >
                          View
                        </Link>
                      </Button>
                      <Button
                        variant="success"
                        size="sm"
                        disabled={!canWrite || resolvingId === alert.id}
                        onClick={() => handleResolveAlert(alert)}
                      >
                        Resolve
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recovery in Progress</CardTitle>
              <CardDescription>{data.recoveryCases.length} open cases</CardDescription>
            </div>
            <Link href="/recovery">
              <Button variant="ghost" size="sm">
                View all
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recoveryCases.length === 0 ? (
              <EmptyState
                title="No recovery cases"
                description="Bank and MID closures will appear here."
              />
            ) : (
              data.recoveryCases.map((recoveryCase) => {
                const { done, total, percent } = recoveryProgress(recoveryCase);
                return (
                  <Link
                    key={recoveryCase.id}
                    href={`/recovery/${recoveryCase.id}`}
                    className="block rounded-xl border border-slate-100 bg-white p-4 transition-colors hover:border-emerald-200 hover:bg-emerald-50/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Shield className="h-3.5 w-3.5 text-emerald-500" />
                          <StatusBadge status={recoveryCase.status} />
                          <StatusBadge status={recoveryCase.priority} />
                        </div>
                        <h4 className="mt-1.5 truncate text-sm font-medium text-slate-900">
                          {recoveryCase.title}
                        </h4>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {done}/{total} steps ·{" "}
                          {recoveryCase.type === "bank_closure" ? "Bank closure" : "MID closure"}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-600">{percent}%</span>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
        </TabsContent>
      </Tabs>

    </div>
  );
}
