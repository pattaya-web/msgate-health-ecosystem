import type {
  Alert,
  AppSettings,
  AppUser,
  Bank,
  BankPage,
  BusinessWeeklyMetric,
  Crm,
  Ibo,
  Iso,
  Mid,
  Processor,
  RecoveryCase,
  Shop,
  Sop,
  SyncLog,
  SystemHealthRule,
} from "@/types";

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
const weeksAgo = (w: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() - w * 7);
  return d;
};
const startOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfWeek = (date: Date) => {
  const s = startOfWeek(date);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
};

export const DEMO_USER: AppUser = {
  id: "user-1",
  email: "admin@msgate.internal",
  full_name: "Alex Morgan",
  role: "admin",
};

export const DEMO_CREDENTIALS = {
  email: "admin@msgate.internal",
  password: "demo1234",
  operatorEmail: "operator@msgate.internal",
  operatorPassword: "demo1234",
  viewerEmail: "viewer@msgate.internal",
  viewerPassword: "demo1234",
};

export const mockSettings: AppSettings = {
  min_active_banks: 12,
  min_active_mids: 10,
  recommended_banks_per_ibo: 2,
  max_underwriting_days: 14,
  max_payout_delay_days: 5,
  churn_threshold: 15,
  currency: "USD",
  timezone: "Europe/Paris",
  sync_frequency_minutes: 30,
  airtable_configured: false,
  goals: {
    target_ibos: 5,
    target_llcs: 5,
    target_banks: 10,
    target_mids: 8,
  },
};

export const mockHealthRules: SystemHealthRule[] = [
  {
    id: "rule-1",
    key: "ibo_no_active_bank",
    label: "IBO sans bank active",
    description: "Pénalité si un IBO actif n’a plus de bank",
    penalty: 20,
    enabled: true,
  },
  {
    id: "rule-1b",
    key: "ibo_no_active_mid",
    label: "IBO sans MID approuvé",
    description: "Pénalité si un IBO actif n’a plus de MID",
    penalty: 20,
    enabled: true,
  },
  {
    id: "rule-2",
    key: "ibo_less_than_recommended_banks",
    label: "IBO sans bank backup",
    description: "Pénalité si un IBO n’a qu’1 bank (il faut un 2e backup)",
    penalty: 8,
    enabled: true,
    threshold: 2,
  },
  {
    id: "rule-3",
    key: "mid_closed_no_replacement",
    label: "MID fermé sans remplacement",
    description: "Pénalité quand un MID est fermé sans remplacement actif",
    penalty: 15,
    enabled: true,
  },
  {
    id: "rule-4",
    key: "mid_underwriting_too_long",
    label: "MID underwriting overdue",
    description: "Désactivé — ne dégrade plus la santé",
    penalty: 5,
    enabled: false,
  },
  {
    id: "rule-5",
    key: "payout_overdue",
    label: "Payout overdue > 5 days",
    description: "Pénalité payout critique en retard",
    penalty: 10,
    enabled: true,
  },
  {
    id: "rule-6",
    key: "no_backup_available",
    label: "No backup account available",
    description: "Désactivé — ne dégrade plus la santé",
    penalty: 10,
    enabled: false,
  },
  {
    id: "rule-7",
    key: "recovery_open_over_48h",
    label: "Recovery open > 48h",
    description: "Pénalité dossier recovery ouvert > 48h",
    penalty: 10,
    enabled: true,
  },
  {
    id: "rule-8",
    key: "bank_opening_overdue",
    label: "Bank opening overdue",
    description: "Désactivé — ne dégrade plus la santé",
    penalty: 4,
    enabled: false,
  },
  {
    id: "rule-9",
    key: "below_ibo_goal",
    label: "Below IBO goal",
    description: "Désactivé — les objectifs ne baissent plus la santé",
    penalty: 4,
    enabled: false,
  },
  {
    id: "rule-10",
    key: "below_bank_goal",
    label: "Below bank goal",
    description: "Désactivé — les objectifs ne baissent plus la santé",
    penalty: 3,
    enabled: false,
  },
  {
    id: "rule-11",
    key: "below_mid_goal",
    label: "Below MID goal",
    description: "Désactivé — les objectifs ne baissent plus la santé",
    penalty: 3,
    enabled: false,
  },
];

export const mockIbos: Ibo[] = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1;
  const isLowBanks = n === 4;
  return {
    id: `ibo-${n}`,
    reference_code: `IBO #${n}`,
    display_name: null,
    status: "active",
    active_banks_count: isLowBanks ? 1 : 2,
    backup_banks_count: isLowBanks ? 0 : 1,
    active_mids_count: n <= 6 ? 2 : 1,
    created_at: daysAgo(120 - n * 5),
    updated_at: hoursAgo(n),
  };
});

