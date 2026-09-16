"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, Link2, Loader2, Package, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { engineGet, enginePost, panel } from "@/components/mass-test/engine-client";
import type { ProductImageCandidate } from "@/lib/creative-engine/product-images";
import { primaryReference, type ProductContext, type TestBatch } from "@/lib/creative-engine/types";
import { cn } from "@/lib/utils";

/**
 * Le produit actif, partagé entre l'espace produit et le prompt libre : le
 * même store du Creative Engine, la même analyse, les mêmes photos lues sur
 * la page et la même référence principale persistée sur le produit. Un seul
 * produit actif pour tout le studio (clé locale commune).
 */

export const ACTIVE_PRODUCT_KEY = "msgate.product-workspace.active";

export function loadActiveProductId(key = ACTIVE_PRODUCT_KEY): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export type ProductContextState = ReturnType<typeof useProductContext>;

/**
 * `storageKey` : chaque écran garde son propre produit attaché (l'espace produit
 * et le prompt libre ne se volent pas leur produit), mais la fiche, l'analyse
 * et la référence principale sont les mêmes, lues dans le même store.
 */
export function useProductContext(options: { onSwitch?: () => void; onPrimarySet?: () => void; storageKey?: string } = {}) {
  const storageKey = options.storageKey ?? ACTIVE_PRODUCT_KEY;
  const [products, setProducts] = useState<ProductContext[]>([]);
  const [batches, setBatches] = useState<TestBatch[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveProductId(storageKey));
  const [url, setUrl] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [images, setImages] = useState<ProductImageCandidate[] | null>(null);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [showJunk, setShowJunk] = useState(false);
  const [settingRef, setSettingRef] = useState<string | null>(null);
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });

  const active = useMemo(() => products.find((product) => product.id === activeId) ?? null, [products, activeId]);
  const primary = active ? primaryReference(active) : null;

  const reload = useCallback(async () => {
    const data = await engineGet();
    setProducts(data.products);
    setBatches(data.batches);
    return data;
  }, []);

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(storageKey, activeId);
      else localStorage.removeItem(storageKey);
    } catch {
      // stockage indisponible
    }
  }, [activeId, storageKey]);

  /* Changer de produit vide tout ce qui appartenait au précédent : galerie, et chez l'appelant plan, aperçu, lot suivi. */
  const loadImages = useCallback(async (product: ProductContext) => {
    setImages(null);
    setImagesError(null);
    setShowJunk(false);
    callbacks.current.onSwitch?.();
    try {
      const data = await enginePost<{ images: ProductImageCandidate[] }>({ action: "product-images", productId: product.id });
      setImages(data.images);
    } catch (error) {
      setImagesError(error instanceof Error ? error.message : "Images illisibles");
      setImages([]);
    }
  }, []);

  const selectProduct = useCallback(
    (id: string | null, list?: ProductContext[]) => {
      setActiveId(id);
      const product = (list ?? products).find((entry) => entry.id === id) ?? null;
      if (product) void loadImages(product);
      else {
        setImages(null);
        callbacks.current.onSwitch?.();
      }
    },
    [products, loadImages]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      reload()
        .then((data) => {
          const stored = loadActiveProductId(storageKey);
          const product = stored ? data.products.find((entry) => entry.id === stored) : null;
          if (product) void loadImages(product);
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : "Produits illisibles"));
    }, 0);
    return () => clearTimeout(timer);
  }, [reload, loadImages, storageKey]);

  async function loadProduct() {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return toast.error("Colle le lien complet de la page produit");
    setLoadingProduct(true);
    try {
      const data = await enginePost<{ product: ProductContext; fallbackReason?: string }>({ action: "analyze", url: clean });
      const fresh = await reload();
      selectProduct(data.product.id, fresh.products);
      setUrl("");
      toast.success(data.fallbackReason ? `${data.product.name} chargé · ${data.fallbackReason}` : `${data.product.name} chargé et analysé`);
    } catch (error) {
      // Le moteur refuse d'écraser une analyse existante par un repli : le produit existe déjà, on l'active.
      const fresh = await reload().catch(() => ({ products, batches }));
      const existing = fresh.products.find((product) => product.url === clean || product.url === clean.split("?")[0]);
      if (existing) {
        selectProduct(existing.id, fresh.products);
        setUrl("");
        toast.warning(error instanceof Error ? error.message : "Analyse indisponible, produit existant activé");
      } else toast.error(error instanceof Error ? error.message : "Page produit illisible");
    } finally {
      setLoadingProduct(false);
    }
  }

  async function setPrimary(imageUrl: string) {
    if (!active) return;
    setSettingRef(imageUrl);
    try {
      const data = await enginePost<{ product: ProductContext }>({ action: "product-reference", productId: active.id, referenceType: "primary", referenceUrl: imageUrl });
      setProducts((current) => current.map((product) => (product.id === data.product.id ? data.product : product)));
      setImages((current) => current?.map((image) => ({ ...image, stored: image.stored || image.url === imageUrl })) ?? current);
      callbacks.current.onPrimarySet?.();
      toast.success("Référence principale enregistrée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Référence impossible");
    } finally {
      setSettingRef(null);
    }
  }

  /** Les faits produit passés au prompt final. */
  const facts = useMemo(() => (active ? { name: active.name, store: active.store, category: active.analysis?.category, productType: active.analysis?.productType, features: active.analysis?.features } : null), [active]);

  return { products, batches, activeId, active, primary, facts, url, setUrl, loadingProduct, images, imagesError, showJunk, setShowJunk, settingRef, reload, loadImages, selectProduct, loadProduct, setPrimary };
}

