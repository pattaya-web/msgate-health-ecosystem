"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  ChevronDown,
  Copy,
  Download,
  ImagePlus,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { CreativeBatch } from "@/components/studio/creative-batch";
import { avoidList, CreativeReferenceSlot, patchPlan, PlanCards, requestPlan, VisionUnavailableError, VisionWarning, type PlanResult } from "@/components/studio/brief-planner";
import { ActiveProductCard, ProductGallery, useProductContext } from "@/components/studio/product-context";
import { CompetitorResearchPanel } from "@/components/studio/competitor-research";
import type { CompetitorInspiration } from "@/lib/brandsearch/types";
import { BatchPreview, launchFromPrompts, launchedState, type Draft } from "@/components/studio/batch-preview";
import { GenerationStatus, type GenerationState } from "@/components/ask-hermes/generate-dialog";
import { composeWorkspacePrompt } from "@/lib/creative-engine/workspace-prompt";
import { isPromptsOnly, parseRequestedCount, parseRequestedRatio } from "@/lib/creative-engine/workspace-plan";
import { usePublishHermesContext } from "@/components/ask-hermes/page-context";
import { cn } from "@/lib/utils";
import { assetProxy, libraryFileUrl, pollStudioTask, saveStaticCreative, studioPost } from "@/lib/studio/client";
import { STUDIO_REMOVE_SOURCE_KEY, STUDIO_REUSE_KEY, type StaticCreative } from "@/lib/studio/library-types";
import { claimTask, releaseTask, markStaticStudioMounted } from "@/lib/studio/generation-registry";
import { useRouter } from "next/navigation";
import { Eraser } from "lucide-react";
import { SendToDrive } from "@/components/drive/send-to-drive";
import { DEFAULT_RATIO, RATIOS, isWideRatio, ratioAspect, type Ratio } from "@/lib/studio/ratios";
import { DEFAULT_MODEL_FAMILY, MODEL_FAMILIES, modelFamily } from "@/lib/studio/models";
import { CREATIVE_TYPES, buildCreativePrompt, type ProductCategory } from "@/lib/studio/creative-types";
import { NO_STYLE, resolveFreePrompts, styleInstructions } from "@/lib/studio/free-prompt";
import type { ProductInput } from "@/lib/ugc/types";

/** La catégorie de la fiche UGC, traduite pour le constructeur de prompts du studio. */
function categoryOf(kind: ProductInput["kind"]): ProductCategory {
  switch (kind) {
    case "fashion":
      return "fashion";
    case "beauty":
      return "beauty";
    case "gadget":
      return "gadget";
    case "furniture":
      return "home";
    case "food":
      return "general";
    case "book":
    case "digital":
    case "topic":
      return "digital";
    default:
      return "general";
  }
}

const COUNTS = [1, 2, 4, 6, 8];

/** Les lots en cours survivent à un rechargement : sans ça, une image générée
 *  et facturée chez Kie n'est jamais enregistrée en bibliothèque. */
const JOBS_KEY = "msgate.studio.jobs";
const MAX_KEPT_JOBS = 60;

type Job = {
  /** Clé stable : le taskId n'existe pas encore à la création. */
  id: string;
  prompt: string;
  taskId?: string;
  urls: string[];
  status: "idle" | "run" | "ok" | "err";
  error?: string;
  /** Passé à true une fois la créa écrite en bibliothèque. */
  saved?: boolean;
  /** Repris tel quel après un rechargement, pour pouvoir enregistrer. */
  brief: string;
  ratio: (typeof RATIOS)[number]["id"];
  resolution: string;
  referenceUrls: string[];
  createdAt: string;
  /** Famille du catalogue et nature du rendu ; absents sur les anciens rendus (GPT Image 2, image). */
  model?: string;
  kind?: "image" | "video";
  /** Rendu fait ailleurs (espace produit, Ask Hermes) et rangé en bibliothèque : il s'affiche ici aussi. */
  origin?: "product-workspace" | "ask-hermes";
  productName?: string;
};

/** Rendus d'autres écrans retirés de la grille par « Vider les terminées » : ils ne reviennent pas au prochain chargement. */
const DISMISSED_KEY = "msgate.studio.dismissed";

function loadDismissed(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "[]") as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jobFromLibrary(item: StaticCreative): Job {
  return {
    id: item.id,
    prompt: item.prompt,
    urls: item.resultFiles.map((file) => libraryFileUrl(item.id, file)),
    status: "ok",
    saved: true,
    brief: item.brief,
    ratio: item.ratio,
    resolution: item.resolution,
    referenceUrls: (item.refFiles ?? []).map((file) => libraryFileUrl(item.id, file)),
    createdAt: item.createdAt,
    ...(item.origin && item.origin !== "studio" ? { origin: item.origin } : {}),
    ...(item.productName ? { productName: item.productName } : {}),
  };
}