export const mockIsos: Iso[] = [
  { id: "iso-1", name: "ISO Alpha", contact_name: "John Stevenson", status: "active", created_at: daysAgo(200), updated_at: daysAgo(10) },
  { id: "iso-2", name: "ISO Beta", contact_name: "Greg M.", status: "active", created_at: daysAgo(180), updated_at: daysAgo(8) },
  { id: "iso-3", name: "ISO Gamma", contact_name: "Yanis K.", status: "active", created_at: daysAgo(150), updated_at: daysAgo(3) },
];

export const mockProcessors: Processor[] = [
  { id: "proc-1", name: "Processor North", status: "active", created_at: daysAgo(300), updated_at: daysAgo(20) },
  { id: "proc-2", name: "Processor East", status: "active", created_at: daysAgo(250), updated_at: daysAgo(15) },
  { id: "proc-3", name: "Processor West", status: "active", created_at: daysAgo(220), updated_at: daysAgo(12) },
];

export const mockCrms: Crm[] = [
  { id: "crm-1", name: "CRM Primary", status: "active", created_at: daysAgo(400), updated_at: daysAgo(2) },
  { id: "crm-2", name: "CRM Secondary", status: "active", created_at: daysAgo(200), updated_at: daysAgo(5) },
  { id: "crm-3", name: "CRM Backup", status: "backup", created_at: daysAgo(100), updated_at: daysAgo(1) },
];

export const mockShops: Shop[] = [
  { id: "shop-1", name: "Shop Alpha", crm_id: "crm-1", status: "active", created_at: daysAgo(90), updated_at: daysAgo(1) },
  { id: "shop-2", name: "Shop Beta", crm_id: "crm-1", status: "active", created_at: daysAgo(80), updated_at: daysAgo(2) },
  { id: "shop-3", name: "Shop Gamma", crm_id: "crm-2", status: "active", created_at: daysAgo(70), updated_at: daysAgo(3) },
  { id: "shop-4", name: "Shop Delta", crm_id: "crm-2", status: "opening", created_at: daysAgo(10), updated_at: hoursAgo(6) },
];

export const mockBankPages: BankPage[] = [
  { id: "bp-1", name: "Bank Page A", ibo_id: "ibo-1", status: "active", created_at: daysAgo(60), updated_at: daysAgo(4) },
  { id: "bp-2", name: "Bank Page B", ibo_id: "ibo-2", status: "active", created_at: daysAgo(55), updated_at: daysAgo(3) },
  { id: "bp-3", name: "Bank Page C", ibo_id: "ibo-3", status: "opening", created_at: daysAgo(12), updated_at: daysAgo(1) },
  { id: "bp-4", name: "Bank Page D", ibo_id: "ibo-4", status: "active", created_at: daysAgo(40), updated_at: daysAgo(2) },
];

const bankSeed: Array<{
  ibo: number;
  status: Bank["status"];
  is_backup?: boolean;
  closed?: boolean;
  funds?: number;
}> = [
  // IBO #1
  { ibo: 1, status: "active" },
  { ibo: 1, status: "backup", is_backup: true },
  // IBO #2
  { ibo: 2, status: "active" },
  { ibo: 2, status: "backup", is_backup: true },
  // IBO #3
  { ibo: 3, status: "active" },
  { ibo: 3, status: "backup", is_backup: true },
  // IBO #4 — only 1 available bank (demo risk)
  { ibo: 4, status: "active" },
  { ibo: 4, status: "closed", closed: true, funds: 12500 },
  // IBO #5
  { ibo: 5, status: "active" },
  { ibo: 5, status: "backup", is_backup: true },
  // IBO #6
  { ibo: 6, status: "active" },
  { ibo: 6, status: "backup", is_backup: true },
  // IBO #7
  { ibo: 7, status: "active" },
  { ibo: 7, status: "backup", is_backup: true },
  // IBO #8
  { ibo: 8, status: "active" },
  { ibo: 8, status: "backup", is_backup: true },
  // Opening banks (3)
  { ibo: 1, status: "opening" },
  { ibo: 3, status: "opening" },
  { ibo: 6, status: "opening" },
];

export const mockBanks: Bank[] = bankSeed.map((cfg, i) => {
  const n = i + 1;
  return {
    id: `bank-${n}`,
    ibo_id: `ibo-${cfg.ibo}`,
    name:
      cfg.ibo === 4 && cfg.status === "active"
        ? "Bank 4 (IBO #4 Primary)"
        : cfg.ibo === 4 && cfg.status === "closed"
          ? "Bank 8 (IBO #4 Closed)"
          : `Bank ${n}`,
    status: cfg.status,
    is_backup: Boolean(cfg.is_backup),
    opened_at: cfg.status === "opening" ? null : daysAgo(90 - n),
    closed_at: cfg.closed ? hoursAgo(5) : null,
    funds_at_risk: cfg.funds ?? null,
    notes: cfg.closed ? "Account closed by bank. Recovery in progress." : null,
    created_at: cfg.status === "opening" ? daysAgo(5 + (n % 3)) : daysAgo(100 - n),
    updated_at: hoursAgo(n),
  };
});

