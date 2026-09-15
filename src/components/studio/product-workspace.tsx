"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, ImageIcon, Link2, Loader2, Package, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { usePublishHermesContext } from "@/components/ask-hermes/page-context";
import { GenerationStatus, type GenerationState, type LaunchedBatch } from "@/components/ask-hermes/generate-dialog";
import { engineGet, enginePost, panel } from "@/components/mass-test/engine-client";
import { PageHeader } from "@/components/shared/page-states";
import type { ProductImageCandidate } from "@/lib/creative-engine/product-images";
import { primaryReference, type ProductContext } from "@/lib/creative-engine/types";
import { composeWorkspacePrompt } from "@/lib/creative-engine/workspace-prompt";
import { RATIOS, ratioAspect, type Ratio } from "@/lib/studio/ratios";
import { cn } from "@/lib/utils";

/**
 * L'espace de création centré produit : un produit actif (du store du Creative
 * Engine), ses photos lues sur sa page, une référence visuelle principale
 * choisie et persistée, et un prompt court qui n'a plus à répéter le produit.
 * La génération passe par la route confirmée du moteur, avec la référence
 * réellement jointe au modèle image-to-image.
 */

const ACTIVE_KEY = "msgate.product-workspace.active";
const TEXT_MODEL = "gpt-image-2-text-to-image";
const IMAGE_MODEL = "gpt-image-2-image-to-image";

function launched(batch: LaunchedBatch): GenerationState {
  return { batch, startedAt: Date.now(), settled: batch.items.every((item) => item.state !== "pending") };
}

