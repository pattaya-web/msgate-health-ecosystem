"use client";

import {
  BANK_CLOSURE_STEPS,
  MID_CLOSURE_STEPS,
  mockAlerts,
  mockBankPages,
  mockBusinessMetrics,
  mockBusinessDailyMetrics,
  mockCrms,
  mockHealthRules,
  mockIsos,
  mockProcessors,
  mockRecoveryCases,
  mockSettings,
  mockShops,
  mockSops,
  mockSyncLogs,
  DEMO_USER,
} from "@/lib/mock/data";
import {
  recomputeIboBankCounts,
  recomputeIboMidCounts,
  seededBanksFromLlc,
  seededIbos,
  seededLlcs,
  seededMids,
} from "@/lib/mock/airtable-seed";
import { calculateSystemHealth } from "@/lib/health-score";
import { attachLinkedLlcsToIbos, banksFromLlc } from "@/lib/airtable/mappers";
import { computeCombinedRoas } from "@/lib/business/roas";
import type {
  Alert,
  AppSettings,
  AppUser,
  Bank,
  BankPage,
  BusinessWeeklyMetric,
  Crm,
  DashboardData,
  Ibo,
  Iso,
  Llc,
  Mid,
  Processor,
  RecoveryCase,
  RecoveryStep,
  Shop,
  Sop,
  SyncLog,
  SystemHealthRule,
} from "@/types";
import type {
  CreateBankClosureInput,
  CreateMidClosureInput,
  CreateSopInput,
  IDataProvider,
} from "@/lib/providers/types";
import type { EcosystemSyncPayload } from "@/lib/airtable/sync";
import {
  loadPersistedEcosystem,
  savePersistedEcosystem,
} from "@/lib/providers/persist";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

type DeletedIds = {
  ibos: string[];
  llcs: string[];
  banks: string[];
  mids: string[];
};

class MockStore {
  user: AppUser = clone(DEMO_USER);
  // Prefer real Airtable-derived seed for IBO / LLC / banks
  ibos = clone(
    recomputeIboMidCounts(
      recomputeIboBankCounts(seededIbos, seededBanksFromLlc),
      seededMids
    )
  );
  llcs = clone(seededLlcs);
  banks = clone(seededBanksFromLlc);
  mids = clone(seededMids);
  isos = clone(mockIsos);
  processors = clone(mockProcessors);
  crms = clone(mockCrms);
  bankPages = clone(mockBankPages);
  shops = clone(mockShops);
  alerts = clone(mockAlerts);
  recoveryCases = clone(mockRecoveryCases);
  sops = clone(mockSops);
  business = clone(mockBusinessMetrics);
  businessDaily = clone(mockBusinessDailyMetrics);
  settings = clone(mockSettings);
  healthRules = clone(mockHealthRules);
  syncLogs = clone(mockSyncLogs);
  lastSyncAt = new Date().toISOString();
  lastSyncSource: "airtable" | "seed" | "mock" = "seed";
  deletedIds: DeletedIds = { ibos: [], llcs: [], banks: [], mids: [] };
  private _hydratedFromDisk = false;

  /** Restore last session from localStorage (client only) */
  hydrateFromDisk() {
    if (this._hydratedFromDisk) return;
    this._hydratedFromDisk = true;
    const snap = loadPersistedEcosystem();
    if (!snap) {
      this.healthRules = clone(mockHealthRules);
      return;
    }
    try {
      if (Array.isArray(snap.ibos) && snap.ibos.length) this.ibos = clone(snap.ibos as Ibo[]);
      if (Array.isArray(snap.llcs)) this.llcs = clone(snap.llcs as Llc[]);
      if (Array.isArray(snap.banks)) this.banks = clone(snap.banks as Bank[]);
      if (Array.isArray(snap.mids)) this.mids = clone(snap.mids as Mid[]);
      if (snap.settings) this.settings = { ...this.settings, ...(snap.settings as AppSettings) };
      if (snap.deletedIds) {
        this.deletedIds = {
          ibos: [...(snap.deletedIds.ibos || [])],
          llcs: [...(snap.deletedIds.llcs || [])],
          banks: [...(snap.deletedIds.banks || [])],
          mids: [...(snap.deletedIds.mids || [])],
        };
      }
      // Always refresh pilot health rules (soft goals no longer hurt score)
      this.healthRules = clone(mockHealthRules);
      this.lastSyncSource = "mock";
    } catch {
      /* ignore corrupt snapshot */
    }
  }
}

const globalStore = globalThis as typeof globalThis & { __msgateStoreV2?: MockStore };

function getStore() {
  const existing = globalStore.__msgateStoreV2;
  // HMR can leave a stale store without new methods — recreate if needed
  if (!existing || typeof existing.hydrateFromDisk !== "function") {
    globalStore.__msgateStoreV2 = new MockStore();
  }
  globalStore.__msgateStoreV2!.hydrateFromDisk();
  return globalStore.__msgateStoreV2!;
}

export class MockDataProvider implements IDataProvider {
  /** Always resolve live store (survives HMR / stale global instances) */
  private get store() {
    return getStore();
  }

  private persistSnapshot() {
    savePersistedEcosystem({
      ibos: this.store.ibos,
      llcs: this.store.llcs,
      banks: this.store.banks,
      mids: this.store.mids,
      settings: this.store.settings,
      deletedIds: this.store.deletedIds,
    });
  }

  private markDeleted(kind: keyof DeletedIds, id: string) {
    const list = this.store.deletedIds[kind];
    if (!list.includes(id)) list.push(id);
  }

  async getCurrentUser() {
    return delay(clone(this.store.user));
  }