// Keep recovery case bank_id valid
// bank-8 in old data was closed on ibo-4; now closed bank is bank-8 (index 7)


const midDefs: Array<Partial<Mid> & { reference_code: string; status: Mid["status"]; ibo_id: string }> = [
  { reference_code: "MID #1", status: "active", ibo_id: "ibo-1", bank_id: "bank-1", processor_id: "proc-1", iso_id: "iso-1", crm_id: "crm-1", shop_id: "shop-1", average_volume: 42000 },
  { reference_code: "MID #2", status: "active", ibo_id: "ibo-1", bank_id: "bank-3", processor_id: "proc-1", iso_id: "iso-1", crm_id: "crm-1", shop_id: "shop-1", average_volume: 28000 },
  { reference_code: "MID #3", status: "active", ibo_id: "ibo-2", bank_id: "bank-2", processor_id: "proc-2", iso_id: "iso-2", crm_id: "crm-1", shop_id: "shop-2", average_volume: 35000 },
  { reference_code: "MID #4", status: "active", ibo_id: "ibo-2", bank_id: "bank-8", processor_id: "proc-2", iso_id: "iso-2", crm_id: "crm-2", shop_id: "shop-2", average_volume: 19000 },
  { reference_code: "MID #5", status: "active", ibo_id: "ibo-3", bank_id: "bank-4", processor_id: "proc-1", iso_id: "iso-1", crm_id: "crm-1", shop_id: "shop-3", average_volume: 31000 },
  { reference_code: "MID #6", status: "active", ibo_id: "ibo-3", bank_id: "bank-6", processor_id: "proc-3", iso_id: "iso-3", crm_id: "crm-2", shop_id: "shop-3", average_volume: 22000 },
  { reference_code: "MID #7", status: "active", ibo_id: "ibo-4", bank_id: "bank-4", processor_id: "proc-2", iso_id: "iso-2", crm_id: "crm-1", shop_id: "shop-1", average_volume: 27000 },
  { reference_code: "MID #8", status: "active", ibo_id: "ibo-5", bank_id: "bank-9", processor_id: "proc-1", iso_id: "iso-1", crm_id: "crm-1", shop_id: "shop-2", average_volume: 24000 },
  { reference_code: "MID #9", status: "active", ibo_id: "ibo-5", bank_id: "bank-13", processor_id: "proc-3", iso_id: "iso-3", crm_id: "crm-2", shop_id: "shop-3", average_volume: 16000 },
  { reference_code: "MID #10", status: "active", ibo_id: "ibo-6", bank_id: "bank-11", processor_id: "proc-2", iso_id: "iso-2", crm_id: "crm-1", shop_id: "shop-1", average_volume: 21000 },
  { reference_code: "MID #11", status: "active", ibo_id: "ibo-6", bank_id: "bank-14", processor_id: "proc-1", iso_id: "iso-1", crm_id: "crm-3", shop_id: "shop-4", average_volume: 12000 },
  { reference_code: "MID #12", status: "closed", ibo_id: "ibo-7", bank_id: "bank-16", processor_id: "proc-2", iso_id: "iso-2", crm_id: "crm-1", shop_id: "shop-2", average_volume: 18000, closed_at: daysAgo(1), notes: "Closed by processor" },
  { reference_code: "MID #13", status: "underwriting", ibo_id: "ibo-8", bank_id: "bank-18", processor_id: "proc-3", iso_id: "iso-3", crm_id: "crm-2", shop_id: "shop-3", underwriting_started_at: daysAgo(9), average_volume: 0 },
  { reference_code: "MID #14", status: "underwriting", ibo_id: "ibo-8", bank_id: "bank-18", processor_id: "proc-1", iso_id: "iso-1", crm_id: "crm-1", shop_id: "shop-1", underwriting_started_at: daysAgo(6), average_volume: 0 },
  { reference_code: "MID #15", status: "backup", ibo_id: "ibo-7", bank_id: "bank-16", processor_id: "proc-2", iso_id: "iso-2", crm_id: "crm-3", shop_id: "shop-4", average_volume: 5000 },
  { reference_code: "MID #16", status: "active", ibo_id: "ibo-4", bank_id: "bank-4", processor_id: "proc-3", iso_id: "iso-3", crm_id: "crm-2", shop_id: "shop-3", average_volume: 15000 },
];

