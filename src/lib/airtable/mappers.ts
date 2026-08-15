import type { Bank, Ibo, Llc, Sop, Mid } from "@/types";
import type {
  AirtableBankFields,
  AirtableIboFields,
  AirtableLlcFields,
  AirtableMidFields,
  AirtableRecord,
  AirtableSopFields,
} from "@/lib/airtable/types";

function firstLink(value: string[] | string | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function linkList(value: string[] | string | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function mapBankStatus(raw?: string): Bank["status"] {
  const v = (raw || "").toLowerCase().trim();
  if (v === "active") return "active";
  if (v === "pending" || v === "opening") return "opening";
  if (v === "backup") return "backup";
  if (v === "closed") return "closed";
  if (v === "restricted") return "restricted";
  return "opening";
}

export function mapAirtableIbo(
  record: AirtableRecord<AirtableIboFields>,
  index: number
): Ibo {
  const name = record.fields.Name || record.fields.DisplayName || null;
  const linkedIds = linkList(
    record.fields["🔗 Linked LLCs"] || record.fields["Linked LLCs"]
  );
  return {
    id: record.id,
    reference_code: record.fields.ReferenceCode || `IBO #${index + 1}`,
    display_name: name,
    status: (record.fields.Status as Ibo["status"]) || "active",
    active_banks_count: record.fields.ActiveBanksCount ?? 0,
    backup_banks_count: record.fields.BackupBanksCount ?? 0,
    active_mids_count: record.fields.ActiveMidsCount ?? 0,
    linked_llc_ids: linkedIds,
    linked_llcs_label: null, // filled after LLC sync with names
    phone_ibo: record.fields["Phone IBO"] || null,
    created_at: record.createdTime,
    updated_at: record.createdTime,
  };
}

/** Attach linked LLC names + bank names onto IBOs */
export function attachLinkedLlcsToIbos(ibos: Ibo[], llcs: Llc[], banks: Bank[] = []): Ibo[] {
  const llcById = new Map(llcs.map((l) => [l.id, l]));
  return ibos.map((ibo) => {
    const fromLinks = (ibo.linked_llc_ids || [])
      .map((id) => llcById.get(id)?.name)
      .filter(Boolean) as string[];
    const linkedLlcs = llcs.filter((l) => l.ibo_id === ibo.id);
    const fromReverse = linkedLlcs.map((l) => l.name);
    const names = [...new Set(fromLinks.length ? fromLinks : fromReverse)];
    const ids =
      ibo.linked_llc_ids?.length
        ? ibo.linked_llc_ids
        : linkedLlcs.map((l) => l.id);

    const bankNamesFromRows = banks
      .filter((b) => b.ibo_id === ibo.id)
      .map((b) => b.name);
    const bankNamesFromLlcs = linkedLlcs
      .flatMap((l) => (l.banks_label || "").split(",").map((s) => s.trim()))
      .filter(Boolean);
    const bankNames = [...new Set([...bankNamesFromRows, ...bankNamesFromLlcs])];

    return {
      ...ibo,
      linked_llc_ids: ids,
      linked_llcs_label: names.length ? names.join(", ") : null,
      banks_label: bankNames.length ? bankNames.join(", ") : null,
    };
  });
}

export function mapAirtableLlc(
  record: AirtableRecord<AirtableLlcFields>,
  iboIdByNameOrRecordId: Map<string, string>
): Llc {
  const iboRaw = firstLink(record.fields.IBO);
  const ibo_id =
    (iboRaw && iboIdByNameOrRecordId.get(iboRaw.toLowerCase())) ||
    (iboRaw && iboIdByNameOrRecordId.get(iboRaw)) ||
    iboRaw ||
    "";

  const bankStatus = mapBankStatus(record.fields["Statuts Bank"] || record.fields.Status);
  const banks = linkList(record.fields.Bank);

  return {
    id: record.id,
    name: record.fields["LLC Name"] || "LLC",
    ibo_id,
    ein: record.fields.EIN?.replace(/\s+/g, "") || null,
    state: record.fields.States || null,
    address: record.fields.Address || null,
    formation_date: record.fields["Formation Date (US)"] || null,
    phone: record.fields.Phone || null,
    domain: record.fields.Domain || null,
    bank_status: bankStatus,
    banks_label: banks.length ? banks.join(", ") : null,
    status: bankStatus === "opening" ? "opening" : "active",
    created_at: record.createdTime,
    updated_at: record.createdTime,
  };
}

/** Derive bank rows from LLC Bank + Statuts Bank fields */
export function banksFromLlc(llc: Llc): Bank[] {
  if (!llc.banks_label) return [];
  const names = llc.banks_label.split(",").map((s) => s.trim()).filter(Boolean);
  return names.map((name, i) => ({
    id: `${llc.id}-bank-${i + 1}`,
    ibo_id: llc.ibo_id,
    name,
    status: (llc.bank_status as Bank["status"]) || "active",
    is_backup: false,
    opened_at: llc.formation_date || null,
    closed_at: null,
    funds_at_risk: null,
    notes: `From LLC ${llc.name}`,
    created_at: llc.created_at,
    updated_at: llc.updated_at,
  }));
}

export function mapAirtableBank(record: AirtableRecord<AirtableBankFields>): Bank {
  return {
    id: record.id,
    ibo_id: record.fields.IboId?.[0] || "",
    name: record.fields.Name || "Bank",
    status: (record.fields.Status as Bank["status"]) || "active",
    is_backup: Boolean(record.fields.IsBackup),
    opened_at: record.fields.OpenedAt ?? null,
    closed_at: record.fields.ClosedAt ?? null,
    funds_at_risk: record.fields.FundsAtRisk ?? null,
    notes: record.fields.Notes ?? null,
    created_at: record.createdTime,
    updated_at: record.createdTime,
  };
}

export function mapAirtableMid(record: AirtableRecord<AirtableMidFields>): Mid {
  return {
    id: record.id,
    ibo_id: record.fields.IboId?.[0] || "",
    bank_id: record.fields.BankId?.[0] ?? null,
    processor_id: null,
    iso_id: null,
    crm_id: null,
    shop_id: null,
    reference_code: record.fields.ReferenceCode || "MID",
    status: (record.fields.Status as Mid["status"]) || "active",
    underwriting_started_at: record.fields.UnderwritingStartedAt ?? null,
    approved_at: record.fields.ApprovedAt ?? null,
    closed_at: record.fields.ClosedAt ?? null,
    average_volume: record.fields.AverageVolume ?? null,
    notes: record.fields.Notes ?? null,
    created_at: record.createdTime,
    updated_at: record.createdTime,
  };
}

export function mapAirtableSop(record: AirtableRecord<AirtableSopFields>): Sop {
  return {
    id: record.id,
    title: record.fields.Title || "Untitled SOP",
    category: (record.fields.Category as Sop["category"]) || "IBO",
    summary: record.fields.Summary || "",
    objective: record.fields.Objective || "",
    prerequisites: [],
    documents_needed: [],
    estimated_time: record.fields.EstimatedTime || "",
    difficulty: (record.fields.Difficulty as Sop["difficulty"]) || "medium",
    owner: record.fields.Owner || "Operations",
    created_at: record.createdTime,
    updated_at: record.createdTime,
    steps: [],
  };
}