  async getDashboard(): Promise<DashboardData> {
    // IBO table Banks / MID actifs = source of truth for System Health cards
    const banksFromIbos = this.store.ibos.reduce(
      (sum, i) => sum + (Number(i.active_banks_count) || 0),
      0
    );
    const midsFromIbos = this.store.ibos.reduce(
      (sum, i) => sum + (Number(i.active_mids_count) || 0),
      0
    );

    const health = calculateSystemHealth({
      ibos: this.store.ibos,
      banks: this.store.banks,
      mids: this.store.mids,
      alerts: this.store.alerts,
      recoveryCases: this.store.recoveryCases,
      rules: this.store.healthRules,
      settings: this.store.settings,
    });

    const infrastructure = {
      active_ibos: this.store.ibos.filter((i) => i.status === "active").length,
      banks: banksFromIbos,
      mids: midsFromIbos,
      mids_underwriting: this.store.mids.filter((m) => m.status === "underwriting").length,
      banks_opening: this.store.banks.filter((b) => b.status === "opening").length,
      active_banks: banksFromIbos,
      backup_banks: this.store.banks.filter((b) => b.is_backup || b.status === "backup").length,
    };

    return delay({
      health,
      infrastructure,
      alerts: clone(this.store.alerts.filter((a) => a.status === "active")),
      recoveryCases: clone(
        this.store.recoveryCases.filter((c) => !["resolved", "lost_funds"].includes(c.status))
      ),
      business: clone(this.store.business[0]),
      businessTrend: clone(this.store.business.slice(0, 8).reverse()),
      lastSyncAt: this.store.lastSyncAt,
      syncStatus: "synced",
    });
  }

  async getIbos() {
    return delay(clone(attachLinkedLlcsToIbos(this.store.ibos, this.store.llcs, this.store.banks)));
  }

  async getLlcs() {
    return delay(clone(this.store.llcs ?? []));
  }

  async updateLlc(
    id: string,
    patch: Partial<
      Pick<
        Llc,
        | "name"
        | "ibo_id"
        | "ein"
        | "state"
        | "address"
        | "formation_date"
        | "phone"
        | "domain"
        | "banks_label"
        | "status"
        | "bank_status"
      >
    >
  ) {
    const llc = this.store.llcs.find((l) => l.id === id);
    if (!llc) throw new Error("LLC not found");
    Object.assign(llc, patch, { updated_at: new Date().toISOString() });
    if (patch.status && !patch.bank_status) llc.bank_status = patch.status;
    if (patch.bank_status && !patch.status) llc.status = patch.bank_status;

    // Rebuild / sync derived banks when label or status changes
    if (patch.banks_label !== undefined) {
      this.store.banks = [
        ...this.store.banks.filter((b) => !b.id.startsWith(`${llc.id}-bank-`)),
        ...banksFromLlc(llc),
      ];
    } else if (patch.status || patch.bank_status || patch.ibo_id) {
      const next = (patch.bank_status || patch.status || llc.status) as Bank["status"];
      for (const bank of this.store.banks) {
        const linked =
          bank.id.startsWith(`${llc.id}-bank-`) ||
          (bank.ibo_id === llc.ibo_id &&
            (llc.banks_label || "")
              .split(",")
              .map((s) => s.trim())
              .includes(bank.name));
        if (linked) {
          if (patch.status || patch.bank_status) bank.status = next;
          if (patch.ibo_id) bank.ibo_id = patch.ibo_id;
          bank.updated_at = new Date().toISOString();
        }
      }
    }

    this.store.ibos = recomputeIboMidCounts(
      recomputeIboBankCounts(this.store.ibos, this.store.banks),
      this.store.mids
    );
    return delay(clone(llc));
  }

  async updateIbo(id: string, patch: Partial<Pick<Ibo, "display_name" | "status" | "reference_code">>) {
    const ibo = this.store.ibos.find((i) => i.id === id);
    if (!ibo) throw new Error("IBO not found");
    Object.assign(ibo, patch, { updated_at: new Date().toISOString() });
    return delay(clone(ibo));
  }

  async updateBank(
    id: string,
    patch: Partial<
      Pick<Bank, "name" | "status" | "is_backup" | "funds_at_risk" | "notes" | "opened_at" | "closed_at">
    >
  ) {
    const bank = this.store.banks.find((b) => b.id === id);
    if (!bank) throw new Error("Bank not found");
    const prevName = bank.name;
    Object.assign(bank, patch, { updated_at: new Date().toISOString() });
    if (patch.is_backup === true && !patch.status) bank.status = "backup";

    const llc =
      this.store.llcs.find((l) => bank.id.startsWith(`${l.id}-bank-`)) ||
      this.store.llcs.find(
        (l) =>
          l.ibo_id === bank.ibo_id &&
          (l.banks_label || "")
            .split(",")
            .map((s) => s.trim())
            .includes(prevName)
      );

    if (llc) {
      if (patch.name && patch.name !== prevName && llc.banks_label) {
        llc.banks_label = llc.banks_label
          .split(",")
          .map((s) => s.trim())
          .map((n) => (n === prevName ? patch.name! : n))
          .join(", ");
        llc.updated_at = new Date().toISOString();
      }
      if (patch.status) {
        llc.bank_status = patch.status;
        llc.status = patch.status;
        llc.updated_at = new Date().toISOString();
      }
    }

    this.store.ibos = recomputeIboMidCounts(
      recomputeIboBankCounts(this.store.ibos, this.store.banks),
      this.store.mids
    );
    return delay(clone({ bank, llc_id: llc?.id ?? null, banks_label: llc?.banks_label ?? null }));
  }

