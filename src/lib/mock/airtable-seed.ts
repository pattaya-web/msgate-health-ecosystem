import type { Bank, Ibo, Llc, Mid } from "@/types";

/**
 * Seed derived from cleaned Airtable exports (no passwords / ID docs / SSN).
 * Dashboard shows anonymized reference_code (IBO #n).
 */
export const seededIbos: Ibo[] = [
  {
    id: "ibo-at-1",
    reference_code: "IBO #1",
    display_name: "Victoria Cacese",
    status: "active",
    active_banks_count: 2,
    backup_banks_count: 0,
    active_mids_count: 0,
    created_at: "2026-05-04T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "ibo-at-2",
    reference_code: "IBO #2",
    display_name: "BRANDON LEE REDDISH",
    status: "active",
    active_banks_count: 1,
    backup_banks_count: 0,
    active_mids_count: 0,
    created_at: "2026-05-07T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "ibo-at-3",
    reference_code: "IBO #3",
    display_name: "Adam Caron",
    status: "active",
    active_banks_count: 0,
    backup_banks_count: 0,
    active_mids_count: 0,
    created_at: "2026-07-05T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
];

export const seededLlcs: Llc[] = [
  {
    id: "llc-at-1",
    name: "SKINRENEW LLC",
    ibo_id: "ibo-at-1",
    ein: "42-2324241",
    state: "Wyoming",
    address: "1831 13th Ave E, Bradenton, FL 34208",
    formation_date: "2026-05-04",
    phone: "+1 941 396-3182",
    domain: "https://upskinrenew.com",
    bank_status: "active",
    banks_label: "BlueVine, LiliBank",
    status: "active",
    created_at: "2026-05-04T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "llc-at-2",
    name: "BLASTUP GLOW LLC",
    ibo_id: "ibo-at-2",
    ein: "42-2421466",
    state: "Wyoming",
    address: "3022 22nd Street, Sarasota, Florida 34234",
    formation_date: "2026-05-07",
    phone: "+1 941 396-6088",
    domain: "blast-skin.com",
    bank_status: "active",
    banks_label: "Relay",
    status: "active",
    created_at: "2026-05-07T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "llc-at-3",
    name: "SageResearch OKH LLC",
    ibo_id: "ibo-at-3",
    ein: "98-1952449",
    state: "Wyoming",
    address: "318 ORANGE ST #1 MANCHESTER, NH 03104",
    formation_date: "2026-07-05",
    phone: "+1 603 207-1934",
    domain: null,
    bank_status: "opening",
    banks_label: null,
    status: "opening",
    created_at: "2026-07-05T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
];

export const seededBanksFromLlc: Bank[] = [
  {
    id: "bank-at-1",
    ibo_id: "ibo-at-1",
    name: "BlueVine",
    status: "active",
    is_backup: false,
    opened_at: "2026-05-10T00:00:00.000Z",
    closed_at: null,
    funds_at_risk: null,
    notes: "From LLC SKINRENEW LLC",
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "bank-at-2",
    ibo_id: "ibo-at-1",
    name: "LiliBank",
    status: "active",
    is_backup: false,
    opened_at: "2026-05-12T00:00:00.000Z",
    closed_at: null,
    funds_at_risk: null,
    notes: "From LLC SKINRENEW LLC",
    created_at: "2026-05-12T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "bank-at-3",
    ibo_id: "ibo-at-2",
    name: "Relay",
    status: "active",
    is_backup: false,
    opened_at: "2026-05-15T00:00:00.000Z",
    closed_at: null,
    funds_at_risk: null,
    notes: "From LLC BLASTUP GLOW LLC",
    created_at: "2026-05-15T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
];

export function recomputeIboBankCounts(ibos: Ibo[], banks: Bank[]): Ibo[] {
  return ibos.map((ibo) => {
    const iboBanks = banks.filter((b) => b.ibo_id === ibo.id);
    return {
      ...ibo,
      active_banks_count: iboBanks.filter((b) => b.status === "active").length,
      backup_banks_count: iboBanks.filter((b) => b.is_backup || b.status === "backup").length,
    };
  });
}

export const seededMids: Mid[] = [
  {
    id: "mid-at-1",
    ibo_id: "ibo-at-1",
    bank_id: "bank-at-1",
    processor_id: null,
    iso_id: null,
    crm_id: null,
    shop_id: null,
    reference_code: "MID-SR-01",
    status: "active",
    underwriting_started_at: "2026-05-20T00:00:00.000Z",
    approved_at: "2026-05-28T00:00:00.000Z",
    closed_at: null,
    average_volume: 42000,
    notes: "Primary MID — SkinRenew",
    created_at: "2026-05-28T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "mid-at-2",
    ibo_id: "ibo-at-1",
    bank_id: "bank-at-2",
    processor_id: null,
    iso_id: null,
    crm_id: null,
    shop_id: null,
    reference_code: "MID-SR-02",
    status: "underwriting",
    underwriting_started_at: "2026-07-01T00:00:00.000Z",
    approved_at: null,
    closed_at: null,
    average_volume: 18000,
    notes: "Backup MID in underwriting",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  {
    id: "mid-at-3",
    ibo_id: "ibo-at-2",
    bank_id: "bank-at-3",
    processor_id: null,
    iso_id: null,
    crm_id: null,
    shop_id: null,
    reference_code: "MID-BG-01",
    status: "active",
    underwriting_started_at: "2026-05-18T00:00:00.000Z",
    approved_at: "2026-05-25T00:00:00.000Z",
    closed_at: null,
    average_volume: 31000,
    notes: "BlastUp Glow primary",
    created_at: "2026-05-25T00:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
];

export function recomputeIboMidCounts(ibos: Ibo[], mids: Mid[]): Ibo[] {
  return ibos.map((ibo) => ({
    ...ibo,
    active_mids_count: mids.filter((m) => m.ibo_id === ibo.id && m.status === "active").length,
  }));
}