export const mockMids: Mid[] = midDefs.map((m, i) => ({
  id: `mid-${i + 1}`,
  ibo_id: m.ibo_id,
  bank_id: m.bank_id ?? null,
  processor_id: m.processor_id ?? null,
  iso_id: m.iso_id ?? null,
  crm_id: m.crm_id ?? null,
  shop_id: m.shop_id ?? null,
  reference_code: m.reference_code,
  status: m.status,
  underwriting_started_at: m.underwriting_started_at ?? null,
  approved_at: m.status === "active" ? daysAgo(40 - i) : null,
  closed_at: m.closed_at ?? null,
  average_volume: m.average_volume ?? null,
  notes: m.notes ?? null,
  created_at: daysAgo(60 - i),
  updated_at: hoursAgo(i + 1),
}));

export const mockAlerts: Alert[] = [
  {
    id: "alert-1",
    title: "Seulement 1 banque disponible sur IBO #4",
    description: "IBO #4 has only one active bank. Recommended minimum is 2 banks for redundancy.",
    level: "critical",
    category: "Banking",
    entity_type: "ibo",
    entity_id: "ibo-4",
    entity_label: "IBO #4",
    owner: "Alex Morgan",
    status: "active",
    recommended_action: "Open a backup bank or activate an existing opening bank for IBO #4.",
    recovery_case_id: "recovery-1",
    created_at: hoursAgo(6),
    updated_at: hoursAgo(1),
  },
  {
    id: "alert-2",
    title: "2 MIDs en underwriting",
    description: "MID #13 and MID #14 are currently in underwriting. Follow up with ISO before the 14-day threshold.",
    level: "warning",
    category: "MID",
    entity_type: "mid",
    entity_id: "mid-13",
    entity_label: "MID #13",
    owner: "Alex Morgan",
    status: "active",
    recommended_action: "Follow up with ISO and prepare underwriting documents.",
    created_at: hoursAgo(20),
    updated_at: hoursAgo(4),
  },
  {
    id: "alert-3",
    title: "Payout attendu depuis 6 jours",
    description: "Expected payout has been pending for 6 days, exceeding the 5-day threshold.",
    level: "warning",
    category: "Finance",
    entity_type: "bank",
    entity_id: "bank-4",
    entity_label: "Bank 4",
    owner: "Alex Morgan",
    status: "active",
    recommended_action: "Contact the bank and escalate with ISO if needed.",
    created_at: daysAgo(6),
    updated_at: hoursAgo(8),
  },
];

export const mockRecoveryCases: RecoveryCase[] = [
  {
    id: "recovery-1",
    type: "bank_closure",
    title: "Bank closure — IBO #4",
    status: "in_progress",
    priority: "critical",
    ibo_id: "ibo-4",
    bank_id: "bank-8",
    funds_at_risk: 12500,
    closed_at: hoursAgo(5),
    reason: "Bank initiated account closure",
    backup_bank_id: null,
    comments: "Primary bank closed. Switching volume and opening replacement.",
    documents: ["closure_notice.pdf"],
    estimated_recovery_date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    created_at: hoursAgo(5),
    updated_at: hoursAgo(1),
    steps: [
      { id: "rs-1-1", recovery_case_id: "recovery-1", step_order: 1, title: "Contacter IBO", status: "done", completed_at: hoursAgo(4) },
      { id: "rs-1-2", recovery_case_id: "recovery-1", step_order: 2, title: "Vérifier les fonds présents sur le compte", status: "done", completed_at: hoursAgo(3) },
      { id: "rs-1-3", recovery_case_id: "recovery-1", step_order: 3, title: "Demander si un chèque ou un remboursement sera envoyé", status: "done", completed_at: hoursAgo(2) },
      { id: "rs-1-4", recovery_case_id: "recovery-1", step_order: 4, title: "Basculer le MID vers la banque de secours", status: "in_progress" },
      { id: "rs-1-5", recovery_case_id: "recovery-1", step_order: 5, title: "Ouvrir une nouvelle banque", status: "pending" },
      { id: "rs-1-6", recovery_case_id: "recovery-1", step_order: 6, title: "Attendre et enregistrer la confirmation", status: "pending" },
    ],
  },
  {
    id: "recovery-2",
    type: "mid_closure",
    title: "MID closure — MID #12",
    status: "open",
    priority: "high",
    ibo_id: "ibo-7",
    mid_id: "mid-12",
    bank_id: "bank-16",
    processor_id: "proc-2",
    iso_id: "iso-2",
    shop_id: "shop-2",
    crm_id: "crm-1",
    closed_at: daysAgo(1),
    reason: "Processor risk review",
    average_volume: 18000,
    replacement_mid_id: null,
    comments: "Volume paused. Identifying replacement MID.",
    documents: [],
    created_at: daysAgo(1),
    updated_at: hoursAgo(3),
    steps: [
      { id: "rs-2-1", recovery_case_id: "recovery-2", step_order: 1, title: "Arrêter ou rediriger le volume", status: "done", completed_at: hoursAgo(20) },
      { id: "rs-2-2", recovery_case_id: "recovery-2", step_order: 2, title: "Prévenir l'ISO", status: "pending" },
      { id: "rs-2-3", recovery_case_id: "recovery-2", step_order: 3, title: "Identifier la cause de fermeture", status: "pending" },
      { id: "rs-2-4", recovery_case_id: "recovery-2", step_order: 4, title: "Basculer vers un MID actif ou de secours", status: "pending" },
      { id: "rs-2-5", recovery_case_id: "recovery-2", step_order: 5, title: "Ouvrir un nouveau MID", status: "pending" },
      { id: "rs-2-6", recovery_case_id: "recovery-2", step_order: 6, title: "Passer l'underwriting", status: "pending" },
      { id: "rs-2-7", recovery_case_id: "recovery-2", step_order: 7, title: "Connecter le nouveau MID au CRM", status: "pending" },
      { id: "rs-2-8", recovery_case_id: "recovery-2", step_order: 8, title: "Reprendre progressivement le volume", status: "pending" },
      { id: "rs-2-9", recovery_case_id: "recovery-2", step_order: 9, title: "Confirmer la stabilité", status: "pending" },
    ],
  },
];

