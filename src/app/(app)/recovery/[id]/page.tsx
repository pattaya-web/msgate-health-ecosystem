"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Calendar, FileText } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth/auth-context";
import { mockProvider } from "@/lib/providers/mock-provider";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { Bank, Ibo, Mid, RecoveryCase, RecoveryStatus } from "@/types";

const recoveryStatuses: RecoveryStatus[] = [
  "open",
  "in_progress",
  "waiting_on_ibo",
  "waiting_on_bank",
  "funds_recovered",
  "resolved",
  "lost_funds",
];

function stepProgress(recoveryCase: RecoveryCase) {
  const total = recoveryCase.steps.length;
  const done = recoveryCase.steps.filter((s) => s.status === "done").length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export default function RecoveryDetailPage() {
  const params = useParams<{ id: string }>();
  const { canWrite } = useAuth();
  const [recoveryCase, setRecoveryCase] = useState<RecoveryCase | null>(null);
  const [ibos, setIbos] = useState<Ibo[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [mids, setMids] = useState<Mid[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingStepId, setUpdatingStepId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const loadCase = useCallback(async () => {
    if (!params.id) return;
    try {
      const [item, iboList, bankList, midList] = await Promise.all([
        mockProvider.getRecoveryCase(params.id),
        mockProvider.getIbos(),
        mockProvider.getBanks(),
        mockProvider.getMids(),
      ]);
      setRecoveryCase(item);
      setIbos(iboList);
      setBanks(bankList);
      setMids(midList);
    } catch {
      toast.error("Failed to load recovery case");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadCase();
  }, [loadCase]);

  const progress = useMemo(
    () => (recoveryCase ? stepProgress(recoveryCase) : { done: 0, total: 0, percent: 0 }),
    [recoveryCase]
  );

  const iboLabel = useMemo(() => {
    if (!recoveryCase?.ibo_id) return "—";
    return (
      ibos.find((i) => i.id === recoveryCase.ibo_id)?.display_name ||
      ibos.find((i) => i.id === recoveryCase.ibo_id)?.reference_code ||
      recoveryCase.ibo_id
    );
  }, [recoveryCase, ibos]);

  const bankLabel = useMemo(() => {
    if (!recoveryCase?.bank_id) return "—";
    return banks.find((b) => b.id === recoveryCase.bank_id)?.name ?? recoveryCase.bank_id;
  }, [recoveryCase, banks]);

  const midLabel = useMemo(() => {
    if (!recoveryCase?.mid_id) return "—";
    return mids.find((m) => m.id === recoveryCase.mid_id)?.reference_code ?? recoveryCase.mid_id;
  }, [recoveryCase, mids]);

  async function handleStatusChange(status: RecoveryStatus) {
    if (!recoveryCase || !canWrite) {
      toast.error("You do not have permission to update status");
      return;
    }
    setUpdatingStatus(true);
    try {
      const updated = await mockProvider.updateRecoveryStatus(recoveryCase.id, status);
      setRecoveryCase(updated);
      toast.success("Status updated");
    } catch {
      toast.error("Failed to update status");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleStepToggle(stepId: string, checked: boolean) {
    if (!recoveryCase || !canWrite) {
      toast.error("You do not have permission to update steps");
      return;
    }
    setUpdatingStepId(stepId);
    try {
      const updated = await mockProvider.updateRecoveryStep(
        recoveryCase.id,
        stepId,
        checked ? "done" : "pending"
      );
      setRecoveryCase(updated);
    } catch {
      toast.error("Failed to update step");
    } finally {
      setUpdatingStepId(null);
    }
  }

  if (loading) {
    return <LoadingState className="min-h-[480px]" />;
  }

  if (!recoveryCase) {
    return (
      <EmptyState
        title="Recovery case not found"
        description="This case may have been removed or the link is invalid."
        action={
          <Button variant="outline" asChild>
            <Link href="/recovery">Back to recovery list</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/recovery"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-emerald-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to recovery
        </Link>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {recoveryCase.type === "bank_closure" ? "Bank closure" : "MID closure"}
              </Badge>
              <StatusBadge status={recoveryCase.priority} />
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {recoveryCase.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Updated {formatRelativeTime(recoveryCase.updated_at)} ago
            </p>
          </div>

          <div className="w-full max-w-xs space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={recoveryCase.status}
              onValueChange={(v) => handleStatusChange(v as RecoveryStatus)}
              disabled={!canWrite || updatingStatus}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {recoveryStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>
            {progress.done} of {progress.total} checklist steps completed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <StatusBadge status={recoveryCase.status} />
            <span className="font-semibold text-emerald-600">{progress.percent}%</span>
          </div>
          <Progress value={progress.percent} className="h-2.5" />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Case details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">IBO</dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{iboLabel}</dd>
              </div>
              {recoveryCase.type === "bank_closure" ? (
                <>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Bank
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-slate-900">{bankLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Funds at risk
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-rose-600">
                      {formatCurrency(recoveryCase.funds_at_risk ?? 0)}
                    </dd>
                  </div>
                  {recoveryCase.estimated_recovery_date ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Est. recovery
                      </dt>
                      <dd className="mt-1 flex items-center gap-1.5 text-sm text-slate-900">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        {recoveryCase.estimated_recovery_date}
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      MID
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-slate-900">{midLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Avg. volume
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-slate-900">
                      {formatCurrency(recoveryCase.average_volume ?? 0)}
                    </dd>
                  </div>
                </>
              )}
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Closed at
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {recoveryCase.closed_at
                    ? new Date(recoveryCase.closed_at).toLocaleDateString()
                    : "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Reason
                </dt>
                <dd className="mt-1 text-sm text-slate-700">
                  {recoveryCase.reason || "—"}
                </dd>
              </div>
              {recoveryCase.comments ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Comments
                  </dt>
                  <dd className="mt-1 text-sm text-slate-700">{recoveryCase.comments}</dd>
                </div>
              ) : null}
              {recoveryCase.documents && recoveryCase.documents.length > 0 ? (
                <div className="sm:col-span-2">
                  <dt className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Documents
                  </dt>
                  <dd className="flex flex-wrap gap-2">
                    {recoveryCase.documents.map((doc) => (
                      <Badge key={doc} variant="secondary" className="gap-1">
                        <FileText className="h-3 w-3" />
                        {doc}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recovery checklist</CardTitle>
            <CardDescription>
              Mark steps as done to track recovery progress
              {!canWrite ? " (read-only)" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recoveryCase.steps
              .slice()
              .sort((a, b) => a.step_order - b.step_order)
              .map((step) => {
                const isDone = step.status === "done";
                const isUpdating = updatingStepId === step.id;
                return (
                  <label
                    key={step.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                      isDone
                        ? "border-emerald-100 bg-emerald-50/40"
                        : "border-slate-100 bg-slate-50/40",
                      (!canWrite || isUpdating) && "cursor-default opacity-70"
                    )}
                  >
                    <Checkbox
                      checked={isDone}
                      disabled={!canWrite || isUpdating}
                      onCheckedChange={(checked) =>
                        handleStepToggle(step.id, checked === true)
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            isDone ? "text-emerald-800 line-through" : "text-slate-900"
                          )}
                        >
                          {step.step_order}. {step.title}
                        </span>
                        {step.status === "in_progress" ? (
                          <StatusBadge status="in_progress" />
                        ) : null}
                      </div>
                      {step.completed_at ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          Completed {formatRelativeTime(step.completed_at)} ago
                        </p>
                      ) : null}
                    </div>
                  </label>
                );
              })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
