"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Minus,
  Plus,
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
import { mockProvider } from "@/lib/providers/mock-provider";
import { useAuth } from "@/lib/auth/auth-context";
import {
  downloadCsv,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils";
import {
  ROAS_THRESHOLDS,
  computeCombinedRoas,
  getRoasLevel,
  roasLevelMeta,
} from "@/lib/business/roas";
import type { BusinessDailyMetric, BusinessWeeklyMetric } from "@/types";
import { PageHeader, LoadingState, EmptyState } from "@/components/shared/page-states";
import { RoasLegend, RoasScoreCard } from "@/components/business/roas-score-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function weekLabel(metric: BusinessWeeklyMetric) {
  const start = parseISO(metric.week_start);
  const end = parseISO(metric.week_end);
  return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function computeDerivedMetrics(
  active: number,
  newSubs: number,
  lost: number
): { churn_rate: number; retention_rate: number; net_growth: number } {
  const net_growth = newSubs - lost;
  const beginning_active = active - newSubs + lost;
  const churn_rate =
    beginning_active > 0 ? Number(((lost / beginning_active) * 100).toFixed(1)) : 0;
  const retention_rate = Number((100 - churn_rate).toFixed(1));
  return { churn_rate, retention_rate, net_growth };
}

const metricSchema = z.object({
  week_start: z.string().min(1, "Week start is required"),
  week_end: z.string().min(1, "Week end is required"),
  roas_otp_7d: z.number().min(0),
  roas_rebill_7d: z.number().min(0),
  spend: z.number().min(0),
  revenue: z.number().min(0),
  active_subscribers: z.number().int().min(0),
  new_subscribers: z.number().int().min(0),
  lost_subscribers: z.number().int().min(0),
});

type MetricForm = z.infer<typeof metricSchema>;

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-slate-400">
        <Minus className="h-3 w-3" />
        n/a
      </span>
    );
  }
  const positive = delta >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        positive ? "text-emerald-600" : "text-rose-600"
      }`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(delta).toFixed(1)}% vs prev week
    </span>
  );
}

function KpiCard({
  label,
  value,
  delta,
  subtitle,
}: {
  label: string;
  value: string;
  delta?: number | null;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {delta !== undefined ? (
          <div className="mt-2">
            <DeltaBadge delta={delta} />
          </div>
        ) : null}
        {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

function DailyRoasCell({ value, colorize = true }: { value: number; colorize?: boolean }) {
  if (!colorize) {
    return <span className="font-medium text-slate-700">{value.toFixed(2)}x</span>;
  }
  const meta = roasLevelMeta(getRoasLevel(value));
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.valueClass}`}>
      <span className={`h-2 w-2 rounded-full ${meta.barClass}`} />
      {value.toFixed(2)}x
    </span>
  );
}

