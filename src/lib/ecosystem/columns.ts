import type {
  Bank,
  EcosystemColumn,
  EcosystemEntityKind,
  EcosystemTableSchema,
  EntityStatus,
  Ibo,
  Llc,
  Mid,
} from "@/types";

export type EcosystemRow = Ibo | Llc | Bank | Mid;

/** IBO: only the principal pilotage columns */
export const DEFAULT_TABLE_COLUMNS: EcosystemTableSchema = {
  ibos: [
    { id: "display_name", label: "Name", field: "display_name", type: "text", builtin: true },
    {
      id: "linked_llcs_label",
      label: "Linked LLC",
      field: "linked_llcs_label",
      type: "text",
      builtin: true,
    },
    { id: "status", label: "Status", field: "status", type: "status", builtin: true },
    {
      id: "active_banks_count",
      label: "Banks",
      field: "active_banks_count",
      type: "number",
      builtin: true,
    },
    {
      id: "active_mids_count",
      label: "MID actifs",
      field: "active_mids_count",
      type: "number",
      builtin: true,
    },
  ],
  llcs: [
    { id: "name", label: "LLC", field: "name", type: "text", builtin: true },
    { id: "ibo_id", label: "IBO", field: "ibo_id", type: "ibo_ref", builtin: true },
    { id: "ein", label: "EIN", field: "ein", type: "text", builtin: true },
    { id: "state", label: "State", field: "state", type: "text", builtin: true },
    { id: "address", label: "Address", field: "address", type: "text", builtin: true },
    { id: "formation_date", label: "Formation", field: "formation_date", type: "text", builtin: true },
    { id: "banks_label", label: "Banks", field: "banks_label", type: "text", builtin: true },
    { id: "domain", label: "Domain", field: "domain", type: "text", builtin: true },
    { id: "phone", label: "Phone", field: "phone", type: "text", builtin: true },
    { id: "bank_status", label: "Bank status", field: "bank_status", type: "status", builtin: true },
    { id: "status", label: "Status", field: "status", type: "status", builtin: true },
  ],
  banks: [
    {
      id: "linked_llcs_label",
      label: "LLC",
      field: "linked_llcs_label",
      type: "text",
      builtin: true,
    },
    { id: "display_name", label: "IBO", field: "display_name", type: "text", builtin: true },
    {
      id: "active_banks_count",
      label: "Banks",
      field: "active_banks_count",
      type: "number",
      builtin: true,
    },
  ],
  mids: [
    { id: "display_name", label: "ID IBO", field: "display_name", type: "text", builtin: true },
    {
      id: "linked_llcs_label",
      label: "LLC",
      field: "linked_llcs_label",
      type: "text",
      builtin: true,
    },
    {
      id: "active_mids_count",
      label: "MID approuvés",
      field: "active_mids_count",
      type: "number",
      builtin: true,
    },
  ],
};

/** Columns the user does not want on IBO */
const IBO_ALLOWED = new Set([
  "display_name",
  "linked_llcs_label",
  "status",
  "active_banks_count",
  "active_mids_count",
]);

/** MID tab: IBO-centric summary only */
const MID_ALLOWED = new Set(["display_name", "linked_llcs_label", "active_mids_count"]);

/** Bank tab: LLC · IBO · Banks (number only) */
const BANK_ALLOWED = new Set(["linked_llcs_label", "display_name", "active_banks_count"]);

export function resolveColumns(
  kind: EcosystemEntityKind,
  schema?: EcosystemTableSchema | null
): EcosystemColumn[] {
  const defaults = DEFAULT_TABLE_COLUMNS[kind];

  // IBO: force principal columns only (ignore stale saved schemas)
  if (kind === "ibos") {
    return defaults.filter((c) => IBO_ALLOWED.has(c.field) && !c.hidden);
  }

  // MID: force ID IBO · LLC · MID approuvés only
  if (kind === "mids") {
    return defaults.filter((c) => MID_ALLOWED.has(c.field) && !c.hidden);
  }

  // Bank: force LLC · IBO · Banks (chiffre) only
  if (kind === "banks") {
    return defaults.filter((c) => BANK_ALLOWED.has(c.field) && !c.hidden);
  }

  const custom = schema?.[kind];
  if (!custom?.length) return defaults.filter((c) => !c.hidden);

  const ordered = [...custom];
  for (const d of defaults) {
    if (!custom.some((c) => c.field === d.field || c.id === d.id)) {
      ordered.push(d);
    }
  }
  return ordered.filter((c) => !c.hidden);
}

