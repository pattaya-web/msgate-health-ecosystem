"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, ImageIcon, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { usePublishHermesContext } from "@/components/ask-hermes/page-context";
import { GenerationStatus, type GenerationState } from "@/components/ask-hermes/generate-dialog";
import { fileToDataUrl, itemImageUrl, panel } from "@/components/mass-test/engine-client";
import { PageHeader } from "@/components/shared/page-states";
import { BatchPreview, launchFromPrompts, launchedState, type Draft } from "@/components/studio/batch-preview";
import { avoidList, CreativeReferenceSlot, patchPlan, PlanCards, requestPlan, VisionUnavailableError, VisionWarning, type PlanResult } from "@/components/studio/brief-planner";
import { CreativeResults, type ResultItem } from "@/components/studio/creative-results";
import { ActiveProductCard, ProductGallery, useProductContext } from "@/components/studio/product-context";
import { isPromptsOnly, parseRequestedCount, parseRequestedRatio } from "@/lib/creative-engine/workspace-plan";
import { composeWorkspacePrompt } from "@/lib/creative-engine/workspace-prompt";
import { assetProxy } from "@/lib/studio/client";
import { RATIOS, type Ratio } from "@/lib/studio/ratios";
import { cn } from "@/lib/utils";

/**
 * L'espace de création centré produit : un produit actif (du store du Creative
 * Engine), ses photos lues sur sa page, une référence visuelle principale
 * choisie et persistée, un brief en langage naturel que le planificateur
 * (Hermes) transforme en N créas distinctes, et une génération confirmée qui
 * joint réellement la référence au modèle image-to-image. Les rendus du produit
 * s'affichent en bas, chacun dans son ratio.
 */

const TEXT_MODEL = "gpt-image-2-text-to-image";
const IMAGE_MODEL = "gpt-image-2-image-to-image";
const RATIO_IDS = RATIOS.map((entry) => entry.id) as string[];

