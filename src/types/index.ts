export type UserRole = "admin" | "operator" | "viewer";

export type EntityStatus =
  | "active"
  | "opening"
  | "backup"
  | "restricted"
  | "closed"
  | "underwriting"
  | "declined"
  | "inactive";

export type AlertLevel = "info" | "warning" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export type RecoveryType = "bank_closure" | "mid_closure";
export type RecoveryStatus =
  | "open"
  | "in_progress"
  | "waiting_on_ibo"
  | "waiting_on_bank"
  | "funds_recovered"
  | "resolved"
  | "lost_funds";

export type RecoveryPriority = "low" | "medium" | "high" | "critical";
export type StepStatus = "pending" | "in_progress" | "done" | "skipped";

export type SopCategory =
  | "IBO"
  | "Banking"
  | "MID"
  | "CRM"
  | "Bank Page"
  | "Recovery"
  | "Finance"
  | "Shop"
  | "Compliance";

export type Difficulty = "easy" | "medium" | "hard";

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url?: string;
}

export interface Ibo {
  id: string;
  reference_code: string;
  /** Name from Airtable ID IBO `Name` field */
  display_name?: string | null;
  status: EntityStatus;
  active_banks_count: number;
  backup_banks_count: number;
  active_mids_count: number;
  /** Linked LLC record ids (Airtable) */
  linked_llc_ids?: string[];
  /** Linked LLC names (display / edit) */
  linked_llcs_label?: string | null;
  /** Banks linked to this IBO (same as LLC banks) */
  banks_label?: string | null;
  phone_ibo?: string | null;
  extra?: Record<string, string | number | boolean | null>;
  created_at: string;
  updated_at: string;
}

export interface Llc {
  id: string;
  name: string;
  ibo_id: string;
  ein?: string | null;
  state?: string | null;
  address?: string | null;
  formation_date?: string | null;
  phone?: string | null;
  domain?: string | null;
  bank_status?: EntityStatus | null;
  banks_label?: string | null;
  status: EntityStatus;
  extra?: Record<string, string | number | boolean | null>;
  created_at: string;
  updated_at: string;
}

export interface Bank {
  id: string;
  ibo_id: string;
  name: string;
  status: EntityStatus;
  is_backup: boolean;
  opened_at?: string | null;
  closed_at?: string | null;
  funds_at_risk?: number | null;
  notes?: string | null;
  extra?: Record<string, string | number | boolean | null>;
  created_at: string;
  updated_at: string;
}

