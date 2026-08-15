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
  Mid,
  Processor,
  RecoveryCase,
  RecoveryStep,
  Shop,
  Sop,
  SyncLog,
  SystemHealthRule,
} from "@/types";

export interface CreateBankClosureInput {
  ibo_id: string;
  bank_id: string;
  funds_at_risk?: number;
  closed_at?: string;
  reason?: string;
  backup_bank_id?: string;
  comments?: string;
  estimated_recovery_date?: string;
  priority?: RecoveryCase["priority"];
}

export interface CreateMidClosureInput {
  mid_id: string;
  ibo_id?: string;
  bank_id?: string;
  processor_id?: string;
  iso_id?: string;
  shop_id?: string;
  crm_id?: string;
  closed_at?: string;
  reason?: string;
  average_volume?: number;
  replacement_mid_id?: string;
  comments?: string;
  priority?: RecoveryCase["priority"];
}

export interface CreateSopInput {
  title: string;
  category: Sop["category"];
  summary: string;
  objective: string;
  prerequisites: string[];
  documents_needed: string[];
  estimated_time: string;
  difficulty: Sop["difficulty"];
  owner: string;
  steps: Array<{ title: string; description?: string }>;
}

export interface IDataProvider {
  getCurrentUser(): Promise<AppUser | null>;
  getDashboard(): Promise<DashboardData>;
  getIbos(): Promise<Ibo[]>;
  getLlcs(): Promise<import("@/types").Llc[]>;
  getBanks(): Promise<Bank[]>;
  getMids(): Promise<Mid[]>;
  getIsos(): Promise<Iso[]>;
  getProcessors(): Promise<Processor[]>;
  getCrms(): Promise<Crm[]>;
  getBankPages(): Promise<BankPage[]>;
  getShops(): Promise<Shop[]>;
  getAlerts(): Promise<Alert[]>;
  resolveAlert(id: string): Promise<Alert>;
  getRecoveryCases(): Promise<RecoveryCase[]>;
  getRecoveryCase(id: string): Promise<RecoveryCase | null>;
  createBankClosure(input: CreateBankClosureInput): Promise<RecoveryCase>;
  createMidClosure(input: CreateMidClosureInput): Promise<RecoveryCase>;
  updateRecoveryStep(caseId: string, stepId: string, status: RecoveryStep["status"]): Promise<RecoveryCase>;
  updateRecoveryStatus(caseId: string, status: RecoveryCase["status"]): Promise<RecoveryCase>;
  getSops(): Promise<Sop[]>;
  getSop(id: string): Promise<Sop | null>;
  createSop(input: CreateSopInput): Promise<Sop>;
  updateSop(id: string, input: Partial<CreateSopInput>): Promise<Sop>;
  getBusinessMetrics(): Promise<BusinessWeeklyMetric[]>;
  getBusinessDailyMetrics(): Promise<import("@/types").BusinessDailyMetric[]>;
  upsertBusinessMetric(metric: Omit<BusinessWeeklyMetric, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<BusinessWeeklyMetric>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  getHealthRules(): Promise<SystemHealthRule[]>;
  updateHealthRules(rules: SystemHealthRule[]): Promise<SystemHealthRule[]>;
  getSyncLogs(): Promise<SyncLog[]>;
  refresh(): Promise<SyncLog>;
  search(query: string): Promise<Array<{ type: string; id: string; title: string; href: string }>>;
}