function makeWeeklyMetric(weekOffset: number, overrides: Partial<BusinessWeeklyMetric> = {}): BusinessWeeklyMetric {
  const start = startOfWeek(weeksAgo(weekOffset));
  const end = endOfWeek(start);
  const active = 950 - weekOffset * 18 + (overrides.active_subscribers ?? 0);
  const newSubs = 184 - weekOffset * 4;
  const lost = Math.round(active * (0.124 - weekOffset * 0.002));
  const churn = Number(((lost / (active + lost - newSubs)) * 100).toFixed(1));
  const spend = 20743 - weekOffset * 420;
  const revenue = 31529 - weekOffset * 510;
  const roas_otp_7d = Number((1.48 - weekOffset * 0.015).toFixed(2));
  const roas_rebill_7d = Number((0.31 - weekOffset * 0.005).toFixed(2));
  const roas_combined_7d = Number((roas_otp_7d + roas_rebill_7d).toFixed(2));
  return {
    id: `biz-${weekOffset}`,
    week_start: start.toISOString().slice(0, 10),
    week_end: end.toISOString().slice(0, 10),
    roas_otp_7d,
    roas_rebill_7d,
    roas_combined_7d,
    roas_7d: roas_combined_7d,
    spend,
    revenue,
    active_subscribers: active,
    new_subscribers: newSubs,
    lost_subscribers: lost,
    churn_rate: churn,
    retention_rate: Number((100 - churn).toFixed(1)),
    net_growth: newSubs - lost,
    created_at: start.toISOString(),
    updated_at: end.toISOString(),
    ...overrides,
  };
}

export const mockBusinessMetrics: BusinessWeeklyMetric[] = [
  {
    id: "biz-0",
    week_start: startOfWeek(now).toISOString().slice(0, 10),
    week_end: endOfWeek(now).toISOString().slice(0, 10),
    roas_otp_7d: 1.48,
    roas_rebill_7d: 0.31,
    roas_combined_7d: 1.79,
    roas_7d: 1.79,
    spend: 20743,
    revenue: 31529,
    active_subscribers: 950,
    new_subscribers: 184,
    lost_subscribers: 118,
    churn_rate: 12.4,
    retention_rate: 87.6,
    net_growth: 66,
    created_at: daysAgo(1),
    updated_at: hoursAgo(2),
  },
  ...Array.from({ length: 11 }, (_, i) => makeWeeklyMetric(i + 1)),
];

function daysAgoDate(d: number) {
  const date = new Date(now);
  date.setDate(date.getDate() - d);
  date.setHours(12, 0, 0, 0);
  return date;
}

/** Last 14 days — for inspection only. Decisions stay on 7d. */
export const mockBusinessDailyMetrics: import("@/types").BusinessDailyMetric[] = Array.from(
  { length: 14 },
  (_, i) => {
    const day = daysAgoDate(13 - i);
    // Deterministic variation (no Math.random — avoids hydration mismatch)
    const wave = Math.sin(i / 2.2) * 0.22;
    const dip = i === 10 || i === 3 ? -0.55 : 0;
    const roas_otp = Number(Math.max(0.72, 1.48 + wave + dip - (13 - i) * 0.008).toFixed(2));
    const roas_rebill = Number(Math.max(0.12, 0.28 + Math.cos(i / 3) * 0.06).toFixed(2));
    const roas_combined = Number((roas_otp + roas_rebill).toFixed(2));
    const spend = 2800 + ((i * 137) % 900);
    return {
      id: `biz-day-${i}`,
      date: day.toISOString().slice(0, 10),
      roas_otp,
      roas_rebill,
      roas_combined,
      spend,
      revenue: Math.round(spend * roas_combined),
      new_subscribers: 22 + ((i * 5) % 18),
      lost_subscribers: 12 + ((i * 3) % 10),
      created_at: day.toISOString(),
    };
  }
);