export default function BusinessPage() {
  const { canWrite } = useAuth();
  const [metrics, setMetrics] = useState<BusinessWeeklyMetric[]>([]);
  const [daily, setDaily] = useState<BusinessDailyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [selectedDayId, setSelectedDayId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMetric, setEditingMetric] = useState<BusinessWeeklyMetric | null>(null);
  const [view, setView] = useState<"7d" | "day">("7d");

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    const [weekly, dailyMetrics] = await Promise.all([
      mockProvider.getBusinessMetrics(),
      mockProvider.getBusinessDailyMetrics(),
    ]);
    const sorted = [...weekly].sort(
      (a, b) => parseISO(b.week_start).getTime() - parseISO(a.week_start).getTime()
    );
    const sortedDaily = [...dailyMetrics].sort(
      (a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()
    );
    setMetrics(sorted);
    setDaily(sortedDaily);
    setSelectedWeekId((prev) => prev || sorted[0]?.id || "");
    setSelectedDayId((prev) => prev || sortedDaily[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const selected = useMemo(
    () => metrics.find((m) => m.id === selectedWeekId) ?? metrics[0],
    [metrics, selectedWeekId]
  );

  const selectedDay = useMemo(
    () => daily.find((d) => d.id === selectedDayId) ?? daily[0],
    [daily, selectedDayId]
  );

  const previous = useMemo(() => {
    if (!selected) return undefined;
    const idx = metrics.findIndex((m) => m.id === selected.id);
    return metrics[idx + 1];
  }, [metrics, selected]);

  const chartData = useMemo(() => {
    return [...metrics]
      .sort((a, b) => parseISO(a.week_start).getTime() - parseISO(b.week_start).getTime())
      .slice(-12)
      .map((m) => ({
        week: format(parseISO(m.week_start), "MMM d"),
        active: m.active_subscribers,
        new: m.new_subscribers,
        churn: m.churn_rate,
        otp: m.roas_otp_7d,
        rebill: m.roas_rebill_7d,
        combined: m.roas_combined_7d,
      }));
  }, [metrics]);

  const dailyChart = useMemo(
    () =>
      [...daily]
        .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())
        .map((d) => ({
          day: format(parseISO(d.date), "MMM d"),
          otp: d.roas_otp,
          rebill: d.roas_rebill,
          combined: d.roas_combined,
          spend: d.spend,
          revenue: d.revenue,
        })),
    [daily]
  );
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MetricForm>({
    resolver: zodResolver(metricSchema) as Resolver<MetricForm>,
  });

  function openManualEntry(metric?: BusinessWeeklyMetric) {
    setEditingMetric(metric ?? null);
    reset(
      metric
        ? {
            week_start: metric.week_start,
            week_end: metric.week_end,
            roas_otp_7d: metric.roas_otp_7d,
            roas_rebill_7d: metric.roas_rebill_7d,
            spend: metric.spend,
            revenue: metric.revenue,
            active_subscribers: metric.active_subscribers,
            new_subscribers: metric.new_subscribers,
            lost_subscribers: metric.lost_subscribers,
          }
        : {
            week_start: "",
            week_end: "",
            roas_otp_7d: 1.5,
            roas_rebill_7d: 0.3,
            spend: 0,
            revenue: 0,
            active_subscribers: 0,
            new_subscribers: 0,
            lost_subscribers: 0,
          }
    );
    setDialogOpen(true);
  }

  async function onSubmit(values: MetricForm) {
    const derived = computeDerivedMetrics(
      values.active_subscribers,
      values.new_subscribers,
      values.lost_subscribers
    );
    const roas_combined_7d = computeCombinedRoas(values.roas_otp_7d, values.roas_rebill_7d);
    try {
      await mockProvider.upsertBusinessMetric({
        id: editingMetric?.id,
        week_start: values.week_start,
        week_end: values.week_end,
        roas_otp_7d: values.roas_otp_7d,
        roas_rebill_7d: values.roas_rebill_7d,
        roas_combined_7d,
        roas_7d: roas_combined_7d,
        spend: values.spend,
        revenue: values.revenue,
        active_subscribers: values.active_subscribers,
        new_subscribers: values.new_subscribers,
        lost_subscribers: values.lost_subscribers,
        ...derived,
      });
      toast.success(editingMetric ? "Week updated" : "Week added");
      setDialogOpen(false);
      await loadMetrics();
    } catch {
      toast.error("Failed to save metric");
    }
  }

  function handleExport() {
    const rows = [...metrics]
      .sort((a, b) => parseISO(a.week_start).getTime() - parseISO(b.week_start).getTime())
      .map((m) => ({
        week_start: m.week_start,
        week_end: m.week_end,
        roas_otp_7d: m.roas_otp_7d,
        roas_rebill_7d: m.roas_rebill_7d,
        roas_combined_7d: m.roas_combined_7d,
        spend: m.spend,
        revenue: m.revenue,
        active_subscribers: m.active_subscribers,
        new_subscribers: m.new_subscribers,
        lost_subscribers: m.lost_subscribers,
        churn_rate: m.churn_rate,
        retention_rate: m.retention_rate,
        net_growth: m.net_growth,
      }));
    downloadCsv("business-weekly-metrics.csv", rows);
    toast.success("CSV exported");
  }

  if (loading) return <LoadingState />;

  if (!selected) {
    return (
      <EmptyState
        title="No business metrics"
        description="Add your first weekly KPI entry to get started."
        action={
          canWrite ? (
            <Button onClick={() => openManualEntry()}>
              <Plus className="h-4 w-4" />
              Add week
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Business KPIs"
        description="Weekly performance metrics with trend analysis and week-over-week comparison."
        actions={
          <>
            <Select value={selectedWeekId} onValueChange={setSelectedWeekId}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent>
                {metrics.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {weekLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            {canWrite ? (
              <>
                <Button variant="secondary" onClick={() => openManualEntry(selected)}>
                  Edit week
                </Button>
                <Button onClick={() => openManualEntry()}>
                  <Plus className="h-4 w-4" />
                  Add week
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-slate-600">
            <p className="font-medium text-slate-900">ROAS scoring scale</p>
            <p className="mt-1">
              <strong>&lt; 1.0</strong> seuil de mort · <strong>1.3</strong> confort ·{" "}
              <strong>1.8</strong> direct paie tout seul.{" "}
              <strong>Combined = OTP + Rebill</strong> (7j pour décider, jour par jour pour
              inspecter).
            </p>
          </div>
          <RoasLegend />
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as "7d" | "day")}>
          <TabsList>
            <TabsTrigger value="7d">7 days (decisions)</TabsTrigger>
            <TabsTrigger value="day">By day</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "7d" ? (
        <>
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-800">
            <TrendingUp className="h-4 w-4 shrink-0" />
            <span>
              Viewing <strong>{weekLabel(selected)}</strong>
              {previous ? " compared to the previous week" : ""}
            </span>
          </div>

          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <RoasScoreCard
              title="OTP / Direct (7d)"
              value={selected.roas_otp_7d}
              hint={roasLevelMeta(getRoasLevel(selected.roas_otp_7d)).description}
            />
            <RoasScoreCard
              title="Rebill (7d)"
              value={selected.roas_rebill_7d}
              colorize={false}
              subtitle="Initial + recurring + salvage"
            />
            <RoasScoreCard
              title="Combined (7d)"
              value={selected.roas_combined_7d}
              breakdown={{
                otp: selected.roas_otp_7d,
                rebill: selected.roas_rebill_7d,
              }}
              hint="Somme OTP + Rebill — pas une métrique séparée"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Spend"
              value={formatCurrency(selected.spend)}
              delta={previous ? deltaPercent(selected.spend, previous.spend) : null}
            />
            <KpiCard
              label="Revenue (CA)"
              value={formatCurrency(selected.revenue)}
              delta={previous ? deltaPercent(selected.revenue, previous.revenue) : null}
            />
            <KpiCard
              label="Active subscribers"
              value={formatNumber(selected.active_subscribers)}
              delta={
                previous
                  ? deltaPercent(selected.active_subscribers, previous.active_subscribers)
                  : null
              }
            />
            <KpiCard
              label="New subscribers"
              value={formatNumber(selected.new_subscribers)}
              delta={
                previous ? deltaPercent(selected.new_subscribers, previous.new_subscribers) : null
              }
            />
            <KpiCard
              label="Churn"
              value={formatPercent(selected.churn_rate)}
              delta={previous ? deltaPercent(selected.churn_rate, previous.churn_rate) : null}
              subtitle="Lower is better"
            />
            <KpiCard
              label="Retention"
              value={formatPercent(selected.retention_rate)}
              delta={
                previous ? deltaPercent(selected.retention_rate, previous.retention_rate) : null
              }
              subtitle="Higher is better"
            />
            <KpiCard
              label="Net growth"
              value={formatNumber(selected.net_growth)}
              delta={previous ? deltaPercent(selected.net_growth, previous.net_growth) : null}
            />
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={selectedDay?.id} onValueChange={setSelectedDayId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select day" />
              </SelectTrigger>
              <SelectContent>
                {daily.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {format(parseISO(d.date), "EEE, MMM d yyyy")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline">Daily = monitoring only</Badge>
          </div>
          {selectedDay ? (
            <>
              <div className="mb-4 grid gap-4 sm:grid-cols-3">
                <RoasScoreCard title="OTP / Direct (day)" value={selectedDay.roas_otp} />
                <RoasScoreCard
                  title="Rebill (day)"
                  value={selectedDay.roas_rebill}
                  colorize={false}
                  subtitle="Initial + recurring + salvage"
                />
                <RoasScoreCard
                  title="Combined (day)"
                  value={selectedDay.roas_combined}
                  breakdown={{
                    otp: selectedDay.roas_otp,
                    rebill: selectedDay.roas_rebill,
                  }}
                  hint="OTP + Rebill du jour"
                />
              </div>
              <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard label="Spend" value={formatCurrency(selectedDay.spend)} />
                <KpiCard label="Revenue" value={formatCurrency(selectedDay.revenue)} />
                <KpiCard
                  label="New subscribers"
                  value={formatNumber(selectedDay.new_subscribers)}
                />
                <KpiCard
                  label="Lost subscribers"
                  value={formatNumber(selectedDay.lost_subscribers)}
                />
              </div>
            </>
          ) : null}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Daily ROAS table</CardTitle>
              <CardDescription>
                Combined = OTP + Rebill chaque jour. Décisions uniquement sur le 7d.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">OTP</th>
                    <th className="px-3 py-2 font-medium">Rebill</th>
                    <th className="px-3 py-2 font-medium">Combined</th>
                    <th className="px-3 py-2 font-medium">Spend</th>
                    <th className="px-3 py-2 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d) => (
                    <tr
                      key={d.id}
                      className={`border-b border-slate-100 hover:bg-slate-50/80 ${
                        d.id === selectedDay?.id ? "bg-emerald-50/40" : ""
                      }`}
                      onClick={() => setSelectedDayId(d.id)}
                    >
                      <td className="cursor-pointer px-3 py-2.5 text-slate-700">
                        {format(parseISO(d.date), "EEE, MMM d")}
                      </td>
                      <td className="px-3 py-2.5">
                        <DailyRoasCell value={d.roas_otp} />
                      </td>
                      <td className="px-3 py-2.5">
                        <DailyRoasCell value={d.roas_rebill} colorize={false} />
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-slate-500">
                          {d.roas_otp.toFixed(2)}+{d.roas_rebill.toFixed(2)}=
                        </span>{" "}
                        <DailyRoasCell value={d.roas_otp + d.roas_rebill} />
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {formatCurrency(d.spend)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {formatCurrency(d.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>{view === "7d" ? "ROAS trends (7d)" : "ROAS trends (daily)"}</CardTitle>
          <CardDescription>
            {view === "7d"
              ? `OTP / Direct, Rebill, Combined — last ${chartData.length} weeks`
              : `Daily OTP / Rebill / Combined — last ${dailyChart.length} days`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={(view === "7d" ? chartData : dailyChart) as Array<Record<string, string | number>>}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey={view === "7d" ? "week" : "day"}
                  tick={{ fontSize: 12, fill: "#64748b" }}
                />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} domain={[0, "auto"]} />
                <Tooltip
                  formatter={(value, name) => {
                    const num = typeof value === "number" ? value : Number(value ?? 0);
                    const label =
                      name === "otp" ? "OTP" : name === "rebill" ? "Rebill" : "Combined";
                    return [`${num.toFixed(2)}x`, label];
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="otp"
                  name="OTP"
                  stroke="#047857"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="rebill"
                  name="Rebill"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="combined"
                  name="Combined"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {view === "7d" ? (
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Subscriber trends</CardTitle>
          <CardDescription>
            Last {chartData.length} weeks — active subscribers, new sign-ups, and churn rate
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  tickFormatter={(v) => formatNumber(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
                  }}
                  formatter={(value, name) => {
                    const num = typeof value === "number" ? value : Number(value ?? 0);
                    if (name === "churn") return [formatPercent(num), "Churn rate"];
                    return [formatNumber(num), name === "active" ? "Active" : "New"];
                  }}
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="active"
                  name="Active"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="new"
                  name="New"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="churn"
                  name="Churn"
                  stroke="#e11d48"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      ) : null}


      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingMetric ? "Edit weekly metrics" : "Add weekly metrics"}</DialogTitle>
            <DialogDescription>
              Churn, retention, and net growth are computed automatically from subscriber inputs.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="week_start">Week start</Label>
                <Input id="week_start" type="date" {...register("week_start")} />
                {errors.week_start ? (
                  <p className="text-xs text-rose-600">{errors.week_start.message}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="week_end">Week end</Label>
                <Input id="week_end" type="date" {...register("week_end")} />
                {errors.week_end ? (
                  <p className="text-xs text-rose-600">{errors.week_end.message}</p>
                ) : null}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="roas_otp_7d">ROAS OTP / Direct</Label>
                <Input
                  id="roas_otp_7d"
                  type="number"
                  step="0.01"
                  {...register("roas_otp_7d", { valueAsNumber: true })}
                />
                <p className="text-xs text-slate-400">
                  Ideal {ROAS_THRESHOLDS.ideal}x · Comfort {ROAS_THRESHOLDS.comfort}x · Death &lt;{" "}
                  {ROAS_THRESHOLDS.death}x
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="roas_rebill_7d">ROAS Rebill</Label>
                <Input
                  id="roas_rebill_7d"
                  type="number"
                  step="0.01"
                  {...register("roas_rebill_7d", { valueAsNumber: true })}
                />
                <p className="text-xs text-slate-400">Initial + recurring + salvage</p>
              </div>
              <div className="space-y-2">
                <Label>ROAS Combined (auto)</Label>
                <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                  OTP + Rebill
                </div>
                <p className="text-xs text-slate-400">Calculé automatiquement, jamais saisi</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="spend">Spend</Label>
                <Input id="spend" type="number" {...register("spend", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="revenue">Revenue</Label>
                <Input id="revenue" type="number" {...register("revenue", { valueAsNumber: true })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="active_subscribers">Active subscribers</Label>
                <Input
                  id="active_subscribers"
                  type="number"
                  {...register("active_subscribers", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_subscribers">New subscribers</Label>
                <Input
                  id="new_subscribers"
                  type="number"
                  {...register("new_subscribers", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lost_subscribers">Lost subscribers</Label>
                <Input
                  id="lost_subscribers"
                  type="number"
                  {...register("lost_subscribers", { valueAsNumber: true })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