  async updateMid(
    id: string,
    patch: Partial<
      Pick<Mid, "reference_code" | "status" | "average_volume" | "notes" | "ibo_id" | "bank_id">
    >
  ) {
    const mid = this.store.mids.find((m) => m.id === id);
    if (!mid) throw new Error("MID not found");
    Object.assign(mid, patch, { updated_at: new Date().toISOString() });
    this.store.ibos = recomputeIboMidCounts(this.store.ibos, this.store.mids);
    return delay(clone(mid));
  }

  async hydrateEcosystem(payload: EcosystemSyncPayload) {
    const deleted = this.store.deletedIds;
    const notDeleted =
      (kind: keyof DeletedIds) =>
      <T extends { id: string }>(row: T) =>
        !deleted[kind].includes(row.id);

    const mergeById = <T extends { id: string; updated_at?: string }>(
      kind: keyof DeletedIds,
      existing: T[],
      incoming: T[],
      preferLocal: (local: T, remote: T) => T
    ): T[] => {
      const localsOnly = existing.filter(
        (e) => e.id.startsWith("local-") && notDeleted(kind)(e)
      );
      const existingMap = new Map(existing.filter(notDeleted(kind)).map((e) => [e.id, e]));
      const merged = incoming.filter(notDeleted(kind)).map((remote) => {
        const local = existingMap.get(remote.id);
        if (!local) return remote;
        return preferLocal(local, remote);
      });
      const incomingIds = new Set(merged.map((m) => m.id));
      return [...merged, ...localsOnly.filter((l) => !incomingIds.has(l.id))];
    };

    const ibos = mergeById("ibos", this.store.ibos, payload.ibos, (local, remote) => ({
      ...remote,
      display_name: local.display_name ?? remote.display_name,
      status: local.status || remote.status,
      phone_ibo: local.phone_ibo ?? remote.phone_ibo,
      linked_llc_ids: local.linked_llc_ids?.length ? local.linked_llc_ids : remote.linked_llc_ids,
      linked_llcs_label: local.linked_llcs_label ?? remote.linked_llcs_label,
      // Pilotage counts edited in-app are source of truth
      active_banks_count: local.active_banks_count ?? remote.active_banks_count,
      active_mids_count: local.active_mids_count ?? remote.active_mids_count,
      backup_banks_count: local.backup_banks_count ?? remote.backup_banks_count,
      banks_label: local.banks_label ?? remote.banks_label,
      extra: { ...(remote.extra || {}), ...(local.extra || {}) },
      updated_at: local.updated_at || remote.updated_at,
    }));

    const llcs = mergeById("llcs", this.store.llcs, payload.llcs, (local, remote) => ({
      ...remote,
      name: local.name || remote.name,
      status: local.status || remote.status,
      bank_status: local.bank_status || remote.bank_status,
      banks_label: local.banks_label ?? remote.banks_label,
      ein: local.ein ?? remote.ein,
      state: local.state ?? remote.state,
      address: local.address ?? remote.address,
      phone: local.phone ?? remote.phone,
      domain: local.domain ?? remote.domain,
      ibo_id: local.ibo_id || remote.ibo_id,
      extra: { ...(remote.extra || {}), ...(local.extra || {}) },
      updated_at: local.updated_at || remote.updated_at,
    }));

    const banks = mergeById("banks", this.store.banks, payload.banks, (local, remote) => ({
      ...remote,
      name: local.name || remote.name,
      status: local.status || remote.status,
      is_backup: local.is_backup ?? remote.is_backup,
      notes: local.notes ?? remote.notes,
      funds_at_risk: local.funds_at_risk ?? remote.funds_at_risk,
      extra: { ...(remote.extra || {}), ...(local.extra || {}) },
      updated_at: local.updated_at || remote.updated_at,
    }));

    // MIDs: keep local rows + any existing; Airtable MID table may be empty
    const mids = mergeById(
      "mids",
      this.store.mids.length ? this.store.mids : seededMids,
      [] as Mid[],
      (local) => local
    );

    this.store.mids = clone(mids.length ? mids : seededMids.filter(notDeleted("mids")));
    this.store.llcs = clone(llcs);
    this.store.banks = clone(banks);
    // Do NOT recompute counts from banks/mids — IBO table counts are authoritative
    this.store.ibos = clone(attachLinkedLlcsToIbos(ibos, this.store.llcs, this.store.banks));
    this.store.lastSyncAt = payload.log.created_at;
    this.store.lastSyncSource = payload.source;
    this.store.syncLogs.unshift(clone(payload.log));
    this.persistSnapshot();
    return delay(true, 50);
  }

  async getBanks() {
    return delay(clone(this.store.banks));
  }
  async getMids() {
    return delay(clone(this.store.mids));
  }
  async getIsos() {
    return delay(clone(this.store.isos));
  }
  async getProcessors() {
    return delay(clone(this.store.processors));
  }
  async getCrms() {
    return delay(clone(this.store.crms));
  }
  async getBankPages() {
    return delay(clone(this.store.bankPages));
  }
  async getShops() {
    return delay(clone(this.store.shops));
  }

  async getAlerts() {
    return delay(clone(this.store.alerts));
  }

  async resolveAlert(id: string) {
    const alert = this.store.alerts.find((a) => a.id === id);
    if (!alert) throw new Error("Alert not found");
    alert.status = "resolved";
    alert.resolved_at = new Date().toISOString();
    alert.updated_at = new Date().toISOString();
    return delay(clone(alert));
  }

  async getRecoveryCases() {
    return delay(clone(this.store.recoveryCases));
  }

