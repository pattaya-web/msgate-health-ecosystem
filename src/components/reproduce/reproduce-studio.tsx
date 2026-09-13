"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  Film,
  ImageIcon,
  ImagePlus,
  Link2,
  Loader2,
  Maximize2,
  RefreshCw,
  Scissors,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-states";
import { pollStudioTask } from "@/lib/studio/client";
import type { VideoBatch } from "@/lib/studio/video-types";
import { RECIPES, recipeSeconds, type Recipe, type RecipeShot } from "@/lib/reproduce/recipes";
import { toDataUrl } from "@/lib/ugc/creative-file";
import { CREDITS_PER_SECOND, formatUsd, type ProductInput } from "@/lib/ugc/types";
import { cn } from "@/lib/utils";

/**
 * Reproduire : une référence, un produit, une vidéo.
 *
 * On choisit la créa à refaire parmi celles relevées, on colle le produit,
 * le script est réécrit, l'image clé fixe le personnage, les plans partent,
 * le montage recolle tout avec la voix off et le carton. Rien d'autre.
 */

const POLL_MS = 10000;
const panel = "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/reproduce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Reproduction indisponible");
  return data;
}

function posterUrl(recipe: Recipe) {
  return `/api/reproduce/poster?file=${encodeURIComponent(recipe.poster)}`;
}

function fileUrl(batchId: string, file: string) {
  return `/api/studio/video/file?id=${encodeURIComponent(batchId)}&file=${encodeURIComponent(file)}`;
}