export function ProductWorkspace() {
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<"auto" | "exact">("auto");
  const [countOverride, setCountOverride] = useState<number | null>(null);
  const [ratio, setRatio] = useState<Ratio>("3:4");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [useReference, setUseReference] = useState(true);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  /* Une créa d'inspiration (pub concurrente, style) : décrite pour le planificateur ; la référence produit reste la seule vérité visuelle. */
  const [creativeRef, setCreativeRef] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [visionWarning, setVisionWarning] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [generation, setGeneration] = useState<GenerationState | null>(null);

  const ctx = useProductContext({
    onSwitch: () => {
      setPlan(null);
      setSelected(new Set());
      setPreviewOpen(false);
      setGeneration(null);
    },
    onPrimarySet: () => setUseReference(true),
  });
  const { active, primary, facts, batches, reload } = ctx;
  const detectedCount = useMemo(() => parseRequestedCount(brief), [brief]);
  const count = mode === "exact" ? 1 : countOverride ?? detectedCount;
  const promptsOnly = useMemo(() => isPromptsOnly(brief), [brief]);

  /* Tant qu'un lot de ce produit tourne, la liste est relue : c'est le veilleur du shell qui fait avancer les lots, où qu'on soit. */
  const productBatches = useMemo(() => (active ? batches.filter((batch) => batch.source === "product-workspace" && batch.productId === active.id) : []), [batches, active]);
  const pendingBatch = productBatches.some((batch) => batch.items.some((item) => item.state === "pending"));
  useEffect(() => {
    if (!pendingBatch) return;
    const timer = setInterval(() => {
      reload().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [pendingBatch, reload]);

  const results = useMemo<ResultItem[]>(
    () =>
      productBatches.flatMap((batch) =>
        batch.items.map((item) => ({
          id: item.id,
          src: item.file ? itemImageUrl(batch.id, item.file, item.name) : item.urls[0] ? assetProxy(item.urls[0]) : null,
          ratio: batch.ratio,
          kind: "image" as const,
          status: item.state === "pending" ? ("run" as const) : item.state === "fail" ? ("err" as const) : ("ok" as const),
          error: item.error,
          prompt: item.prompt,
          brief: item.userPrompt,
          referenceUrls: batch.primaryReferenceUrl ? [batch.primaryReferenceUrl] : [],
          createdAt: item.generatedAt ?? batch.createdAt,
          name: item.name,
          tech: `${item.model} · ${item.referenceUsed ? "image vers image" : "texte vers image"}`,
          resolution: batch.resolution,
          caption: `#${String(batch.number).padStart(3, "0")} · ${batch.ratio}${item.angleName && item.angleName !== "Ask Hermes" ? ` · ${item.angleName}` : ""}`,
        }))
      ),
    [productBatches]
  );

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

  const referenceMode = Boolean(useReference && primary);
  /* L'inspiration ne part au modèle image que faute de référence produit : sinon la seule image envoyée est le vrai produit. */
  const inspirationSent = Boolean(creativeRef) && !referenceMode;
  const model = referenceMode || inspirationSent ? IMAGE_MODEL : TEXT_MODEL;

  /** Les créas qui partiront : en mode exact, le texte tel quel ; en mode auto, les cartes cochées du plan. */
  const drafts = useMemo<Draft[]>(() => {
    if (!facts) return [];
    const compose = (userPrompt: string) => composeWorkspacePrompt({ userPrompt, product: facts, hasReference: referenceMode, hasInspiration: Boolean(creativeRef) });
    if (mode === "exact") return brief.trim() ? [{ index: 1, userPrompt: brief.trim(), label: "exact prompt", final: compose(brief) }] : [];
    return (plan?.creatives ?? [])
      .filter((creative) => selected.has(creative.index))
      .map((creative) => ({ index: creative.index, userPrompt: creative.prompt, angle: creative.angle, hook: creative.hook, label: creative.concept.slice(0, 120), final: compose(creative.prompt) }));
  }, [facts, mode, brief, plan, selected, referenceMode, creativeRef]);

  async function prepare(ignoreReference = false) {
    if (!active || !brief.trim()) return;
    if (mode === "exact") {
      setPreviewOpen(true);
      return;
    }
    const wantedRatio = parseRequestedRatio(brief);
    if (wantedRatio && RATIO_IDS.includes(wantedRatio) && wantedRatio !== ratio) setRatio(wantedRatio as Ratio);
    setPlanning(true);
    setPreviewOpen(false);
    setVisionWarning(null);
    try {
      const fresh = await requestPlan({ productId: active.id, brief, count, ratio: wantedRatio ?? ratio, hasReference: referenceMode, referenceDataUrl: creativeRef, ignoreReference });
      setPlan(fresh);
      setSelected(new Set(fresh.creatives.map((creative) => creative.index)));
      toast.success(`${fresh.creatives.length} créa${fresh.creatives.length > 1 ? "s" : ""} planifiée${fresh.creatives.length > 1 ? "s" : ""} par ${fresh.engine === "hermes" ? "Hermes" : "Claude"}${fresh.referenceSeen ? " · référence lue" : ""}`);
    } catch (error) {
      setPlan(null);
      if (error instanceof VisionUnavailableError) setVisionWarning(error.message);
      else toast.error(error instanceof Error ? error.message : "Planification impossible");
    } finally {
      setPlanning(false);
    }
  }

  async function rewriteOne(index: number) {
    if (!active || !plan) return;
    setRewriting(index);
    try {
      const fresh = (await requestPlan({ productId: active.id, brief, count: 1, ratio, hasReference: referenceMode, avoid: avoidList(plan, index), referenceDataUrl: creativeRef })).creatives[0];
      if (!fresh) throw new Error("Aucune créa renvoyée");
      setPlan((current) => (current ? patchPlan(current, index, fresh) : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Réécriture impossible");
    } finally {
      setRewriting(null);
    }
  }

  async function confirmGeneration() {
    if (!active || !drafts.length) return;
    setLaunching(true);
    try {
      const batch = await launchFromPrompts({
        product: active,
        drafts,
        brief: mode === "exact" ? null : brief,
        ratio,
        resolution,
        primaryUrl: referenceMode && primary ? primary.url : null,
        inspiration: inspirationSent ? creativeRef : null,
      });
      setGeneration(launchedState(batch));
      setPreviewOpen(false);
      toast.success(`Lot #${String(batch.number).padStart(3, "0")} lancé · ${batch.items.length} image${batch.items.length > 1 ? "s" : ""}`);
      void reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div>
      <PageHeader title="Espace produit" description="Un produit, sa vraie photo comme référence, et un brief : « Create 5 ads… » donne cinq créas distinctes, une image chacune." />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ Produit actif + références */}
        <div className="space-y-3">
          <ActiveProductCard ctx={ctx} />
          <ProductGallery ctx={ctx} />
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
              onPaste={(event) => {
                const file = [...(event.clipboardData?.files ?? [])].find((entry) => entry.type.startsWith("image/"));
                if (!file) return;
                event.preventDefault();
                void fileToDataUrl(file).then((dataUrl) => {
                  setCreativeRef(dataUrl);
                  toast.success("Créa d'inspiration jointe au brief");
                });
              }}
              rows={5}
              disabled={!active}
              placeholder={mode === "auto" ? "Ex. « Create 5 ultra realistic static ads for this product. Style: iPhone 15 candid, ultra native, organic. Ratio 3:4. » ou « J'aime cette créa concurrente, fais-moi 5 versions pour mon produit. » — inutile de redire le produit, sa marque ou sa photo." : "Ton prompt exact, envoyé tel quel pour une image (produit et fidélité ajoutés automatiquement)."}
              className="w-full resize-y rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed outline-none disabled:opacity-60 dark:bg-slate-800"
              data-brief
            />
            <div className="mt-2">
              <CreativeReferenceSlot value={creativeRef} onChange={setCreativeRef} />
            </div>
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
              {primary ? (referenceMode ? `La référence principale part avec chaque prompt (image-to-image)${creativeRef ? " ; l'inspiration guide les prompts sans être envoyée au modèle" : ""}.` : creativeRef ? "Référence produit désactivée ; l'inspiration part avec chaque image, le produit ne sera pas fidèle." : "Référence désactivée : génération texte seul, le produit ne sera pas fidèle.") : creativeRef ? "L'inspiration part avec chaque image (image-to-image) ; sans référence produit, le modèle inventera l'apparence du produit." : "Sans référence principale, la génération est en texte seul : le modèle inventera l'apparence du produit."}
            </p>
          </section>

          {visionWarning ? <VisionWarning message={visionWarning} busy={planning} onContinue={() => void prepare(true)} onDismiss={() => setVisionWarning(null)} /> : null}

          {mode === "auto" && plan ? (
            <PlanCards
              plan={plan}
              withProduct
              selected={selected}
              onSelect={setSelected}
              onEdit={(index, value) => setPlan((current) => (current ? patchPlan(current, index, { prompt: value }) : current))}
              onRewrite={(index) => void rewriteOne(index)}
              rewriting={rewriting}
              actionLabel={(n) => `Générer la sélection (${n})`}
              onAction={() => setPreviewOpen(true)}
            />
          ) : null}

          {previewOpen && active && drafts.length ? (
            <BatchPreview
              product={active}
              primaryUrl={referenceMode && primary ? primary.url : null}
              inspiration={creativeRef}
              inspirationSent={inspirationSent}
              drafts={drafts}
              exact={mode === "exact"}
              ratio={ratio}
              resolution={resolution}
              model={model}
              launching={launching}
              onCancel={() => setPreviewOpen(false)}
              onConfirm={() => void confirmGeneration()}
            />
          ) : null}

          {generation ? (
            <section className={panel}>
              <GenerationStatus generation={generation} onUpdate={setGeneration} onDismiss={() => setGeneration(null)} />
            </section>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------ Résultats du produit : la grille du studio, 4 par ligne, chacun dans son ratio, mêmes actions qu'en Creatives */}
      {active && productBatches.length ? (
        <div className="mt-3">
          <CreativeResults
            items={results}
            title={`Résultats · ${active.name}`}
            columns={4}
            zipName={`${active.name.replace(/[^\w-]+/g, "-").toLowerCase()}-creatives`}
            actions={
              <a href={`/studio/mass-test?batch=${productBatches[0].id}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                <ExternalLink className="h-3 w-3" /> Détails du lot
              </a>
            }
            onReuse={(item) => {
              setMode("exact");
              setBrief(item.brief || item.prompt);
              setPlan(null);
              setPreviewOpen(false);
              toast.success("Prompt remis dans la zone de création");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
