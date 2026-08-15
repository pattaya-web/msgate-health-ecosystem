"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  Expand,
  Filter,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Bank,
  EcosystemColumn,
  EcosystemColumnType,
  EcosystemEntityKind,
  EcosystemTableSchema,
  EntityStatus,
  Ibo,
  Llc,
  Mid,
} from "@/types";
import {
  buildExtraFieldKey,
  getCellValue,
  getDisplayToneStatus,
  moveIdBefore,
  resolveColumns,
  rowToneClass,
  type EcosystemRow,
} from "@/lib/ecosystem/columns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const STATUS_OPTIONS: { value: EntityStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "opening", label: "Pending" },
  { value: "underwriting", label: "Pending (UW)" },
  { value: "backup", label: "Backup" },
  { value: "restricted", label: "Restricted" },
  { value: "declined", label: "Rejected" },
  { value: "closed", label: "Closed" },
  { value: "inactive", label: "Inactive" },
];

type SortState = { field: string; dir: "asc" | "desc" } | null;

/** Columns that must show the full label / value (no crop) */
function isFullNameColumn(field: string) {
  return (
    field === "linked_llcs_label" ||
    field === "name" ||
    field === "display_name" ||
    field === "banks_label" ||
    field === "address" ||
    field === "domain"
  );
}

function columnMinWidthClass(field: string, kind: EcosystemEntityKind) {
  if (field === "linked_llcs_label" || (kind === "llcs" && field === "name")) {
    return "min-w-[280px]";
  }
  if (isFullNameColumn(field) || kind === "llcs") {
    return "min-w-[160px]";
  }
  if (field.endsWith("_count") || field === "status" || field === "bank_status") {
    return "min-w-[88px]";
  }
  return "min-w-[100px]";
}

