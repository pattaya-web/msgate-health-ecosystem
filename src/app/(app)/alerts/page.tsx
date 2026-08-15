"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Search,
  ShieldPlus,
} from "lucide-react";
import { toast } from "sonner";
import { mockProvider } from "@/lib/providers/mock-provider";
import { useAuth } from "@/lib/auth/auth-context";
import type { Alert, AlertLevel, AlertStatus } from "@/types";
import { PageHeader, LoadingState, EmptyState } from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE = 8;

const levelVariant: Record<AlertLevel, "default" | "warning" | "destructive"> = {
  info: "default",
  warning: "warning",
  critical: "destructive",
};

export default function AlertsPage() {
  const { canWrite } = useAuth();
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewAlert, setViewAlert] = useState<Alert | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    const data = await mockProvider.getAlerts();
    setAlerts(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const categories = useMemo(() => {
    return Array.from(new Set(alerts.map((a) => a.category))).sort();
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return alerts.filter((a) => {
      if (levelFilter !== "all" && a.level !== levelFilter) return false;
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        (a.entity_label?.toLowerCase().includes(q) ?? false) ||
        (a.owner?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [alerts, levelFilter, categoryFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [levelFilter, categoryFilter, statusFilter, search]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function handleResolve(alert: Alert) {
    if (!canWrite || alert.status === "resolved") return;
    setResolvingId(alert.id);
    try {
      await mockProvider.resolveAlert(alert.id);
      toast.success("Alert resolved");
      await loadAlerts();
    } catch {
      toast.error("Failed to resolve alert");
    } finally {
      setResolvingId(null);
    }
  }

  function handleCreateRecovery(alert: Alert) {
    toast.info("Opening recovery center", {
      description: alert.recovery_case_id
        ? `Existing case linked: ${alert.recovery_case_id}`
        : "Create a new recovery case for this alert",
    });
    router.push(
      alert.recovery_case_id ? `/recovery/${alert.recovery_case_id}` : "/recovery"
    );
  }

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Alert center"
        description="Monitor infrastructure, banking, MID, and finance alerts across the ecosystem."
      />

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, description, entity, owner…"
                className="pl-9"
              />
            </div>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-full lg:w-[140px]">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full lg:w-[160px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full lg:w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title="No alerts match your filters"
          description="Try adjusting filters or clearing the search query."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Alert</th>
                    <th className="px-4 py-3 font-medium">Level</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Entity</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((alert) => (
                    <tr
                      key={alert.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{alert.title}</div>
                        <div className="mt-0.5 line-clamp-1 max-w-xs text-xs text-slate-500">
                          {alert.description}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={levelVariant[alert.level]} className="capitalize">
                          {alert.level}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{alert.category}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {alert.entity_label ?? "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {format(parseISO(alert.created_at), "MMM d, yyyy HH:mm")}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{alert.owner ?? "—"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={alert.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewAlert(alert)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                          {canWrite && alert.status !== "resolved" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={resolvingId === alert.id}
                              onClick={() => handleResolve(alert)}
                            >
                              {resolvingId === alert.id ? "…" : "Resolve"}
                            </Button>
                          ) : null}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCreateRecovery(alert)}
                          >
                            <ShieldPlus className="h-3.5 w-3.5" />
                            Recovery
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} alerts
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!viewAlert} onOpenChange={(open) => !open && setViewAlert(null)}>
        <DialogContent className="max-w-lg">
          {viewAlert ? (
            <>
              <DialogHeader>
                <DialogTitle>{viewAlert.title}</DialogTitle>
                <DialogDescription>{viewAlert.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={levelVariant[viewAlert.level]} className="capitalize">
                    {viewAlert.level}
                  </Badge>
                  <Badge variant="secondary">{viewAlert.category}</Badge>
                  <StatusBadge status={viewAlert.status} />
                </div>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium uppercase text-slate-400">Entity</dt>
                    <dd className="mt-0.5 text-slate-800">
                      {viewAlert.entity_label ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase text-slate-400">Owner</dt>
                    <dd className="mt-0.5 text-slate-800">{viewAlert.owner ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase text-slate-400">Created</dt>
                    <dd className="mt-0.5 text-slate-800">
                      {format(parseISO(viewAlert.created_at), "PPpp")}
                    </dd>
                  </div>
                  {viewAlert.resolved_at ? (
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-400">Resolved</dt>
                      <dd className="mt-0.5 text-slate-800">
                        {format(parseISO(viewAlert.resolved_at), "PPpp")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {viewAlert.recommended_action ? (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                    <p className="text-xs font-medium uppercase text-emerald-600">
                      Recommended action
                    </p>
                    <p className="mt-1 text-slate-800">{viewAlert.recommended_action}</p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-2">
                  {viewAlert.recovery_case_id ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        router.push(`/recovery/${viewAlert.recovery_case_id}`);
                        setViewAlert(null);
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open recovery case
                    </Button>
                  ) : null}
                  {canWrite && viewAlert.status !== "resolved" ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await handleResolve(viewAlert);
                        setViewAlert(null);
                      }}
                    >
                      Resolve alert
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