  async getRecoveryCase(id: string) {
    const item = this.store.recoveryCases.find((c) => c.id === id) ?? null;
    return delay(clone(item));
  }

  async createBankClosure(input: CreateBankClosureInput) {
    const ibo = this.store.ibos.find((i) => i.id === input.ibo_id);
    const bank = this.store.banks.find((b) => b.id === input.bank_id);
    const id = uid("recovery");
    const caseItem: RecoveryCase = {
      id,
      type: "bank_closure",
      title: `Bank closure — ${ibo?.reference_code ?? "IBO"}`,
      status: "open",
      priority: input.priority ?? "critical",
      ibo_id: input.ibo_id,
      bank_id: input.bank_id,
      funds_at_risk: input.funds_at_risk ?? bank?.funds_at_risk ?? 0,
      closed_at: input.closed_at ?? new Date().toISOString(),
      reason: input.reason ?? "",
      backup_bank_id: input.backup_bank_id ?? null,
      comments: input.comments ?? "",
      documents: [],
      estimated_recovery_date: input.estimated_recovery_date ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: BANK_CLOSURE_STEPS.map((title, index) => ({
        id: uid("rs"),
        recovery_case_id: id,
        step_order: index + 1,
        title,
        status: "pending" as const,
      })),
    };
    this.store.recoveryCases.unshift(caseItem);
    if (bank) {
      bank.status = "closed";
      bank.closed_at = caseItem.closed_at;
      bank.funds_at_risk = caseItem.funds_at_risk;
      bank.updated_at = new Date().toISOString();
    }
    return delay(clone(caseItem));
  }

  async createMidClosure(input: CreateMidClosureInput) {
    const mid = this.store.mids.find((m) => m.id === input.mid_id);
    const id = uid("recovery");
    const caseItem: RecoveryCase = {
      id,
      type: "mid_closure",
      title: `MID closure — ${mid?.reference_code ?? "MID"}`,
      status: "open",
      priority: input.priority ?? "high",
      ibo_id: input.ibo_id ?? mid?.ibo_id ?? null,
      mid_id: input.mid_id,
      bank_id: input.bank_id ?? mid?.bank_id ?? null,
      processor_id: input.processor_id ?? mid?.processor_id ?? null,
      iso_id: input.iso_id ?? mid?.iso_id ?? null,
      shop_id: input.shop_id ?? mid?.shop_id ?? null,
      crm_id: input.crm_id ?? mid?.crm_id ?? null,
      closed_at: input.closed_at ?? new Date().toISOString(),
      reason: input.reason ?? "",
      average_volume: input.average_volume ?? mid?.average_volume ?? 0,
      replacement_mid_id: input.replacement_mid_id ?? null,
      comments: input.comments ?? "",
      documents: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: MID_CLOSURE_STEPS.map((title, index) => ({
        id: uid("rs"),
        recovery_case_id: id,
        step_order: index + 1,
        title,
        status: "pending" as const,
      })),
    };
    this.store.recoveryCases.unshift(caseItem);
    if (mid) {
      mid.status = "closed";
      mid.closed_at = caseItem.closed_at;
      mid.updated_at = new Date().toISOString();
    }
    return delay(clone(caseItem));
  }

  async updateRecoveryStep(caseId: string, stepId: string, status: RecoveryStep["status"]) {
    const item = this.store.recoveryCases.find((c) => c.id === caseId);
    if (!item) throw new Error("Recovery case not found");
    const step = item.steps.find((s) => s.id === stepId);
    if (!step) throw new Error("Step not found");
    step.status = status;
    step.completed_at = status === "done" ? new Date().toISOString() : null;
    item.updated_at = new Date().toISOString();
    const done = item.steps.filter((s) => s.status === "done").length;
    if (done > 0 && item.status === "open") item.status = "in_progress";
    if (done === item.steps.length) item.status = "resolved";
    return delay(clone(item));
  }

  async updateRecoveryStatus(caseId: string, status: RecoveryCase["status"]) {
    const item = this.store.recoveryCases.find((c) => c.id === caseId);
    if (!item) throw new Error("Recovery case not found");
    item.status = status;
    item.updated_at = new Date().toISOString();
    return delay(clone(item));
  }

  async getSops() {
    return delay(clone(this.store.sops));
  }

  async getSop(id: string) {
    return delay(clone(this.store.sops.find((s) => s.id === id) ?? null));
  }

  async createSop(input: CreateSopInput) {
    const id = uid("sop");
    const sop: Sop = {
      id,
      title: input.title,
      category: input.category,
      summary: input.summary,
      objective: input.objective,
      prerequisites: input.prerequisites,
      documents_needed: input.documents_needed,
      estimated_time: input.estimated_time,
      difficulty: input.difficulty,
      owner: input.owner,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: input.steps.map((s, index) => ({
        id: uid("ss"),
        sop_id: id,
        step_order: index + 1,
        title: s.title,
        description: s.description ?? null,
        is_checklist_item: true,
      })),
    };
    this.store.sops.unshift(sop);
    return delay(clone(sop));
  }

  async updateSop(id: string, input: Partial<CreateSopInput>) {
    const sop = this.store.sops.find((s) => s.id === id);
    if (!sop) throw new Error("SOP not found");
    Object.assign(sop, {
      ...input,
      updated_at: new Date().toISOString(),
      steps: input.steps
        ? input.steps.map((s, index) => ({
            id: uid("ss"),
            sop_id: id,
            step_order: index + 1,
            title: s.title,
            description: s.description ?? null,
            is_checklist_item: true,
          }))
        : sop.steps,
    });
    return delay(clone(sop));
  }

