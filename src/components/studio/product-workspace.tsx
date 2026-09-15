"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, ImageIcon, Link2, Loader2, Package, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { usePublishHermesContext } from "@/components/ask-hermes/page-context";
import { GenerationStatus, type GenerationState, type LaunchedBatch } from "@/components/ask-hermes/generate-dialog";
import { engineGet, enginePost, itemImageUrl, panel } from "@/components/mass-test/engine-client";
import { PageHeader } from "@/components/shared/page-states";
import type { ProductImageCandidate } from "@/lib/creative-engine/product-images";
import { primaryReference, type ProductContext, type TestBatch } from "@/lib/creative-engine/types";
import { isPromptsOnly, parseRequestedCount, parseRequestedRatio, type CreativePlan, type PlannedCreative } from "@/lib/creative-engine/workspace-plan";
import { composeWorkspacePrompt } from "@/lib/creative-engine/workspace-prompt";
import { RATIOS, ratioAspect, type Ratio } from "@/lib/studio/ratios";
import { cn } from "@/lib/utils";

/**
 * L'espace de création centré produit : un produit actif (du store du Creative
 * Engine), ses photos lues sur sa page, une référence visuelle principale
 * choisie et persistée, un brief en langage naturel que le planificateur
 * (Hermes) transforme en N créas distinctes, et une génération confirmée qui
 * joint réellement la référence au modèle image-to-image. Les rendus du produit
 * s'affichent en bas, chacun dans son ratio.
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

const RATIO_IDS = RATIOS.map((entry) => entry.id) as string[];

export function ProductWorkspace() {
  const [products, setProducts] = useState<ProductContext[]>([]);
  const [batches, setBatches] = useState<TestBatch[]>([]);
  const [activeId, setActiveId] = useState<string | null>(loadActive);
  const [url, setUrl] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [images, setImages] = useState<ProductImageCandidate[] | null>(null);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [showJunk, setShowJunk] = useState(false);
  const [settingRef, setSettingRef] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<"auto" | "exact">("auto");
  const [countOverride, setCountOverride] = useState<number | null>(null);
  const [ratio, setRatio] = useState<Ratio>("3:4");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [useReference, setUseReference] = useState(true);
  const [plan, setPlan] = useState<(CreativePlan & { engine: string }) | null>(null);
  const [planning, setPlanning] = useState(false);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [generation, setGeneration] = useState<GenerationState | null>(null);

  const active = useMemo(() => products.find((product) => product.id === activeId) ?? null, [products, activeId]);
  const primary = active ? primaryReference(active) : null;
  const detectedCount = useMemo(() => parseRequestedCount(brief), [brief]);
  const count = mode === "exact" ? 1 : countOverride ?? detectedCount;
  const promptsOnly = useMemo(() => isPromptsOnly(brief), [brief]);

  const reload = useCallback(async () => {
    const data = await engineGet();
    setProducts(data.products);
    setBatches(data.batches);
    return data;
  }, []);

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // stockage indisponible
    }
  }, [activeId]);

  /* Changer de produit vide tout ce qui appartenait au précédent : galerie, plan, aperçu, lot suivi. */
  const loadImages = useCallback(async (product: ProductContext) => {
    setImages(null);
    setImagesError(null);
    setShowJunk(false);
    setPlan(null);
    setSelected(new Set());
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
        setPlan(null);
        setPreviewOpen(false);
        setGeneration(null);
      }
    },
    [products, loadImages]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      reload()
        .then((data) => {
          const stored = loadActive();
          const product = stored ? data.products.find((entry) => entry.id === stored) : null;
          if (product) void loadImages(product);
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : "Produits illisibles"));
    }, 0);
    return () => clearTimeout(timer);
  }, [reload, loadImages]);

  /* Tant qu'un lot de ce produit tourne, les rendus du bas se rafraîchissent. */
  const productBatches = useMemo(() => (active ? batches.filter((batch) => batch.source === "product-workspace" && batch.productId === active.id) : []), [batches, active]);
  const pendingBatch = productBatches.some((batch) => batch.items.some((item) => item.state === "pending"));
  useEffect(() => {
    if (!pendingBatch) return;
    const timer = setInterval(() => {
      const running = productBatches.filter((batch) => batch.items.some((item) => item.state === "pending"));
      Promise.all(running.map((batch) => enginePost({ action: "refresh", batchId: batch.id })))
        .then(() => reload())
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [pendingBatch, productBatches, reload]);

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
      setUseReference(true);
      toast.success("Référence principale enregistrée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Référence impossible");
    } finally {
      setSettingRef(null);
    }
  }

  const facts = useMemo(() => (active ? { name: active.name, store: active.store, category: active.analysis?.category, productType: active.analysis?.productType, features: active.analysis?.features } : null), [active]);
  const referenceMode = Boolean(useReference && primary);
  const model = referenceMode ? IMAGE_MODEL : TEXT_MODEL;

  /** Les créas qui partiront : en mode exact, le texte tel quel ; en mode auto, les cartes cochées du plan. */
  const drafts = useMemo<Array<{ index: number; userPrompt: string; angle?: string; hook?: string; label?: string; final: string }>>(() => {
    if (!facts) return [];
    if (mode === "exact") return brief.trim() ? [{ index: 1, userPrompt: brief.trim(), label: "exact prompt", final: composeWorkspacePrompt({ userPrompt: brief, product: facts, hasReference: referenceMode }) }] : [];
    return (plan?.creatives ?? [])
      .filter((creative) => selected.has(creative.index))
      .map((creative) => ({ index: creative.index, userPrompt: creative.prompt, angle: creative.angle, hook: creative.hook, label: creative.concept.slice(0, 120), final: composeWorkspacePrompt({ userPrompt: creative.prompt, product: facts, hasReference: referenceMode }) }));
  }, [facts, mode, brief, plan, selected, referenceMode]);

  async function prepare() {
    if (!active || !brief.trim()) return;
    if (mode === "exact") {
      setPreviewOpen(true);
      return;
    }
    const wantedRatio = parseRequestedRatio(brief);
    if (wantedRatio && RATIO_IDS.includes(wantedRatio) && wantedRatio !== ratio) setRatio(wantedRatio as Ratio);
    setPlanning(true);
    setPreviewOpen(false);
    try {
      const data = await enginePost<{ plan: CreativePlan & { engine: string } }>({ action: "workspace-plan", productId: active.id, brief, count, ratio: wantedRatio ?? ratio, hasReference: referenceMode });
      setPlan(data.plan);
      setSelected(new Set(data.plan.creatives.map((creative) => creative.index)));
      toast.success(`${data.plan.creatives.length} créa${data.plan.creatives.length > 1 ? "s" : ""} planifiée${data.plan.creatives.length > 1 ? "s" : ""} par ${data.plan.engine === "hermes" ? "Hermes" : "Claude"}`);
    } catch (error) {
      setPlan(null);
      toast.error(error instanceof Error ? error.message : "Planification impossible");
    } finally {
      setPlanning(false);
    }
  }

  async function rewriteOne(index: number) {
    if (!active || !plan) return;
    setRewriting(index);
    try {
      const avoid = plan.creatives.filter((creative) => creative.index !== index).map((creative) => creative.concept || creative.angle).filter(Boolean);
      const data = await enginePost<{ plan: CreativePlan }>({ action: "workspace-plan", productId: active.id, brief, count: 1, ratio, hasReference: referenceMode, avoid });
      const fresh = data.plan.creatives[0];
      if (!fresh) throw new Error("Aucune créa renvoyée");
      setPlan((current) => (current ? { ...current, creatives: current.creatives.map((creative) => (creative.index === index ? { ...fresh, index } : creative)) } : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Réécriture impossible");
    } finally {
      setRewriting(null);
    }
  }

  function editPrompt(index: number, value: string) {
    setPlan((current) => (current ? { ...current, creatives: current.creatives.map((creative) => (creative.index === index ? { ...creative, prompt: value } : creative)) } : current));
  }

  async function confirmGeneration() {
    if (!active || !drafts.length) return;
    setLaunching(true);
    try {
      const response = await fetch("/api/creative-engine/from-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "generate",
          source: "product-workspace",
          prompts: drafts.map((draft) => ({ prompt: draft.final, userPrompt: mode === "exact" ? draft.userPrompt : brief.trim(), angle: draft.angle, hook: draft.hook, label: draft.label })),
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
      toast.success(`Lot #${String(payload.batch.number).padStart(3, "0")} lancé · ${payload.batch.items.length} image${payload.batch.items.length > 1 ? "s" : ""}`);
      void reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setLaunching(false);
    }
  }

  const visible = (images ?? []).filter((image) => showJunk || !image.junk);
  const hidden = (images ?? []).filter((image) => image.junk).length;
  const thumb = primary?.url ?? active?.imageUrls[0] ?? null;
  const planned = plan?.creatives ?? [];

  return (
    <div>
      <PageHeader title="Espace produit" description="Un produit, sa vraie photo comme référence, et un brief : « Create 5 ads… » donne cinq créas distinctes, une image chacune." />

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
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Créer</div>
              <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Mode">
                {(
                  [
                    ["auto", "Auto · brief"],
                    ["exact", "Prompt exact"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={mode === id} onClick={() => { setMode(id); setPreviewOpen(false); }} className={cn("rounded px-2 py-0.5 text-[10.5px] font-medium", mode === id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")} data-mode={id}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
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
              <p className="mb-2 text-[12px] text-slate-500">Active un produit à gauche : le brief agira sur lui.</p>
            )}
            <textarea
              value={brief}
              onChange={(event) => {
                setBrief(event.target.value);
                setCountOverride(null);
                setPreviewOpen(false);
              }}
              rows={5}
              disabled={!active}
              placeholder={mode === "auto" ? 'Ex. « Create 5 ultra realistic static ads for this product. Style: iPhone 15 candid, ultra native, organic. Ratio 3:4. Make the real product clearly visible. » — inutile de redire le produit, sa marque ou sa photo.' : "Ton prompt exact, envoyé tel quel pour une image (produit et fidélité ajoutés automatiquement)."}
              className="w-full resize-y rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed outline-none disabled:opacity-60 dark:bg-slate-800"
              data-brief
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              {mode === "auto" ? (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500" title="Nombre d'images lu dans le brief ; modifiable">
                  <span className="font-semibold uppercase tracking-wide">Créas</span>
                  <input type="number" min={1} max={30} value={count} onChange={(event) => setCountOverride(Math.min(30, Math.max(1, Number(event.target.value) || 1)))} className="w-14 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800" data-count />
                  <span className="text-[10px] text-slate-400">{countOverride === null ? "détecté" : "modifié"}</span>
                </label>
              ) : null}
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-semibold uppercase tracking-wide">Ratio</span>
                <select value={ratio} onChange={(event) => setRatio(event.target.value as Ratio)} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800" data-ratio>
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
                disabled={!active || !brief.trim() || planning}
                onClick={() => void prepare()}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
                data-prepare
              >
                {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {mode === "auto" ? (planning ? "Planification…" : `Planifier ${count} créa${count > 1 ? "s" : ""}`) : "Préparer la génération"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {mode === "auto" ? `${count} créa${count > 1 ? "s" : ""} = ${count} image${count > 1 ? "s" : ""} distincte${count > 1 ? "s" : ""}. ` : ""}
              {promptsOnly ? "« Prompts only » lu dans le brief : rien ne sera généré sans ton clic. " : ""}
              {primary ? (referenceMode ? "La référence principale part avec chaque prompt (image-to-image)." : "Référence désactivée : génération texte seul, le produit ne sera pas fidèle.") : "Sans référence principale, la génération est en texte seul : le modèle inventera l'apparence du produit."}
            </p>
          </section>

          {mode === "auto" && plan ? (
            <section className={panel} data-plan>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="text-[12px] font-semibold text-slate-900 dark:text-slate-100" data-plan-count>
                  Batch : {planned.length} créa{planned.length > 1 ? "s" : ""} = {planned.length} image{planned.length > 1 ? "s" : ""}
                </div>
                <span className="text-[10.5px] text-slate-400">planifié par {plan.engine === "hermes" ? "Hermes" : "Claude"} · {plan.ratio}</span>
                <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                  <button type="button" onClick={() => setSelected(new Set(planned.map((creative) => creative.index)))} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Tout sélectionner</button>
                  <button type="button" onClick={() => setSelected(new Set())} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Tout désélectionner</button>
                </div>
              </div>
              <div className="space-y-2">
                {planned.map((creative: PlannedCreative) => (
                  <article key={creative.index} className={cn("rounded-xl border p-2.5", selected.has(creative.index) ? "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900" : "border-slate-200 bg-slate-50 opacity-70 dark:border-slate-800 dark:bg-slate-900/40")} data-creative-card={creative.index}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={selected.has(creative.index)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(creative.index); else next.delete(creative.index); return next; })} aria-label={`Créa ${creative.index}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                          <span className="font-semibold uppercase tracking-wide text-slate-500">Creative {String(creative.index).padStart(2, "0")}</span>
                          {creative.angle ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-angle>{creative.angle}</span> : null}
                          <button type="button" disabled={rewriting !== null} onClick={() => void rewriteOne(creative.index)} className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:hover:text-slate-200" title="Demander un autre concept pour cette créa">
                            {rewriting === creative.index ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Réécrire
                          </button>
                        </div>
                        {creative.concept ? <div className="mt-0.5 text-[11.5px] text-slate-700 dark:text-slate-300" data-concept>{creative.concept}</div> : null}
                        {creative.hook ? <div className="text-[11px] text-slate-500">Hook : « {creative.hook} »</div> : null}
                        <textarea value={creative.prompt} onChange={(event) => editPrompt(creative.index, event.target.value)} rows={3} className="mt-1.5 w-full resize-y rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed outline-none dark:bg-slate-800" data-creative-prompt />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button type="button" disabled={!selected.size} onClick={() => setPreviewOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900" data-generate-selected>
                  <Wand2 className="h-3.5 w-3.5" />
                  Générer la sélection ({selected.size})
                </button>
              </div>
            </section>
          ) : null}

          {previewOpen && active && drafts.length ? (
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
                <dt className="text-slate-500">Images</dt>
                <dd data-preview-count={drafts.length}>{drafts.length} image{drafts.length > 1 ? "s" : ""} · {ratio} · {resolution}</dd>
                <dt className="text-slate-500">Model</dt>
                <dd className="font-mono text-[11px]" data-preview-model={model}>{model}</dd>
                <dt className="text-slate-500">Reference mode</dt>
                <dd data-preview-reference-mode={referenceMode ? "image" : "text"}>{referenceMode ? "Image reference enabled" : "Image reference disabled (text-to-image)"}</dd>
              </dl>
              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                {drafts.map((draft, position) => (
                  <div key={draft.index} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800" data-preview-draft={draft.index}>
                    <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                      {mode === "exact" ? "User prompt" : `Creative ${String(position + 1).padStart(2, "0")}${draft.angle ? ` · ${draft.angle}` : ""}`}
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap text-[11.5px] text-slate-800 dark:text-slate-200" data-preview-user-prompt>{draft.userPrompt}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Final generation prompt</div>
                    <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-white p-2 font-mono text-[10.5px] leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-300" data-preview-final-prompt>{draft.final}</pre>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setPreviewOpen(false)} disabled={launching} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  Annuler
                </button>
                <button type="button" onClick={() => void confirmGeneration()} disabled={launching} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900">
                  {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Confirmer la génération ({drafts.length})
                </button>
              </div>
            </section>
          ) : null}

          {generation ? (
            <section className={panel}>
              <GenerationStatus generation={generation} onUpdate={setGeneration} onDismiss={() => setGeneration(null)} />
            </section>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------ Résultats du produit : 4 par ligne, chacun dans son ratio */}
      {active && productBatches.length ? (
        <section className={cn(panel, "mt-3")} data-results>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Résultats · {active.name}</div>
            <span className="text-[11px] text-slate-500">{productBatches.reduce((sum, batch) => sum + batch.items.length, 0)} image{productBatches.reduce((sum, batch) => sum + batch.items.length, 0) > 1 ? "s" : ""} sur {productBatches.length} lot{productBatches.length > 1 ? "s" : ""}</span>
          </div>
          <div className="grid grid-cols-2 items-start gap-2 md:grid-cols-4">
            {productBatches.flatMap((batch) =>
              batch.items.map((item) => {
                const src = item.file ? itemImageUrl(batch.id, item.file, item.name) : null;
                return (
                  <article key={item.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900" data-result-item data-result-ratio={batch.ratio}>
                    <div className={cn("relative bg-slate-100 dark:bg-slate-800", ratioAspect(batch.ratio))}>
                      {src ? (
                        <a href={src} target="_blank" rel="noreferrer" title={item.userPrompt ?? item.prompt}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </a>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">
                          {item.state === "fail" ? <span className="px-2 text-center text-rose-500">{item.error ?? "échec"}</span> : <Loader2 className="h-5 w-5 animate-spin" />}
                        </div>
                      )}
                    </div>
                    <div className="truncate px-2 py-1 text-[10px] text-slate-500" title={item.name}>
                      #{String(batch.number).padStart(3, "0")} · {batch.ratio}{item.angleName && item.angleName !== "Ask Hermes" ? ` · ${item.angleName}` : ""}
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <a href={`/studio/mass-test?batch=${productBatches[0].id}`} className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <ExternalLink className="h-3 w-3" /> Ouvrir dans Mass test (statuts, relance, Drive)
          </a>
        </section>
      ) : null}
    </div>
  );
}
