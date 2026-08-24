"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, Loader2, Search, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import { cn } from "@/lib/utils";

type Collection = { handle: string; title: string; products_count: number };

type ProductSummary = {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  variants: number;
  images: number;
  minPrice: number;
  maxPrice: number;
  image: string | null;
};

type ScrapeResult = {
  shop: string;
  products: ProductSummary[];
  totals: { products: number; variants: number; scanned: number };
  truncated: boolean;
};

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function ShopifyScraperPage() {
  const [shop, setShop] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState(false);

  const params = useMemo(() => {
    const search = new URLSearchParams({ shop });
    if (collection) search.set("collection", collection);
    if (min.trim()) search.set("min", min.trim());
    if (max.trim()) search.set("max", max.trim());
    return search;
  }, [shop, collection, min, max]);

  const loadCollections = useCallback(async () => {
    if (!shop.trim()) {
      toast.error("Renseigne l'URL de la boutique");
      return;
    }
    setLoadingCollections(true);
    try {
      const res = await fetch(`/api/shopify-scraper?shop=${encodeURIComponent(shop)}&action=collections`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setCollections(body.collections);
      toast.success(`${body.collections.length} collections trouvées`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Collections illisibles");
    } finally {
      setLoadingCollections(false);
    }
  }, [shop]);

  const scrape = useCallback(async () => {
    if (!shop.trim()) {
      toast.error("Renseigne l'URL de la boutique");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/shopify-scraper?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setResult(body as ScrapeResult);
      if (!body.products.length) toast.error("Aucun produit sur ces critères");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Boutique injoignable");
    } finally {
      setLoading(false);
    }
  }, [shop, params]);

  return (
    <div>
      <PageHeader
        title="Shopify scraper"
        description="Catalogue public d'une boutique Shopify, filtré par collection et par prix, exporté au format d'import Shopify."
        actions={
          result?.products.length ? (
            <Button size="sm" asChild>
              <a href={`/api/shopify-scraper/csv?${params}`}>
                <Download className="h-3.5 w-3.5" />
                CSV ({result.totals.variants} variantes)
              </a>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Store className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              className={cn(inputClass, "w-full pl-8")}
              placeholder="aecojoy.store"
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void scrape();
              }}
            />
          </div>

          <Button variant="outline" size="sm" onClick={loadCollections} disabled={loadingCollections}>
            {loadingCollections ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Collections
          </Button>

          <select
            className={cn(inputClass, "max-w-[260px]")}
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">Toute la boutique</option>
            {collections.map((item) => (
              <option key={item.handle} value={item.handle}>
                {item.title} ({item.products_count})
              </option>
            ))}
          </select>

          <input
            type="number"
            className={cn(inputClass, "w-[92px]")}
            placeholder="Prix min"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
          <input
            type="number"
            className={cn(inputClass, "w-[92px]")}
            placeholder="Prix max"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />

          <Button size="sm" onClick={scrape} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Récupérer
          </Button>
        </div>

        {collections.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            Charge les collections pour pouvoir filtrer, ou lance directement sur toute la boutique.
          </p>
        ) : null}
      </div>

      {result ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-slate-600 dark:text-slate-300">
            <span>
              <strong className="text-slate-900 dark:text-slate-100">{result.totals.products}</strong>{" "}
              produits
            </span>
            <span>
              <strong className="text-slate-900 dark:text-slate-100">{result.totals.variants}</strong>{" "}
              variantes
            </span>
            {result.totals.scanned !== result.totals.products ? (
              <span className="text-slate-500">
                sur {result.totals.scanned} scannés avant filtre prix
              </span>
            ) : null}
            {result.truncated ? (
              <span className="text-amber-600">catalogue plafonné à 5 000 produits</span>
            ) : null}
          </div>

          {result.products.length === 0 ? (
            <EmptyState
              title="Aucun produit"
              description="Élargis la fourchette de prix ou change de collection."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-900/[0.06] thin-scroll dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
              <table className="w-full min-w-[720px] text-[12px]">
                <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Produit</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 text-right font-semibold">Variantes</th>
                    <th className="px-3 py-2 text-right font-semibold">Images</th>
                    <th className="px-3 py-2 text-right font-semibold">Prix</th>
                  </tr>
                </thead>
                <tbody>
                  {result.products.map((product) => (
                    <tr
                      key={product.handle}
                      className="border-b border-slate-50 last:border-0 dark:border-slate-800/60"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {product.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.image}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                            />
                          ) : (
                            <div className="h-8 w-8 shrink-0 rounded-md bg-slate-100 dark:bg-slate-800" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {product.title}
                            </div>
                            <div className="truncate text-[11px] text-slate-500">{product.handle}</div>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-slate-500">
                        {product.type || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {product.variants}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {product.images}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {product.minPrice === product.maxPrice
                          ? money(product.minPrice)
                          : `${money(product.minPrice)} – ${money(product.maxPrice)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="Aucune boutique chargée"
          description="Colle l'URL d'une boutique Shopify puis lance la récupération."
        />
      )}
    </div>
  );
}
