"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildCreativePrompt, type ProductCategory } from "@/lib/studio/creative-types";
import { NO_LOGO_RULE, TEMPLATE_CATEGORIES, templateToCreativeType, type PromptTemplate, type PromptTemplateInput } from "@/lib/studio/template-types";
import { isDigitalClass, productKeyPoints, productPriceLabel, type ProductContext } from "@/lib/creative-engine/types";
import { cn } from "@/lib/utils";

/**
 * Les templates de prompt de Static : une grille de formats (prix en avant,
 * avant/après, avis client…), une recherche, des pages de six, et l'édition
 * sur place : un template s'ajoute, se modifie et se supprime ici.
 */

const PAGE_SIZE = 6;

export function TemplatePicker({ templates, value, onChange, onCreate, onUpdate, onDelete, disabled = false }: { templates: PromptTemplate[] | null; value: string | null; onChange: (id: string) => void; onCreate: (input: PromptTemplateInput) => Promise<void>; onUpdate: (id: string, input: PromptTemplateInput) => Promise<void>; onDelete: (id: string) => Promise<void>; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<PromptTemplate | "new" | null>(null);
  const [deleting, setDeleting] = useState<PromptTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => templates ?? [], [templates]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.filter((type) => !needle || `${type.name} ${type.description} ${type.category}`.toLowerCase().includes(needle));
  }, [list, query]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // La page se borne au rendu : une recherche qui réduit la liste ne laisse pas sur une page vide.
  const current = Math.min(page, pages - 1);
  const slice = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const categoryLabel = (id: string) => TEMPLATE_CATEGORIES.find((entry) => entry.id === id)?.label ?? id;

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await onDelete(deleting.id);
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-template-picker>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10.5px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {value ? "1" : "0"} / {list.length} templates
        </span>
        <div className="relative ml-auto min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Rechercher un template…"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-[11.5px] dark:border-slate-700 dark:bg-slate-950"
            data-template-search
          />
        </div>
        <button type="button" onClick={() => setEditing("new")} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[11.5px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900" data-template-new>
          <Plus className="h-3 w-3" /> Nouveau template
        </button>
      </div>
      {templates === null ? (
        <div className="flex items-center gap-1.5 py-4 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des templates…</div>
      ) : (
        <div className={cn("grid gap-2 sm:grid-cols-2", disabled && "pointer-events-none opacity-50")}>
          {slice.map((type) => {
            const selected = type.id === value;
            return (
              <div
                key={type.id}
                className={cn(
                  "group relative rounded-xl border transition-colors",
                  selected ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                )}
                data-template-option={type.id}
              >
                <button type="button" onClick={() => onChange(type.id)} aria-pressed={selected} className="w-full p-2.5 pr-16 text-left">
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Sparkles className="h-2.5 w-2.5" /> GPT Image 2</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{categoryLabel(type.category)}</span>
                    {type.noLogo ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">sans logo</span> : null}
                  </div>
                  <div className="text-[12.5px] font-semibold uppercase tracking-wide text-slate-900 dark:text-slate-100">{type.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{type.description || type.prompt.slice(0, 80)}</div>
                </button>
                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" onClick={() => setEditing(type)} className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-slate-900 dark:hover:text-slate-100" aria-label={`Modifier ${type.name}`} data-template-edit>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => setDeleting(type)} className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-rose-600 dark:hover:bg-slate-900" aria-label={`Supprimer ${type.name}`} data-template-delete>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {templates && !slice.length ? <p className="px-1 py-3 text-[11.5px] text-slate-500">{list.length ? "Aucun template ne correspond." : "Aucun template : crée le premier."}</p> : null}
      {visible.length > PAGE_SIZE ? (
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            {current * PAGE_SIZE + 1}–{Math.min(visible.length, (current + 1) * PAGE_SIZE)} sur {visible.length}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0} className="rounded-md border border-slate-200 p-1 disabled:opacity-40 dark:border-slate-700" aria-label="Page précédente"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="px-1 font-mono">{current + 1} / {pages}</span>
            <button type="button" onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1} className="rounded-md border border-slate-200 p-1 disabled:opacity-40 dark:border-slate-700" aria-label="Page suivante"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await onCreate(input);
            else await onUpdate(editing.id, input);
            setEditing(null);
          }}
        />
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="dark:text-slate-100">Supprimer ce template ?</DialogTitle>
            <DialogDescription>« {deleting?.name} » disparaît de la liste. Les créas déjà générées ne bougent pas.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="h-9 rounded-xl px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Annuler</button>
            <button type="button" onClick={() => void confirmDelete()} disabled={busy} className="h-9 rounded-xl bg-rose-600 px-3 text-[12px] font-semibold text-white hover:bg-rose-500 disabled:opacity-60" data-template-delete-confirm>Supprimer</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** La fiche d'un template : nom, catégorie, description, consigne, logo ou pas. */
function TemplateEditor({ template, onClose, onSave }: { template: PromptTemplate | null; onClose: () => void; onSave: (input: PromptTemplateInput) => Promise<void> }) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState<PromptTemplateInput["category"]>(template?.category ?? "performance");
  const [prompt, setPrompt] = useState(template?.prompt ?? "");
  const [noLogo, setNoLogo] = useState(template?.noLogo ?? true);
  const [saving, setSaving] = useState(false);
  const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
  const label = "mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-200";

  async function save() {
    if (!name.trim()) return toast.error("Donne un nom au template");
    if (!prompt.trim()) return toast.error("Écris la consigne du template");
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), category, prompt: prompt.trim(), noLogo });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-5 dark:border-slate-800 dark:bg-slate-900" data-template-editor>
        <DialogHeader>
          <DialogTitle className="dark:text-slate-100">{template ? "Modifier le template" : "Nouveau template"}</DialogTitle>
          <DialogDescription>Le format d&apos;une créa. Les faits du produit (nom, prix, points clés) sont ajoutés automatiquement : la consigne décrit la mise en scène, la hiérarchie et le ton.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label className={label} htmlFor="tpl-name">Nom</label>
              <input id="tpl-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Split background punchy price" className={field} data-template-name />
            </div>
            <div>
              <label className={label} htmlFor="tpl-category">Catégorie</label>
              <select id="tpl-category" value={category} onChange={(event) => setCategory(event.target.value as PromptTemplateInput["category"])} className={field}>
                {TEMPLATE_CATEGORIES.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="tpl-description">Description courte</label>
            <input id="tpl-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Le prix domine l'image" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="tpl-prompt">Consigne du template</label>
            <textarea id="tpl-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} placeholder="Build the creative around the price: set it large and unmissable, the compare-at price struck through beside it. Product centred on a split background…" className={cn(field, "resize-y leading-relaxed")} data-template-prompt />
          </div>
          <label className="flex items-start gap-2 text-[12px] text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={noLogo} onChange={(event) => setNoLogo(event.target.checked)} className="mt-0.5" data-template-nologo />
            <span>
              <span className="font-semibold">Sans logo</span>
              <span className="block text-[11px] text-slate-500">Aucun logo, marque ni filigrane sur la créa, même s&apos;il figure sur la photo du produit.</span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Annuler</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-[12px] font-semibold text-white hover:bg-sky-500 disabled:opacity-60" data-template-save>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {template ? "Enregistrer" : "Créer le template"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** La catégorie du constructeur de prompts, devinée depuis l'analyse de la page (sinon générale). */
function guessCategory(product: ProductContext): ProductCategory {
  const text = `${product.analysis?.category ?? ""} ${product.analysis?.productType ?? ""}`.toLowerCase();
  if (isDigitalClass(product.analysis?.productClass) || /digital|ebook|logiciel|software|formation|course|app\b/.test(text)) return "digital";
  if (/mode|fashion|vêt|vet|robe|lingerie|chauss|apparel/.test(text)) return "fashion";
  if (/beaut|skin|cosm|soin|peau|hair|cheveu/.test(text)) return "beauty";
  if (/gadget|tech|électron|electron|device/.test(text)) return "gadget";
  if (/maison|déco|deco|home|furnit|meuble|cuisine/.test(text)) return "home";
  if (/fitness|sport|muscu|gym/.test(text)) return "fitness";
  if (/santé|sante|health|minceur|patch|complément|supplement|wellness/.test(text)) return "health";
  if (/bijou|jewel/.test(text)) return "jewelry";
  if (/animal|pet|chien|chat\b|dog|cat\b/.test(text)) return "pet";
  return "general";
}

/** Le prompt complet d'un template pour un produit du catalogue : même graine, même prompt ; nouvelle graine, nouvelle variation. */
export function templatePrompt(product: ProductContext, template: PromptTemplate, seed: number): string {
  const comparePrice = product.comparePrice?.trim() || product.analysis?.comparePrice?.trim() || undefined;
  const body = buildCreativePrompt({
    creativeType: templateToCreativeType(template),
    angleIds: [],
    visualElementIds: template.visualElements,
    productName: product.name,
    productCategory: guessCategory(product),
    productDescription: product.description?.trim() || product.analysis?.transformation || undefined,
    price: productPriceLabel(product) || undefined,
    comparePrice: comparePrice && product.currency && !/[€$£]/.test(comparePrice) ? `${comparePrice} ${product.currency}` : comparePrice,
    keyPoints: productKeyPoints(product),
    variation: seed % 7,
    autoMix: true,
    randomElements: true,
    seed,
  });
  return template.noLogo ? `${body}\n\n${NO_LOGO_RULE}` : body;
}