export function getRowStatus(row: EcosystemRow): EntityStatus {
  return (row as { status?: EntityStatus }).status || "inactive";
}

/**
 * Row color for pilotage:
 * - Vert = prêt (banks ≥ 2 + MID si applicable)
 * - Orange = pending / en train de travailler dessus
 * - Rouge = rejected / closed
 */
export function getDisplayToneStatus(
  kind: EcosystemEntityKind,
  row: EcosystemRow,
  ctx?: { ibos?: Ibo[]; banks?: Bank[] }
): EntityStatus {
  const raw = getRowStatus(row);
  if (raw === "declined" || raw === "closed") return raw;

  if (kind === "llcs") {
    const llc = row as Llc;
    const ibo = (ctx?.ibos || []).find((i) => i.id === llc.ibo_id);
    const bankCount = Number(ibo?.active_banks_count) || 0;
    const hasMid = (Number(ibo?.active_mids_count) || 0) > 0;
    // Pending orange until 2 banks + MID
    return bankCount >= 2 && hasMid ? "active" : "opening";
  }

  if (kind === "ibos" || kind === "mids") {
    const ibo = row as Ibo;
    const banks = Number(ibo.active_banks_count) || 0;
    const mids = Number(ibo.active_mids_count) || 0;
    // Vert seulement si 2 banks min (+ MID). 0 ou 1 bank = orange pending
    return banks >= 2 && mids > 0 ? "active" : "opening";
  }

  if (kind === "banks") {
    // Onglet Bank : vert si ≥ 2, sinon orange (ex. 1 = manque backup)
    const ibo = row as Ibo;
    const banks = Number(ibo.active_banks_count) || 0;
    return banks >= 2 ? "active" : "opening";
  }

  return raw;
}

export function rowToneClass(status: EntityStatus): string {
  switch (status) {
    case "active":
    case "backup":
      return "bg-emerald-100/90 hover:bg-emerald-100 dark:bg-emerald-950/45";
    case "opening":
    case "underwriting":
      return "bg-orange-100/90 hover:bg-orange-100 dark:bg-orange-950/40";
    case "declined":
    case "closed":
      return "bg-rose-100/90 hover:bg-rose-100 dark:bg-rose-950/40";
    case "restricted":
      return "bg-orange-50/90 hover:bg-orange-50 dark:bg-orange-950/30";
    case "inactive":
    default:
      return "bg-slate-50/70 hover:bg-slate-50 dark:bg-slate-900/40";
  }
}

export function getCellValue(row: EcosystemRow, column: EcosystemColumn): string {
  if (column.field.startsWith("extra.")) {
    const key = column.field.slice(6);
    const extra = (row as { extra?: Record<string, unknown> }).extra || {};
    const v = extra[key];
    if (v == null) return "";
    return String(v);
  }
  const raw = (row as unknown as Record<string, unknown>)[column.field];
  if (raw == null) return "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}

export function buildExtraFieldKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || `col_${Date.now()}`;
}

/** Apply saved manual order; unknown/new ids append at the end */
export function applyRowOrder<T extends { id: string }>(rows: T[], order?: string[] | null): T[] {
  if (!order?.length) return rows;
  const map = new Map(rows.map((r) => [r.id, r]));
  const ordered: T[] = [];
  for (const id of order) {
    const row = map.get(id);
    if (row) {
      ordered.push(row);
      map.delete(id);
    }
  }
  for (const row of map.values()) ordered.push(row);
  return ordered;
}

/** Move `dragId` before `dropId` (or to end if dropId missing) within an id list */
export function moveIdBefore(ids: string[], dragId: string, dropId: string | null): string[] {
  if (dragId === dropId) return ids;
  const next = ids.filter((id) => id !== dragId);
  if (!dropId) {
    next.push(dragId);
    return next;
  }
  const at = next.indexOf(dropId);
  if (at < 0) {
    next.push(dragId);
    return next;
  }
  next.splice(at, 0, dragId);
  return next;
}
