"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Package, Search } from "lucide-react";
import { primaryReference, productPriceLabel, type ProductContext } from "@/lib/creative-engine/types";
import { imageSrc } from "@/lib/studio/client";
import { cn } from "@/lib/utils";

/**
 * Le choix du produit dans Static : une grille de cartes (photo, nom, prix),
 * une recherche et des pages de six. Le catalogue lui-même s'édite dans
 * « Produits » ; ici on ne fait que désigner celui qu'on vend.
 */

const PAGE_SIZE = 6;

export function ProductPicker({ products, activeId, onSelect }: { products: ProductContext[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => !needle || `${product.name} ${product.store}`.toLowerCase().includes(needle));
  }, [products, query]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // La page se borne au rendu : une recherche qui réduit la liste ne laisse pas sur une page vide.
  const current = Math.min(page, pages - 1);
  const slice = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div data-product-picker>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10.5px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {activeId ? "1" : "0"} / {products.length} produit{products.length > 1 ? "s" : ""}
        </span>
        <div className="relative ml-auto min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Rechercher un produit…"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-[11.5px] dark:border-slate-700 dark:bg-slate-950"
            data-product-picker-search
          />
        </div>
      </div>
      {!products.length ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[11.5px] text-slate-500 dark:border-slate-700">Aucun produit dans le catalogue : ajoute-en un dans « Produits ».</p>
      ) : !slice.length ? (
        <p className="px-1 py-3 text-[11.5px] text-slate-500">Aucun produit ne correspond.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {slice.map((product) => {
            const selected = product.id === activeId;
            const thumb = primaryReference(product)?.url ?? product.imageUrls[0] ?? null;
            const price = productPriceLabel(product);
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => onSelect(product.id)}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border p-2 text-left transition-colors",
                  selected ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                )}
                data-product-option={product.id}
              >
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-900/10 dark:bg-slate-800">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageSrc(thumb)} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400"><Package className="h-4 w-4" /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-slate-900 dark:text-slate-100">{product.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{price || product.store}</div>
                </div>
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", selected ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600")} aria-hidden>
                  {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
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