  async getBusinessMetrics() {
    return delay(clone(this.store.business));
  }

  async getBusinessDailyMetrics() {
    if (!this.store.businessDaily) {
      this.store.businessDaily = clone(mockBusinessDailyMetrics);
    }
    return delay(clone(this.store.businessDaily));
  }

  async upsertBusinessMetric(
    metric: Omit<BusinessWeeklyMetric, "id" | "created_at" | "updated_at"> & { id?: string }
  ) {
    const nowIso = new Date().toISOString();
    const roas_otp_7d = metric.roas_otp_7d ?? 0;
    const roas_rebill_7d = metric.roas_rebill_7d ?? 0;
    const roas_combined_7d = computeCombinedRoas(roas_otp_7d, roas_rebill_7d);
    // Always derive combined from OTP + Rebill — never trust a stored override.
    const normalized = {
      ...metric,
      roas_otp_7d,
      roas_rebill_7d,
      roas_combined_7d,
      roas_7d: roas_combined_7d,
    };
    if (metric.id) {
      const existing = this.store.business.find((b) => b.id === metric.id);
      if (existing) {
        Object.assign(existing, normalized, { updated_at: nowIso });
        return delay(clone(existing));
      }
    }
    const created: BusinessWeeklyMetric = {
      id: uid("biz"),
      week_start: normalized.week_start,
      week_end: normalized.week_end,
      roas_otp_7d,
      roas_rebill_7d,
      roas_combined_7d,
      roas_7d: roas_combined_7d,
      spend: normalized.spend,
      revenue: normalized.revenue,
      active_subscribers: normalized.active_subscribers,
      new_subscribers: normalized.new_subscribers,
      lost_subscribers: normalized.lost_subscribers,
      churn_rate: normalized.churn_rate,
      retention_rate: normalized.retention_rate,
      net_growth: normalized.net_growth,
      created_at: nowIso,
      updated_at: nowIso,
    };
    this.store.business.unshift(created);
    return delay(clone(created));
  }

  async getSettings() {
    if (!this.store.settings.goals) {
      this.store.settings.goals = {
        target_ibos: 5,
        target_llcs: 5,
        target_banks: 10,
        target_mids: 8,
      };
    }
    if (!this.store.settings.table_columns) {
      const { DEFAULT_TABLE_COLUMNS } = await import("@/lib/ecosystem/columns");
      this.store.settings.table_columns = clone(DEFAULT_TABLE_COLUMNS);
    }
    return delay(clone(this.store.settings));
  }

  async updateSettings(settings: Partial<AppSettings>) {
    this.store.settings = {
      ...this.store.settings,
      ...settings,
      goals: {
        ...this.store.settings.goals,
        ...(settings.goals || {}),
      },
      table_columns: settings.table_columns
        ? clone(settings.table_columns)
        : this.store.settings.table_columns,
      row_order: settings.row_order
        ? clone(settings.row_order)
        : this.store.settings.row_order,
    };
    this.persistSnapshot();
    return delay(clone(this.store.settings));
  }

  async updateTableColumns(
    kind: "ibos" | "llcs" | "banks" | "mids",
    columns: import("@/types").EcosystemColumn[]
  ) {
    const { DEFAULT_TABLE_COLUMNS } = await import("@/lib/ecosystem/columns");
    const current = this.store.settings.table_columns || clone(DEFAULT_TABLE_COLUMNS);
    this.store.settings.table_columns = {
      ...current,
      [kind]: clone(columns),
    };
    this.persistSnapshot();
    return delay(clone(this.store.settings.table_columns));
  }

  async reorderEcosystemRows(kind: "ibos" | "llcs" | "banks" | "mids", orderedIds: string[]) {
    const current = this.store.settings.row_order || {};
    this.store.settings.row_order = {
      ...current,
      [kind]: [...orderedIds],
    };
    this.persistSnapshot();
    return delay(clone(this.store.settings.row_order));
  }

  /** Align bank rows for an IBO with the numeric Banks count from the IBO table */
  private syncBanksCountForIbo(iboId: string, desired: number) {
    const now = new Date().toISOString();
    const n = Math.max(0, Math.floor(desired));
    let active = this.store.banks.filter((b) => b.ibo_id === iboId && b.status === "active");

    while (active.length < n) {
      const idx = active.length + 1;
      const bank: Bank = {
        id: `local-bank-${iboId}-${Date.now()}-${idx}`,
        ibo_id: iboId,
        name: `Bank ${idx}`,
        status: "active",
        is_backup: false,
        opened_at: now,
        closed_at: null,
        funds_at_risk: null,
        notes: "Synced from IBO Banks count",
        created_at: now,
        updated_at: now,
      };
      this.store.banks.push(bank);
      active = this.store.banks.filter((b) => b.ibo_id === iboId && b.status === "active");
    }

    if (active.length > n) {
      const toClose = active.slice(n);
      for (const bank of toClose) {
        bank.status = "closed";
        bank.closed_at = now;
        bank.updated_at = now;
      }
    }

    const ibo = this.store.ibos.find((i) => i.id === iboId);
    if (ibo) {
      ibo.active_banks_count = n;
      ibo.updated_at = now;
      // Mirror onto linked LLC banks_label count hint
      const linked = this.store.llcs.filter((l) => l.ibo_id === iboId);
      for (const llc of linked) {
        const names = this.store.banks
          .filter((b) => b.ibo_id === iboId && b.status === "active")
          .map((b) => b.name);
        llc.banks_label = names.length ? names.join(", ") : null;
        llc.bank_status = n > 0 ? "active" : "opening";
        llc.updated_at = now;
      }
    }
  }

