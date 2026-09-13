"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckSquare, ChevronDown, Copy, Download, Loader2, Maximize2, Pencil, RefreshCw, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SendToDrive } from "@/components/drive/send-to-drive";
import { CREATIVE_STATUSES, EMPHASES, summarize, type BatchItem, type CreativeStatus, type TestBatch } from "@/lib/creative-engine/types";
import { chip, enginePost, itemImageUrl, panel } from "@/components/mass-test/engine-client";
import { cn } from "@/lib/utils";

/**
 * Le tableau de bord des tests : BOUTIQUE → PRODUIT → LOT → ANGLE → VARIANTES.
 *
 * Chaque niveau se replie. Un lot en cours se rafraîchit seul ; chaque carte
 * porte son nom propre, son preset, sa variante, son statut et son prompt.
 */

const STATUS_TONE: Record<CreativeStatus, string> = {
  generated: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  ready: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  testing: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  potential: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  winner: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  loser: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  archived: "bg-slate-100 text-slate-400 dark:bg-slate-800",
};

function pad(number: number) {
  return `#${String(number).padStart(3, "0")}`;
}

export function BatchDashboard({ batches, onChange, focusBatchId }: { batches: TestBatch[]; onChange: (next: TestBatch[]) => void; focusBatchId?: string | null }) {
  const [openStores, setOpenStores] = useState<Set<string>>(new Set());
  const [openBatches, setOpenBatches] = useState<Set<string>>(new Set(focusBatchId ? [focusBatchId] : []));
  const [preview, setPreview] = useState<{ batch: TestBatch; item: BatchItem } | null>(null);
  const [statusFilter, setStatusFilter] = useState<CreativeStatus | "all">("all");
  const [retrying, setRetrying] = useState<string | null>(null);
  /* Sélection multiple : des créas de plusieurs lots peuvent partir ensemble vers un dossier. */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportBatch(batch: TestBatch, folder: string, itemIds: string[] | null) {
    const body = await enginePost<{ sent: number; skipped: number }>({ action: "drive-export", batchId: batch.id, folder, itemIds });
    return body;
  }

  /** Envoie la sélection, lot par lot, vers le dossier choisi. */
  async function exportSelection(folder: string) {
    let sent = 0;
    let skipped = 0;
    for (const batch of batches) {
      const ids = batch.items.filter((item) => selected.has(item.id)).map((item) => item.id);
      if (!ids.length) continue;
      const result = await exportBatch(batch, folder, ids);
      sent += result.sent;
      skipped += result.skipped;
    }
    setSelected(new Set());
    return `${sent} créa(s) envoyée(s) dans ${folder ? `« ${folder.split("/").pop()} »` : "le Drive"}${skipped ? ` · ${skipped} pas encore générée(s)` : ""}`;
  }

  /* Les lots en attente se rafraîchissent seuls, sans bouton à marteler. */
  const pendingIds = useMemo(() => batches.filter((batch) => batch.items.some((item) => item.state === "pending" && item.taskId)).map((batch) => batch.id), [batches]);
  useEffect(() => {
    if (!pendingIds.length) return;
    let stopped = false;
    const tick = async () => {
      for (const id of pendingIds) {
        try {
          const body = await enginePost<{ batch: TestBatch }>({ action: "refresh", batchId: id });
          if (stopped) return;
          onChange(batches.map((batch) => (batch.id === id ? body.batch : batch)));
        } catch {
          // prochain passage
        }
      }
    };
    const timer = setTimeout(tick, 6000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pendingIds, batches, onChange]);

  useEffect(() => {
    if (!focusBatchId) return;
    const batch = batches.find((item) => item.id === focusBatchId);
    if (!batch) return;
    const timer = setTimeout(() => {
      setOpenBatches((current) => new Set(current).add(focusBatchId));
      setOpenStores((current) => new Set(current).add(batch.store));
    }, 0);
    return () => clearTimeout(timer);
  }, [focusBatchId, batches]);

  const tree = useMemo(() => {
    const stores = new Map<string, Map<string, TestBatch[]>>();
    for (const batch of batches) {
      const products = stores.get(batch.store) ?? new Map<string, TestBatch[]>();
      products.set(batch.productName, [...(products.get(batch.productName) ?? []), batch]);
      stores.set(batch.store, products);
    }
    return stores;
  }, [batches]);

  async function setStatus(batch: TestBatch, item: BatchItem, status: CreativeStatus) {
    try {
      await enginePost({ action: "status", batchId: batch.id, itemId: item.id, status });
      onChange(batches.map((entry) => (entry.id === batch.id ? { ...entry, items: entry.items.map((it) => (it.id === item.id ? { ...it, status } : it)) } : entry)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Statut impossible");
    }
  }

  async function retry(batch: TestBatch) {
    setRetrying(batch.id);
    try {
      const body = await enginePost<{ batch: TestBatch; relaunched: number }>({ action: "retry", batchId: batch.id });
      onChange(batches.map((entry) => (entry.id === batch.id ? body.batch : entry)));
      toast.success(`${body.relaunched} créa(s) relancée(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Relance impossible");
    } finally {
      setRetrying(null);
    }
  }

  async function regenerate(batch: TestBatch, item: BatchItem, prompt?: string) {
    if (!window.confirm(prompt ? "Régénérer cette créa avec le prompt modifié ? (1 rendu Kie)" : "Régénérer cette créa ? (1 rendu Kie)")) return;
    try {
      const body = await enginePost<{ item: BatchItem }>({ action: "item-regenerate", batchId: batch.id, itemId: item.id, prompt });
      onChange(batches.map((entry) => (entry.id === batch.id ? { ...entry, items: entry.items.map((it) => (it.id === item.id ? body.item : it)) } : entry)));
      setPreview(null);
      toast.success("Créa relancée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Régénération impossible");
    }
  }

  async function duplicate(batch: TestBatch, item: BatchItem) {
    if (!window.confirm("Dupliquer cette créa et la générer à nouveau ? (1 rendu Kie)")) return;
    try {
      const body = await enginePost<{ item: BatchItem }>({ action: "item-duplicate", batchId: batch.id, itemId: item.id });
      onChange(
        batches.map((entry) => {
          if (entry.id !== batch.id) return entry;
          const at = entry.items.findIndex((it) => it.id === item.id);
          const items = [...entry.items];
          items.splice(at + 1, 0, body.item);
          return { ...entry, items };
        })
      );
      setPreview(null);
      toast.success("Copie lancée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Duplication impossible");
    }
  }

  async function remove(batch: TestBatch) {
    if (!window.confirm(`Supprimer le lot ${pad(batch.number)} et ses ${batch.items.length} créas ?`)) return;
    try {
      await enginePost({ action: "batch-delete", batchId: batch.id });
      onChange(batches.filter((entry) => entry.id !== batch.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  if (!batches.length) {
    return <section className={cn(panel, "text-[12px] text-slate-500")}>Aucun lot encore. Lance un premier test depuis « Nouveau test ».</section>;
  }

  return (
    <div className="space-y-3">
      {selected.size ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-[12px] text-white shadow-lg dark:bg-white dark:text-slate-900">
          <CheckSquare className="h-4 w-4" />
          <span className="font-semibold">{selected.size} créa{selected.size > 1 ? "s" : ""} sélectionnée{selected.size > 1 ? "s" : ""}</span>
          <SendToDrive send={exportSelection} label="Envoyer la sélection au Drive" className="[&>button]:bg-white [&>button]:text-slate-900 dark:[&>button]:bg-slate-900 dark:[&>button]:text-white" />
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[11px] underline-offset-2 hover:underline">
            Tout désélectionner
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Filtrer</span>
        <button type="button" onClick={() => setStatusFilter("all")} className={chip(statusFilter === "all")}>
          Tous
        </button>
        {CREATIVE_STATUSES.map((status) => (
          <button key={status.id} type="button" onClick={() => setStatusFilter(status.id)} className={chip(statusFilter === status.id)}>
            {status.label}
          </button>
        ))}
      </div>

      {[...tree.entries()].map(([store, products]) => {
        const storeOpen = openStores.has(store) || tree.size === 1;
        const storeBatches = [...products.values()].flat();
        const storeTotal = storeBatches.reduce((total, batch) => total + batch.items.length, 0);
        return (
          <section key={store} className={panel}>
            <button
              type="button"
              onClick={() =>
                setOpenStores((current) => {
                  const next = new Set(current);
                  if (next.has(store)) next.delete(store);
                  else next.add(store);
                  return next;
                })
              }
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{store}</span>
              <span className="text-[11px] text-slate-500">
                {products.size} produit{products.size > 1 ? "s" : ""} · {storeBatches.length} lot{storeBatches.length > 1 ? "s" : ""} · {storeTotal} créas
                <ChevronDown className={cn("ml-2 inline h-3.5 w-3.5 transition-transform", storeOpen && "rotate-180")} />
              </span>
            </button>

            {storeOpen
              ? [...products.entries()].map(([productName, productBatches]) => (
                  <div key={productName} className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="mb-2 text-[12px] font-semibold text-slate-800 dark:text-slate-100">{productName}</div>
                    <div className="space-y-2">
                      {productBatches.map((batch) => {
                        const open = openBatches.has(batch.id);
                        const sum = summarize(batch);
                        const angles = [...new Map(batch.items.map((item) => [item.angleId, item.angleName])).entries()];
                        return (
                          <div key={batch.id} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenBatches((current) => {
                                    const next = new Set(current);
                                    if (next.has(batch.id)) next.delete(batch.id);
                                    else next.add(batch.id);
                                    return next;
                                  })
                                }
                                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-900 dark:text-slate-100"
                              >
                                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                                Lot {pad(batch.number)}
                              </button>
                              <span className="text-[11px] text-slate-500">{new Date(batch.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                              <span className="text-[11px] text-slate-500">
                                {angles.length} angle{angles.length > 1 ? "s" : ""} × {batch.variationsPerAngle} = <strong className="text-slate-800 dark:text-slate-100">{sum.total}</strong>
                              </span>
                              <span className="text-[11px] text-slate-500" title={`Transformation ${batch.plan.groups.transformation} · Détail ${batch.plan.groups.feature} · Social ${batch.plan.groups.social} · Produit ${batch.plan.groups.product}`}>
                                {EMPHASES.find((entry) => entry.id === batch.emphasis)?.label}
                                {batch.plan.families.length ? ` · ${batch.plan.families.length} mécanismes` : ""}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                générées <strong className={sum.generated === sum.total ? "text-emerald-600" : "text-slate-800 dark:text-slate-100"}>{sum.generated}/{sum.total}</strong>
                                {sum.failed ? <span className="text-rose-600"> · {sum.failed} échec(s)</span> : null}
                              </span>
                              {(["ready", "testing", "winner", "loser"] as const).map((status) =>
                                sum.byStatus[status] ? (
                                  <span key={status} className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", STATUS_TONE[status])}>
                                    {sum.byStatus[status]} {CREATIVE_STATUSES.find((entry) => entry.id === status)?.label.toLowerCase()}
                                  </span>
                                ) : null
                              )}
                              <span className="ml-auto flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const ids = batch.items.filter((item) => item.state === "done").map((item) => item.id);
                                    const allIn = ids.every((id) => selected.has(id));
                                    setSelected((current) => {
                                      const next = new Set(current);
                                      for (const id of ids) {
                                        if (allIn) next.delete(id);
                                        else next.add(id);
                                      }
                                      return next;
                                    });
                                  }}
                                  title="Sélectionner toutes les créas générées du lot"
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-white hover:text-slate-800 dark:hover:bg-slate-900"
                                >
                                  <CheckSquare className="h-3.5 w-3.5" />
                                  Tout sélectionner
                                </button>
                                <SendToDrive
                                  send={async (folder) => {
                                    const result = await exportBatch(batch, folder, null);
                                    return `Lot ${pad(batch.number)} : ${result.sent} créa(s) envoyée(s)${result.skipped ? `, ${result.skipped} pas encore générée(s)` : ""}`;
                                  }}
                                  label="Lot → Drive"
                                  disabled={sum.generated === 0}
                                />
                                {sum.failed ? (
                                  <Button size="sm" variant="outline" onClick={() => void retry(batch)} disabled={retrying === batch.id}>
                                    {retrying === batch.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                    Relancer les échecs
                                  </Button>
                                ) : null}
                                <button type="button" onClick={() => void remove(batch)} title="Supprimer le lot" className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            </div>

                            {open
                              ? angles.map(([angleId, angleName], index) => {
                                  const items = batch.items.filter((item) => item.angleId === angleId && (statusFilter === "all" || item.status === statusFilter));
                                  if (!items.length) return null;
                                  return (
                                    <div key={angleId} className="mt-2.5">
                                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                        Angle {String(index + 1).padStart(2, "0")} — {angleName}
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {items.map((item) => (
                                          <CreativeCard
                                            key={item.id}
                                            batch={batch}
                                            item={item}
                                            selected={selected.has(item.id)}
                                            onSelect={() => toggleSelected(item.id)}
                                            onOpen={() => setPreview({ batch, item })}
                                            onStatus={(status) => void setStatus(batch, item, status)}
                                            onRegenerate={() => void regenerate(batch, item)}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })
                              : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              : null}
          </section>
        );
      })}

      {preview ? (
        <PreviewDialog
          batch={preview.batch}
          item={preview.item}
          onClose={() => setPreview(null)}
          onStatus={(status) => void setStatus(preview.batch, preview.item, status)}
          onRegenerate={(prompt) => void regenerate(preview.batch, preview.item, prompt)}
          onDuplicate={() => void duplicate(preview.batch, preview.item)}
        />
      ) : null}
    </div>
  );
}

function imageOf(batch: TestBatch, item: BatchItem) {
  if (item.file) return itemImageUrl(batch.id, item.file, item.name);
  return item.urls[0] ?? null;
}

function CreativeCard({
  batch,
  item,
  selected,
  onSelect,
  onOpen,
  onStatus,
  onRegenerate,
}: {
  batch: TestBatch;
  item: BatchItem;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onStatus: (status: CreativeStatus) => void;
  onRegenerate: () => void;
}) {
  const src = item.state === "done" ? imageOf(batch, item) : null;
  const emphasisLabel = EMPHASES.find((entry) => entry.id === item.emphasis)?.label ?? "";
  return (
    <div className="w-[150px]">
      <div className={cn("relative aspect-[3/4] overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800", selected && "ring-2 ring-emerald-500")}>
        {src ? (
          <>
            <button type="button" onClick={onOpen} className="h-full w-full" title="Agrandir">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
            <button
              type="button"
              onClick={onSelect}
              title={selected ? "Retirer de la sélection" : "Sélectionner"}
              className={cn("absolute left-1 top-1 rounded-md p-1 text-white", selected ? "bg-emerald-600" : "bg-slate-950/60 opacity-70 hover:opacity-100")}
            >
              {selected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            </button>
            <span className="absolute left-1 bottom-1 rounded bg-slate-950/70 px-1 text-[9px] font-semibold text-white">V{String(item.variation).padStart(2, "0")}</span>
            <button type="button" onClick={onOpen} className="absolute right-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 hover:opacity-100" title="Agrandir">
              <Maximize2 className="h-3 w-3" />
            </button>
          </>
        ) : item.state === "fail" ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
            <X className="h-4 w-4 text-rose-500" />
            <span className="text-[9px] leading-tight text-rose-600">{item.error}</span>
            <button type="button" onClick={onRegenerate} className="mt-1 rounded-md bg-slate-900 px-2 py-0.5 text-[9px] font-semibold text-white dark:bg-white dark:text-slate-900">
              Relancer
            </button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </div>
        )}
      </div>
      <div className="mt-1 truncate text-[10px] font-medium text-slate-700 dark:text-slate-200" title={item.name}>
        {item.name}
      </div>
      <div className="truncate text-[10px] text-slate-500" title={`${item.angleName} · ${item.familyLabel} · ${emphasisLabel} · ${item.presetName}`}>
        {item.familyLabel} · {emphasisLabel}
      </div>
      <select value={item.status} onChange={(event) => onStatus(event.target.value as CreativeStatus)} className={cn("mt-1 w-full rounded-md border-0 px-1.5 py-0.5 text-[10px] font-medium", STATUS_TONE[item.status])}>
        {CREATIVE_STATUSES.map((status) => (
          <option key={status.id} value={status.id}>
            {status.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PreviewDialog({
  batch,
  item,
  onClose,
  onStatus,
  onRegenerate,
  onDuplicate,
}: {
  batch: TestBatch;
  item: BatchItem;
  onClose: () => void;
  onStatus: (status: CreativeStatus) => void;
  onRegenerate: (prompt?: string) => void;
  onDuplicate: () => void;
}) {
  const src = imageOf(batch, item);
  const section = "mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.prompt);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 md:flex-row" onClick={(event) => event.stopPropagation()}>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="max-h-[85vh] w-auto max-w-full object-contain" />
          ) : (
            <div className="p-10 text-[12px] text-slate-300">{item.error ?? "En cours…"}</div>
          )}
        </div>
        <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto p-4 md:w-[340px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-all text-[12px] font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
              <div className="text-[11px] text-slate-500">
                {batch.store} · {batch.productName} · Lot {pad(batch.number)}
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
            {[
              ["Angle", item.angleName],
              ["Mécanisme", item.familyLabel],
              ["Style", item.presetName],
              ["Emphase", EMPHASES.find((entry) => entry.id === item.emphasis)?.label ?? ""],
              ["Variante", `V${String(item.variation).padStart(2, "0")} · ${item.strategy}`],
              ["Produit visible", item.productVisibility],
              ["Généré le", item.generatedAt ? new Date(item.generatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—"],
              ["Référence", item.referenceUsed ? `oui · ${batch.referenceStrength}` : "non"],
              ["Modèle", item.model],
              ["Format", `${batch.ratio} · ${batch.resolution}`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
                <dd className="text-slate-700 dark:text-slate-200">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <div className={section}>Statut</div>
            <div className="flex flex-wrap gap-1">
              {CREATIVE_STATUSES.map((status) => (
                <button key={status.id} type="button" onClick={() => onStatus(status.id)} className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-transparent", STATUS_TONE[status.id], item.status === status.id && "ring-slate-900 dark:ring-white")}>
                  {status.label}
                </button>
              ))}
            </div>
          </div>

          {item.hook ? (
            <div>
              <div className={section}>Accroche · concept</div>
              <p className="text-[12px] font-medium text-slate-900 dark:text-slate-100">« {item.hook} »</p>
              {item.visualConcept ? <p className="text-[11px] text-slate-500">{item.visualConcept}</p> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {src ? (
              <>
                <a href={item.file ? itemImageUrl(batch.id, item.file, item.name, true) : src} download={`${item.name}.png`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
                  <Download className="h-3.5 w-3.5" />
                  Télécharger
                </a>
                <SendToDrive url={src} name={`${item.name}.png`} />
              </>
            ) : null}
            <button type="button" onClick={() => onRegenerate()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
              <RefreshCw className="h-3.5 w-3.5" />
              Régénérer
            </button>
            <button type="button" onClick={onDuplicate} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
              <Copy className="h-3.5 w-3.5" />
              Dupliquer
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className={section}>Prompt utilisé</div>
              <button type="button" onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline">
                <Pencil className="h-3 w-3" />
                {editing ? "Fermer" : "Modifier"}
              </button>
            </div>
            {editing ? (
              <>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={12} className="w-full rounded-lg border border-slate-200 p-2 text-[11px] leading-relaxed dark:border-slate-700 dark:bg-slate-950" />
                <button type="button" onClick={() => onRegenerate(draft)} className="mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Régénérer avec ce prompt
                </button>
              </>
            ) : (
              <p className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">{item.prompt}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
