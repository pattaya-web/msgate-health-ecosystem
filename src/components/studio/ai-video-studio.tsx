"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  Link2,
  Loader2,
  Maximize2,
  PenLine,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/page-states";
import { pollStudioTask } from "@/lib/studio/client";
import {
  VIDEO_RATIOS,
  VIDEO_STYLES,
  type ShotDraft,
  type VideoBatch,
  type VideoRatio,
  type VideoStyleId,
} from "@/lib/studio/video-types";
import { toDataUrl } from "@/lib/ugc/creative-file";
import { CLIP_DURATIONS, CREDITS_PER_SECOND, formatUsd, type ProductInput } from "@/lib/ugc/types";
import { cn } from "@/lib/utils";

/**
 * Studio Vidéo IA.
 *
 * Idée → storyboard (Claude) → image clé (gpt-image-2) → plans (Seedance) →
 * montage. Deux modes : « Produit » pour une video ad avec le vrai produit,
 * « Scène » pour inventer un cartoon, un mini-film, une animation.
 */

const POLL_MS = 10000;
const panel = "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";
const chip = (on: boolean) =>
  cn(
    "rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
    on ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
  );

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/studio/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Studio vidéo indisponible");
  return data;
}

function fileUrl(batchId: string, file: string) {
  return `/api/studio/video/file?id=${encodeURIComponent(batchId)}&file=${encodeURIComponent(file)}`;
}