function loadStoredJobs(): Job[] {
  try {
    const raw = window.localStorage.getItem(JOBS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Job[]) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Une référence : fichier chargé (`dataUrl`) ou photo lue sur une fiche produit (`url`). L'ordre de la liste est l'ordre envoyé. */
type RefImage = { id: string; preview: string; name: string; dataUrl?: string; url?: string };

export function StaticStudio() {
  const [brief, setBrief] = useState("");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [promptsOpen, setPromptsOpen] = useState(true);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]["id"]>(DEFAULT_RATIO);
  const [resolution, setResolution] = useState<string>("1K");
  /* Modèle du prompt libre : image par défaut (GPT Image 2), vidéo au choix ; la durée ne sert qu'aux vidéos. */
  const [modelId, setModelId] = useState(DEFAULT_MODEL_FAMILY);
  const [duration, setDuration] = useState(5);
  const family = modelFamily(modelId) ?? MODEL_FAMILIES[0];
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<"expand" | "gen" | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  /* Tant que le studio est monté, c'est lui qui suit ses tâches ; parti, le veilleur du shell prend le relais. */
  useEffect(() => {
    markStaticStudioMounted(true);
    return () => markStaticStudioMounted(false);
  }, []);
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [genPaste, setGenPaste] = useState("");
  /* Prompt libre : en « Auto · brief », le texte est un brief que Hermes découpe en N prompts distincts ; en « Prompt exact », il part tel quel. */
  const [promptMode, setPromptMode] = useState<"auto" | "exact">("auto");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [planSelected, setPlanSelected] = useState<Set<number>>(() => new Set());
  const [planning, setPlanning] = useState(false);
  const [visionWarning, setVisionWarning] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const [countOverride, setCountOverride] = useState<number | null>(null);
  const detectedCount = useMemo(() => parseRequestedCount(genPaste), [genPaste]);
  const planCount = countOverride ?? detectedCount;
  const promptsOnly = useMemo(() => isPromptsOnly(genPaste), [genPaste]);
  /* Produit actif du Creative Engine, le même que l'espace produit : vérité produit pour le planificateur et la génération. */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  /* Creative inspiration : pub concurrente ou créa de style, décrite pour le planificateur ; à défaut, la 1re référence chargée joue ce rôle. */
  const [inspiration, setInspiration] = useState<string | null>(null);
  /* Pubs concurrentes choisies dans la galerie Brand Search et regardées par Hermes : motifs et ADN pour l'Auto-brief, jamais leurs faits. */
  const [competitorInspiration, setCompetitorInspiration] = useState<CompetitorInspiration | null>(null);
  const ctx = useProductContext({
    storageKey: "msgate.free-prompt.product",
    onSwitch: () => {
      setPlan(null);
      setPlanSelected(new Set());
      setPreviewOpen(false);
      setGeneration(null);
    },
  });
  const activeProduct = ctx.active;
  const primary = ctx.primary;
  const inspirationImage = inspiration ?? refs.find((ref) => ref.dataUrl)?.dataUrl ?? null;
  /* Avec un produit, l'inspiration guide les prompts ; elle ne part au modèle qu'à défaut de référence produit. */
  const inspirationSent = Boolean(inspirationImage) && !primary;
  const drafts = useMemo<Draft[]>(() => {
    if (!ctx.facts || !plan) return [];
    const facts = ctx.facts;
    return plan.creatives
      .filter((creative) => planSelected.has(creative.index))
      .map((creative) => ({ index: creative.index, userPrompt: creative.prompt, angle: creative.angle, hook: creative.hook, label: creative.concept.slice(0, 120), final: composeWorkspacePrompt({ userPrompt: creative.prompt, product: facts, hasReference: Boolean(primary), hasInspiration: Boolean(inspirationImage) || Boolean(competitorInspiration) }) }));
  }, [ctx.facts, plan, planSelected, primary, inspirationImage, competitorInspiration]);
  /** Référence ouverte en grand, et index en cours de glisser pour réordonner. */
  const [refZoom, setRefZoom] = useState<RefImage | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState(false);
  /** Photos d'une fiche produit : elles remplacent les précédentes photos de fiche, sans toucher aux fichiers chargés. */
  const setPageRefs = useCallback((urls: string[]) => {
    setRefs((list) => {
      const kept = list.filter((ref) => !ref.url);
      const fresh = urls.filter((url) => /^https?:\/\//i.test(url)).map((url, i) => ({ id: `page-${url}`, preview: assetProxy(url), name: `fiche-${i + 1}`, url }));
      return [...kept, ...fresh].slice(0, 8);
    });
  }, []);
  function moveRef(from: number, to: number) {
    if (from === to) return;
    setRefs((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  /* Lien produit en prompt libre, facultatif : la fiche est lue, ses photos deviennent les références. */
  const [productUrl, setProductUrl] = useState("");
  const [productBusy, setProductBusy] = useState(false);
  const [product, setProduct] = useState<ProductInput | null>(null);
  /* Style de créa, facultatif : vide, le prompt part tel quel ; choisi, ses consignes s'ajoutent au prompt. */
  const [productType, setProductType] = useState(NO_STYLE);
  const [pageLabel, setPageLabel] = useState("");
  /* Le prompt libre est l'entrée principale : brief naturel, produit et inspiration facultatifs, Hermes décide des angles. */
  const [mode, setMode] = useState<"batch" | "prompt">("prompt");
  /* La fiche chargée en prompt libre est « ce produit » pour Ask Hermes ; en mode lot, c'est CreativeBatch qui publie la sienne. */
  usePublishHermesContext(
    "static-studio-product",
    mode === "prompt" && activeProduct
      ? { pageType: "product-creative-workspace", productId: activeProduct.id, productName: activeProduct.name, productUrl: activeProduct.url, storeName: activeProduct.store, ...(primary ? { primaryReferenceUrl: primary.url, primaryReferenceType: primary.type } : {}) }
      : mode === "prompt" && product
        ? { pageType: "product", productName: product.name, ...(productUrl.trim() ? { productUrl: productUrl.trim() } : {}), ...(product.brand ? { storeName: product.brand } : {}) }
        : null
  );
  /** Créa ouverte en grand, et lot coché pour un export groupé. */
  const [zoom, setZoom] = useState<string | null>(null);
  const router = useRouter();
  /** Envoie le rendu ouvert dans Remove Magic : gomme au pinceau, l'IA rebouche. */
  async function eraseWithAi(url: string) {
    try {
      const blob = await (await fetch(url)).blob();
      const dataUrl = await fileToDataUrl(new File([blob], "creative.png", { type: blob.type || "image/png" }));
      sessionStorage.setItem(STUDIO_REMOVE_SOURCE_KEY, dataUrl);
      setZoom(null);
      router.push("/studio/remove");
    } catch {
      toast.error("Image illisible");
    }
  }

  /* Aperçu ouvert : Échap le ferme, et la page derrière ne défile plus. */
  useEffect(() => {
    if (!zoom && !refZoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoom(null);
        setRefZoom(null);
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [zoom, refZoom]);
  const [picked, setPicked] = useState<string[]>([]);
  /** En mode sélection, un clic n'agrandit plus : il coche. */
  const [selectMode, setSelectMode] = useState(false);

  const activePrompts = useMemo(
    () => prompts.filter((_, i) => selected[i] !== false),
    [prompts, selected]
  );

  const running = useMemo(() => jobs.filter((job) => job.status === "run").length, [jobs]);
  const savedCount = useMemo(() => jobs.filter((job) => job.saved).length, [jobs]);

  /** Nombre de prompts réellement dans la zone — sert à annoncer le total avant de lancer. */
  const genCount = useMemo(() => {
    const fromPaste = splitGeneratePrompts(genPaste);
    return (fromPaste.length ? fromPaste : activePrompts).length || 1;
  }, [genPaste, activePrompts]);

  // Reprend les lots laissés en plan : ceux encore « run » sont re-surveillés
  // par l'effet plus bas, donc leurs images finissent en bibliothèque même si
  // l'onglet a été fermé pendant la génération.
  useEffect(() => {
    const stored = loadStoredJobs();
    if (!stored.length) return;

    /*
     * Une tâche encore « run » après deux heures ne reviendra pas : Kie garde
     * ses résultats bien moins longtemps. Les relancer à chaque ouverture de
     * l'onglet empilait des sondes qui ne trouveraient jamais rien, et c'est
     * cette accumulation qui finissait par ralentir les lots en cours.
     */
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    setJobs(
      stored.map((job) =>
        job.status === "run" && new Date(job.createdAt).getTime() < cutoff
          ? { ...job, status: "err" as const, error: "Expirée — relance la génération" }
          : job
      )
    );
  }, []);

  /*
   * Les créas générées depuis l'espace produit ou Ask Hermes sont rangées en
   * bibliothèque avec leur origine : elles apparaissent ici aussi, et y
   * restent tant qu'on ne les a pas vidées.
   */
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/studio/library", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ items?: StaticCreative[] }>) : { items: [] }))
      .then((body) => {
        const dismissed = new Set(loadDismissed());
        const foreign = (body.items ?? []).filter((item) => (item.origin === "product-workspace" || item.origin === "ask-hermes") && (item.media ?? "image") === "image" && item.resultFiles?.length && !dismissed.has(item.id));
        if (!foreign.length) return;
        setJobs((current) => {
          const known = new Set(current.map((job) => job.id));
          const fresh = foreign.filter((item) => !known.has(item.id)).map(jobFromLibrary);
          if (!fresh.length) return current;
          return [...current, ...fresh].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_KEPT_JOBS);
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, MAX_KEPT_JOBS)));
    } catch {
      // stockage plein ou indisponible : on garde juste l'état en mémoire
    }
  }, [jobs]);

  const patchJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }, []);

  /** Surveille une tâche jusqu'au bout et l'enregistre dès qu'elle sort. */
  const watchJob = useCallback(
    async (job: Job) => {
      if (!job.taskId) return;
      try {
        const task = await pollStudioTask(job.taskId);
        let saved = false;
        if (task.urls.length) {
          try {
            await saveStaticCreative({
              brief: job.brief,
              prompt: job.prompt,
              ratio: job.ratio,
              resolution: job.resolution === "2K" ? "2K" : "1K",
              resultUrls: task.urls,
              referenceUrls: job.referenceUrls,
              media: job.kind ?? "image",
            });
            saved = true;
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Sauvegarde bibliothèque impossible");
          }
        }
        patchJob(job.id, { urls: task.urls, status: "ok", saved });
      } catch (error) {
        patchJob(job.id, {
          status: "err",
          error: error instanceof Error ? error.message : "Échec",
        });
      } finally {
        releaseTask(job.taskId);
      }
    },
    [patchJob]
  );

  // Chaque tâche est suivie indépendamment : une image s'affiche et part en
  // bibliothèque dès qu'elle est prête, sans attendre le reste du lot.
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== "run" || !job.taskId) continue;
      if (!claimTask(job.taskId)) continue;
      // Le suivi démarre hors du rendu de l'effet : il met à jour la grille au fil des retours de Kie.
      void Promise.resolve().then(() => watchJob(job));
    }
  }, [jobs, watchJob]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STUDIO_REUSE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(STUDIO_REUSE_KEY);
      const data = JSON.parse(raw) as { brief?: string; prompt?: string; refDataUrls?: string[] };
      if (data.brief) setBrief(data.brief);
      if (data.prompt) {
        setPrompts([data.prompt]);
        setSelected({ 0: true });
        setGenPaste(data.prompt);
        setPromptsOpen(true);
      }
      if (data.refDataUrls?.length) {
        setRefs(
          data.refDataUrls.map((dataUrl, i) => ({
            id: `reuse-${i}`,
            preview: dataUrl,
            dataUrl,
            name: `ref-${i + 1}.png`,
          }))
        );
      }
    } catch {
      // ignore
    }
  }, []);

  /**
   * Copie une image dans le presse-papiers, en PNG : c'est le seul format
   * d'image que les navigateurs acceptent d'écrire. Un JPEG passe par un canvas.
   */
  async function copyImage(url: string) {
    try {
      const res = await fetch(url);
      let blob = await res.blob();
      if (blob.type !== "image/png") {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("Conversion impossible"))), "image/png")
        );
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Image copiée");
    } catch {
      toast.error("Copie impossible — télécharge l'image à la place");
    }
  }

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copié`);
    } catch {
      toast.error("Copie impossible");
    }
  }

  /** Remet le prompt, le brief et les références d'une créa dans le formulaire. */
  async function reuseJob(job: Job) {
    if (job.brief) setBrief(job.brief);
    setPrompts([job.prompt]);
    setSelected({ 0: true });
    setGenPaste(job.prompt);
    setPromptsOpen(true);
    const loaded = await Promise.all(
      job.referenceUrls.slice(0, 8).map(async (url, i) => {
        try {
          const blob = await (await fetch(assetProxy(url))).blob();
          const dataUrl = await fileToDataUrl(new File([blob], `ref-${i + 1}.png`, { type: blob.type || "image/png" }));
          return { id: `reuse-${job.id}-${i}`, preview: dataUrl, dataUrl, name: `ref-${i + 1}.png` } as RefImage;
        } catch {
          return null;
        }
      })
    );
    const refsLoaded = loaded.filter((ref): ref is RefImage => ref !== null);
    if (refsLoaded.length) setRefs(refsLoaded);
    setZoom(null);
    toast.success(`Prompt${refsLoaded.length ? ` et ${refsLoaded.length} référence(s)` : ""} remis dans le formulaire`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * Un prompt complet depuis la fiche, sans IA : le même constructeur que la
   * production en lot, avec le type de créa choisi. Utile quand le passage
   * Claude de Kie est tombé, et comme point de départ à retoucher.
   */
  function promptFromProduct(source: ProductInput, typeId: string) {
    const type = CREATIVE_TYPES.find((item) => item.id === typeId) ?? CREATIVE_TYPES[0];
    return buildCreativePrompt({
      creativeType: type,
      angleIds: [],
      visualElementIds: type.defaultVisualElements,
      productName: source.name,
      productCategory: categoryOf(source.kind),
      productDescription: source.description,
      price: source.price,
      comparePrice: source.comparePrice,
      keyPoints: source.keyPoints.filter(Boolean),
      variation: 0,
      autoMix: true,
      randomElements: true,
      seed: Date.now() % 100000,
    });
  }

  async function loadProduct() {
    const url = productUrl.trim();
    if (!/^https?:\/\//i.test(url)) return toast.error("Colle le lien complet de la page produit");
    setProductBusy(true);
    try {
      const res = await fetch("/api/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch", url }),
      });
      const body = (await res.json()) as { product?: ProductInput; error?: string };
      if (!res.ok || !body.product) throw new Error(body.error || "Fiche illisible");
      const found = body.product;
      setProduct(found);
      setPageRefs(found.imageUrls.filter((item) => /^https:\/\//i.test(item)).slice(0, 6));
      setBrief(`${url}\n${found.name}${found.description ? ` — ${found.description}` : ""}${found.price ? ` · ${found.price}` : ""}`);
      if (productType) setGenPaste(promptFromProduct(found, productType));
      toast.success(`${found.name} chargé · ${found.imageUrls.length} photo(s) en référence${productType ? " · prompt prêt" : " · écris ton prompt"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fiche illisible");
    } finally {
      setProductBusy(false);
    }
  }

  async function addRefs(files: FileList | File[]) {
    const next = await Promise.all(
      [...files].slice(0, 8 - refs.length).map(async (file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        preview: URL.createObjectURL(file),
        dataUrl: await fileToDataUrl(file),
        name: file.name,
      }))
    );
    setRefs((list) => [...list, ...next].slice(0, 8));
  }

  async function expand() {
    if (!brief.trim()) {
      toast.error("Écris tes consignes (le lien produit est facultatif)");
      return;
    }
    setBusy("expand");
    setPromptsOpen(true);
    try {
      const body = await studioPost<{
        prompts: string[];
        referenceUrls?: string[];
        product?: { title?: string; url?: string; price?: string };
        sheet?: { name?: string; price?: string };
        engine?: "claude" | "fallback";
        fallbackReason?: string;
      }>({
        action: "expand",
        brief,
        count,
        ratio,
        // La première image chargée sert de créa de référence au moteur (structure, hiérarchie, callouts).
        referenceDataUrl: refs.find((ref) => ref.dataUrl)?.dataUrl,
      });
      setPrompts(body.prompts);
      setSelected(Object.fromEntries(body.prompts.map((_, i) => [i, true])));
      setGenPaste(body.prompts.join("\n\n"));
      setPageRefs(body.referenceUrls || []);
      const label = [body.sheet?.name || body.product?.title, body.sheet?.price || body.product?.price].filter(Boolean).join(" · ");
      setPageLabel(label);
      if (body.engine === "fallback") {
        toast.warning(`Moteur IA indisponible (${body.fallbackReason ?? "?"}) — prompts de repli écrits depuis la fiche, à retoucher`);
      } else {
        toast.success(label ? `Page lue — ${label} · ${body.prompts.length} prompt(s)` : `${body.prompts.length} prompt(s) prêts`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Expand impossible");
    } finally {
      setBusy(null);
    }
  }

  /**
   * `override` sert au mode lot : les prompts viennent d'être fabriqués et
   * `setGenPaste` ne les aura pas encore appliqués au moment de l'appel — un
   * état React n'est pas lu dans le tour où on l'écrit.
   */
  async function generate(override?: string[]) {
    const fromPaste = override?.length ? override : splitGeneratePrompts(genPaste);
    const typed = fromPaste.length ? fromPaste : activePrompts.length ? activePrompts : [];
    // Sans prompt mais avec des références, une consigne neutre les reproduit telles quelles.
    // Le style choisi s'ajoute au prompt libre ; les prompts d'un lot sont déjà complets.
    const base = resolveFreePrompts({
      prompts: typed,
      styleId: override?.length ? NO_STYLE : productType,
      hasReferences: refs.length > 0,
    });
    if (!base.length) {
      toast.error("Écris un prompt ou ajoute au moins une image de référence");
      return;
    }
    // Un seul prompt : Batch décide du nombre de variantes. Plusieurs prompts
    // (expand, ou séparés par `---`) : une image chacun, le Batch a déjà servi
    // à décider combien de prompts écrire.
    const list =
      base.length === 1 && !override?.length
        ? Array.from({ length: Math.max(1, count) }, () => base[0])
        : base;

    // `busy` ne couvre que la création des tâches, pas leur exécution : dès que
    // Kie a rendu les taskId, la main est libre pour lancer un autre lot.
    setBusy("gen");
    try {
      // Dans l'ordre affiché : les fichiers sont envoyés, les photos de fiche partent telles quelles.
      const referenceUrls: string[] = [];
      for (const ref of refs) {
        if (ref.url) {
          if (!referenceUrls.includes(ref.url)) referenceUrls.push(ref.url);
          continue;
        }
        if (!ref.dataUrl) continue;
        const uploaded = await studioPost<{ url: string }>({
          action: "upload",
          imageDataUrl: ref.dataUrl,
          fileName: ref.name.replace(/[^\w.-]+/g, "-") || `ref-${Date.now()}.png`,
        });
        if (uploaded.url) referenceUrls.push(uploaded.url);
      }
      const body = await studioPost<{
        jobs: Array<{ prompt: string; taskId: string }>;
        referenceUrls?: string[];
        skipped?: number;
        skippedReason?: string | null;
        model?: string;
        kind?: "image" | "video";
      }>({
        action: "image",
        prompts: list,
        ratio,
        resolution,
        referenceUrls,
        model: modelId,
        ...(family.kind === "video" ? { duration } : {}),
      });
      const savedRefs = body.referenceUrls?.length ? body.referenceUrls : referenceUrls;
      const stamp = Date.now();

      // Les nouveaux passent devant, les lots précédents restent à l'écran.
      setJobs((current) =>
        [
          ...body.jobs.map((job, index) => ({
            id: `${stamp}-${index}`,
            prompt: job.prompt,
            taskId: job.taskId,
            urls: [],
            status: "run" as const,
            saved: false,
            brief,
            ratio,
            resolution,
            referenceUrls: savedRefs,
            createdAt: new Date().toISOString(),
            model: body.model ?? modelId,
            kind: body.kind ?? family.kind,
          })),
          ...current,
        ].slice(0, MAX_KEPT_JOBS)
      );

      toast.success(`${body.jobs.length} génération(s) lancée(s) — tu peux en relancer d'autres`);
      // Kie a refusé une partie du lot : le dire, plutôt que laisser compter.
      if (body.skipped) {
        toast.error(
          `${body.skipped} refusée(s) par Kie — ${body.skippedReason || "cadence trop élevée"}`
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  function clearFinished() {
    setJobs((current) => {
      const gone = current.filter((job) => job.status !== "run" && job.origin).map((job) => job.id);
      if (gone.length) {
        try {
          window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...loadDismissed(), ...gone])].slice(-300)));
        } catch {
          // sans stockage, ces rendus reviendront au prochain chargement
        }
      }
      return current.filter((job) => job.status === "run");
    });
  }

  /** Auto · brief : le texte est un brief, Hermes le découpe en N prompts distincts, montrés avant de générer. */
  async function planFromBrief(ignoreReference = false) {
    if (!genPaste.trim()) {
      toast.error("Écris ton brief (« Create 5 ads… »)");
      return;
    }
    const wantedRatio = parseRequestedRatio(genPaste);
    if (wantedRatio && family.ratios.includes(wantedRatio as Ratio) && wantedRatio !== ratio) setRatio(wantedRatio as Ratio);
    setPlanning(true);
    setVisionWarning(null);
    try {
      const fresh = await requestPlan({
        brief: genPaste,
        count: planCount,
        ratio: wantedRatio ?? ratio,
        hasReference: activeProduct ? Boolean(primary) : refs.length > 0,
        productId: activeProduct?.id ?? null,
        product: !activeProduct && product ? { name: product.name, ...(product.brand ? { store: product.brand } : {}), ...(productUrl.trim() ? { url: productUrl.trim() } : {}), ...(product.price ? { price: product.price } : {}) } : null,
        // L'inspiration explicite, sinon la première référence chargée, est la créa que le batch suit.
        referenceDataUrl: inspirationImage,
        ignoreReference,
        competitorInspiration,
      });
      setPlan(fresh);
      setPlanSelected(new Set(fresh.creatives.map((creative) => creative.index)));
      toast.success(`${fresh.creatives.length} prompt${fresh.creatives.length > 1 ? "s" : ""} planifié${fresh.creatives.length > 1 ? "s" : ""} par ${fresh.engine === "hermes" ? "Hermes" : "Claude"}${fresh.referenceSeen ? " · référence lue" : ""}`);
    } catch (error) {
      setPlan(null);
      if (error instanceof VisionUnavailableError) setVisionWarning(error.message);
      else toast.error(error instanceof Error ? error.message : "Planification impossible");
    } finally {
      setPlanning(false);
    }
  }

  async function rewritePlanned(index: number) {
    if (!plan) return;
    setRewriting(index);
    try {
      const fresh = (await requestPlan({ brief: genPaste, count: 1, ratio, hasReference: activeProduct ? Boolean(primary) : refs.length > 0, productId: activeProduct?.id ?? null, product: !activeProduct && product ? { name: product.name } : null, avoid: avoidList(plan, index), referenceDataUrl: inspirationImage, competitorInspiration })).creatives[0];
      if (!fresh) throw new Error("Aucune créa renvoyée");
      setPlan((current) => (current ? patchPlan(current, index, fresh) : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Réécriture impossible");
    } finally {
      setRewriting(null);
    }
  }

  /** Avec un produit actif : la génération confirmée passe par le Creative Engine, référence produit en seule image. */
  async function confirmProductGeneration() {
    if (!activeProduct || !drafts.length) return;
    setLaunching(true);
    try {
      const batch = await launchFromPrompts({ product: activeProduct, drafts, brief: genPaste, ratio, resolution, primaryUrl: primary?.url ?? null, inspiration: inspirationSent ? inspirationImage : null });
      setGeneration(launchedState(batch));
      setPreviewOpen(false);
      toast.success(`Lot #${String(batch.number).padStart(3, "0")} lancé · ${batch.items.length} image${batch.items.length > 1 ? "s" : ""} — visible dans l'onglet Produit et ici une fois sorties`);
      void ctx.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setLaunching(false);
    }
  }

  /** Les prompts cochés remplacent le brief (un par ligne ---) et partent par le bouton Générer habituel : une image chacun. */
  function usePlannedPrompts() {
    if (!plan) return;
    const chosen = plan.creatives.filter((creative) => planSelected.has(creative.index)).map((creative) => creative.prompt.trim()).filter(Boolean);
    if (!chosen.length) return;
    setGenPaste(chosen.join("\n---\n"));
    setCount(1);
    setPromptMode("exact");
    setPlan(null);
    // Sans produit actif, l'inspiration est la référence visuelle : elle rejoint les références pour partir avec la génération.
    if (inspiration && !refs.some((ref) => ref.dataUrl === inspiration)) {
      setRefs((list) => [{ id: `inspiration-${Date.now()}`, preview: inspiration, dataUrl: inspiration, name: "inspiration.png" }, ...list].slice(0, 8));
    }
    toast.success(`${chosen.length} prompt${chosen.length > 1 ? "s" : ""} prêt${chosen.length > 1 ? "s" : ""} — clique Générer pour lancer ${chosen.length} image${chosen.length > 1 ? "s" : ""}`);
  }

  /**
   * « Vider les terminées » ne touche qu'à l'affichage : chaque rendu a été
   * écrit en bibliothèque au moment où il est sorti. On peut donc remettre
   * les dernières créas du studio dans la grille, sans rien régénérer.
   */
  const [restoring, setRestoring] = useState(false);
  async function restoreFromLibrary() {
    setRestoring(true);
    try {
      const res = await fetch("/api/studio/library", { cache: "no-store" });
      if (!res.ok) throw new Error("Bibliothèque injoignable");
      const body = (await res.json()) as { items?: Array<StaticCreative & { source?: string; media?: string }> };
      const items = (body.items ?? []).filter(
        (item) => (item.source ?? "static") === "static" && (item.media ?? "image") === "image" && item.resultFiles?.length
      );
      setJobs((current) => {
        const known = new Set(current.map((job) => job.id));
        const restored: Job[] = items
          .filter((item) => !known.has(item.id))
          .slice(0, MAX_KEPT_JOBS)
          .map((item) => ({
            id: item.id,
            prompt: item.prompt,
            urls: item.resultFiles.map((file) => libraryFileUrl(item.id, file)),
            status: "ok" as const,
            saved: true,
            brief: item.brief,
            ratio: item.ratio,
            resolution: item.resolution,
            referenceUrls: (item.refFiles ?? []).map((file) => libraryFileUrl(item.id, file)),
            createdAt: item.createdAt,
          }));
        const merged = [...current, ...restored].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        toast.success(restored.length ? `${restored.length} créa(s) remises depuis la bibliothèque` : "Rien de nouveau à remettre");
        return merged.slice(0, MAX_KEPT_JOBS);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restauration impossible");
    } finally {
      setRestoring(false);
    }
  }

  /** Sans argument : tout le lot. Avec : seulement les créas cochées. */
  async function zipAll(only?: string[]) {
    const urls = only?.length
      ? jobs.flatMap((job) => job.urls).filter((url) => only.includes(assetProxy(url)))
      : jobs.flatMap((job) => job.urls);
    if (!urls.length) return;
    const zip = new JSZip();
    await Promise.all(
      urls.map(async (url, i) => {
        const res = await fetch(assetProxy(url));
        zip.file(`creative-${i + 1}.png`, await res.blob());
      })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `creatives-${ratio.replace(":", "x")}.zip`;
    a.click();
  }

  return (
    <div className={cn("grid gap-3", promptsOpen ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-1")}>
      <aside className="rounded-2xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <button
          type="button"
          onClick={() => setPromptsOpen((open) => !open)}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
        >
          <span className="text-[12px] font-semibold">Prompts</span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition", promptsOpen ? "rotate-0" : "-rotate-90")} />
        </button>
        {promptsOpen ? (
          <div className="space-y-2 border-t border-slate-100 px-2.5 pb-2.5 pt-2 dark:border-slate-800">
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={"Tes consignes (lien produit facultatif)\nUGC cuisine, femme 35 ans, lumière iPhone, packshot lisible"}
              rows={7}
              className="w-full resize-none rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] leading-relaxed outline-none dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => void expand()}
              disabled={busy !== null}
              className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-slate-100 text-[12px] font-medium dark:bg-slate-800"
            >
              {busy === "expand" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Sortir les prompts
            </button>
            {prompts.length ? (
              <div className="max-h-[46vh] space-y-1 overflow-auto pr-0.5">
                {prompts.map((prompt, i) => (
                  <label key={i} className="flex gap-1.5 rounded-lg bg-slate-50 p-1.5 text-[11px] leading-snug dark:bg-slate-800/80">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected[i] !== false}
                      onChange={(e) => setSelected((s) => ({ ...s, [i]: e.target.checked }))}
                    />
                    <textarea
                      value={prompt}
                      onChange={(e) =>
                        setPrompts((list) => list.map((item, idx) => (idx === i ? e.target.value : item)))
                      }
                      rows={3}
                      className="w-full resize-none bg-transparent outline-none"
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setGenPaste(activePrompts.join("\n\n"))}
                  className="h-8 w-full rounded-lg bg-slate-900 text-[11px] font-medium text-white dark:bg-white dark:text-slate-900"
                >
                  Coller dans Générer
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      <section className="space-y-2">
        {/* Deux façons de travailler. Le lot pour produire du test en volume, le
            prompt libre pour la main à la pâte — ce dernier reste intact, c'est
            lui qu'on utilise quand on sait déjà exactement ce qu'on veut. */}
        <div className="flex w-fit items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {(
            [
              ["batch", "Production en lot"],
              ["prompt", "Prompt libre"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                mode === id
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "batch" ? (
          <CreativeBatch
            productName={pageLabel}
            busy={busy !== null}
            onProduct={(imageUrls) => setPageRefs(imageUrls.slice(0, 8))}
            ratio={ratio}
            onRatio={setRatio}
            resolution={resolution === "2K" ? "2K" : "1K"}
            onResolution={(value) => setResolution(value)}
            onLaunch={(prompts) => {
              /*
               * Le lot repasse par la zone de prompts : tout l'aval — envoi des
               * références, suivi des tâches, rangement en bibliothèque — est
               * déjà écrit et testé, il n'y a rien à dupliquer.
               */
              setGenPaste(prompts.join("\n---\n"));
              setCount(1);
              void generate(prompts);
            }}
          />
        ) : null}

        {mode === "prompt" ? (
          <div className="space-y-3" data-free-product-context>
            <ActiveProductCard ctx={ctx} title="Produit actif · vérité produit (optionnel)" />
            <ProductGallery ctx={ctx} collapsible />
          </div>
        ) : null}

        <div
          className={cn(
            "rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70",
            mode === "batch" && "hidden"
          )}
        >
          {/* Ligne 0 — lien produit facultatif (sans produit du moteur) : fiche lue, photos en références, et un prompt écrit si un style est choisi. */}
          <div className={cn("mb-2 flex flex-wrap items-center gap-2", activeProduct && "hidden")}>
            <div className="relative min-w-[260px] flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadProduct();
                }}
                placeholder="Facultatif — lien de ta page produit : la fiche est lue et ses photos servent de références"
                className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadProduct()}
              disabled={productBusy}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              {productBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              {product ? "Recharger" : "Charger la fiche"}
            </button>
            {product ? (
              <span className="text-[11px] text-slate-500">
                {product.name}
                {product.price ? ` · ${product.price}` : ""} · {product.imageUrls.length} photo(s)
                {productType ? (
                  <button
                    type="button"
                    onClick={() => product && setGenPaste(promptFromProduct(product, productType))}
                    className="ml-2 font-medium text-emerald-600 hover:underline"
                    title="Réécrire un nouveau prompt depuis la fiche, autre variation"
                  >
                    Nouvelle variation
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>

          {/* Ligne 1 — les références d'abord (dépôt de fichiers, clic pour agrandir, glisser pour réordonner), puis les réglages du rendu. */}
          <div
            data-refs-zone
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl p-1 transition-colors",
              fileOver && "bg-emerald-50 ring-2 ring-dashed ring-emerald-400 dark:bg-emerald-950/30"
            )}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setFileOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setFileOver(false);
              const files = [...e.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
              if (files.length) void addRefs(files);
            }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400" title="Dépose des images ici. Clic : agrandir. Glisser : changer l'ordre.">
              Références{refs.length ? ` ${refs.length}/8` : ""}
            </span>

            {refs.map((ref, index) => (
              <div
                key={ref.id}
                draggable
                data-ref-index={index}
                onDragStart={(e) => {
                  setDragIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(index));
                }}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => {
                  if (dragIndex !== null) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  moveRef(dragIndex, index);
                  setDragIndex(null);
                }}
                className={cn(
                  "group/ref relative h-11 w-11 shrink-0 cursor-grab overflow-hidden rounded-lg ring-1 active:cursor-grabbing",
                  ref.url ? "ring-emerald-500/40" : "ring-slate-900/10",
                  dragIndex === index && "opacity-40"
                )}
                title={`${index + 1} · ${ref.name} — clic : agrandir, glisser : réordonner`}
              >
                <button type="button" onClick={() => setRefZoom(ref)} className="h-full w-full" aria-label={`Agrandir la référence ${index + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.preview} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                </button>
                <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[9px] font-semibold leading-3 text-white">{index + 1}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRefs((list) => list.filter((item) => item.id !== ref.id));
                  }}
                  className="absolute right-0 top-0 rounded bg-black/60 p-0.5 text-white"
                  aria-label={`Retirer la référence ${index + 1}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}

            {refs.length < 8 ? (
              <label
                title="Ajouter une image de référence (ou dépose des fichiers sur la rangée)"
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-dashed ring-slate-300 hover:text-slate-600 dark:bg-slate-800 dark:ring-slate-600"
              >
                <ImagePlus className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void addRefs(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null}

            <div className="ml-auto flex items-center gap-1.5">
              <Picker
                label="Modèle"
                value={modelId}
                onChange={(value) => {
                  const next = modelFamily(value);
                  if (!next) return;
                  setModelId(value);
                  if (next.ratios.length && !next.ratios.includes(ratio)) setRatio(next.ratios[0]);
                  if (next.resolutions.length && !next.resolutions.includes(resolution)) setResolution(next.resolutions[0]);
                  if (next.durations?.length && !next.durations.includes(duration)) setDuration(next.durations[0]);
                }}
              >
                <optgroup label="Image">
                  {MODEL_FAMILIES.filter((item) => item.kind === "image").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}{item.imageModel ? "" : " · texte seul"}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Vidéo">
                  {MODEL_FAMILIES.filter((item) => item.kind === "video").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}{item.imageModel ? "" : " · texte seul"}
                    </option>
                  ))}
                </optgroup>
              </Picker>
              <Picker
                label="Style"
                value={productType}
                onChange={(value) => {
                  setProductType(value);
                  if (product && value) setGenPaste(promptFromProduct(product, value));
                }}
              >
                <option value={NO_STYLE}>Aucun · prompt tel quel</option>
                {CREATIVE_TYPES.filter((item) => item.enabled).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Picker>
              {family.ratios.length ? (
                <Picker label="Ratio" value={ratio} onChange={(value) => setRatio(value as Ratio)}>
                  {RATIOS.filter((item) => family.ratios.includes(item.id)).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.hint}
                    </option>
                  ))}
                </Picker>
              ) : null}
              {family.resolutions.length ? (
                <Picker label="Taille" value={resolution} onChange={(value) => setResolution(value)}>
                  {family.resolutions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Picker>
              ) : null}
              {family.kind === "video" && family.durations?.length ? (
                <Picker label="Durée" value={String(duration)} onChange={(value) => setDuration(Number(value))}>
                  {family.durations.map((item) => (
                    <option key={item} value={item}>
                      {item} s
                    </option>
                  ))}
                </Picker>
              ) : null}
              <Picker label="Batch" value={String(count)} onChange={(value) => setCount(Number(value))}>
                {COUNTS.map((n) => (
                  <option key={n} value={n}>
                    ×{n}
                  </option>
                ))}
              </Picker>
            </div>
          </div>

          {pageLabel && !activeProduct ? (
            <p className="mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">Page lue : {pageLabel}</p>
          ) : null}
          {promptMode === "auto" ? (
            <div className="mt-2">
              <CreativeReferenceSlot value={inspiration} onChange={setInspiration} hint={activeProduct ? "Pub concurrente ou créa de style : le batch en garde l'angle, la structure et le style ; le produit, sa photo et ses faits restent ceux du produit actif." : "Pub concurrente ou créa de style : le batch en garde la structure et le style. Sans produit actif, la 1re référence chargée joue ce rôle."} />
            </div>
          ) : null}

          {/* Ligne 2 — le prompt, tenu bas par défaut. Le coin se tire à la souris
              pour relire un prompt entier sans changer d'écran. */}
          <div className="mt-2 flex items-start gap-2">
            <textarea
              value={genPaste}
              onChange={(e) => {
                setGenPaste(e.target.value);
                setCountOverride(null);
              }}
              onPaste={(e) => {
                // Une image dans le presse-papiers (capture, copie depuis le navigateur) devient une référence, sans passer par un fichier.
                const files = [...(e.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
                if (!files.length) return;
                e.preventDefault();
                void addRefs(files);
                toast.success(`${files.length} image${files.length > 1 ? "s" : ""} ajoutée${files.length > 1 ? "s" : ""} aux références`);
              }}
              rows={2}
              placeholder={promptMode === "auto" ? "Ton brief, comme à Hermes : « Create 5 ultra realistic static ads, iPhone candid, ratio 3:4… » — chaque créa aura son prompt" : "Ton prompt, envoyé tel quel (aucun style ajouté sauf si tu en choisis un). Plusieurs : sépare-les par une ligne ---"}
              className="min-h-[38px] flex-1 resize-y rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] leading-relaxed outline-none dark:bg-slate-800"
              data-free-prompt
            />
            {promptMode === "auto" ? (
              <button
                type="button"
                onClick={() => void planFromBrief()}
                disabled={busy !== null || planning || !genPaste.trim()}
                title="Hermes découpe le brief en N prompts distincts, montrés avant de générer"
                className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-medium text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
                data-plan-brief
              >
                {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {planning ? "Planification…" : `Planifier ${planCount} créa${planCount > 1 ? "s" : ""}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy !== null}
                title="Lancer la génération"
                className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-medium text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
              >
                {busy === "gen" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Générer
              </button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Mode du prompt">
              {(
                [
                  ["auto", "Auto · brief"],
                  ["exact", "Prompt exact"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={promptMode === id} onClick={() => { setPromptMode(id); if (id === "exact") setPlan(null); }} className={cn("rounded px-2 py-0.5 text-[10.5px] font-medium", promptMode === id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")} data-prompt-mode={id}>
                  {label}
                </button>
              ))}
            </div>
            {promptMode === "auto" ? (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500" title="Nombre d'images lu dans le brief ; modifiable">
                <span className="font-semibold uppercase tracking-wide">Créas</span>
                <input type="number" min={1} max={30} value={planCount} onChange={(event) => setCountOverride(Math.min(30, Math.max(1, Number(event.target.value) || 1)))} className="w-14 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800" data-plan-count-input />
                <span className="text-[10px] text-slate-400">{countOverride === null ? "détecté" : "modifié"}</span>
              </label>
            ) : null}
          </div>

          <p className="mt-1 text-[11px] text-slate-400">
            {promptMode === "auto"
              ? `Auto · brief : « Create 5 ads… » donne ${planCount} prompt${planCount > 1 ? "s" : ""} distinct${planCount > 1 ? "s" : ""} par Hermes, ${planCount} image${planCount > 1 ? "s" : ""}, à relire avant de générer.${promptsOnly ? " « Prompts only » lu : rien ne part sans ton clic." : ""}${activeProduct ? ` Produit actif : ${activeProduct.name}${primary ? ", sa référence principale part avec chaque image" : ", sans référence principale (texte seul)"}.` : product ? ` Produit : ${product.name}.` : ""}${inspiration ? " Inspiration jointe : structure et style suivis, faits concurrents écartés." : refs.some((ref) => ref.dataUrl) ? " La 1re référence chargée est la créa que le batch suit." : ""}${!activeProduct && refs.length ? " Les références partent avec chaque prompt." : ""} `
              : null}
            {promptMode === "exact" && !genPaste.trim() && !activePrompts.length && refs.length
              ? `Sans prompt : les références sont reproduites telles quelles × Batch ×${count}.`
              : genCount === 1
                ? `1 prompt × Batch ×${count} → ${Math.max(1, count)} image${count > 1 ? "s" : ""}.`
                : `${genCount} prompts (séparés par ---) → ${genCount} images, une par prompt.`}
            {productType && styleInstructions(productType) ? ` Style « ${CREATIVE_TYPES.find((item) => item.id === productType)?.name} » ajouté au prompt.` : " Sans style : le prompt part tel quel."}
            {` Modèle : ${family.label}${family.kind === "video" ? ` (vidéo ${duration} s)` : ""}.`}
            {refs.length && !family.imageModel ? " Ce modèle ne prend pas de référence : retire-les ou change de modèle." : ""}
            {family.note ? ` ${family.note}` : ""}
          </p>
        </div>

        {mode === "prompt" && promptMode === "auto" ? (
          <CompetitorResearchPanel
            productId={activeProduct?.id ?? null}
            productName={activeProduct?.name ?? null}
            active={competitorInspiration ? { domain: competitorInspiration.domain, ads: competitorInspiration.creatives.length } : null}
            onUse={(next) => {
              setCompetitorInspiration(next);
              setPlan(null);
            }}
          />
        ) : null}
        {mode === "prompt" && promptMode === "auto" && competitorInspiration ? (
          <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-1.5 text-[11.5px] text-sky-900 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800" data-competitor-inspiration>
            <span>Inspiration Brand Search : <span className="font-semibold">{competitorInspiration.domain}</span> · {competitorInspiration.creatives.length} pub{competitorInspiration.creatives.length > 1 ? "s" : ""} · {competitorInspiration.patterns.length} motif{competitorInspiration.patterns.length > 1 ? "s" : ""}{activeProduct ? ` → adaptées à ${activeProduct.name}` : ""}</span>
            <button type="button" onClick={() => setCompetitorInspiration(null)} className="ml-auto text-sky-700 hover:text-sky-900 dark:text-sky-300" aria-label="Retirer l'inspiration concurrente" data-competitor-inspiration-clear>×</button>
          </div>
        ) : null}
        {mode === "prompt" && promptMode === "auto" && visionWarning ? <VisionWarning message={visionWarning} busy={planning} onContinue={() => void planFromBrief(true)} onDismiss={() => setVisionWarning(null)} /> : null}

        {mode === "prompt" && promptMode === "auto" && plan ? (
          <PlanCards
            plan={plan}
            withProduct={Boolean(activeProduct)}
            selected={planSelected}
            onSelect={setPlanSelected}
            onEdit={(index, value) => setPlan((current) => (current ? patchPlan(current, index, { prompt: value }) : current))}
            onRewrite={(index) => void rewritePlanned(index)}
            rewriting={rewriting}
            actionLabel={(n) => (activeProduct ? `Générer la sélection (${n})` : `Utiliser ces ${n} prompt${n > 1 ? "s" : ""}`)}
            onAction={activeProduct ? () => setPreviewOpen(true) : usePlannedPrompts}
          />
        ) : null}

        {mode === "prompt" && activeProduct && previewOpen && drafts.length ? (
          <BatchPreview
            product={activeProduct}
            primaryUrl={primary?.url ?? null}
            inspiration={inspirationImage}
            inspirationSent={inspirationSent}
            drafts={drafts}
            exact={false}
            ratio={ratio}
            resolution={resolution}
            model={primary || inspirationSent ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image"}
            launching={launching}
            onCancel={() => setPreviewOpen(false)}
            onConfirm={() => void confirmProductGeneration()}
          />
        ) : null}

        {mode === "prompt" && generation ? (
          <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
            <GenerationStatus generation={generation} onUpdate={setGeneration} onDismiss={() => setGeneration(null)} />
          </section>
        ) : null}

        <div className="min-h-[48vh] rounded-2xl bg-slate-50/80 p-2 ring-1 ring-slate-900/[0.04] dark:bg-slate-950/40">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="text-[11px] text-slate-400">
              {jobs.length ? (
                <>
                  {running ? (
                    <span className="font-medium text-slate-600 dark:text-slate-300">{running} en cours · </span>
                  ) : null}
                  {jobs.length - running} terminée(s)
                  {savedCount ? ` · ${savedCount} en bibliothèque` : ""}
                </>
              ) : (
                "Les visuels arrivent ici"
              )}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void restoreFromLibrary()}
                disabled={restoring}
                title="Remet dans la grille les dernières créas enregistrées en bibliothèque"
                className="text-[11px] font-medium text-slate-500 disabled:opacity-50"
              >
                {restoring ? "Restauration…" : "Restaurer depuis la bibliothèque"}
              </button>
              {jobs.length - running > 0 ? (
                <button type="button" onClick={clearFinished} className="text-[11px] font-medium text-slate-500">
                  Vider les terminées
                </button>
              ) : null}
              {jobs.some((j) => j.urls.length) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode((value) => !value);
                    setPicked([]);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold",
                    selectMode
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  )}
                >
                  <CheckSquare className="h-3 w-3" />
                  {selectMode ? "Terminer" : "Sélectionner"}
                </button>
              ) : null}
              {jobs.some((j) => j.urls.length) ? (
                <button type="button" onClick={() => void zipAll()} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  <Download className="h-3 w-3" />
                  ZIP batch
                </button>
              ) : null}
            </div>
          </div>
          <div
            className={cn(
              "grid items-start gap-2",
              isWideRatio(jobs[0]?.ratio ?? ratio) || (jobs[0]?.ratio ?? ratio) === "1:1" ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4"
            )}
          >
            {jobs.map((job) => {
              const src = job.urls[0] ? assetProxy(job.urls[0]) : null;
              const chosen = src ? picked.includes(src) : false;
              return (
                <article
                  key={job.id}
                  className={cn(
                    "overflow-hidden rounded-xl bg-white ring-1 dark:bg-slate-900",
                    chosen ? "ring-2 ring-emerald-500" : "ring-slate-900/[0.06]"
                  )}
                >
                  {/* Chaque rendu garde le ratio avec lequel il a été généré : changer le réglage des prochaines créas ne déforme pas les précédentes. */}
                  <div className={cn("relative bg-slate-100 dark:bg-slate-800", ratioAspect(job.ratio))}>
                    {src ? (
                      <>
                        {/* Un clic ouvre en grand : une créa se juge à sa taille
                            réelle, pas dans une vignette de la grille. */}
                        {/* Toute la vignette est cliquable : viser une case de
                            5 px pour cocher trente créas est le genre de détail
                            qui décourage de trier. */}
                        <button
                          type="button"
                          onClick={() =>
                            selectMode
                              ? setPicked((current) =>
                                  current.includes(src)
                                    ? current.filter((item) => item !== src)
                                    : [...current, src]
                                )
                              : setZoom(src)
                          }
                          title={selectMode ? (chosen ? "Retirer" : "Sélectionner") : "Voir en grand"}
                          className="block h-full w-full"
                        >
                          {job.kind === "video" ? (
                            <video src={src} muted playsInline loop autoPlay preload="metadata" className={cn("h-full w-full object-cover transition-opacity", selectMode && !chosen && "opacity-60")} />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={src}
                              alt=""
                              className={cn(
                                "h-full w-full object-cover transition-opacity",
                                selectMode && !chosen && "opacity-60"
                              )}
                            />
                          )}
                        </button>
                        {selectMode ? (
                          <span
                            className={cn(
                              "pointer-events-none absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md text-[11px] font-bold",
                              chosen
                                ? "bg-emerald-500 text-white"
                                : "bg-slate-950/40 text-white/60 ring-1 ring-white/40"
                            )}
                          >
                            {chosen ? "✓" : ""}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-slate-400">
                        {job.status === "run" ? <Loader2 className="h-5 w-5 animate-spin" /> : job.error || "…"}
                      </div>
                    )}
                  </div>
                  {src ? (
                    <a
                      href={src}
                      download
                      className="block px-2 py-1.5 text-center text-[10px] font-medium text-slate-500"
                    >
                      {job.origin ? <span className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800" data-origin={job.origin} title={job.productName ?? ""}>{job.origin === "product-workspace" ? "Produit" : "Hermes"}</span> : null}
                      Télécharger
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Barre flottante translucide : elle n'apparaît qu'une fois quelque chose
          de coché, et reste sous la main quel que soit l'endroit de la grille
          où on se trouve — remonter en haut pour cliquer « télécharger » après
          avoir coché trente vignettes n'a aucun sens. */}
      {selectMode && picked.length ? (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-950/80 px-3 py-2 text-white shadow-2xl backdrop-blur-md">
            <span className="px-1 text-[12px] font-semibold">
              {picked.length} créa{picked.length > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => void zipAll(picked)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-slate-900"
            >
              <Download className="h-3.5 w-3.5" />
              Télécharger le ZIP
            </button>
            <button
              type="button"
              onClick={() => setPicked([])}
              className="h-8 rounded-lg px-2 text-[12px] font-medium text-white/70 hover:text-white"
            >
              Vider
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false);
                setPicked([]);
              }}
              className="h-8 rounded-lg px-2 text-[12px] font-medium text-white/70 hover:text-white"
            >
              Quitter
            </button>
          </div>
        </div>
      ) : null}

      {refZoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={() => setRefZoom(null)} data-ref-zoom>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={refZoom.preview} alt={refZoom.name} className="max-h-[85vh] w-auto max-w-[90vw] rounded-xl object-contain shadow-2xl" />
            <div className="mt-2 flex items-center justify-between text-[12px] text-slate-200">
              <span>{refZoom.name}</span>
              <button type="button" onClick={() => setRefZoom(null)} className="rounded-lg bg-white/10 px-2 py-1 hover:bg-white/20" aria-label="Fermer">
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {zoom ? (() => {
        const job = jobs.find((item) => item.urls.some((url) => assetProxy(url) === zoom));
        const tech = job
          ? `GPT Image 2 · ${job.referenceUrls.length ? "image vers image" : "texte vers image"}`
          : "GPT Image 2";
        const when = job ? new Date(job.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
        const section = "mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500";
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
            onClick={() => setZoom(null)}
          >
            <div
              className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 md:flex-row"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
                {job?.kind === "video" ? (
                  <video src={zoom} controls autoPlay playsInline className="max-h-[85vh] w-auto max-w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={zoom} alt="" className="max-h-[85vh] w-auto max-w-full object-contain" />
                )}
              </div>

              <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto p-4 md:w-[340px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{tech}</div>
                    <div className="text-[11px] text-slate-500">
                      {job ? `${job.ratio} · ${job.resolution} · ${job.referenceUrls.length} référence(s)` : ""}
                      {when ? ` · ${when}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setZoom(null)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPicked((current) =>
                        current.includes(zoom) ? current.filter((item) => item !== zoom) : [...current, zoom]
                      )
                    }
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold",
                      picked.includes(zoom)
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                    )}
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    {picked.includes(zoom) ? "Sélectionnée" : "Sélectionner"}
                  </button>
                  {job?.kind !== "video" ? (
                    <button
                      type="button"
                      onClick={() => void copyImage(zoom)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copier l&apos;image
                    </button>
                  ) : null}
                  <SendToDrive url={zoom} name={`crea-${job?.id ?? "studio"}.${job?.kind === "video" ? "mp4" : "png"}`} />
                  {job?.kind !== "video" ? (
                    <button
                      type="button"
                      onClick={() => void eraseWithAi(zoom)}
                      title="Gomme un élément au pinceau, l'IA rebouche la zone (Remove Magic)"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                      data-erase-ai
                    >
                      <Eraser className="h-3.5 w-3.5" />
                      Effacer avec l&apos;IA
                    </button>
                  ) : null}
                  <a
                    href={zoom}
                    download
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Télécharger
                  </a>
                  {job ? (
                    <button
                      type="button"
                      onClick={() => void reuseJob(job)}
                      title="Remet le prompt, le brief et les références dans le formulaire"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Réutiliser
                    </button>
                  ) : null}
                </div>

                {job?.prompt ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <div className={section}>Prompt</div>
                      <button
                        type="button"
                        onClick={() => void copyText(job.prompt, "Prompt")}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline"
                      >
                        <Copy className="h-3 w-3" />
                        Copier
                      </button>
                    </div>
                    <p className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                      {job.prompt}
                    </p>
                  </div>
                ) : null}

                {job?.brief ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <div className={section}>Brief</div>
                      <button
                        type="button"
                        onClick={() => void copyText(job.brief, "Brief")}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline"
                      >
                        <Copy className="h-3 w-3" />
                        Copier
                      </button>
                    </div>
                    <p className="max-h-[18vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                      {job.brief}
                    </p>
                  </div>
                ) : null}

                {job?.referenceUrls.length ? (
                  <div>
                    <div className={section}>Références — clic : copier l&apos;image</div>
                    <div className="flex flex-wrap gap-1.5">
                      {job.referenceUrls.map((url) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => void copyImage(assetProxy(url))}
                          title="Copier cette image dans le presse-papiers"
                          className="group relative h-16 w-16 overflow-hidden rounded-md ring-1 ring-slate-200 hover:ring-emerald-500 dark:ring-slate-700"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={assetProxy(url)} alt="" className="h-full w-full object-cover" />
                          <span className="absolute inset-0 hidden items-center justify-center bg-slate-950/50 text-white group-hover:flex">
                            <Copy className="h-4 w-4" />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}

/**
 * Un prompt écrit à la main tient souvent sur plusieurs paragraphes : découper
 * sur les lignes vides transformait un seul prompt en autant de prompts, et
 * donc en autant d'images. La zone vaut UN prompt, sauf séparateur `---`
 * explicite entre deux prompts.
 */
function splitGeneratePrompts(raw: string) {
  return raw
    .split(/\n\s*-{3,}\s*\n/)
    .map((item) => item.replace(/^\s*[-*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture image impossible"));
    reader.readAsDataURL(file);
  });
}

/**
 * Réglage compact de la barre du haut. Un `select` natif plutôt qu'un menu
 * dessiné : il tient sur une ligne, s'ouvre au clavier comme à la souris, et
 * reste lisible en thème sombre sans avoir à repeindre un portail.
 */
function Picker({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="appearance-none rounded-lg bg-slate-100 py-1.5 pl-2.5 pr-6 text-[11px] font-medium text-slate-700 outline-none dark:bg-slate-800 dark:text-slate-200"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
}
