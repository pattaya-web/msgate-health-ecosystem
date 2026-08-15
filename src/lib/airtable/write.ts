import { airtableRequest, getAirtableConfig } from "@/lib/airtable/client";
import type {
  AirtableIboFields,
  AirtableLlcFields,
  AirtableMidFields,
  AirtableRecord,
} from "@/lib/airtable/types";
import type { Bank, EntityStatus, Ibo, Llc, Mid } from "@/types";

export function statusToAirtableBankStatus(status: EntityStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "opening":
    case "underwriting":
      return "Pending";
    case "closed":
      return "Closed";
    case "backup":
      return "Backup";
    case "restricted":
      return "Restricted";
    case "inactive":
      return "Inactive";
    case "declined":
      return "Declined";
    default:
      return "Pending";
  }
}

export type LlcPatch = Partial<
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
>;

export type IboPatch = Partial<
  Pick<Ibo, "display_name" | "status" | "reference_code" | "phone_ibo" | "linked_llc_ids">
>;

export type BankPatch = Partial<
  Pick<Bank, "name" | "status" | "is_backup" | "funds_at_risk" | "notes" | "opened_at" | "closed_at">
>;

export type MidPatch = Partial<
  Pick<Mid, "reference_code" | "status" | "average_volume" | "notes" | "ibo_id" | "bank_id">
>;

export async function updateLlcInAirtable(
  recordId: string,
  patch: LlcPatch
): Promise<AirtableRecord<AirtableLlcFields>> {
  const config = getAirtableConfig();
  if (!config) throw new Error("Airtable is not configured");

  const fields: AirtableLlcFields = {};
  if (patch.name !== undefined) fields["LLC Name"] = patch.name || "";
  if (patch.ein !== undefined) fields.EIN = patch.ein || "";
  if (patch.state !== undefined) fields.States = patch.state || "";
  if (patch.address !== undefined) fields.Address = patch.address || "";
  if (patch.formation_date !== undefined) {
    fields["Formation Date (US)"] = patch.formation_date || "";
  }
  if (patch.domain !== undefined) fields.Domain = patch.domain || "";
  if (patch.phone !== undefined) fields.Phone = patch.phone || "";
  if (patch.banks_label !== undefined) fields.Bank = patch.banks_label || "";
  if (patch.status || patch.bank_status) {
    fields["Statuts Bank"] = statusToAirtableBankStatus(
      (patch.bank_status || patch.status) as EntityStatus
    );
  }
  // IBO linked field: only send if it looks like an Airtable record id
  if (patch.ibo_id && patch.ibo_id.startsWith("rec")) {
    fields.IBO = [patch.ibo_id];
  }

  const table = encodeURIComponent(config.tables.llcs);
  return airtableRequest<AirtableRecord<AirtableLlcFields>>(
    `${table}/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    }
  );
}

export async function updateIboInAirtable(
  recordId: string,
  patch: IboPatch
): Promise<AirtableRecord<AirtableIboFields>> {
  const config = getAirtableConfig();
  if (!config) throw new Error("Airtable is not configured");

  const fields: AirtableIboFields = {};
  if (patch.display_name !== undefined) fields.Name = patch.display_name || "";
  if (patch.status !== undefined) fields.Status = statusToAirtableBankStatus(patch.status);
  if (patch.reference_code !== undefined) fields.ReferenceCode = patch.reference_code || "";
  if (patch.phone_ibo !== undefined) fields["Phone IBO"] = patch.phone_ibo || "";
  if (patch.linked_llc_ids !== undefined) {
    fields["🔗 Linked LLCs"] = patch.linked_llc_ids;
    fields["Linked LLCs"] = patch.linked_llc_ids;
  }

  const table = encodeURIComponent(config.tables.ibos);
  return airtableRequest<AirtableRecord<AirtableIboFields>>(
    `${table}/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    }
  );
}

/** Banks live on LLC rows in Airtable — write status / name via parent LLC when possible */
export async function updateBankViaLlcInAirtable(params: {
  llcId: string;
  patch: BankPatch;
  banksLabel?: string | null;
}): Promise<AirtableRecord<AirtableLlcFields>> {
  const llcPatch: LlcPatch = {};
  if (params.patch.status) {
    llcPatch.bank_status = params.patch.status;
    llcPatch.status = params.patch.status;
  }
  if (params.banksLabel !== undefined) {
    llcPatch.banks_label = params.banksLabel;
  } else if (params.patch.name !== undefined) {
    // caller should pass rebuilt label; ignore lone name without label
  }
  return updateLlcInAirtable(params.llcId, llcPatch);
}

export async function updateMidInAirtable(
  recordId: string,
  patch: MidPatch
): Promise<AirtableRecord<AirtableMidFields>> {
  const config = getAirtableConfig();
  if (!config) throw new Error("Airtable is not configured");

  const fields: AirtableMidFields = {};
  if (patch.reference_code !== undefined) fields.ReferenceCode = patch.reference_code || "";
  if (patch.status !== undefined) fields.Status = statusToAirtableBankStatus(patch.status);
  if (patch.average_volume !== undefined) {
    fields.AverageVolume = patch.average_volume ?? undefined;
  }
  if (patch.notes !== undefined) fields.Notes = patch.notes || "";
  if (patch.ibo_id && patch.ibo_id.startsWith("rec")) fields.IboId = [patch.ibo_id];
  if (patch.bank_id && patch.bank_id.startsWith("rec")) fields.BankId = [patch.bank_id];

  const table = encodeURIComponent(config.tables.mids);
  return airtableRequest<AirtableRecord<AirtableMidFields>>(
    `${table}/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    }
  );
}

export function isAirtableRecordId(id: string) {
  return id.startsWith("rec");
}

/** Extract LLC id from derived bank id `${llcId}-bank-N` */
export function llcIdFromDerivedBankId(bankId: string): string | null {
  const m = bankId.match(/^(.*)-bank-\d+$/);
  return m?.[1] ?? null;
}