export interface Iso {
  id: string;
  name: string;
  contact_name?: string | null;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Processor {
  id: string;
  name: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Crm {
  id: string;
  name: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface BankPage {
  id: string;
  name: string;
  ibo_id?: string | null;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Shop {
  id: string;
  name: string;
  crm_id?: string | null;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Mid {
  id: string;
  ibo_id: string;
  bank_id?: string | null;
  processor_id?: string | null;
  iso_id?: string | null;
  crm_id?: string | null;
  shop_id?: string | null;
  reference_code: string;
  status: EntityStatus;
  underwriting_started_at?: string | null;
  approved_at?: string | null;
  closed_at?: string | null;
  average_volume?: number | null;
  notes?: string | null;
  extra?: Record<string, string | number | boolean | null>;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  title: string;
  description: string;
  level: AlertLevel;
  category: string;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_label?: string | null;
  owner?: string | null;
  status: AlertStatus;
  recommended_action?: string | null;
  recovery_case_id?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

export interface RecoveryStep {
  id: string;
  recovery_case_id: string;
  step_order: number;
  title: string;
  status: StepStatus;
  completed_at?: string | null;
  notes?: string | null;
}

export interface RecoveryCase {
  id: string;
  type: RecoveryType;
  title: string;
  status: RecoveryStatus;
  priority: RecoveryPriority;
  ibo_id?: string | null;
  bank_id?: string | null;
  mid_id?: string | null;
  funds_at_risk?: number | null;
  closed_at?: string | null;
  reason?: string | null;
  backup_bank_id?: string | null;
  replacement_mid_id?: string | null;
  comments?: string | null;
  documents?: string[];
  estimated_recovery_date?: string | null;
  processor_id?: string | null;
  iso_id?: string | null;
  shop_id?: string | null;
  crm_id?: string | null;
  average_volume?: number | null;
  created_at: string;
  updated_at: string;
  steps: RecoveryStep[];
}

export interface SopStep {
  id: string;
  sop_id: string;
  step_order: number;
  title: string;
  description?: string | null;
  is_checklist_item: boolean;
}

export interface Sop {
  id: string;
  title: string;
  category: SopCategory;
  summary: string;
  objective: string;
  prerequisites: string[];
  documents_needed: string[];
  estimated_time: string;
  difficulty: Difficulty;
  owner: string;
  updated_at: string;
  created_at: string;
  steps: SopStep[];
}

export interface BusinessWeeklyMetric {
  id: string;
  week_start: string;
  week_end: string;
  /** @deprecated Prefer roas_combined_7d — kept for compatibility */
  roas_7d: number;
  /** Direct / OTP sales ROAS (7d) */
  roas_otp_7d: number;
  /** Rebill ROAS 7d — initial + recurring + salvage */
  roas_rebill_7d: number;
  /** Combined = OTP + rebill only (same spend base) */
  roas_combined_7d: number;
  spend: number;
  revenue: number;
  active_subscribers: number;
  new_subscribers: number;
  lost_subscribers: number;
  churn_rate: number;
  retention_rate: number;
  net_growth: number;
  created_at: string;
  updated_at: string;
}

/** Daily ROAS snapshot — informative only; decisions use 7d metrics. */
export interface BusinessDailyMetric {
  id: string;
  date: string;
  roas_otp: number;
  roas_rebill: number;
  /** Combined = OTP + rebill for that day */
  roas_combined: number;
  spend: number;
  revenue: number;
  new_subscribers: number;
  lost_subscribers: number;
  created_at: string;
}

export interface SystemHealthRule {
  id: string;
  key: string;
  label: string;
  description: string;
  penalty: number;
  enabled: boolean;
  threshold?: number | null;
}

export interface SyncLog {
  id: string;
  source: string;
  status: "success" | "error" | "partial";
  message: string;
  records_synced: number;
  created_at: string;
}

export interface EcosystemGoals {
  target_ibos: number;
  target_llcs: number;
  target_banks: number;
  target_mids: number;
}

export type EcosystemEntityKind = "ibos" | "llcs" | "banks" | "mids";

export type EcosystemColumnType =
  | "text"
  | "number"
  | "status"
  | "boolean"
  | "ibo_ref"
  | "bank_ref";

export interface EcosystemColumn {
  id: string;
  label: string;
  /** Built-in field name or `extra.<key>` for custom */
  field: string;
  type: EcosystemColumnType;
  builtin?: boolean;
  hidden?: boolean;
}

export interface EcosystemTableSchema {
  ibos: EcosystemColumn[];
  llcs: EcosystemColumn[];
  banks: EcosystemColumn[];
  mids: EcosystemColumn[];
}

export interface AppSettings {
  min_active_banks: number;
  min_active_mids: number;
  recommended_banks_per_ibo: number;
  max_underwriting_days: number;
  max_payout_delay_days: number;
  churn_threshold: number;
  currency: string;
  timezone: string;
  sync_frequency_minutes: number;
  airtable_base_id?: string;
  airtable_configured: boolean;
  goals: EcosystemGoals;
  table_columns?: EcosystemTableSchema;
  /** Manual row order per ecosystem tab (ids top → bottom) */
  row_order?: Partial<Record<EcosystemEntityKind, string[]>>;
}

export interface InfrastructureMetrics {
  active_ibos: number;
  banks: number;
  mids: number;
  mids_underwriting: number;
  banks_opening: number;
  active_banks: number;
  backup_banks: number;
}

export interface SystemHealthResult {
  score: number;
  status: "healthy" | "monitor" | "critical";
  explanation: string;
  appliedPenalties: Array<{ rule: string; penalty: number; detail: string }>;
}

export interface EcosystemHealthByCategory {
  ibo: number;
  banking: number;
  mid: number;
  crm: number;
  shop: number;
}

export interface DashboardData {
  health: SystemHealthResult;
  infrastructure: InfrastructureMetrics;
  alerts: Alert[];
  recoveryCases: RecoveryCase[];
  business: BusinessWeeklyMetric;
  businessTrend: BusinessWeeklyMetric[];
  lastSyncAt: string;
  syncStatus: "live" | "synced";
}