export function EntitySheet({
  kind,
  title,
  description,
  rows,
  ibos,
  banks,
  columnsSchema,
  canWrite,
  compact,
  onChangeCell,
  onAddRow,
  onDeleteRow,
  onColumnsChange,
  onReorderRows,
}: {
  kind: EcosystemEntityKind;
  title: string;
  description?: string;
  rows: EcosystemRow[];
  ibos: Ibo[];
  banks: Bank[];
  columnsSchema?: EcosystemTableSchema | null;
  canWrite: boolean;
  compact?: boolean;
  onChangeCell: (id: string, field: string, value: string | number | boolean | null) => Promise<void>;
  onAddRow: () => Promise<void>;
  onDeleteRow: (id: string) => Promise<void>;
  onColumnsChange: (next: EcosystemColumn[]) => Promise<void>;
  onReorderRows?: (orderedIds: string[]) => Promise<void>;
}) {
  const columns = useMemo(
    () => resolveColumns(kind, columnsSchema),
    [kind, columnsSchema]
  );
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");
  const [newColType, setNewColType] = useState<EcosystemColumnType>("text");
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const canReorder = Boolean(canWrite && onReorderRows && !sort);

  const visible = useMemo(() => {
    let list = [...rows];
    const q = globalFilter.trim().toLowerCase();
    if (q) {
      list = list.filter((row) =>
        columns.some((col) => getCellValue(row, col).toLowerCase().includes(q))
      );
    }
    for (const [field, raw] of Object.entries(filters)) {
      const f = raw.trim().toLowerCase();
      if (!f) continue;
      const col = columns.find((c) => c.field === field);
      if (!col) continue;
      list = list.filter((row) => getCellValue(row, col).toLowerCase().includes(f));
    }
    if (sort) {
      const col = columns.find((c) => c.field === sort.field);
      if (col) {
        list.sort((a, b) => {
          const av = getCellValue(a, col);
          const bv = getCellValue(b, col);
          const an = Number(av);
          const bn = Number(bv);
          let cmp = 0;
          if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "") {
            cmp = an - bn;
          } else {
            cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
          }
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return list;
  }, [rows, columns, filters, globalFilter, sort]);

  function toggleSort(field: string) {
    setSort((s) => {
      if (!s || s.field !== field) return { field, dir: "asc" };
      if (s.dir === "asc") return { field, dir: "desc" };
      return null;
    });
  }

  async function commitReorder(fromId: string, toId: string | null) {
    if (!onReorderRows || fromId === toId) return;
    const baseIds = rows.map((r) => r.id);
    const nextIds = moveIdBefore(baseIds, fromId, toId);
    if (nextIds.join() === baseIds.join()) return;
    setBusy(true);
    try {
      await onReorderRows(nextIds);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Réordonnancement échoué");
    } finally {
      setBusy(false);
    }
  }

  async function commit(
    id: string,
    field: string,
    value: string | number | boolean | null
  ) {
    if (!canWrite) return;
    try {
      await onChangeCell(id, field, value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleAddColumn() {
    if (!canWrite || !newColLabel.trim()) return;
    const key = buildExtraFieldKey(newColLabel);
    const field = `extra.${key}`;
    if (
      columns.some(
        (c) =>
          c.field === field || c.label.toLowerCase() === newColLabel.trim().toLowerCase()
      )
    ) {
      toast.error("Column already exists");
      return;
    }
    const next: EcosystemColumn[] = [
      ...columns,
      {
        id: `custom-${key}`,
        label: newColLabel.trim(),
        field,
        type: newColType,
        builtin: false,
      },
    ];
    setBusy(true);
    try {
      await onColumnsChange(next);
      setAddColOpen(false);
      setNewColLabel("");
      setNewColType("text");
      toast.success("Column added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveColumn(col: EcosystemColumn) {
    if (!canWrite || col.builtin) return;
    setBusy(true);
    try {
      await onColumnsChange(columns.filter((c) => c.id !== col.id));
      toast.success("Column removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const colCount =
    columns.length + (canWrite ? 1 : 0) + (canWrite && onReorderRows ? 1 : 0);

  const table = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Filtrer toutes les colonnes…"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        </div>
        <Badge variant="outline" className="text-[11px]">
          {visible.length}/{rows.length} lignes
        </Badge>
        {canWrite && onReorderRows ? (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {sort
              ? "Désactive le tri colonne pour glisser les lignes"
              : "Glisser ⋮⋮ pour réorganiser"}
          </Badge>
        ) : null}
        {canWrite && kind !== "ibos" && kind !== "mids" && kind !== "banks" ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setAddColOpen(true)}>
              <Columns3 className="h-3.5 w-3.5" />
              Colonne
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                setBusy(true);
                try {
                  await onAddRow();
                  toast.success("Ligne ajoutée");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              <Plus className="h-3.5 w-3.5" />
              Ligne
            </Button>
          </>
        ) : canWrite ? (
          <Button
            size="sm"
            onClick={async () => {
              setBusy(true);
              try {
                await onAddRow();
                toast.success("Ligne ajoutée");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            <Plus className="h-3.5 w-3.5" />
            Ligne
          </Button>
        ) : null}
        {!fullscreen && !compact ? (
          <Button size="sm" variant="secondary" onClick={() => setFullscreen(true)}>
            <Expand className="h-3.5 w-3.5" />
            Plein écran
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          "overflow-auto rounded-xl border border-slate-200",
          fullscreen ? "max-h-[70vh]" : "max-h-[480px]"
        )}
      >
        <table
          className={cn(
            "w-full border-collapse text-left text-[11px] leading-tight",
            kind === "llcs" ? "min-w-[1100px]" : "min-w-[720px]"
          )}
        >
          <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur dark:bg-slate-950/95">
            <tr className="border-b border-slate-200">
              {canWrite && onReorderRows ? (
                <th className="w-7 px-0.5 py-1.5" aria-label="Ordre" />
              ) : null}
              {columns.map((col) => {
                const active = sort?.field === col.field;
                const wide = isFullNameColumn(col.field) || kind === "llcs";
                return (
                  <th
                    key={col.id}
                    className={cn("px-1.5 py-1.5 align-bottom", columnMinWidthClass(col.field, kind))}
                  >
                    <button
                      type="button"
                      className="mb-0.5 flex w-full items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 hover:text-emerald-700"
                      onClick={() => toggleSort(col.field)}
                    >
                      <span className={cn(wide ? "whitespace-nowrap" : "truncate")}>
                        {col.label}
                      </span>
                      {active ? (
                        sort?.dir === "asc" ? (
                          <ArrowUp className="h-2.5 w-2.5 shrink-0" />
                        ) : (
                          <ArrowDown className="h-2.5 w-2.5 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 shrink-0 opacity-40" />
                      )}
                      {!col.builtin && canWrite ? (
                        <span
                          role="button"
                          className="ml-auto text-rose-400 hover:text-rose-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRemoveColumn(col);
                          }}
                          title="Supprimer colonne"
                        >
                          <X className="h-2.5 w-2.5" />
                        </span>
                      ) : null}
                    </button>
                    <Input
                      className="h-6 px-1.5 text-[10px]"
                      placeholder="Filtre"
                      value={filters[col.field] || ""}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, [col.field]: e.target.value }))
                      }
                    />
                  </th>
                );
              })}
              {canWrite ? <th className="w-8 px-1 py-1.5" /> : null}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-3 py-6 text-center text-[11px] text-slate-400"
                >
                  Aucune ligne — ajoute une ligne ou élargis les filtres
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const status = getDisplayToneStatus(kind, row, { ibos, banks });
                const isDragging = dragId === row.id;
                const isOver = overId === row.id && dragId !== row.id;
                return (
                  <tr
                    key={row.id}
                    draggable={canReorder}
                    onDragStart={(e) => {
                      if (!canReorder) return;
                      dragIdRef.current = row.id;
                      setDragId(row.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", row.id);
                    }}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => {
                      if (!canReorder || !dragIdRef.current) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overId !== row.id) setOverId(row.id);
                    }}
                    onDrop={(e) => {
                      if (!canReorder) return;
                      e.preventDefault();
                      const from =
                        dragIdRef.current || e.dataTransfer.getData("text/plain");
                      setOverId(null);
                      setDragId(null);
                      dragIdRef.current = null;
                      if (from) void commitReorder(from, row.id);
                    }}
                    className={cn(
                      "border-b border-slate-100/80 transition-colors",
                      rowToneClass(status),
                      isDragging && "opacity-50",
                      isOver && "ring-2 ring-inset ring-emerald-400"
                    )}
                  >
                    {canWrite && onReorderRows ? (
                      <td className="w-7 px-0.5 py-1 align-middle">
                        <button
                          type="button"
                          disabled={!canReorder || busy}
                          className={cn(
                            "flex h-6 w-6 cursor-grab items-center justify-center rounded text-slate-400 active:cursor-grabbing",
                            !canReorder && "cursor-not-allowed opacity-30"
                          )}
                          title={
                            canReorder
                              ? "Glisser pour réorganiser"
                              : "Désactive le tri colonne pour réorganiser"
                          }
                          onClick={(e) => e.preventDefault()}
                          aria-label="Déplacer la ligne"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    ) : null}
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          "px-1.5 py-1 align-middle",
                          columnMinWidthClass(col.field, kind)
                        )}
                      >
                        <CellEditor
                          column={col}
                          row={row}
                          disabled={!canWrite}
                          ibos={ibos}
                          banks={banks}
                          fullWidth={isFullNameColumn(col.field) || kind === "llcs"}
                          onCommit={(v) => commit(row.id, col.field, v)}
                        />
                      </td>
                    ))}
                    {canWrite ? (
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Supprimer ligne"
                          onClick={async () => {
                            if (!confirm("Supprimer cette ligne ?")) return;
                            try {
                              await onDeleteRow(row.id);
                              toast.success("Ligne supprimée");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Failed");
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      <div className="space-y-2">
        {(title || description) && !fullscreen ? (
          <div className="flex items-start justify-between gap-3">
            <div>
              {title ? (
                <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
              ) : null}
              {description ? (
                <p className="text-xs text-slate-500">{description}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {table}
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-6xl flex-col overflow-hidden p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle>{title} — éditeur complet</DialogTitle>
            <DialogDescription>
              Glisse les lignes (⋮⋮), ajoute colonnes & lignes, trie, filtre. Couleurs par
              statut. Sauvegarde auto.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">{table}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={addColOpen} onOpenChange={setAddColOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nouvelle colonne</DialogTitle>
            <DialogDescription>Colonne libre sauvegardée sur cet onglet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Libellé</Label>
              <Input
                value={newColLabel}
                onChange={(e) => setNewColLabel(e.target.value)}
                placeholder="Ex. Notes, Date…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={newColType}
                onValueChange={(v) => setNewColType(v as EcosystemColumnType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texte</SelectItem>
                  <SelectItem value="number">Nombre</SelectItem>
                  <SelectItem value="status">Statut</SelectItem>
                  <SelectItem value="boolean">Oui / Non</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={busy || !newColLabel.trim()}
              onClick={handleAddColumn}
            >
              Ajouter
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CellEditor({
  column,
  row,
  disabled,
  ibos,
  banks,
  fullWidth,
  onCommit,
}: {
  column: EcosystemColumn;
  row: EcosystemRow;
  disabled: boolean;
  ibos: Ibo[];
  banks: Bank[];
  fullWidth?: boolean;
  onCommit: (value: string | number | boolean | null) => void;
}) {
  const value = getCellValue(row, column);

  if (column.type === "boolean") {
    const checked = value === "true" || value === "1";
    return (
      <Switch checked={checked} disabled={disabled} onCheckedChange={(v) => onCommit(v)} />
    );
  }

  if (column.type === "status") {
    const tone =
      value === "active" || value === "backup"
        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
        : value === "opening" || value === "underwriting"
          ? "border-orange-300 bg-orange-100 text-orange-900"
          : value === "declined" || value === "closed" || value === "restricted"
            ? "border-rose-300 bg-rose-100 text-rose-900"
            : "border-slate-200 bg-white/70 text-slate-700";
    return (
      <Select
        disabled={disabled}
        value={value || "opening"}
        onValueChange={(v) => onCommit(v)}
      >
        <SelectTrigger className={cn("h-6 min-w-[90px] px-1.5 text-[10px] shadow-none", tone)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-[11px]">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (column.type === "ibo_ref") {
    return (
      <Select
        disabled={disabled}
        value={value || "none"}
        onValueChange={(v) => onCommit(v === "none" ? null : v)}
      >
        <SelectTrigger className="h-7 min-w-[160px] max-w-none border-transparent bg-white/70 px-1.5 text-[10px] shadow-none [&>span]:whitespace-normal [&>span]:line-clamp-none">
          <SelectValue placeholder="IBO" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" className="text-[11px]">
            —
          </SelectItem>
          {ibos.map((i) => (
            <SelectItem key={i.id} value={i.id} className="text-[11px]">
              {i.display_name || i.reference_code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (column.type === "bank_ref") {
    return (
      <Select
        disabled={disabled}
        value={value || "none"}
        onValueChange={(v) => onCommit(v === "none" ? null : v)}
      >
        <SelectTrigger className="h-7 min-w-[140px] border-transparent bg-white/70 px-1.5 text-[10px] shadow-none">
          <SelectValue placeholder="Bank" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" className="text-[11px]">
            —
          </SelectItem>
          {banks.map((b) => (
            <SelectItem key={b.id} value={b.id} className="text-[11px]">
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // LLC names & long labels: full text, wrap, never crop
  if (column.type !== "number" && (fullWidth || isFullNameColumn(column.field))) {
    const lines = Math.min(4, Math.max(1, Math.ceil((value.length || 1) / 36)));
    return (
      <Textarea
        disabled={disabled}
        title={value}
        rows={lines}
        className="min-h-7 w-full min-w-[240px] resize-y border-transparent bg-white/70 px-1.5 py-1 text-[10px] leading-snug shadow-none focus-visible:border-emerald-300 dark:bg-slate-950/50"
        defaultValue={value}
        key={`${row.id}-${column.field}-${value}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === value) return;
          onCommit(raw === "" ? null : raw);
        }}
      />
    );
  }

  return (
    <Input
      disabled={disabled}
      type={column.type === "number" ? "number" : "text"}
      title={value}
      className="h-6 min-w-[64px] border-transparent bg-white/70 px-1.5 text-[10px] leading-none shadow-none focus-visible:border-emerald-300 dark:bg-slate-950/50"
      defaultValue={value}
      key={`${row.id}-${column.field}-${value}`}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === value) return;
        if (column.type === "number") {
          onCommit(raw === "" ? null : Number(raw));
        } else {
          onCommit(raw === "" ? null : raw);
        }
      }}
    />
  );
}

export type { EcosystemRow, Llc, Mid };
