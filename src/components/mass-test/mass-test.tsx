"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublishHermesContext } from "@/components/ask-hermes/page-context";
import { FlaskConical, LayoutList } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-states";
import { BatchDashboard } from "@/components/mass-test/batch-dashboard";
import { engineGet } from "@/components/mass-test/engine-client";
import { ProductPanel } from "@/components/mass-test/product-panel";
import { TestBuilder } from "@/components/mass-test/test-builder";
import type { ProductContext, TestBatch } from "@/lib/creative-engine/types";
import { cn } from "@/lib/utils";

/**
 * Mass test : un produit, plusieurs angles, plusieurs presets, N variantes,
 * un clic. La génération unitaire du studio reste dans l'onglet Static ; ceci
 * est un second chemin, pour produire et tester en volume.
 */
export function MassTest() {
  const [products, setProducts] = useState<ProductContext[]>([]);
  const [batches, setBatches] = useState<TestBatch[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [view, setView] = useState<"new" | "batches">("new");
  const [focus, setFocus] = useState<string | null>(null);
  const [initialUrl, setInitialUrl] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const data = await engineGet();
      setProducts(data.products);
      setBatches(data.batches);
      setProductId((current) => current ?? data.products[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Moteur illisible");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  /* Arrivée depuis une fiche produit : /studio/mass-test?url=… pré-remplit l'analyse. */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("url");
    if (!wanted) return;
    const timer = setTimeout(() => setInitialUrl(wanted), 0);
    return () => clearTimeout(timer);
  }, []);

  const product = useMemo(() => products.find((item) => item.id === productId) ?? null, [products, productId]);
  usePublishHermesContext("mass-test", product ? { pageType: "product", storeName: product.store, productId: product.id, productName: product.name, productUrl: product.url } : null);

  return (
    <div>
      <PageHeader
        title="Mass test"
        description="Un test créatif complet en un clic : ton produit, ce que tu veux tester, combien de créas."
        actions={
          <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
            {(
              [
                ["new", "Nouveau test", FlaskConical],
                ["batches", `Tests (${batches.length})`, LayoutList],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                  view === id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500"
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        }
      />

      {view === "new" ? (
        <div className="space-y-10 pb-24 lg:pb-0">
          <ProductPanel products={products} selectedId={productId} onSelect={setProductId} onChanged={load} initialUrl={initialUrl} />
          <TestBuilder
            product={product}
            onProductChanged={load}
            onLaunched={(batch) => {
              setBatches((current) => [batch, ...current]);
              setFocus(batch.id);
              setView("batches");
            }}
          />
        </div>
      ) : (
        <BatchDashboard batches={batches} onChange={setBatches} focusBatchId={focus} />
      )}
    </div>
  );
}