  /** Align MID rows for an IBO with the numeric MID actifs count */
  private syncMidsCountForIbo(iboId: string, desired: number) {
    const now = new Date().toISOString();
    const n = Math.max(0, Math.floor(desired));
    let active = this.store.mids.filter((m) => m.ibo_id === iboId && m.status === "active");

    while (active.length < n) {
      const idx = active.length + 1;
      const mid: Mid = {
        id: `local-mid-${iboId}-${Date.now()}-${idx}`,
        ibo_id: iboId,
        bank_id: this.store.banks.find((b) => b.ibo_id === iboId && b.status === "active")?.id ?? null,
        processor_id: null,
        iso_id: null,
        crm_id: null,
        shop_id: null,
        reference_code: `MID-${idx}`,
        status: "active",
        underwriting_started_at: null,
        approved_at: now,
        closed_at: null,
        average_volume: null,
        notes: "Synced from IBO MID actifs count",
        created_at: now,
        updated_at: now,
      };
      this.store.mids.push(mid);
      active = this.store.mids.filter((m) => m.ibo_id === iboId && m.status === "active");
    }

    if (active.length > n) {
      const toClose = active.slice(n);
      for (const mid of toClose) {
        mid.status = "closed";
        mid.closed_at = now;
        mid.updated_at = now;
      }
    }

    const ibo = this.store.ibos.find((i) => i.id === iboId);
    if (ibo) {
      ibo.active_mids_count = n;
      ibo.updated_at = now;
    }
  }
  private recomputeDerived(options?: { preserveIboId?: string; preserveBanksLabel?: boolean }) {
    // IBO Banks / MID counts are edited in the tables — never overwrite them from row sync
    const countSnapshot = new Map(
      this.store.ibos.map((i) => [
        i.id,
        {
          active_banks_count: i.active_banks_count,
          active_mids_count: i.active_mids_count,
          backup_banks_count: i.backup_banks_count,
          display_name: i.display_name,
          status: i.status,
          linked_llcs_label: i.linked_llcs_label,
          linked_llc_ids: i.linked_llc_ids,
          banks_label: i.banks_label,
        },
      ])
    );
    const preserveId = options?.preserveIboId;
    const preserved = preserveId ? countSnapshot.get(preserveId) : undefined;

    this.store.ibos = attachLinkedLlcsToIbos(this.store.ibos, this.store.llcs, this.store.banks);

    this.store.ibos = this.store.ibos.map((i) => {
      const snap = countSnapshot.get(i.id);
      if (!snap) return i;
      const usePreserved = preserved && i.id === preserveId ? preserved : snap;
      return {
        ...i,
        active_banks_count: usePreserved.active_banks_count,
        active_mids_count: usePreserved.active_mids_count,
        backup_banks_count: usePreserved.backup_banks_count,
        display_name: usePreserved.display_name ?? i.display_name,
        status: usePreserved.status || i.status,
        linked_llcs_label: usePreserved.linked_llcs_label ?? i.linked_llcs_label,
        linked_llc_ids: usePreserved.linked_llc_ids ?? i.linked_llc_ids,
        banks_label: options?.preserveBanksLabel && i.id === preserveId
          ? usePreserved.banks_label
          : (usePreserved.banks_label ?? i.banks_label),
      };
    });
  }

