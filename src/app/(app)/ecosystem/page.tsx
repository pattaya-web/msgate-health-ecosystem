"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CreditCard,
  Landmark,
  Network,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { mockProvider } from "@/lib/providers/mock-provider";
import { syncAirtableToStore } from "@/lib/sync/client-sync";
import { useAuth } from "@/lib/auth/auth-context";
import { applyRowOrder, DEFAULT_TABLE_COLUMNS } from "@/lib/ecosystem/columns";
import { computeBankActions } from "@/lib/ecosystem/bank-actions";
import { computeAllGoals } from "@/lib/goals";
import { cn, formatRelativeTime } from "@/lib/utils";
import type {
  Bank,
  DashboardData,
  EcosystemColumn,
  EcosystemEntityKind,
  EcosystemGoals,
  EcosystemTableSchema,
  Ibo,
  Llc,
  Mid,
} from "@/types";
import { PilotPanel } from "@/components/ecosystem/pilot-panel";
import { BankActionsPanel } from "@/components/ecosystem/bank-actions-panel";
import { EntitySheet } from "@/components/ecosystem/entity-sheet";
import { PageHeader, LoadingState } from "@/components/shared/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function EcosystemPage() {
  const { canWrite, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [health, setHealth] = useState<DashboardData | null>(null);
  const [llcs, setLlcs] = useState<Llc[]>([]);
  const [ibos, setIbos] = useState<Ibo[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [mids, setMids] = useState<Mid[]>([]);
  const [goals, setGoals] = useState<EcosystemGoals>({
    target_ibos: 5,
    target_llcs: 5,
    target_banks: 10,
    target_mids: 8,
  });
  const [tableColumns, setTableColumns] = useState<EcosystemTableSchema>(DEFAULT_TABLE_COLUMNS);
  const [midRowOrder, setMidRowOrder] = useState<string[] | null>(null);
  const [bankRowOrder, setBankRowOrder] = useState<string[] | null>(null);
  const [syncMeta, setSyncMeta] = useState("");
  const goalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goalProgress = useMemo(
    () => computeAllGoals({ ibos, llcs, banks, mids, goals }),
    [ibos, llcs, banks, mids, goals]
  );

  const midSummaryRows = useMemo(
    () => applyRowOrder(ibos, midRowOrder),
    [ibos, midRowOrder]
  );

  const bankSummaryRows = useMemo(
    () => applyRowOrder(ibos, bankRowOrder),
    [ibos, bankRowOrder]
  );

  const midApprovedTotal = useMemo(
    () => ibos.reduce((s, i) => s + (Number(i.active_mids_count) || 0), 0),
    [ibos]
  );

  const banksTotal = useMemo(
    () => ibos.reduce((s, i) => s + (Number(i.active_banks_count) || 0), 0),
    [ibos]
  );

  const bankActions = useMemo(() => computeBankActions(ibos), [ibos]);

  const reload = useCallback(async () => {
    const [llcRows, iboRows, bankRows, midRows, dash, settings] = await Promise.all([
      mockProvider.getLlcs(),
      mockProvider.getIbos(),
      mockProvider.getBanks(),
      mockProvider.getMids(),
      mockProvider.getDashboard(),
      mockProvider.getSettings(),
    ]);
    const order = settings.row_order || {};
    setLlcs(applyRowOrder(llcRows, order.llcs));
    setIbos(applyRowOrder(iboRows, order.ibos));
    setBanks(applyRowOrder(bankRows, order.banks));
    setMids(applyRowOrder(midRows, order.mids));
    setMidRowOrder(order.mids || null);
    setBankRowOrder(order.banks || null);
    setHealth(dash);
    if (settings.goals) setGoals(settings.goals);
    if (settings.table_columns) setTableColumns(settings.table_columns);
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const payload = await syncAirtableToStore();
      setSyncMeta(
        `${payload.source === "airtable" ? "Airtable" : "Local seed"} · ${formatRelativeTime(payload.log.created_at)} ago`
      );
      await reload();
      toast.success(
        payload.source === "airtable" ? "Synced from Airtable" : "Loaded local seed"
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, [reload]);

  useEffect(() => {
    handleSync();
  }, [handleSync]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const settings = await mockProvider.getSettings();
      const ms = Math.max(1, settings.sync_frequency_minutes || 30) * 60 * 1000;
      timer = setInterval(() => {
        if (!cancelled) handleSync();
      }, ms);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [handleSync]);

  function handleGoalTarget(key: keyof EcosystemGoals, value: number) {
    if (!canWrite) return;
    setGoals((g) => {
      const next = { ...g, [key]: value };
      if (goalTimer.current) clearTimeout(goalTimer.current);
      goalTimer.current = setTimeout(async () => {
        try {
          await mockProvider.updateSettings({ goals: next });
          await reload();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Save failed");
        }
      }, 450);
      return next;
    });
  }

  async function changeCell(
    kind: EcosystemEntityKind,
    id: string,
    field: string,
    value: string | number | boolean | null
  ) {
    await mockProvider.setEcosystemCell(kind, id, field, value);

    // Write-back Airtable for synced records (rec…)
    if (id.startsWith("rec") && !field.startsWith("extra.") && (kind === "llcs" || kind === "ibos")) {
      try {
        let body: Record<string, unknown> = { [field]: value };
        if (kind === "ibos" && field === "linked_llcs_label") {
          const ibo = (await mockProvider.getIbos()).find((i) => i.id === id);
          body = { linked_llc_ids: ibo?.linked_llc_ids || [], display_name: ibo?.display_name };
        } else if (field === "status" || field === "bank_status") {
          body = { status: value, bank_status: value };
        } else if (field === "display_name") {
          body = { display_name: value };
        } else if (field === "phone_ibo") {
          body = { phone_ibo: value };
        }
        await fetch(`/api/airtable/${kind}/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        /* local already saved */
      }
    }

    // banks status → also patch parent LLC on Airtable when possible
    if (kind === "banks" && field === "status") {
      const bank = (await mockProvider.getBanks()).find((b) => b.id === id);
      const llc = (await mockProvider.getLlcs()).find(
        (l) =>
          bank &&
          (bank.id.startsWith(`${l.id}-bank-`) ||
            (l.ibo_id === bank.ibo_id &&
              (l.banks_label || "")
                .split(",")
                .map((s) => s.trim())
                .includes(bank.name)))
      );
      if (llc?.id.startsWith("rec")) {
        try {
          await fetch(`/api/airtable/llcs/${encodeURIComponent(llc.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: value, bank_status: value }),
          });
        } catch {
          /* ignore */
        }
      }
    }

    await reload();
    const dash = await mockProvider.getDashboard();
    const settings = await mockProvider.getSettings();
    const progress = computeAllGoals({
      ibos: await mockProvider.getIbos(),
      llcs: await mockProvider.getLlcs(),
      banks: await mockProvider.getBanks(),
      mids: await mockProvider.getMids(),
      goals: settings.goals,
    });
    const iboGoal = progress.find((p) => p.kind === "ibos");
    toast.success(`Santé ${dash.health.score}/100 · ${dash.health.status}`, {
      description: iboGoal
        ? `Objectifs IBO ${iboGoal.current}/${iboGoal.target} actifs · +${iboGoal.potential} potentiel`
        : "Objectifs synchronisés",
    });
  }

  async function addRow(kind: EcosystemEntityKind) {
    if (kind === "ibos") await mockProvider.createIbo({ status: "opening" });
    else if (kind === "llcs") {
      const ibo_id = ibos[0]?.id;
      if (!ibo_id) throw new Error("Crée d’abord un IBO");
      await mockProvider.createLlc({
        name: `New LLC ${llcs.length + 1}`,
        ibo_id,
        status: "opening",
      });
    } else if (kind === "banks") {
      const ibo_id = ibos[0]?.id;
      if (!ibo_id) throw new Error("Crée d’abord un IBO");
      await mockProvider.createBank({
        name: `Bank ${banks.length + 1}`,
        ibo_id,
        status: "opening",
      });
    } else {
      const ibo_id = ibos[0]?.id;
      if (!ibo_id) throw new Error("Crée d’abord un IBO");
      await mockProvider.createMid({ ibo_id, status: "underwriting" });
    }
    await reload();
    const dash = await mockProvider.getDashboard();
    toast.success(`Ligne ajoutée · Santé ${dash.health.score}/100`);
  }

  async function deleteRow(kind: EcosystemEntityKind, id: string) {
    await mockProvider.deleteEcosystemRow(kind, id);
    await reload();
    const dash = await mockProvider.getDashboard();
    toast.success(`Ligne supprimée · Santé ${dash.health.score}/100`);
  }

  async function reorderRows(kind: EcosystemEntityKind, orderedIds: string[]) {
    await mockProvider.reorderEcosystemRows(kind, orderedIds);
    const apply = <T extends { id: string }>(rows: T[]) => applyRowOrder(rows, orderedIds);
    if (kind === "llcs") setLlcs((r) => apply(r));
    else if (kind === "ibos") setIbos((r) => apply(r));
    else if (kind === "banks") setBankRowOrder(orderedIds);
    else setMidRowOrder(orderedIds);
  }

  async function columnsChange(kind: EcosystemEntityKind, columns: EcosystemColumn[]) {
    await mockProvider.updateTableColumns(kind, columns);
    setTableColumns((prev) => ({ ...prev, [kind]: columns }));
  }

  if (loading) return <LoadingState className="min-h-[420px]" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ecosystem"
        description="Pilotage en un clin d’œil : actifs, objectifs, santé. Éditions auto-sauvegardées."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {syncMeta ? (
              <Badge variant="outline" className="font-normal text-[11px]">
                {syncMeta}
              </Badge>
            ) : null}
            <Badge variant={canWrite ? "default" : "secondary"}>
              {canWrite ? (isAdmin ? "Admin edit" : "Operator edit") : "Viewer read-only"}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              Sync
            </Button>
          </div>
        }
      />

      {health ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <PilotPanel
            health={health.health}
            actives={{
              ibos: ibos.filter((i) => i.status === "active").length,
              banks: ibos.reduce((s, i) => s + (Number(i.active_banks_count) || 0), 0),
              mids: midApprovedTotal,
              llcs: llcs.filter((l) => l.status === "active").length || llcs.length,
            }}
            progress={goalProgress}
            goals={goals}
            canWrite={canWrite}
            onTargetChange={handleGoalTarget}
          />
          <BankActionsPanel actions={bankActions} />
        </div>
      ) : null}

      <Tabs defaultValue="ibos" className="space-y-3">
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value="llcs" className="gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
            LLC ({llcs.length})
          </TabsTrigger>
          <TabsTrigger value="ibos" className="gap-1.5 text-xs">
            <Network className="h-3.5 w-3.5 text-emerald-600" />
            IBO ({ibos.length})
          </TabsTrigger>
          <TabsTrigger value="banks" className="gap-1.5 text-xs">
            <Landmark className="h-3.5 w-3.5 text-emerald-600" />
            Bank ({banksTotal})
          </TabsTrigger>
          <TabsTrigger value="mids" className="gap-1.5 text-xs">
            <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
            MID ({midApprovedTotal})
          </TabsTrigger>
        </TabsList>

        {(
          [
            ["llcs", "LLCs", llcs, "llcs"] as const,
            ["ibos", "IBOs", ibos, "ibos"] as const,
            ["banks", "Banks", bankSummaryRows, "ibos"] as const,
            ["mids", "MIDs", midSummaryRows, "ibos"] as const,
          ] as const
        ).map(([kind, label, rows, editKind]) => (
          <TabsContent key={kind} value={kind}>
            <Card>
              <CardContent className="pt-4">
                <EntitySheet
                  kind={kind}
                  title={label}
                  description={
                    kind === "mids"
                      ? "ID IBO · LLC · nombre de MID approuvés. Sauvegarde auto."
                      : kind === "banks"
                        ? "LLC · IBO · Banks (chiffre). Sauvegarde auto à chaque edit."
                        : "Clique Plein écran pour le tableau entier. Sauvegarde auto."
                  }
                  rows={rows}
                  ibos={ibos}
                  banks={banks}
                  columnsSchema={tableColumns}
                  canWrite={canWrite}
                  onChangeCell={(id, field, value) => changeCell(editKind, id, field, value)}
                  onAddRow={() => addRow(editKind)}
                  onDeleteRow={(id) => deleteRow(editKind, id)}
                  onColumnsChange={(cols) => columnsChange(kind, cols)}
                  onReorderRows={(ids) => reorderRows(kind, ids)}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