export function ReproduceStudio() {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<ProductInput | null>(null);
  const [fetching, setFetching] = useState(false);
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [shots, setShots] = useState<RecipeShot[]>([]);
  const [writing, setWriting] = useState(false);
  const [keyframePrompt, setKeyframePrompt] = useState("");
  const [keyframeUrl, setKeyframeUrl] = useState("");
  const [keyframeBusy, setKeyframeBusy] = useState(false);
  const [endCard, setEndCard] = useState("");
  const [launching, setLaunching] = useState(false);
  const [batches, setBatches] = useState<VideoBatch[]>([]);
  const [assembling, setAssembling] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const seconds = shots.reduce((total, shot) => total + shot.seconds, 0);
  const credits = Math.round(seconds * CREDITS_PER_SECOND[resolution]);
  const tooExpensive = balance !== null && credits > balance;

  const loadBatches = useCallback(async () => {
    try {
      const body = await post<{ batches: VideoBatch[] }>({ action: "batches" });
      setBatches(body.batches ?? []);
    } catch {
      // vide au premier passage
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadBatches();
      void fetch("/api/kie-credit", { cache: "no-store" })
        .then((res) => res.json())
        .then((body) => setBalance(typeof body.credits === "number" ? body.credits : null))
        .catch(() => setBalance(null));
    }, 0);
    return () => clearTimeout(timer);
  }, [loadBatches]);

  const pendingIds = useMemo(
    () => batches.flatMap((batch) => batch.jobs.filter((job) => job.state === "pending" && job.taskId).map((job) => job.taskId as string)),
    [batches]
  );

  useEffect(() => {
    if (!pendingIds.length) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await post({ action: "status", taskIds: pendingIds });
        if (!alive) return;
        await loadBatches();
      } catch {
        // on repassera
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pendingIds, loadBatches]);

  function pick(next: Recipe) {
    setRecipe(next);
    setShots([]);
    setKeyframePrompt("");
    setKeyframeUrl("");
    setEndCard("");
  }

  async function loadUrl() {
    if (!url.trim()) return toast.error("Colle l'URL de ta page produit");
    setFetching(true);
    try {
      const body = await post<{ product: ProductInput }>({ action: "fetch", url: url.trim() });
      setProduct(body.product);
      setEndCard(`${body.product.brand || body.product.name}\nBUY 1 GET 1 FREE TODAY\n${body.product.price || ""}`.trim());
      toast.success(`${body.product.name} — ${body.product.imageUrls.length} image(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lecture impossible");
    } finally {
      setFetching(false);
    }
  }

  async function uploadImage(file: File | undefined) {
    if (!file) return;
    try {
      const body = await post<{ url: string }>({ action: "upload", imageDataUrl: await toDataUrl(file) });
      setProduct((current) => ({
        ...(current ?? { handle: "", name: "Produit", description: "", price: "", comparePrice: "", brand: "", keyPoints: [], kind: "other" as const, imageUrls: [] }),
        imageUrls: [...(current?.imageUrls ?? []), body.url],
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    }
  }

  async function writeScript() {
    if (!recipe) return;
    if (!product?.name) return toast.error("Charge d'abord le produit");
    setWriting(true);
    try {
      const body = await post<{ shots: RecipeShot[]; keyframePrompt: string; fallback?: string }>({ action: "script", recipeId: recipe.id, product, language });
      setShots(body.shots);
      setKeyframePrompt(body.keyframePrompt);
      setKeyframeUrl("");
      if (body.fallback) {
        toast.warning("IA d'écriture indisponible : script de la référence livré avec ton produit — relis et corrige les lignes.", { duration: 8000 });
      } else {
        toast.success(`Script écrit — ${body.shots.length} plans`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Script impossible");
    } finally {
      setWriting(false);
    }
  }

  async function makeKeyframe() {
    if (!keyframePrompt.trim()) return toast.error("Écris d'abord le script");
    setKeyframeBusy(true);
    try {
      const body = await post<{ taskId: string }>({ action: "keyframe", keyframePrompt, product });
      const task = await pollStudioTask(body.taskId, 80);
      setKeyframeUrl(task.urls[0]);
      toast.success("Image clé prête");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image clé impossible");
    } finally {
      setKeyframeBusy(false);
    }
  }

  async function uploadKeyframe(file: File | undefined) {
    if (!file) return;
    setKeyframeBusy(true);
    try {
      const body = await post<{ url: string }>({ action: "upload", imageDataUrl: await toDataUrl(file) });
      setKeyframeUrl(body.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    } finally {
      setKeyframeBusy(false);
    }
  }

  async function launch() {
    if (!recipe || !product) return;
    if (!shots.length) return toast.error("Écris d'abord le script");
    if (!keyframeUrl) return toast.error("Génère l'image clé : c'est elle qui tient le personnage d'un plan à l'autre");
    setLaunching(true);
    try {
      await post({ action: "generate", recipeId: recipe.id, product, shots, keyframeUrl, resolution, endCard });
      toast.success(`${shots.length} plans lancés — le lot apparaît en bas`);
      await loadBatches();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lancement impossible");
    } finally {
      setLaunching(false);
    }
  }

  async function assemble(batchId: string) {
    setAssembling(batchId);
    try {
      await post({ action: "assemble", batchId });
      toast.success("Montage prêt");
      await loadBatches();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Montage impossible");
    } finally {
      setAssembling("");
    }
  }

  function patchShot(index: number, patch: Partial<RecipeShot>) {
    setShots((current) => current.map((shot, i) => (i === index ? { ...shot, ...patch } : shot)));
  }

  const mine = recipe ? batches.filter((batch) => batch.recipeId === recipe.id) : batches;

  /* ---------------- Grille des références ---------------- */
  if (!recipe) {
    return (
      <div>
        <PageHeader
          title="Reproduire"
          description="Tes créas de référence, relevées une par une. Choisis celle à refaire, colle ton produit, génère."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {RECIPES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(item)}
              className="group overflow-hidden rounded-2xl bg-white text-left ring-1 ring-slate-900/[0.06] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(35,49,55,0.4)] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]"
            >
              <div className="relative overflow-hidden bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: "4 / 5" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={posterUrl(item)} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white backdrop-blur">
                  {item.kind === "video" ? <Film className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
                  {item.kind === "video" ? `Vidéo · ${item.duration ?? recipeSeconds(item)}s` : "Statique"}
                </span>
              </div>
              <div className="p-3">
                <div className="text-[12.5px] font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                <div className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-slate-500">{item.pitch}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-slate-500">
          Pour en ajouter : dépose la vidéo ou l&apos;image dans <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">data/references/</code> et dis-le moi, je la relève et j&apos;ajoute la carte.
        </p>
      </div>
    );
  }

  /* ---------------- Statique : renvoi vers le Remake ---------------- */
  if (recipe.kind === "static") {
    return (
      <div>
        <button type="button" onClick={() => setRecipe(null)} className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300">
          <ArrowLeft className="h-3.5 w-3.5" />
          Toutes les références
        </button>
        <div className={cn(panel, "grid gap-4 sm:grid-cols-[240px_minmax(0,1fr)]")}>
          <div className="overflow-hidden rounded-xl bg-slate-100" style={{ aspectRatio: recipe.posterAspect === "9:16" ? "9 / 16" : recipe.posterAspect === "1:1" ? "1 / 1" : "4 / 5" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={posterUrl(recipe)} alt="" className="h-full w-full object-cover" />
          </div>
          <div>
            <h2 className="font-display text-2xl text-slate-900 dark:text-slate-50">{recipe.name}</h2>
            <p className="mt-1 text-[12px] text-slate-500">{recipe.pitch}</p>
            <p className="mt-4 text-[12px] leading-relaxed text-slate-700 dark:text-slate-300">
              Les statiques se refont dans le Remake Creative : ce style est déjà dans la bande « Styles enregistrés ». Colle ton produit, choisis le nombre de déclinaisons, lance.
            </p>
            <Button asChild className="mt-4">
              <Link href="/ugc?tab=remake">Ouvrir dans le Remake</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Vidéo : le flux ---------------- */
  return (
    <div>
      <button type="button" onClick={() => setRecipe(null)} className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300">
        <ArrowLeft className="h-3.5 w-3.5" />
        Toutes les références
      </button>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* Référence + produit */}
          <section className={cn(panel, "grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]")}>
            <div className="overflow-hidden rounded-xl bg-slate-100" style={{ aspectRatio: "9 / 16" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={posterUrl(recipe)} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0">
              <span className="eyebrow">Référence · {recipe.duration ?? recipeSeconds(recipe)}s · {recipe.blocks.length} bloc{recipe.blocks.length > 1 ? "s" : ""}</span>
              <h2 className="font-display text-2xl text-slate-900 dark:text-slate-50">{recipe.name}</h2>
              <p className="text-[12px] text-slate-500">{recipe.pitch}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {recipe.blocks.map((block) => (
                  <span key={block.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {block.label} · {block.shots}×{block.seconds}s · {block.kind === "speaking" ? "parlé" : "voix off"}
                  </span>
                ))}
              </div>

              <div className="mt-4">
                <span className="eyebrow mb-1.5 block">1. Ton produit</span>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void loadUrl();
                      }}
                      placeholder="URL de la fiche produit — Entrée"
                      className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void loadUrl()} disabled={fetching}>
                    {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Charger
                  </Button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0])} />
                    <ImagePlus className="h-3.5 w-3.5" />
                    Image
                  </label>
                </div>
                {product ? (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
                    <div className="flex gap-1">
                      {product.imageUrls.slice(0, 4).map((image) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={image} src={image} alt="" className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                      ))}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-slate-900 dark:text-slate-100">{product.name}</div>
                      <div className="text-[10px] text-slate-500">{product.imageUrls.length} image(s) · {product.price || "prix ?"}</div>
                    </div>
                    <button type="button" onClick={() => setProduct(null)} className="ml-auto text-slate-400 hover:text-slate-700" title="Retirer">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                    {(["en", "fr"] as const).map((lang) => (
                      <button key={lang} type="button" onClick={() => setLanguage(lang)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium uppercase", language === lang ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                        {lang}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" onClick={() => void writeScript()} disabled={writing || !product}>
                    {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {shots.length ? "Réécrire le script" : "2. Écrire le script"}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* Script + image clé */}
          {shots.length ? (
            <section className={panel}>
              <div className="grid gap-4 md:grid-cols-[170px_minmax(0,1fr)]">
                <div>
                  <span className="eyebrow mb-1.5 block">3. Image clé</span>
                  <div className="overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: "9 / 16" }}>
                    {keyframeUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={keyframeUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-400">
                        {keyframeBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <Button size="sm" variant={keyframeUrl ? "outline" : "default"} onClick={() => void makeKeyframe()} disabled={keyframeBusy}>
                      {keyframeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : keyframeUrl ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {keyframeUrl ? "Une autre" : "Générer"}
                    </Button>
                    <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                      <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadKeyframe(event.target.files?.[0])} />
                      <Upload className="h-3 w-3" />
                      Charger la mienne
                    </label>
                  </div>
                  <textarea value={keyframePrompt} onChange={(event) => setKeyframePrompt(event.target.value)} rows={6} className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] leading-snug dark:border-slate-700 dark:bg-slate-950" />
                </div>

                <div>
                  <span className="eyebrow mb-1.5 block">Script — relis, corrige, puis lance</span>
                  <div className="space-y-3">
                    {recipe.blocks.map((block) => (
                      <div key={block.id}>
                        <div className="mb-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          {block.label} · {block.kind === "speaking" ? "dit à l'écran" : "voix off sur b-roll muet"}
                        </div>
                        <div className="space-y-1.5">
                          {shots.map((shot, index) =>
                            shot.block === block.id ? (
                              <div key={index} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                                <div className="mb-1 flex items-center gap-2">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">{index + 1}</span>
                                  <input value={shot.label} onChange={(event) => patchShot(index, { label: event.target.value })} className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-[12px] font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:outline-none dark:text-slate-100" />
                                  <select value={shot.seconds} onChange={(event) => patchShot(index, { seconds: Number(event.target.value) })} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-950">
                                    {[4, 5, 6, 7, 8, 9, 10, 12, 15].map((n) => (
                                      <option key={n} value={n}>
                                        {n}s
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <textarea value={shot.line} onChange={(event) => patchShot(index, { line: event.target.value })} rows={2} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] leading-snug dark:border-slate-700 dark:bg-slate-950" />
                                <input value={shot.action} onChange={(event) => patchShot(index, { action: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300" />
                              </div>
                            ) : null
                          )}
                        </div>
                      </div>
                    ))}
                    {recipe.endCard ? (
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">Carton final · 3 s · une ligne par ligne</div>
                        <textarea value={endCard} onChange={(event) => setEndCard(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] leading-snug dark:border-slate-700 dark:bg-slate-950" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {/* Lots */}
          {mine.length ? (
            <section className="space-y-3">
              {mine.map((batch) => {
                const ready = batch.jobs.filter((job) => job.state === "done").length;
                const allReady = batch.jobs.every((job) => job.state === "done" && job.file);
                const final = batch.cut ? fileUrl(batch.id, batch.cut) : null;
                return (
                  <div key={batch.id} className={cn(panel, "p-3")}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{batch.title}</span>
                      <span className="text-[11px] text-slate-500">
                        {new Date(batch.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {ready}/{batch.jobs.length} prêts
                      </span>
                      {allReady && !batch.cut ? (
                        <button type="button" onClick={() => void assemble(batch.id)} disabled={assembling === batch.id} className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900">
                          {assembling === batch.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                          Assembler{batch.voiceover ? " + voix off" : ""}{batch.endCard ? " + carton" : ""}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {batch.jobs.map((job, index) => {
                        const src = job.file ? fileUrl(batch.id, job.file) : job.urls[0];
                        return (
                          <div key={index} className="w-[130px]">
                            <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-900">
                              {src ? (
                                <>
                                  <video src={src} controls playsInline className="h-full w-full object-contain" />
                                  <button type="button" onClick={() => setZoom(src)} className="absolute right-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 hover:opacity-100">
                                    <Maximize2 className="h-3 w-3" />
                                  </button>
                                </>
                              ) : job.state === "fail" ? (
                                <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
                                  <X className="h-4 w-4 text-rose-500" />
                                  <span className="text-[9px] leading-tight text-rose-400">{job.error}</span>
                                </div>
                              ) : (
                                <div className="flex h-full items-center justify-center">
                                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                                </div>
                              )}
                            </div>
                            <div className="mt-1 truncate text-[10px] text-slate-500">
                              {index + 1}. {job.label} · {job.duration}s{job.silent ? " · muet" : ""}
                            </div>
                          </div>
                        );
                      })}
                      {final ? (
                        <div className="w-[130px]">
                          <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-900 ring-2 ring-slate-900 dark:ring-white">
                            <video src={final} controls playsInline className="h-full w-full object-contain" />
                            <button type="button" onClick={() => setZoom(final)} className="absolute right-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 hover:opacity-100">
                              <Maximize2 className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-1">
                            <span className="inline-flex items-center gap-1 truncate text-[10px] font-medium text-slate-900 dark:text-slate-100">
                              <Check className="h-3 w-3" /> Vidéo finale
                            </span>
                            <a href={final} download={`${batch.title}.mp4`} className="shrink-0 text-slate-400 hover:text-slate-900" title="Télécharger">
                              <Download className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}
        </div>

        {/* Récap */}
        <aside className={cn(panel, "h-fit space-y-3 lg:sticky lg:top-20")}>
          <div className="eyebrow">4. Lancer</div>
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
            <div className="eyebrow">Plans</div>
            <div className="font-display text-4xl text-slate-900 dark:text-slate-100">{shots.length}</div>
            <div className="text-[11px] text-slate-500">{seconds}s de vidéo · 9:16</div>
          </div>
          <div className="flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
            {(["720p", "1080p"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setResolution(value)} className={cn("flex-1 rounded-full px-2 py-1 text-[11px] font-medium", resolution === value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                {value}
              </button>
            ))}
          </div>
          <Row label="Référence" value={recipe.name} />
          <Row label="Produit" value={product?.name || "—"} />
          <Row label="Script" value={shots.length ? "prêt" : "—"} />
          <Row label="Image clé" value={keyframeUrl ? "prête" : "—"} />
          <Row label="Coût estimé" value={`${formatUsd(credits)} · ~${credits.toLocaleString("fr-FR")} cr`} />
          <Row label="Solde Kie" value={balance === null ? "…" : balance.toLocaleString("fr-FR")} />
          <Button className="w-full" onClick={() => void launch()} disabled={launching || !shots.length || !keyframeUrl || tooExpensive}>
            {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            Générer
          </Button>
          <p className="text-[10px] leading-snug text-slate-400">
            {tooExpensive ? "Solde insuffisant." : "Les plans se génèrent en parallèle. Quand tout est prêt, « Assembler » recolle les blocs, pose la voix off et le carton."}
          </p>
        </aside>
      </div>

      {zoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4" onClick={() => setZoom(null)}>
          <video src={zoom} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} className="max-h-[92vh] w-auto max-w-full rounded-xl shadow-2xl" />
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}