  async setEcosystemCell(
    kind: "ibos" | "llcs" | "banks" | "mids",
    id: string,
    field: string,
    value: string | number | boolean | null
  ) {
    const now = new Date().toISOString();
    const applyExtra = (row: {
      extra?: Record<string, string | number | boolean | null>;
      updated_at: string;
    }) => {
      const key = field.slice(6);
      row.extra = { ...(row.extra || {}), [key]: value };
      row.updated_at = now;
    };

    const assignField = (row: Record<string, unknown>, key: string, raw: string | number | boolean | null) => {
      if (key === "id" || key === "created_at") return;
      const prev = row[key];
      if (typeof prev === "number" || key.endsWith("_count") || key === "average_volume" || key === "funds_at_risk") {
        row[key] = raw === "" || raw == null ? null : Number(raw);
      } else if (typeof prev === "boolean" || key === "is_backup") {
        row[key] = Boolean(raw === true || raw === "true");
      } else {
        row[key] = raw == null || raw === "" ? null : raw;
      }
      row.updated_at = now;
    };

    if (kind === "ibos") {
      const row = this.store.ibos.find((i) => i.id === id);
      if (!row) throw new Error("IBO not found");
      if (field.startsWith("extra.")) applyExtra(row);
      else if (field === "linked_llcs_label") {
        const names = String(value || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const matched = this.store.llcs.filter((l) =>
          names.some((n) => n.toLowerCase() === l.name.toLowerCase())
        );
        // Also create label even if LLC not found yet
        row.linked_llc_ids = matched.map((l) => l.id);
        row.linked_llcs_label = names.join(", ") || null;
        row.updated_at = now;
        for (const llc of this.store.llcs) {
          if (matched.some((m) => m.id === llc.id)) {
            llc.ibo_id = row.id;
            llc.updated_at = now;
          }
        }
        this.recomputeDerived({ preserveIboId: id });
      } else if (field === "banks_label") {
        const bankNames = String(value || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        row.banks_label = bankNames.join(", ") || null;
        row.updated_at = now;

        // Same banks on linked LLCs
        const linked = this.store.llcs.filter(
          (l) => l.ibo_id === row.id || row.linked_llc_ids?.includes(l.id)
        );
        for (const llc of linked) {
          llc.banks_label = row.banks_label;
          llc.updated_at = now;
          this.store.banks = [
            ...this.store.banks.filter((b) => !b.id.startsWith(`${llc.id}-bank-`)),
            ...banksFromLlc(llc),
          ];
        }
        // Ensure bank rows exist for this IBO
        for (const name of bankNames) {
          const exists = this.store.banks.some(
            (b) => b.ibo_id === row.id && b.name.toLowerCase() === name.toLowerCase()
          );
          if (!exists) {
            this.store.banks.push({
              id: `local-bank-${Date.now()}-${name}`,
              ibo_id: row.id,
              name,
              status: "active",
              is_backup: false,
              opened_at: null,
              closed_at: null,
              funds_at_risk: null,
              notes: `From IBO ${row.display_name || row.reference_code}`,
              created_at: now,
              updated_at: now,
            });
          }
        }
        // Drop banks for this IBO not in the list
        this.store.banks = this.store.banks.filter((b) => {
          if (b.ibo_id !== row.id) return true;
          return bankNames.some((n) => n.toLowerCase() === b.name.toLowerCase());
        });
        this.recomputeDerived({ preserveIboId: id, preserveBanksLabel: true });
      } else if (field === "active_banks_count") {
        const n = Number(value) || 0;
        this.syncBanksCountForIbo(id, n);
        this.recomputeDerived({ preserveIboId: id });
      } else if (field === "active_mids_count") {
        const n = Number(value) || 0;
        this.syncMidsCountForIbo(id, n);
        this.recomputeDerived({ preserveIboId: id });
      } else {
        assignField(row as unknown as Record<string, unknown>, field, value);
        this.recomputeDerived(field === "status" ? undefined : { preserveIboId: id });
      }
      this.persistSnapshot();
      return delay(clone(this.store.ibos.find((i) => i.id === id)!), 40);
    }

    if (kind === "llcs") {
      const row = this.store.llcs.find((i) => i.id === id);
      if (!row) throw new Error("LLC not found");
      if (field.startsWith("extra.")) applyExtra(row);
      else {
        assignField(row as unknown as Record<string, unknown>, field, value);
        if (field === "status") row.bank_status = row.status;
        if (field === "bank_status" && value) {
          row.bank_status = value as Llc["status"];
          row.status = value as Llc["status"];
        }
        if (field === "banks_label") {
          this.store.banks = [
            ...this.store.banks.filter((b) => !b.id.startsWith(`${row.id}-bank-`)),
            ...banksFromLlc(row),
          ];
        }
        if (field === "status" || field === "bank_status") {
          const next = (row.bank_status || row.status) as Bank["status"];
          for (const bank of this.store.banks) {
            if (
              bank.id.startsWith(`${row.id}-bank-`) ||
              (bank.ibo_id === row.ibo_id &&
                (row.banks_label || "")
                  .split(",")
                  .map((s) => s.trim())
                  .includes(bank.name))
            ) {
              bank.status = next;
              bank.updated_at = now;
            }
          }
        }
      }
      this.recomputeDerived();
      this.persistSnapshot();
      return delay(clone(row), 40);
    }

    if (kind === "banks") {
      const row = this.store.banks.find((i) => i.id === id);
      if (!row) throw new Error("Bank not found");
      if (field.startsWith("extra.")) applyExtra(row);
      else {
        assignField(row as unknown as Record<string, unknown>, field, value);
        if (field === "status" && value) {
          const llc =
            this.store.llcs.find((l) => row.id.startsWith(`${l.id}-bank-`)) ||
            this.store.llcs.find(
              (l) =>
                l.ibo_id === row.ibo_id &&
                (l.banks_label || "")
                  .split(",")
                  .map((s) => s.trim())
                  .includes(row.name)
            );
          if (llc) {
            llc.bank_status = value as Llc["status"];
            llc.status = value as Llc["status"];
            llc.updated_at = now;
          }
        }
      }
      this.recomputeDerived();
      this.persistSnapshot();
      return delay(clone(row), 40);
    }

    const row = this.store.mids.find((i) => i.id === id);
    if (!row) throw new Error("MID not found");
    if (field.startsWith("extra.")) applyExtra(row);
    else assignField(row as unknown as Record<string, unknown>, field, value);
    this.recomputeDerived();
    this.persistSnapshot();
    return delay(clone(row), 40);
  }

  async deleteEcosystemRow(kind: "ibos" | "llcs" | "banks" | "mids", id: string) {
    this.markDeleted(kind, id);
    if (kind === "ibos") {
      this.store.ibos = this.store.ibos.filter((i) => i.id !== id);
      // Drop orphan local banks/mids for this IBO
      this.store.banks = this.store.banks.filter((b) => b.ibo_id !== id);
      this.store.mids = this.store.mids.filter((m) => m.ibo_id !== id);
    } else if (kind === "llcs") {
      this.store.llcs = this.store.llcs.filter((i) => i.id !== id);
      this.store.banks = this.store.banks.filter((b) => !b.id.startsWith(`${id}-bank-`));
    } else if (kind === "banks") {
      this.store.banks = this.store.banks.filter((i) => i.id !== id);
    } else {
      this.store.mids = this.store.mids.filter((i) => i.id !== id);
    }
    this.recomputeDerived();
    this.persistSnapshot();
    return delay(true);
  }

  async createIbo(input?: { reference_code?: string; display_name?: string; status?: Ibo["status"] }) {
    const n = this.store.ibos.length + 1;
    const now = new Date().toISOString();
    const ibo: Ibo = {
      id: `local-ibo-${Date.now()}`,
      reference_code: input?.reference_code || `IBO #${n}`,
      display_name: input?.display_name ?? null,
      status: input?.status || "opening",
      active_banks_count: 0,
      backup_banks_count: 0,
      active_mids_count: 0,
      created_at: now,
      updated_at: now,
    };
    this.store.ibos.push(ibo);
    this.recomputeDerived();
    this.persistSnapshot();
    return delay(clone(this.store.ibos.find((i) => i.id === ibo.id)!));
  }

  async createLlc(input: {
    name: string;
    ibo_id: string;
    status?: Llc["status"];
    state?: string;
    banks_label?: string;
  }) {
    const now = new Date().toISOString();
    const llc: Llc = {
      id: `local-llc-${Date.now()}`,
      name: input.name,
      ibo_id: input.ibo_id,
      ein: null,
      state: input.state ?? null,
      address: null,
      formation_date: null,
      phone: null,
      domain: null,
      bank_status: input.status || "opening",
      banks_label: input.banks_label ?? null,
      status: input.status || "opening",
      created_at: now,
      updated_at: now,
    };
    this.store.llcs.push(llc);
    if (llc.banks_label) {
      this.store.banks.push(...banksFromLlc(llc));
    }
    this.recomputeDerived();
    this.persistSnapshot();
    return delay(clone(llc));
  }

  async createBank(input: {
    name: string;
    ibo_id: string;
    status?: Bank["status"];
    is_backup?: boolean;
  }) {
    const now = new Date().toISOString();
    const bank: Bank = {
      id: `local-bank-${Date.now()}`,
      ibo_id: input.ibo_id,
      name: input.name,
      status: input.status || "opening",
      is_backup: Boolean(input.is_backup),
      opened_at: null,
      closed_at: null,
      funds_at_risk: null,
      notes: null,
      created_at: now,
      updated_at: now,
    };
    this.store.banks.push(bank);
    const llc = this.store.llcs.find((l) => l.ibo_id === input.ibo_id);
    if (llc) {
      const labels = (llc.banks_label || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!labels.includes(bank.name)) {
        labels.push(bank.name);
        llc.banks_label = labels.join(", ");
        llc.updated_at = now;
      }
    }
    this.recomputeDerived();
    this.persistSnapshot();
    return delay(clone(bank));
  }

  async createMid(input: {
    reference_code?: string;
    ibo_id: string;
    bank_id?: string | null;
    status?: Mid["status"];
  }) {
    const now = new Date().toISOString();
    const n = this.store.mids.length + 1;
    const mid: Mid = {
      id: `local-mid-${Date.now()}`,
      ibo_id: input.ibo_id,
      bank_id: input.bank_id ?? null,
      processor_id: null,
      iso_id: null,
      crm_id: null,
      shop_id: null,
      reference_code: input.reference_code || `MID-${n}`,
      status: input.status || "underwriting",
      underwriting_started_at: now,
      approved_at: null,
      closed_at: null,
      average_volume: null,
      notes: null,
      created_at: now,
      updated_at: now,
    };
    this.store.mids.push(mid);
    this.recomputeDerived();
    this.persistSnapshot();
    return delay(clone(mid));
  }

  async getHealthRules() {
    return delay(clone(this.store.healthRules));
  }

  async updateHealthRules(rules: SystemHealthRule[]) {
    this.store.healthRules = clone(rules);
    return delay(clone(this.store.healthRules));
  }

  async getSyncLogs() {
    return delay(clone(this.store.syncLogs));
  }

  async refresh() {
    // Prefer live Airtable sync via API when available (called from UI with syncAirtableToStore).
    // Fallback local refresh marker for offline.
    const log: SyncLog = {
      id: uid("sync"),
      source: this.store.lastSyncSource || "mock",
      status: "success",
      message: "Local refresh completed",
      records_synced:
        this.store.ibos.length +
        (this.store.llcs?.length || 0) +
        this.store.banks.length +
        this.store.mids.length +
        this.store.alerts.length,
      created_at: new Date().toISOString(),
    };
    this.store.syncLogs.unshift(log);
    this.store.lastSyncAt = log.created_at;
    return delay(clone(log), 300);
  }

  async search(query: string) {
    const q = query.toLowerCase().trim();
    if (!q) return delay([]);
    const results: Array<{ type: string; id: string; title: string; href: string }> = [];

    for (const ibo of this.store.ibos) {
      if (
        ibo.display_name?.toLowerCase().includes(q) ||
        ibo.reference_code.toLowerCase().includes(q)
      ) {
        results.push({
          type: "IBO",
          id: ibo.id,
          title: ibo.display_name?.trim() || ibo.reference_code,
          href: "/ecosystem?type=ibo",
        });
      }
    }
    for (const mid of this.store.mids) {
      if (mid.reference_code.toLowerCase().includes(q)) {
        results.push({ type: "MID", id: mid.id, title: mid.reference_code, href: "/ecosystem?type=mid" });
      }
    }
    for (const alert of this.store.alerts) {
      if (alert.title.toLowerCase().includes(q)) {
        results.push({ type: "Alert", id: alert.id, title: alert.title, href: `/alerts?id=${alert.id}` });
      }
    }
    for (const rc of this.store.recoveryCases) {
      if (rc.title.toLowerCase().includes(q)) {
        results.push({ type: "Recovery", id: rc.id, title: rc.title, href: `/recovery/${rc.id}` });
      }
    }
    for (const sop of this.store.sops) {
      if (sop.title.toLowerCase().includes(q)) {
        results.push({ type: "SOP", id: sop.id, title: sop.title, href: `/sop/${sop.id}` });
      }
    }
    return delay(results.slice(0, 12));
  }
}

export const mockProvider = new MockDataProvider();