export const mockSops: Sop[] = [
  {
    id: "sop-1",
    title: "Ouvrir un IBO",
    category: "IBO",
    summary: "Procédure complète pour onboarder un nouvel IBO et préparer le dossier LLC.",
    objective: "Mettre en place un IBO opérationnel avec documents validés et suivi Airtable.",
    prerequisites: ["Contact IBO qualifié", "Documents d'identité", "Accès Airtable"],
    documents_needed: ["ID", "Proof of address", "LLC formation docs"],
    estimated_time: "5–10 days",
    difficulty: "medium",
    owner: "Operations",
    created_at: daysAgo(60),
    updated_at: daysAgo(3),
    steps: [
      { id: "ss-1-1", sop_id: "sop-1", step_order: 1, title: "Qualifier le contact IBO", is_checklist_item: true },
      { id: "ss-1-2", sop_id: "sop-1", step_order: 2, title: "Collecter et vérifier les documents", is_checklist_item: true },
      { id: "ss-1-3", sop_id: "sop-1", step_order: 3, title: "Organiser le dossier LLC", is_checklist_item: true },
      { id: "ss-1-4", sop_id: "sop-1", step_order: 4, title: "Configurer email pro et ProfitSharing", is_checklist_item: true },
      { id: "ss-1-5", sop_id: "sop-1", step_order: 5, title: "Enregistrer le statut dans Airtable", is_checklist_item: true },
    ],
  },
  {
    id: "sop-2",
    title: "Ouvrir une banque",
    category: "Banking",
    summary: "Ouverture d'un compte bancaire pour un IBO avec bank page et documents.",
    objective: "Obtenir un compte bancaire actif (objectif: min. 2 banques / IBO).",
    prerequisites: ["IBO actif", "LLC formée", "Bank page prête"],
    documents_needed: ["Identity docs", "Shop details", "Bank page fee receipt ($150)"],
    estimated_time: "10–14 days",
    difficulty: "medium",
    owner: "Banking Ops",
    created_at: daysAgo(55),
    updated_at: daysAgo(2),
    steps: [
      { id: "ss-2-1", sop_id: "sop-2", step_order: 1, title: "Préparer les documents d'ouverture", is_checklist_item: true },
      { id: "ss-2-2", sop_id: "sop-2", step_order: 2, title: "Soumettre la bank page", is_checklist_item: true },
      { id: "ss-2-3", sop_id: "sop-2", step_order: 3, title: "Suivre le statut d'ouverture", is_checklist_item: true },
      { id: "ss-2-4", sop_id: "sop-2", step_order: 4, title: "Confirmer le compte ouvert", is_checklist_item: true },
      { id: "ss-2-5", sop_id: "sop-2", step_order: 5, title: "Marquer comme active / backup dans le cockpit", is_checklist_item: true },
    ],
  },
  {
    id: "sop-3",
    title: "Ouvrir un MID",
    category: "MID",
    summary: "Soumission d'un MID lié à 1 IBO + 1 ISO + 1 banque.",
    objective: "Obtenir un MID approuvé prêt à recevoir du volume.",
    prerequisites: ["Banque active", "ISO contacté", "Documents underwriting"],
    documents_needed: ["Business docs", "Processing history", "Bank statements"],
    estimated_time: "7–21 days",
    difficulty: "hard",
    owner: "MID Ops",
    created_at: daysAgo(50),
    updated_at: daysAgo(1),
    steps: [
      { id: "ss-3-1", sop_id: "sop-3", step_order: 1, title: "Choisir IBO / banque / ISO", is_checklist_item: true },
      { id: "ss-3-2", sop_id: "sop-3", step_order: 2, title: "Préparer le dossier underwriting", is_checklist_item: true },
      { id: "ss-3-3", sop_id: "sop-3", step_order: 3, title: "Soumettre à l'ISO", is_checklist_item: true },
      { id: "ss-3-4", sop_id: "sop-3", step_order: 4, title: "Suivre underwriting jusqu'à approval", is_checklist_item: true },
      { id: "ss-3-5", sop_id: "sop-3", step_order: 5, title: "Connecter au CRM et activer", is_checklist_item: true },
    ],
  },
  {
    id: "sop-4",
    title: "Changer un CRM",
    category: "CRM",
    summary: "Migration contrôlée d'un CRM vers un autre sans perte de volume.",
    objective: "Basculer les MIDs et shops vers le nouveau CRM en toute sécurité.",
    prerequisites: ["Nouveau CRM provisionné", "Fenêtre de maintenance planifiée"],
    documents_needed: ["Mapping MID → CRM", "Credentials"],
    estimated_time: "1–3 days",
    difficulty: "hard",
    owner: "Tech Ops",
    created_at: daysAgo(40),
    updated_at: daysAgo(8),
    steps: [
      { id: "ss-4-1", sop_id: "sop-4", step_order: 1, title: "Inventorier les MIDs connectés", is_checklist_item: true },
      { id: "ss-4-2", sop_id: "sop-4", step_order: 2, title: "Configurer le nouveau CRM", is_checklist_item: true },
      { id: "ss-4-3", sop_id: "sop-4", step_order: 3, title: "Reconnecter les MIDs", is_checklist_item: true },
      { id: "ss-4-4", sop_id: "sop-4", step_order: 4, title: "Valider les transactions test", is_checklist_item: true },
    ],
  },
  {
    id: "sop-5",
    title: "Changer une Bank Page",
    category: "Bank Page",
    summary: "Remplacement ou mise à jour d'une bank page pour un IBO.",
    objective: "Assurer la continuité d'ouverture et de conformité bancaire.",
    prerequisites: ["Documents à jour", "IBO informé"],
    documents_needed: ["New bank page assets", "Identity pack"],
    estimated_time: "2–5 days",
    difficulty: "easy",
    owner: "Banking Ops",
    created_at: daysAgo(35),
    updated_at: daysAgo(6),
    steps: [
      { id: "ss-5-1", sop_id: "sop-5", step_order: 1, title: "Collecter les nouveaux assets", is_checklist_item: true },
      { id: "ss-5-2", sop_id: "sop-5", step_order: 2, title: "Soumettre la nouvelle bank page", is_checklist_item: true },
      { id: "ss-5-3", sop_id: "sop-5", step_order: 3, title: "Confirmer l'activation", is_checklist_item: true },
    ],
  },
  {
    id: "sop-6",
    title: "Gérer une fermeture de banque",
    category: "Recovery",
    summary: "Checklist opérationnelle en cas de fermeture bancaire.",
    objective: "Protéger les fonds, basculer les MIDs et rouvrir une banque.",
    prerequisites: ["Alerte bank closure", "Accès contacts IBO / ISO"],
    documents_needed: ["Closure notice", "Fund recovery emails"],
    estimated_time: "Immediate + follow-up",
    difficulty: "hard",
    owner: "Controller",
    created_at: daysAgo(30),
    updated_at: daysAgo(1),
    steps: [
      { id: "ss-6-1", sop_id: "sop-6", step_order: 1, title: "Créer un recovery case Bank Closure", is_checklist_item: true },
      { id: "ss-6-2", sop_id: "sop-6", step_order: 2, title: "Basculer MID vers banque Class 2 / backup", is_checklist_item: true },
      { id: "ss-6-3", sop_id: "sop-6", step_order: 3, title: "Déplacer le shop associé", is_checklist_item: true },
      { id: "ss-6-4", sop_id: "sop-6", step_order: 4, title: "Lancer la récupération des fonds", is_checklist_item: true },
    ],
  },
  {
    id: "sop-7",
    title: "Gérer une fermeture de MID",
    category: "Recovery",
    summary: "Procédure de continuité lorsqu'un MID est fermé ou declined.",
    objective: "Stopper le risque, basculer le volume et rouvrir un MID.",
    prerequisites: ["MID fermé détecté", "MID backup ou capacité d'ouverture"],
    documents_needed: ["Closure reason", "ISO correspondence"],
    estimated_time: "1–14 days",
    difficulty: "hard",
    owner: "MID Ops",
    created_at: daysAgo(28),
    updated_at: daysAgo(1),
    steps: [
      { id: "ss-7-1", sop_id: "sop-7", step_order: 1, title: "Couper / rediriger le volume", is_checklist_item: true },
      { id: "ss-7-2", sop_id: "sop-7", step_order: 2, title: "Notifier l'ISO", is_checklist_item: true },
      { id: "ss-7-3", sop_id: "sop-7", step_order: 3, title: "Activer MID de secours ou ouvrir un nouveau MID", is_checklist_item: true },
      { id: "ss-7-4", sop_id: "sop-7", step_order: 4, title: "Reconnecter CRM et reprendre le volume", is_checklist_item: true },
    ],
  },
  {
    id: "sop-8",
    title: "Connecter un MID au CRM",
    category: "CRM",
    summary: "Branchement technique d'un MID approuvé au CRM.",
    objective: "Permettre le processing des commandes via le MID.",
    prerequisites: ["MID approved", "Credentials processeur"],
    documents_needed: ["MID credentials", "CRM gateway config"],
    estimated_time: "2–6 hours",
    difficulty: "medium",
    owner: "Tech Ops",
    created_at: daysAgo(25),
    updated_at: daysAgo(4),
    steps: [
      { id: "ss-8-1", sop_id: "sop-8", step_order: 1, title: "Récupérer les credentials MID", is_checklist_item: true },
      { id: "ss-8-2", sop_id: "sop-8", step_order: 2, title: "Configurer le gateway CRM", is_checklist_item: true },
      { id: "ss-8-3", sop_id: "sop-8", step_order: 3, title: "Exécuter un paiement test", is_checklist_item: true },
    ],
  },
  {
    id: "sop-9",
    title: "Envoyer du volume sur un nouveau MID",
    category: "MID",
    summary: "Montée en charge progressive sur un MID fraîchement approuvé.",
    objective: "Valider la stabilité avant d'envoyer le volume complet.",
    prerequisites: ["MID connected to CRM", "Shop prêt"],
    documents_needed: ["Volume plan"],
    estimated_time: "3–7 days",
    difficulty: "medium",
    owner: "Growth Ops",
    created_at: daysAgo(22),
    updated_at: daysAgo(5),
    steps: [
      { id: "ss-9-1", sop_id: "sop-9", step_order: 1, title: "Définir le plan de ramp-up", is_checklist_item: true },
      { id: "ss-9-2", sop_id: "sop-9", step_order: 2, title: "Envoyer un volume test limité", is_checklist_item: true },
      { id: "ss-9-3", sop_id: "sop-9", step_order: 3, title: "Monitorer declines / chargebacks", is_checklist_item: true },
      { id: "ss-9-4", sop_id: "sop-9", step_order: 4, title: "Valider et adapter pour le volume", is_checklist_item: true },
    ],
  },
  {
    id: "sop-10",
    title: "Gérer un payout en retard",
    category: "Finance",
    summary: "Escalade et suivi lorsqu'un payout dépasse le délai configuré.",
    objective: "Débloquer le payout ou documenter le risque fonds.",
    prerequisites: ["Alerte payout overdue", "Coordonnées banque / ISO"],
    documents_needed: ["Payout schedule", "Bank emails"],
    estimated_time: "1–5 days",
    difficulty: "medium",
    owner: "Finance",
    created_at: daysAgo(20),
    updated_at: daysAgo(2),
    steps: [
      { id: "ss-10-1", sop_id: "sop-10", step_order: 1, title: "Vérifier le calendrier de payout", is_checklist_item: true },
      { id: "ss-10-2", sop_id: "sop-10", step_order: 2, title: "Contacter la banque / ISO", is_checklist_item: true },
      { id: "ss-10-3", sop_id: "sop-10", step_order: 3, title: "Mettre à jour l'alerte et le statut", is_checklist_item: true },
    ],
  },
  {
    id: "sop-11",
    title: "Préparer les documents d'underwriting",
    category: "Compliance",
    summary: "Constitution du dossier d'underwriting pour soumission ISO.",
    objective: "Maximiser les chances d'approval MID.",
    prerequisites: ["IBO et banque actifs", "Historique processing si disponible"],
    documents_needed: ["Corp docs", "Bank statements", "Processing history", "Product info"],
    estimated_time: "1–2 days",
    difficulty: "medium",
    owner: "Compliance",
    created_at: daysAgo(18),
    updated_at: daysAgo(3),
    steps: [
      { id: "ss-11-1", sop_id: "sop-11", step_order: 1, title: "Lister les documents requis par l'ISO", is_checklist_item: true },
      { id: "ss-11-2", sop_id: "sop-11", step_order: 2, title: "Collecter et nommer les fichiers", is_checklist_item: true },
      { id: "ss-11-3", sop_id: "sop-11", step_order: 3, title: "Revue qualité avant envoi", is_checklist_item: true },
      { id: "ss-11-4", sop_id: "sop-11", step_order: 4, title: "Archiver le dossier dans Airtable", is_checklist_item: true },
    ],
  },
];

export const mockSyncLogs: SyncLog[] = [
  {
    id: "sync-1",
    source: "mock",
    status: "success",
    message: "Mock provider refreshed successfully",
    records_synced: 64,
    created_at: hoursAgo(0.5),
  },
  {
    id: "sync-2",
    source: "mock",
    status: "success",
    message: "Scheduled refresh completed",
    records_synced: 64,
    created_at: hoursAgo(6),
  },
];

export const BANK_CLOSURE_STEPS = [
  "Contacter IBO",
  "Vérifier les fonds présents sur le compte",
  "Demander si un chèque ou un remboursement sera envoyé",
  "Basculer le MID vers la banque de secours",
  "Ouvrir une nouvelle banque",
  "Attendre et enregistrer la confirmation",
];

export const MID_CLOSURE_STEPS = [
  "Arrêter ou rediriger le volume",
  "Prévenir l'ISO",
  "Identifier la cause de fermeture",
  "Basculer vers un MID actif ou de secours",
  "Ouvrir un nouveau MID",
  "Passer l'underwriting",
  "Connecter le nouveau MID au CRM",
  "Reprendre progressivement le volume",
  "Confirmer la stabilité",
];