export function AiVideoStudio() {
  const [mode, setMode] = useState<"product" | "scene">("product");
  const [style, setStyle] = useState<VideoStyleId>("ugc");
  const [ratio, setRatio] = useState<VideoRatio>("9:16");
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [seconds, setSeconds] = useState(6);
  const [count, setCount] = useState(4);
  const [speech, setSpeech] = useState(true);
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [idea, setIdea] = useState("");
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<ProductInput | null>(null);
  const [fetching, setFetching] = useState(false);
  const [shots, setShots] = useState<ShotDraft[]>([]);
  const [title, setTitle] = useState("");
  const [keyframePrompt, setKeyframePrompt] = useState("");
  const [keyframeUrl, setKeyframeUrl] = useState("");
  const [keyframeBusy, setKeyframeBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [batches, setBatches] = useState<VideoBatch[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const [cutting, setCutting] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentStyle = VIDEO_STYLES.find((item) => item.id === style) ?? VIDEO_STYLES[0];
  const totalSeconds = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const credits = Math.round(totalSeconds * CREDITS_PER_SECOND[resolution]);
  const tooExpensive = balance !== null && credits > balance;

  const loadBatches = useCallback(async () => {
    try {
      const body = await post<{ batches: VideoBatch[] }>({ action: "batches" });
      setBatches(body.batches ?? []);
      return body.batches ?? [];
    } catch {
      return [];
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
    const tick = async () => {
      try {
        await post({ action: "status", taskIds: pendingIds });
        if (!alive) return;
        await loadBatches();
      } catch {
        // on repassera
      }
      if (alive) pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [pendingIds, loadBatches]);

  async function loadUrl() {
    if (!url.trim()) return toast.error("Colle l'URL de ta page produit");
    setFetching(true);
    try {
      const body = await post<{ product: ProductInput }>({ action: "fetch", url: url.trim() });
      setProduct(body.product);
      setMode("product");
      toast.success(`${body.product.name} — ${body.product.imageUrls.length} image(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lecture impossible");
    } finally {
      setFetching(false);
    }
  }

  async function uploadProductImage(file: File | undefined) {
    if (!file) return;
    try {
      const body = await post<{ url: string }>({ action: "upload", imageDataUrl: await toDataUrl(file) });
      setProduct((current) => ({
        ...(current ?? { handle: "", name: "Produit", description: "", price: "", comparePrice: "", brand: "", keyPoints: [], kind: "other" as const, imageUrls: [] }),
        imageUrls: [...(current?.imageUrls ?? []), body.url],
      }));
      toast.success("Image ajoutée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    }
  }

  async function storyboard() {
    if (!idea.trim()) return toast.error("Décris ce que tu veux voir");
    if (mode === "product" && !product?.imageUrls.length) return toast.error("Charge d'abord le produit (URL ou image), ou passe en mode Scène");
    setWriting(true);
    try {
      const body = await post<{ shots: ShotDraft[]; keyframePrompt: string; title: string }>({
        action: "storyboard",
        idea,
        mode,
        style,
        count,
        seconds,
        ratio,
        product,
        speech,
        language,
      });
      setShots(body.shots);
      setKeyframePrompt(body.keyframePrompt);
      setTitle(body.title);
      setKeyframeUrl("");
      toast.success(`${body.shots.length} plans écrits`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Storyboard impossible");
    } finally {
      setWriting(false);
    }
  }

  async function makeKeyframe() {
    if (!keyframePrompt.trim()) return toast.error("Écris d'abord le storyboard");
    setKeyframeBusy(true);
    try {
      const body = await post<{ taskId: string }>({ action: "keyframe", keyframePrompt, product: mode === "product" ? product : null, ratio });
      const task = await pollStudioTask(body.taskId, 80);
      setKeyframeUrl(task.urls[0]);
      toast.success("Image clé prête — elle tient la cohérence entre les plans");
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
      toast.success("Image clé chargée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    } finally {
      setKeyframeBusy(false);
    }
  }

  async function launch() {
    if (!shots.length) return toast.error("Écris d'abord le storyboard");
    if (tooExpensive) return toast.error("Solde Kie insuffisant pour ce lot");
    setLaunching(true);
    try {
      await post({
        action: "generate",
        shots,
        mode,
        style,
        ratio,
        resolution,
        keyframeUrl: keyframeUrl || undefined,
        product: mode === "product" ? product : null,
        title,
        idea,
      });
      toast.success(`${shots.length} plans lancés`);
      await loadBatches();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lancement impossible");
    } finally {
      setLaunching(false);
    }
  }

  async function stitch(batchId: string) {
    setCutting(batchId);
    try {
      await post({ action: "stitch", batchId });
      toast.success("Montage prêt");
      await loadBatches();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Montage impossible");
    } finally {
      setCutting("");
    }
  }

  function patchShot(index: number, patch: Partial<ShotDraft>) {
    setShots((current) => current.map((shot, i) => (i === index ? { ...shot, ...patch } : shot)));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        {/* 1. Mode + idée */}
        <section className={panel}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">1. Ce que tu veux voir</h2>
            <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
              {(
                [
                  ["product", "Video ad produit", Film],
                  ["scene", "Scène inventée / cartoon / mini-film", Clapperboard],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                    mode === id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "product" ? (
            <div className="mb-3 space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void loadUrl();
                    }}
                    placeholder="URL de la fiche produit — Entrée pour charger"
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => void loadUrl()} disabled={fetching}>
                  {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Charger
                </Button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadProductImage(event.target.files?.[0])} />
                  <ImagePlus className="h-3.5 w-3.5" />
                  Image
                </label>
              </div>
              {product ? (
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
                  <div className="flex gap-1">
                    {product.imageUrls.slice(0, 4).map((image) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={image} src={image} alt="" className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                    ))}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-slate-900 dark:text-slate-100">{product.name}</div>
                    <div className="text-[10px] text-slate-500">{product.imageUrls.length} image(s) de référence · {product.price || "prix ?"}</div>
                  </div>
                  <button type="button" onClick={() => setProduct(null)} className="ml-auto text-slate-400 hover:text-slate-700" title="Retirer">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <textarea
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={4}
            placeholder={
              mode === "product"
                ? "Ex : une créatrice ouvre le colis dans sa cuisine, teste le produit, réagit, puis CTA. Ton énergique, lumière du matin."
                : "Ex : un petit robot perdu dans une forêt de champignons géants cherche son ami, style cartoon 3D, fin heureuse. / Un mini-film noir : un détective et une valise."
            }
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[12px] dark:border-slate-700 dark:bg-slate-950"
          />
        </section>

        {/* 2. Style */}
        <section className={panel}>
          <h2 className="mb-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100">2. Style visuel</h2>
          <p className="mb-3 text-[11px] text-slate-500">{currentStyle.hint}</p>
          <div className="flex flex-wrap gap-1.5">
            {VIDEO_STYLES.map((item) => (
              <button key={item.id} type="button" onClick={() => setStyle(item.id)} title={item.hint} className={chip(style === item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div>
              <span className="eyebrow mb-1 block">Format</span>
              <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                {VIDEO_RATIOS.map((value) => (
                  <button key={value} type="button" onClick={() => setRatio(value)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", ratio === value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="eyebrow mb-1 block">Plans</span>
              <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                  <button key={n} type="button" onClick={() => setCount(n)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", count === n ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="eyebrow mb-1 block">Secondes / plan</span>
              <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                {CLIP_DURATIONS.map((n) => (
                  <button key={n} type="button" onClick={() => setSeconds(n)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", seconds === n ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="eyebrow mb-1 block">Voix</span>
              <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                <button type="button" onClick={() => setSpeech(true)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", speech ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                  Parlée
                </button>
                <button type="button" onClick={() => setSpeech(false)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", !speech ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                  Muette
                </button>
                {speech
                  ? (["en", "fr"] as const).map((lang) => (
                      <button key={lang} type="button" onClick={() => setLanguage(lang)} className={cn("rounded-full px-2 py-1 text-[11px] font-medium uppercase", language === lang ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                        {lang}
                      </button>
                    ))
                  : null}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <Button size="sm" onClick={() => void storyboard()} disabled={writing}>
              {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {shots.length ? "Réécrire le storyboard" : "Écrire le storyboard"}
            </Button>
          </div>
        </section>

        {/* 3. Storyboard + image clé */}
        {shots.length ? (
          <section className={panel}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">3. Storyboard — {title}</h2>
                <p className="text-[11px] text-slate-500">Retouche les plans à la main si besoin, puis fabrique l&apos;image clé.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <span className="eyebrow mb-1 block">Image clé (cohérence)</span>
                <div className="overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: ratio === "16:9" ? "16 / 9" : ratio === "1:1" ? "1 / 1" : "9 / 16" }}>
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
                  <Button size="sm" variant="outline" onClick={() => void makeKeyframe()} disabled={keyframeBusy}>
                    {keyframeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : keyframeUrl ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {keyframeUrl ? "Une autre" : "Générer"}
                  </Button>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadKeyframe(event.target.files?.[0])} />
                    <Upload className="h-3 w-3" />
                    Charger la mienne
                  </label>
                </div>
                <textarea
                  value={keyframePrompt}
                  onChange={(event) => setKeyframePrompt(event.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] leading-snug dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="space-y-2">
                {shots.map((shot, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">{index + 1}</span>
                      <input
                        value={shot.label}
                        onChange={(event) => patchShot(index, { label: event.target.value })}
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-[12px] font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:outline-none dark:text-slate-100"
                      />
                      <select
                        value={shot.duration}
                        onChange={(event) => patchShot(index, { duration: Number(event.target.value) })}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-950"
                      >
                        {CLIP_DURATIONS.map((n) => (
                          <option key={n} value={n}>
                            {n}s
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setShots((current) => current.filter((_, i) => i !== index))} className="text-slate-400 hover:text-rose-600" title="Retirer ce plan">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={shot.prompt}
                      onChange={(event) => patchShot(index, { prompt: event.target.value })}
                      rows={3}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] leading-snug dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setShots((current) => [...current, { label: `Plan ${current.length + 1}`, duration: seconds, prompt: "SHOT: " }])}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:underline dark:text-slate-300"
                >
                  <PenLine className="h-3 w-3" />
                  Ajouter un plan
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {/* 4. Résultats */}
        <section className="space-y-3">
          {batches.length ? (
            batches.map((batch) => {
              const ready = batch.jobs.filter((job) => job.state === "done").length;
              const allReady = batch.jobs.length > 1 && batch.jobs.every((job) => job.state === "done" && job.file);
              const cutSrc = batch.cut ? fileUrl(batch.id, batch.cut) : null;
              return (
                <div key={batch.id} className={cn(panel, "p-3")}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{batch.title}</span>
                    <span className="text-[11px] text-slate-500">
                      {new Date(batch.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {VIDEO_STYLES.find((s) => s.id === batch.style)?.label} · {batch.ratio} · {ready}/{batch.jobs.length} prêts
                    </span>
                    {allReady && !batch.cut ? (
                      <button
                        type="button"
                        onClick={() => void stitch(batch.id)}
                        disabled={cutting === batch.id}
                        className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
                      >
                        {cutting === batch.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                        Assembler les {batch.jobs.length} plans
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {batch.keyframeUrl ? (
                      <div className="w-[110px]">
                        <div className="overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: batch.ratio === "16:9" ? "16 / 9" : batch.ratio === "1:1" ? "1 / 1" : "9 / 16" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={batch.keyframeUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">Image clé</div>
                      </div>
                    ) : null}
                    {batch.jobs.map((job, index) => {
                      const src = job.file ? fileUrl(batch.id, job.file) : job.urls[0];
                      return (
                        <div key={index} className="w-[150px]">
                          <div className="relative overflow-hidden rounded-lg bg-slate-900" style={{ aspectRatio: batch.ratio === "16:9" ? "16 / 9" : batch.ratio === "1:1" ? "1 / 1" : "9 / 16" }}>
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
                          <div className="mt-1 flex items-center justify-between gap-1">
                            <span className="truncate text-[10px] text-slate-500">
                              {index + 1}. {job.label} · {job.duration}s
                            </span>
                            {src ? (
                              <a href={src} download={`${batch.title}-${index + 1}.mp4`} className="shrink-0 text-slate-400 hover:text-slate-900" title="Télécharger">
                                <Download className="h-3 w-3" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {cutSrc ? (
                      <div className="w-[150px]">
                        <div className="relative overflow-hidden rounded-lg bg-slate-900 ring-2 ring-slate-900 dark:ring-white" style={{ aspectRatio: batch.ratio === "16:9" ? "16 / 9" : batch.ratio === "1:1" ? "1 / 1" : "9 / 16" }}>
                          <video src={cutSrc} controls playsInline className="h-full w-full object-contain" />
                          <button type="button" onClick={() => setZoom(cutSrc)} className="absolute right-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 hover:opacity-100">
                            <Maximize2 className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <span className="truncate text-[10px] font-medium text-slate-900 dark:text-slate-100">Montage complet</span>
                          <a href={cutSrc} download={`${batch.title}.mp4`} className="shrink-0 text-slate-400 hover:text-slate-900" title="Télécharger">
                            <Download className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState title="Aucune vidéo générée" description="Décris une idée, choisis un style, écris le storyboard, puis lance." />
          )}
        </section>
      </div>

      {/* Récap */}
      <aside className={cn(panel, "h-fit space-y-3 lg:sticky lg:top-20")}>
        <div className="eyebrow">Récapitulatif</div>
        <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
          <div className="eyebrow">Plans à générer</div>
          <div className="font-display text-4xl text-slate-900 dark:text-slate-100">{shots.length}</div>
          <div className="text-[11px] text-slate-500">{totalSeconds}s de vidéo · {ratio}</div>
        </div>
        <div className="flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
          {(["720p", "1080p"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setResolution(value)} className={cn("flex-1 rounded-full px-2 py-1 text-[11px] font-medium", resolution === value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
              {value}
            </button>
          ))}
        </div>
        <Row label="Mode" value={mode === "product" ? "Video ad produit" : "Scène inventée"} />
        <Row label="Style" value={currentStyle.label} />
        <Row label="Produit" value={mode === "product" ? product?.name || "—" : "aucun"} />
        <Row label="Image clé" value={keyframeUrl ? "prête" : "—"} />
        <Row label="Coût estimé" value={`${formatUsd(credits)} · ~${credits.toLocaleString("fr-FR")} cr`} />
        <Row label="Solde Kie" value={balance === null ? "…" : balance.toLocaleString("fr-FR")} />
        <Button className="w-full" onClick={() => void launch()} disabled={launching || !shots.length || tooExpensive}>
          {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
          Lancer {shots.length ? `(${shots.length} plans)` : ""}
        </Button>
        {!keyframeUrl && shots.length ? (
          <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-300">
            Sans image clé, chaque plan peut réinventer le personnage et le décor. Génère-la d&apos;abord pour un vrai mini-film cohérent.
          </p>
        ) : null}
        {tooExpensive ? (
          <p className="text-[10px] leading-snug text-rose-600">Solde insuffisant : réduis les plans ou la durée, ou recharge Kie.</p>
        ) : (
          <p className="text-[10px] leading-snug text-slate-400">~102 crédits/seconde en 720p, le double en 1080p. Les plans se génèrent en parallèle et se recollent en un clic.</p>
        )}
      </aside>

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
