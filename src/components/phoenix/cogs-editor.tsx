"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Package, Save } from "lucide-react";
import { toast } from "sonner";
import type { ProductCosts } from "@/lib/metrics/product-costs";
import { PanelTitle, Surface } from "@/components/phoenix/ui";

type CatalogProduct = { id: string; title: string; store: string; price: number | null; imageUrl: string | null };

const inputClass =
  "h-8 w-24 rounded-lg bg-white px-2 text-right text-[12px] tabular-nums text-slate-800 ring-1 ring-slate-900/[0.08] focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/[0.08]";

/**
 * Les coûts de revient de base, réglés par l'admin.
 *
 * Un coût par unité pour chaque produit physique des boutiques Reign, et un
 * coût par défaut pour ceux qui n'en ont pas. Le calculateur de profit (le
 * tien et celui de l'associé) multiplie ces coûts par les unités vendues.
 */
export function CogsEditor({ onSaved }: { onSaved?: () => void }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [saved, setSaved] = useState<ProductCosts | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [defaultCost, setDefaultCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/profit/costs", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as { costs?: ProductCosts; products?: CatalogProduct[]; error?: string | null };
        if (!alive) return;
        if (!res.ok || !body.costs) throw new Error(body.error || `HTTP ${res.status}`);
        setSaved(body.costs);
        setProducts(body.products ?? []);
        setDefaultCost(body.costs.defaultUnitCost ? String(body.costs.defaultUnitCost) : "");
        setDraft(Object.fromEntries(Object.entries(body.costs.products).map(([key, value]) => [key, String(value)])));
        setError(body.error ?? null);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "Coûts illisibles");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byStore = useMemo(() => {
    const groups = new Map<string, CatalogProduct[]>();
    for (const product of products) groups.set(product.store, [...(groups.get(product.store) ?? []), product]);
    return [...groups.entries()];
  }, [products]);

  const dirty =
    !!saved &&
    ((Number(defaultCost) || 0) !== saved.defaultUnitCost ||
      products.some((product) => (draft[product.id] ?? "") !== (saved.products[product.id] !== undefined ? String(saved.products[product.id]) : "")));

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, string | null> = {};
      for (const product of products) payload[product.id] = draft[product.id]?.trim() ? draft[product.id].trim() : null;
      const res = await fetch("/api/profit/costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultUnitCost: defaultCost.trim() || 0, products: payload }),
      });
      const body = (await res.json()) as { costs?: ProductCosts; error?: string };
      if (!res.ok || !body.costs) throw new Error(body.error || `HTTP ${res.status}`);
      setSaved(body.costs);
      toast.success("Coûts de revient enregistrés");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Surface plain className="p-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <PanelTitle accent="indigo">
          <span className="inline-flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" />
            Coûts de revient (COGS) par unité
          </span>
        </PanelTitle>
        <span className="text-[10px] text-slate-400">achat + envoi d&apos;une unité, en USD · sert aux deux calculateurs</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Enregistrer
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-[11px] text-slate-400">Chargement du catalogue…</p>
      ) : (
        <div className="space-y-3">
          {error ? <p className="text-[11px] text-amber-700 dark:text-amber-300">{error}</p> : null}
          <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/40">
            <span className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
              Coût par défaut
              <span className="ml-1.5 text-[10px] font-normal text-slate-400">pour un produit sans coût propre</span>
            </span>
            <span className="flex items-center gap-1 text-[12px] text-slate-400">
              $<input inputMode="decimal" value={defaultCost} onChange={(event) => setDefaultCost(event.target.value)} placeholder="0" className={inputClass} />
            </span>
          </label>
          {byStore.map(([store, items]) => (
            <div key={store}>
              <p className="eyebrow mb-1">{store}</p>
              <div className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
                {items.map((product) => (
                  <label key={product.id} className="flex items-center gap-3 py-1.5">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="h-8 w-8 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-slate-700 dark:text-slate-200">{product.title}</span>
                      <span className="text-[10px] text-slate-400">
                        {product.price != null ? `vendu dès $${product.price.toFixed(2)}` : "prix inconnu"}
                        {draft[product.id]?.trim() && product.price ? ` · marge brute ${Math.round((1 - Number(draft[product.id]) / product.price) * 100)} %` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-[12px] text-slate-400">
                      $
                      <input
                        inputMode="decimal"
                        value={draft[product.id] ?? ""}
                        onChange={(event) => setDraft((current) => ({ ...current, [product.id]: event.target.value }))}
                        placeholder={defaultCost || "0"}
                        className={inputClass}
                      />
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!products.length && !error ? <p className="text-[11px] text-slate-400">Aucun produit physique dans les boutiques Reign.</p> : null}
        </div>
      )}
    </Surface>
  );
}
