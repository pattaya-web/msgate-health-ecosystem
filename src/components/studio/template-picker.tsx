"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";
import { CREATIVE_CATEGORIES, CREATIVE_TYPES, buildCreativePrompt, type ProductCategory } from "@/lib/studio/creative-types";
import { isDigitalClass, productKeyPoints, productPriceLabel, type ProductContext } from "@/lib/creative-engine/types";
import { cn } from "@/lib/utils";

/**
 * Les templates de prompt de Static : un format de créa (prix en avant,
 * avant/après, avis client…) que le constructeur du studio adapte au produit
 * choisi, sans IA. Les templates sont ceux du catalogue `CREATIVE_TYPES` ;
 * en ajouter un, c'est y ajouter une entrée.
 */

const PAGE_SIZE = 6;

export function TemplatePicker({ value, onChange, disabled = false }: { value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const templates = useMemo(() => CREATIVE_TYPES.filter((type) => type.enabled), []);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((type) => !needle || `${type.name} ${type.description} ${type.category}`.toLowerCase().includes(needle));
  }, [templates, query]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // La page se borne au rendu : une recherche qui réduit la liste ne laisse pas sur une page vide.
  const current = Math.min(page, pages - 1);
  const slice = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const categoryLabel = (id: string) => CREATIVE_CATEGORIES.find((entry) => entry.id === id)?.label ?? id;

  return (
    <div className={cn(disabled && "pointer-events-none opacity-50")} data-template-picker>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10.5px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {value ? "1" : "0"} / {templates.length} templates
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
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {slice.map((type) => {
          const selected = type.id === value;
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onChange(type.id)}
              aria-pressed={selected}
              className={cn(
                "rounded-xl border p-2.5 text-left transition-colors",
                selected ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
              )}
              data-template-option={type.id}
            >
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Sparkles className="h-2.5 w-2.5" /> GPT Image 2</span>
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{categoryLabel(type.category)}</span>
              </div>
              <div className="text-[12.5px] font-semibold uppercase tracking-wide text-slate-900 dark:text-slate-100">{type.name}</div>
              <div className="truncate text-[11px] text-slate-500">{type.description}</div>
            </button>
          );
        })}
      </div>
      {!slice.length ? <p className="px-1 py-3 text-[11.5px] text-slate-500">Aucun template ne correspond.</p> : null}
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
    </div>
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
export function templatePrompt(product: ProductContext, templateId: string, seed: number): string {
  const type = CREATIVE_TYPES.find((entry) => entry.id === templateId);
  if (!type) return "";
  const comparePrice = product.comparePrice?.trim() || product.analysis?.comparePrice?.trim() || undefined;
  return buildCreativePrompt({
    creativeType: type,
    angleIds: [],
    visualElementIds: type.defaultVisualElements,
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
}
