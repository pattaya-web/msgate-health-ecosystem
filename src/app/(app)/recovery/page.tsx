"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, CreditCard, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/auth-context";
import { mockProvider } from "@/lib/providers/mock-provider";
import { formatCurrency } from "@/lib/utils";
import type { Bank, Ibo, Mid, RecoveryCase, RecoveryPriority, RecoveryStatus } from "@/types";

const ALL = "all";

function stepProgress(recoveryCase: RecoveryCase) {
  const total = recoveryCase.steps.length;
  const done = recoveryCase.steps.filter((s) => s.status === "done").length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export default function RecoveryPage() {
  const router = useRouter();
  const { canWrite } = useAuth();
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [ibos, setIbos] = useState<Ibo[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [mids, setMids] = useState<Mid[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [midDialogOpen, setMidDialogOpen] = useState(false);

  const [bankForm, setBankForm] = useState({
    ibo_id: "",
    bank_id: "",
    funds_at_risk: "",
    closed_at: new Date().toISOString().slice(0, 10),
    reason: "",
    backup_bank_id: "",
    comments: "",
    priority: "critical" as RecoveryPriority,
  });

  const [midForm, setMidForm] = useState({
    mid_id: "",
    reason: "",
    priority: "high" as RecoveryPriority,
    comments: "",
  });

  const loadData = useCallback(async () => {
    try {
      const [recoveryCases, iboList, bankList, midList] = await Promise.all([
        mockProvider.getRecoveryCases(),
        mockProvider.getIbos(),
        mockProvider.getBanks(),
        mockProvider.getMids(),
      ]);
      setCases(recoveryCases);
      setIbos(iboList);
      setBanks(bankList);
      setMids(midList);
    } catch {
      toast.error("Failed to load recovery cases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter((c) => {
      if (statusFilter !== ALL && c.status !== statusFilter) return false;
      if (typeFilter !== ALL && c.type !== typeFilter) return false;
      if (priorityFilter !== ALL && c.priority !== priorityFilter) return false;
      if (q && !c.title.toLowerCase().includes(q) && !(c.reason ?? "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [cases, statusFilter, typeFilter, priorityFilter, search]);

  const banksForIbo = useMemo(
    () => banks.filter((b) => b.ibo_id === bankForm.ibo_id && b.status !== "closed"),
    [banks, bankForm.ibo_id]
  );

  const backupBanksForIbo = useMemo(
    () =>
      banks.filter(
        (b) =>
          b.ibo_id === bankForm.ibo_id &&
          b.id !== bankForm.bank_id &&
          (b.is_backup || b.status === "backup" || b.status === "active")
      ),
    [banks, bankForm.ibo_id, bankForm.bank_id]
  );

  const activeMids = useMemo(
    () => mids.filter((m) => m.status !== "closed"),
    [mids]
  );

  const selectedMid = useMemo(
    () => mids.find((m) => m.id === midForm.mid_id) ?? null,
    [mids, midForm.mid_id]
  );

  const selectedBank = useMemo(
    () => banks.find((b) => b.id === bankForm.bank_id) ?? null,
    [banks, bankForm.bank_id]
  );

  function resetBankForm() {
    setBankForm({
      ibo_id: "",
      bank_id: "",
      funds_at_risk: "",
      closed_at: new Date().toISOString().slice(0, 10),
      reason: "",
      backup_bank_id: "",
      comments: "",
      priority: "critical",
    });
  }

  function resetMidForm() {
    setMidForm({
      mid_id: "",
      reason: "",
      priority: "high",
      comments: "",
    });
  }

  async function handleBankSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) {
      toast.error("You do not have permission to create recovery cases");
      return;
    }
    if (!bankForm.ibo_id || !bankForm.bank_id) {
      toast.error("Please select an IBO and bank");
      return;
    }

    setSubmitting(true);
    try {
      const created = await mockProvider.createBankClosure({
        ibo_id: bankForm.ibo_id,
        bank_id: bankForm.bank_id,
        funds_at_risk: bankForm.funds_at_risk
          ? Number(bankForm.funds_at_risk)
          : selectedBank?.funds_at_risk ?? undefined,
        closed_at: bankForm.closed_at
          ? new Date(bankForm.closed_at).toISOString()
          : undefined,
        reason: bankForm.reason,
        backup_bank_id: bankForm.backup_bank_id || undefined,
        comments: bankForm.comments,
        priority: bankForm.priority,
      });
      toast.success("Bank closure case created");
      setBankDialogOpen(false);
      resetBankForm();
      await loadData();
      router.push(`/recovery/${created.id}`);
    } catch {
      toast.error("Failed to create bank closure case");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMidSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) {
      toast.error("You do not have permission to create recovery cases");
      return;
    }
    if (!midForm.mid_id) {
      toast.error("Please select a MID");
      return;
    }

    setSubmitting(true);
    try {
      const created = await mockProvider.createMidClosure({
        mid_id: midForm.mid_id,
        ibo_id: selectedMid?.ibo_id,
        bank_id: selectedMid?.bank_id ?? undefined,
        processor_id: selectedMid?.processor_id ?? undefined,
        iso_id: selectedMid?.iso_id ?? undefined,
        shop_id: selectedMid?.shop_id ?? undefined,
        crm_id: selectedMid?.crm_id ?? undefined,
        average_volume: selectedMid?.average_volume ?? undefined,
        reason: midForm.reason,
        priority: midForm.priority,
        comments: midForm.comments,
      });
      toast.success("MID closure case created");
      setMidDialogOpen(false);
      resetMidForm();
      await loadData();
      router.push(`/recovery/${created.id}`);
    } catch {
      toast.error("Failed to create MID closure case");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingState className="min-h-[480px]" />;
  }

  return (
    <div>
      <PageHeader
        title="Recovery"
        description="Track bank and MID closure cases with step-by-step recovery checklists."
        actions={
          <>
            <Button
              variant="outline"
              disabled={!canWrite}
              onClick={() => setBankDialogOpen(true)}
            >
              <Building2 className="h-4 w-4" />
              New Bank Closure
            </Button>
            <Button disabled={!canWrite} onClick={() => setMidDialogOpen(true)}>
              <CreditCard className="h-4 w-4" />
              New MID Closure
            </Button>
          </>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cases..."
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {(
                [
                  "open",
                  "in_progress",
                  "waiting_on_ibo",
                  "waiting_on_bank",
                  "funds_recovered",
                  "resolved",
                  "lost_funds",
                ] as RecoveryStatus[]
              ).map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full lg:w-[160px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              <SelectItem value="bank_closure">Bank closure</SelectItem>
              <SelectItem value="mid_closure">MID closure</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full lg:w-[160px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All priorities</SelectItem>
              {(["low", "medium", "high", "critical"] as RecoveryPriority[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filteredCases.length === 0 ? (
        <EmptyState
          title="No recovery cases found"
          description={
            cases.length === 0
              ? "Create a bank or MID closure case to start recovery tracking."
              : "Try adjusting your filters or search query."
          }
          action={
            canWrite ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => setBankDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New Bank Closure
                </Button>
                <Button onClick={() => setMidDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New MID Closure
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-6 py-3 font-medium">Case</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Priority</th>
                    <th className="px-4 py-3 font-medium">Progress</th>
                    <th className="px-4 py-3 font-medium">Funds / Volume</th>
                    <th className="px-6 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.map((recoveryCase) => {
                    const { done, total, percent } = stepProgress(recoveryCase);
                    return (
                      <tr
                        key={recoveryCase.id}
                        className="border-b border-slate-50 hover:bg-slate-50/60"
                      >
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-900">{recoveryCase.title}</div>
                          <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                            {recoveryCase.reason || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-4 capitalize text-slate-600">
                          {recoveryCase.type === "bank_closure" ? "Bank" : "MID"}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={recoveryCase.status} />
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={recoveryCase.priority} />
                        </td>
                        <td className="px-4 py-4">
                          <div className="min-w-[140px] space-y-1.5">
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>
                                {done}/{total} steps
                              </span>
                              <span>{percent}%</span>
                            </div>
                            <Progress value={percent} className="h-1.5" />
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-600">
                          {recoveryCase.type === "bank_closure"
                            ? formatCurrency(recoveryCase.funds_at_risk ?? 0)
                            : formatCurrency(recoveryCase.average_volume ?? 0)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/recovery/${recoveryCase.id}`}>
                              Open
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Bank Closure</DialogTitle>
            <DialogDescription>
              Open a recovery case when a bank account is closed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBankSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ibo">IBO</Label>
              <Select
                value={bankForm.ibo_id}
                onValueChange={(v) =>
                  setBankForm((f) => ({ ...f, ibo_id: v, bank_id: "", backup_bank_id: "" }))
                }
              >
                <SelectTrigger id="ibo">
                  <SelectValue placeholder="Select IBO" />
                </SelectTrigger>
                <SelectContent>
                  {ibos.map((ibo) => (
                    <SelectItem key={ibo.id} value={ibo.id}>
                      {ibo.display_name?.trim() || ibo.reference_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bank">Bank</Label>
              <Select
                value={bankForm.bank_id}
                onValueChange={(v) => {
                  const bank = banks.find((b) => b.id === v);
                  setBankForm((f) => ({
                    ...f,
                    bank_id: v,
                    funds_at_risk: bank?.funds_at_risk ? String(bank.funds_at_risk) : f.funds_at_risk,
                  }));
                }}
                disabled={!bankForm.ibo_id}
              >
                <SelectTrigger id="bank">
                  <SelectValue placeholder="Select bank" />
                </SelectTrigger>
                <SelectContent>
                  {banksForIbo.map((bank) => (
                    <SelectItem key={bank.id} value={bank.id}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="funds">Funds at risk</Label>
                <Input
                  id="funds"
                  type="number"
                  min={0}
                  value={bankForm.funds_at_risk}
                  onChange={(e) => setBankForm((f) => ({ ...f, funds_at_risk: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="closed_at">Closure date</Label>
                <Input
                  id="closed_at"
                  type="date"
                  value={bankForm.closed_at}
                  onChange={(e) => setBankForm((f) => ({ ...f, closed_at: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={bankForm.reason}
                onChange={(e) => setBankForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Bank initiated account closure"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="backup">Backup bank</Label>
              <Select
                value={bankForm.backup_bank_id || "none"}
                onValueChange={(v) =>
                  setBankForm((f) => ({ ...f, backup_bank_id: v === "none" ? "" : v }))
                }
                disabled={!bankForm.ibo_id}
              >
                <SelectTrigger id="backup">
                  <SelectValue placeholder="Optional backup bank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {backupBanksForIbo.map((bank) => (
                    <SelectItem key={bank.id} value={bank.id}>
                      {bank.name}
                      {bank.is_backup ? " (backup)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={bankForm.priority}
                onValueChange={(v) =>
                  setBankForm((f) => ({ ...f, priority: v as RecoveryPriority }))
                }
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high", "critical"] as RecoveryPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="comments">Comments</Label>
              <Textarea
                id="comments"
                value={bankForm.comments}
                onChange={(e) => setBankForm((f) => ({ ...f, comments: e.target.value }))}
                placeholder="Additional context for the recovery team..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBankDialogOpen(false);
                  resetBankForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !canWrite}>
                Create case
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={midDialogOpen} onOpenChange={setMidDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New MID Closure</DialogTitle>
            <DialogDescription>
              Open a recovery case when a MID is closed or suspended.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleMidSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mid">MID</Label>
              <Select
                value={midForm.mid_id}
                onValueChange={(v) => setMidForm((f) => ({ ...f, mid_id: v }))}
              >
                <SelectTrigger id="mid">
                  <SelectValue placeholder="Select MID" />
                </SelectTrigger>
                <SelectContent>
                  {activeMids.map((mid) => (
                    <SelectItem key={mid.id} value={mid.id}>
                      {mid.reference_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedMid ? (
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Related entities
                </p>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">IBO</dt>
                    <dd className="font-medium text-slate-800">
                      {ibos.find((i) => i.id === selectedMid.ibo_id)?.display_name?.trim() ||
                        ibos.find((i) => i.id === selectedMid.ibo_id)?.reference_code ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Bank</dt>
                    <dd className="font-medium text-slate-800">
                      {banks.find((b) => b.id === selectedMid.bank_id)?.name ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Avg. volume</dt>
                    <dd className="font-medium text-slate-800">
                      {formatCurrency(selectedMid.average_volume ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Status</dt>
                    <dd>
                      <StatusBadge status={selectedMid.status} />
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="mid-reason">Reason</Label>
              <Input
                id="mid-reason"
                value={midForm.reason}
                onChange={(e) => setMidForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Processor risk review"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mid-priority">Priority</Label>
              <Select
                value={midForm.priority}
                onValueChange={(v) =>
                  setMidForm((f) => ({ ...f, priority: v as RecoveryPriority }))
                }
              >
                <SelectTrigger id="mid-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high", "critical"] as RecoveryPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mid-comments">Comments</Label>
              <Textarea
                id="mid-comments"
                value={midForm.comments}
                onChange={(e) => setMidForm((f) => ({ ...f, comments: e.target.value }))}
                placeholder="Volume paused. Identifying replacement MID..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMidDialogOpen(false);
                  resetMidForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !canWrite}>
                Create case
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