/** Carte du produit actif + sélection / chargement par URL. */
export function ActiveProductCard({ ctx, title = "Produit actif", showDetach = true }: { ctx: ProductContextState; title?: string; showDetach?: boolean }) {
  const { active, primary, products, activeId } = ctx;
  const thumb = primary?.url ?? active?.imageUrls[0] ?? null;
  return (
    <section className={panel} data-active-product>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {active ? (
        <div className="flex items-start gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/10 dark:bg-slate-800">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-400"><Package className="h-5 w-5" /></div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100" data-product-name>{active.name}</div>
            <div className="text-[12px] text-slate-500">
              {active.store}
              {active.analysis?.category ? ` · ${active.analysis.category}` : ""}
              {active.analysis?.productType ? ` · ${active.analysis.productType}` : ""}
            </div>
            <a href={active.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{active.url}</span>
            </a>
            <div className={cn("mt-1 inline-flex items-center gap-1 text-[11px]", active.engine === "fallback" ? "text-amber-700 dark:text-amber-300" : "text-emerald-600")} data-analysis-status>
              {active.engine === "fallback" ? "Analyse de repli, sans IA (à refaire)" : `Analysé (${active.engine})`}
              {primary ? <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800">✓ référence principale</span> : <span className="ml-2 text-[10px] text-slate-400">pas de référence principale</span>}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-slate-500">Choisis un produit du Creative Engine ou charge une page produit.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={activeId ?? ""}
          onChange={(event) => ctx.selectProduct(event.target.value || null)}
          className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-2 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950"
          aria-label="Produit actif"
        >
          <option value="">{active ? "Changer de produit…" : "Sélectionner un produit…"}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {product.store}
            </option>
          ))}
        </select>
        <div className="relative min-w-[260px] flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={ctx.url}
            onChange={(event) => ctx.setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void ctx.loadProduct();
            }}
            placeholder="…ou colle une URL de page produit"
            className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <button type="button" onClick={() => void ctx.loadProduct()} disabled={ctx.loadingProduct} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900">
          {ctx.loadingProduct ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Load Product
        </button>
        {active && showDetach ? (
          <button type="button" onClick={() => ctx.selectProduct(null)} className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" title="Continuer sans produit" data-detach-product>
            Détacher
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Photos lues sur la page produit, choix de la référence principale, aperçu de celle-ci. */
export function ProductGallery({ ctx, collapsible = false }: { ctx: ProductContextState; collapsible?: boolean }) {
  const { active, primary, images, imagesError, showJunk, settingRef } = ctx;
  const [open, setOpen] = useState(!collapsible);
  if (!active) return null;
  const visible = (images ?? []).filter((image) => showJunk || !image.junk);
  const hidden = (images ?? []).filter((image) => image.junk).length;
  const expanded = open || !primary;
  return (
    <section className={panel} data-product-gallery>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => collapsible && setOpen((value) => !value)} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400" disabled={!collapsible}>
          Références produit · images de la page
          {collapsible ? <ChevronDown className={cn("h-3 w-3 transition-transform", expanded ? "" : "-rotate-90")} /> : null}
        </button>
        <button type="button" onClick={() => void ctx.loadImages(active)} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" title="Relire la page produit">
          <RefreshCw className="h-3 w-3" /> Relire la page
        </button>
      </div>
      {expanded ? (
        <>
          {images === null ? (
            <div className="flex items-center gap-1.5 py-6 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Lecture de la page produit…</div>
          ) : imagesError ? (
            <p className="text-[12px] text-rose-600">{imagesError}</p>
          ) : !visible.length ? (
            <p className="text-[12px] text-slate-500">Aucune image exploitable trouvée sur la page.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {visible.map((image) => {
                const isPrimary = primary?.url === image.url;
                return (
                  <figure key={image.url} className={cn("group relative overflow-hidden rounded-xl bg-slate-100 ring-1 dark:bg-slate-800", isPrimary ? "ring-2 ring-emerald-500" : image.junk ? "ring-amber-300/60" : "ring-slate-900/10")} data-image-url={image.url} data-primary={isPrimary ? "true" : "false"}>
                    <div className="aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={image.alt} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <figcaption className="flex items-center justify-between gap-1 px-1.5 py-1 text-[9.5px] text-slate-500">
                      <span className="truncate">{image.width && image.height ? `${image.width}×${image.height}` : image.source}{image.stored ? " · photo produit" : ""}</span>
                      {image.junk ? <span className="shrink-0 text-amber-600" title={image.reason ?? ""}>?</span> : null}
                    </figcaption>
                    {isPrimary ? (
                      <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                        <Check className="h-3 w-3" /> Primary reference
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={settingRef !== null}
                        onClick={() => void ctx.setPrimary(image.url)}
                        className="absolute inset-x-1.5 bottom-7 rounded-md bg-slate-900/85 px-2 py-1 text-[10.5px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                      >
                        {settingRef === image.url ? "…" : "Définir comme référence principale"}
                      </button>
                    )}
                  </figure>
                );
              })}
            </div>
          )}
          {hidden > 0 ? (
            <button type="button" onClick={() => ctx.setShowJunk(!showJunk)} className="mt-2 text-[11px] text-slate-500 underline-offset-2 hover:underline">
              {showJunk ? `Masquer les ${hidden} images douteuses` : `Afficher aussi ${hidden} image${hidden > 1 ? "s" : ""} douteuse${hidden > 1 ? "s" : ""} (logos, pictos, badges…)`}
            </button>
          ) : null}
        </>
      ) : null}
      {primary ? (
        <div className={cn("flex items-center gap-3 rounded-xl bg-emerald-50/60 p-2 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-800", expanded ? "mt-3" : "")} data-primary-preview>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={primary.url} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 text-[11.5px] text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-emerald-700 dark:text-emerald-300">Référence principale · le vrai produit</div>
            <div className="truncate">{primary.url}</div>
            <div className="text-[10.5px] text-slate-400">choisie le {new Date(primary.selectedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