function loadActive(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function ProductWorkspace() {
  const [products, setProducts] = useState<ProductContext[]>([]);
  const [activeId, setActiveId] = useState<string | null>(loadActive);
  const [url, setUrl] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [images, setImages] = useState<ProductImageCandidate[] | null>(null);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [showJunk, setShowJunk] = useState(false);
  const [settingRef, setSettingRef] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<Ratio>("3:4");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [useReference, setUseReference] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [generation, setGeneration] = useState<GenerationState | null>(null);

  const active = useMemo(() => products.find((product) => product.id === activeId) ?? null, [products, activeId]);
  const primary = active ? primaryReference(active) : null;

  const reload = useCallback(async () => {
    const data = await engineGet();
    setProducts(data.products);
    return data.products;
  }, []);

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // stockage indisponible
    }
  }, [activeId]);

  /* Changer de produit vide tout ce qui appartenait au précédent : galerie, aperçu, lot suivi. */
  const loadImages = useCallback(async (product: ProductContext) => {
    setImages(null);
    setImagesError(null);
    setShowJunk(false);
    setPreviewOpen(false);
    setGeneration(null);
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
        setPreviewOpen(false);
        setGeneration(null);
      }
    },
    [products, loadImages]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      reload()
        .then((list) => {
          const stored = loadActive();
          const product = stored ? list.find((entry) => entry.id === stored) : null;
          if (product) void loadImages(product);
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : "Produits illisibles"));
    }, 0);
    return () => clearTimeout(timer);
  }, [reload, loadImages]);

  usePublishHermesContext(
    "product-workspace",
    active
      ? {
          pageType: "product-creative-workspace",
          productId: active.id,
          productName: active.name,
          productUrl: active.url,
          storeName: active.store,
          ...(primary ? { primaryReferenceUrl: primary.url, primaryReferenceType: primary.type } : {}),
        }
      : null
  );

  async function loadProduct() {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return toast.error("Colle le lien complet de la page produit");
    setLoadingProduct(true);
    try {
      const data = await enginePost<{ product: ProductContext; fallbackReason?: string }>({ action: "analyze", url: clean });
      const list = await reload();
      selectProduct(data.product.id, list);
      setUrl("");
      toast.success(data.fallbackReason ? `${data.product.name} chargé · ${data.fallbackReason}` : `${data.product.name} chargé et analysé`);
    } catch (error) {
      // Le moteur refuse d'écraser une analyse existante par un repli : le produit existe déjà, on l'active.
      const list = await reload().catch(() => products);
      const existing = list.find((product) => product.url === clean || product.url === clean.split("?")[0]);
      if (existing) {
        selectProduct(existing.id, list);
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
      setUseReference(true);
      toast.success("Référence principale enregistrée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Référence impossible");
    } finally {
      setSettingRef(null);
    }
  }

  const facts = active ? { name: active.name, store: active.store, category: active.analysis?.category, productType: active.analysis?.productType, features: active.analysis?.features } : null;
  const referenceMode = Boolean(useReference && primary);
  const finalPrompt = facts && prompt.trim() ? composeWorkspacePrompt({ userPrompt: prompt, product: facts, hasReference: referenceMode }) : "";
  const model = referenceMode ? IMAGE_MODEL : TEXT_MODEL;

  async function confirmGeneration() {
    if (!active || !finalPrompt) return;
    setLaunching(true);
    try {
      const response = await fetch("/api/creative-engine/from-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "generate",
          source: "product-workspace",
          prompts: [{ prompt: finalPrompt, userPrompt: prompt.trim(), label: "product workspace" }],
          productId: active.id,
          productName: active.name,
          productUrl: active.url,
          store: active.store,
          ratio,
          resolution,
          referenceUrls: referenceMode && primary ? [primary.url] : [],
          primaryReferenceUrl: primary?.url ?? null,
          useProductImages: false,
        }),
      });
      const payload = (await response.json()) as { batch?: LaunchedBatch; error?: string };
      if (!response.ok || !payload.batch) throw new Error(payload.error || `Erreur ${response.status}`);
      setGeneration(launched(payload.batch));
      setPreviewOpen(false);
      toast.success(`Lot #${String(payload.batch.number).padStart(3, "0")} lancé`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setLaunching(false);
    }
  }

  const visible = (images ?? []).filter((image) => showJunk || !image.junk);
  const hidden = (images ?? []).filter((image) => image.junk).length;
  const thumb = primary?.url ?? active?.imageUrls[0] ?? null;

  return (
    <div>
      <PageHeader title="Espace produit" description="Un produit, sa vraie photo comme référence, et un prompt court : le moteur sait déjà de quoi tu parles." />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ Produit actif + références */}
        <div className="space-y-3">
          <section className={panel} data-active-product>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Produit actif</div>
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
                  <div className="truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">{active.name}</div>
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
                onChange={(event) => selectProduct(event.target.value || null)}
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
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadProduct();
                  }}
                  placeholder="…ou colle une URL de page produit"
                  className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <button type="button" onClick={() => void loadProduct()} disabled={loadingProduct} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900">
                {loadingProduct ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Load Product
              </button>
            </div>
          </section>

          {active ? (
            <section className={panel} data-product-gallery>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Références produit · images de la page</div>
                <button type="button" onClick={() => void loadImages(active)} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" title="Relire la page produit">
                  <RefreshCw className="h-3 w-3" /> Relire la page
                </button>
              </div>
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
                            onClick={() => void setPrimary(image.url)}
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
                <button type="button" onClick={() => setShowJunk((value) => !value)} className="mt-2 text-[11px] text-slate-500 underline-offset-2 hover:underline">
                  {showJunk ? `Masquer les ${hidden} images douteuses` : `Afficher aussi ${hidden} image${hidden > 1 ? "s" : ""} douteuse${hidden > 1 ? "s" : ""} (logos, pictos, badges…)`}
                </button>
              ) : null}
              {primary ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl bg-emerald-50/60 p-2 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-800" data-primary-preview>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={primary.url} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 text-[11.5px] text-slate-600 dark:text-slate-300">
                    <div className="font-semibold text-emerald-700 dark:text-emerald-300">Référence principale</div>
                    <div className="truncate">{primary.url}</div>
                    <div className="text-[10.5px] text-slate-400">choisie le {new Date(primary.selectedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* ------------------------------------------------ Créer */}
        <div className="space-y-3">
          <section className={panel} data-create>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Créer</div>
            {active ? (
              <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50 p-2 text-[11.5px] dark:bg-slate-800/60" data-context-bar>
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-700">
                  {primary ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={primary.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400"><ImageIcon className="h-4 w-4" /></div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate"><span className="text-slate-500">Active Product :</span> <span className="font-medium text-slate-900 dark:text-slate-100">{active.name}</span></div>
                  <div className="truncate text-slate-500">Brand : {active.store} · Primary reference : {primary ? "sélectionnée" : "aucune (texte seul)"}</div>
                </div>
              </div>
            ) : (
              <p className="mb-2 text-[12px] text-slate-500">Active un produit à gauche : le prompt agira sur lui.</p>
            )}
            <textarea
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setPreviewOpen(false);
              }}
              rows={4}
              disabled={!active}
              placeholder='Ex. « Create a candid iPhone 15 photo of a woman using this product in her bedroom. » — inutile de redire le produit, sa marque ou sa photo.'
              className="w-full resize-y rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed outline-none disabled:opacity-60 dark:bg-slate-800"
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-semibold uppercase tracking-wide">Ratio</span>
                <select value={ratio} onChange={(event) => setRatio(event.target.value as Ratio)} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800">
                  {RATIOS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.hint}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-semibold uppercase tracking-wide">Taille</span>
                <select value={resolution} onChange={(event) => setResolution(event.target.value as "1K" | "2K")} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800">
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                </select>
              </label>
              <label className={cn("flex items-center gap-1.5 text-[11px]", primary ? "text-slate-700 dark:text-slate-200" : "text-slate-400")} title={primary ? "La référence principale est envoyée au modèle image-to-image" : "Choisis d'abord une référence principale"}>
                <input type="checkbox" checked={referenceMode} disabled={!primary} onChange={(event) => setUseReference(event.target.checked)} data-use-reference />
                Utiliser la référence produit
              </label>
              <button
                type="button"
                disabled={!active || !prompt.trim()}
                onClick={() => setPreviewOpen(true)}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Préparer la génération
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {primary ? (referenceMode ? "La référence principale part avec le prompt (image-to-image)." : "Référence désactivée : génération texte seul, le produit ne sera pas fidèle.") : "Sans référence principale, la génération est en texte seul : le modèle inventera l'apparence du produit."}
            </p>
          </section>

          {previewOpen && active ? (
            <section className={cn(panel, "ring-2 ring-slate-900/20 dark:ring-slate-100/20")} data-preview>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Aperçu avant génération · aucun crédit dépensé avant confirmation</div>
              <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                <dt className="text-slate-500">Product</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100" data-preview-product>{active.name} <span className="text-[10.5px] font-normal text-slate-400">· {active.store} · CRM {active.id}</span></dd>
                <dt className="text-slate-500">Primary reference</dt>
                <dd data-preview-reference={referenceMode ? primary?.url : "none"}>
                  {referenceMode && primary ? (
                    <span className="inline-flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={primary.url} alt="" className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-900/10" />
                      <span className="max-w-[260px] truncate text-[10.5px] text-slate-500">{primary.url}</span>
                    </span>
                  ) : (
                    <span className="text-slate-500">aucune</span>
                  )}
                </dd>
                <dt className="text-slate-500">User prompt</dt>
                <dd className="whitespace-pre-wrap text-slate-800 dark:text-slate-200" data-preview-user-prompt>{prompt.trim()}</dd>
                <dt className="text-slate-500">Final generation prompt</dt>
                <dd>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-200" data-preview-final-prompt>{finalPrompt}</pre>
                </dd>
                <dt className="text-slate-500">Ratio</dt>
                <dd>{ratio} · {resolution}</dd>
                <dt className="text-slate-500">Model</dt>
                <dd className="font-mono text-[11px]" data-preview-model={model}>{model}</dd>
                <dt className="text-slate-500">Reference mode</dt>
                <dd data-preview-reference-mode={referenceMode ? "image" : "text"}>{referenceMode ? "Image reference enabled" : "Image reference disabled (text-to-image)"}</dd>
              </dl>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setPreviewOpen(false)} disabled={launching} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  Annuler
                </button>
                <button type="button" onClick={() => void confirmGeneration()} disabled={launching} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900">
                  {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Confirmer la génération
                </button>
              </div>
            </section>
          ) : null}

          {generation ? (
            <section className={panel}>
              <GenerationStatus generation={generation} onUpdate={setGeneration} onDismiss={() => setGeneration(null)} />
              <div className={cn("mx-auto max-w-[200px] overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800", ratioAspect(generation.batch.ratio))} aria-hidden />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
