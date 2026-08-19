"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { cn } from "@/lib/utils";
import { assetProxy, pollStudioTask, saveStaticCreative, studioPost } from "@/lib/studio/client";
import { STUDIO_REUSE_KEY } from "@/lib/studio/library-types";

const RATIOS = [
  { id: "3:4", hint: "Feed" },
  { id: "1:1", hint: "Carré" },
  { id: "9:16", hint: "Story" },
] as const;
const COUNTS = [1, 2, 4, 6, 8];

type Job = {
  prompt: string;
  taskId?: string;
  urls: string[];
  status: "idle" | "run" | "ok" | "err";
  error?: string;
};

type RefImage = { id: string; preview: string; dataUrl: string; name: string };

export function StaticStudio() {
  const [brief, setBrief] = useState("");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [promptsOpen, setPromptsOpen] = useState(true);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]["id"]>("3:4");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<"expand" | "gen" | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [genPaste, setGenPaste] = useState("");
  const [pageRefs, setPageRefs] = useState<string[]>([]);
  const [pageLabel, setPageLabel] = useState("");

  const activePrompts = useMemo(
    () => prompts.filter((_, i) => selected[i] !== false),
    [prompts, selected]
  );

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
      toast.error("Colle l’URL produit + tes consignes");
      return;
    }
    setBusy("expand");
    setPromptsOpen(true);
    try {
      const body = await studioPost<{
        prompts: string[];
        referenceUrls?: string[];
        product?: { title?: string; url?: string; price?: string };
      }>({
        action: "expand",
        brief,
        count,
        ratio,
      });
      setPrompts(body.prompts);
      setSelected(Object.fromEntries(body.prompts.map((_, i) => [i, true])));
      setGenPaste(body.prompts.join("\n\n"));
      setPageRefs(body.referenceUrls || []);
      const label = [body.product?.title, body.product?.price].filter(Boolean).join(" · ");
      setPageLabel(label);
      toast.success(label ? `Page lue — ${label}` : `${body.prompts.length} prompt(s) prêts`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Expand impossible");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    const fromPaste = splitGeneratePrompts(genPaste);
    const list = fromPaste.length ? fromPaste : activePrompts.length ? activePrompts : [];
    if (!list.length) {
      toast.error("Colle les prompts dans la zone Générer");
      return;
    }
    setBusy("gen");
    setJobs(list.map((prompt) => ({ prompt, urls: [], status: "run" })));
    try {
      const referenceUrls: string[] = [];
      for (const ref of refs) {
        const uploaded = await studioPost<{ url: string }>({
          action: "upload",
          imageDataUrl: ref.dataUrl,
          fileName: ref.name.replace(/[^\w.-]+/g, "-") || `ref-${Date.now()}.png`,
        });
        if (uploaded.url) referenceUrls.push(uploaded.url);
      }
      for (const url of pageRefs) {
        if (!referenceUrls.includes(url)) referenceUrls.push(url);
      }
      const body = await studioPost<{ jobs: Array<{ prompt: string; taskId: string }>; referenceUrls?: string[] }>({
        action: "image",
        prompts: list,
        ratio,
        resolution,
        referenceUrls,
      });
      const savedRefs = body.referenceUrls?.length ? body.referenceUrls : referenceUrls;
      setJobs(body.jobs.map((job) => ({ ...job, urls: [], status: "run" })));
      const done = await Promise.all(
        body.jobs.map(async (job) => {
          try {
            const task = await pollStudioTask(job.taskId);
            if (task.urls.length) {
              try {
                await saveStaticCreative({
                  brief,
                  prompt: job.prompt,
                  ratio,
                  resolution,
                  resultUrls: task.urls,
                  referenceUrls: savedRefs,
                });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Sauvegarde bibliothèque impossible");
              }
            }
            return { prompt: job.prompt, taskId: job.taskId, urls: task.urls, status: "ok" as const };
          } catch (error) {
            return {
              prompt: job.prompt,
              taskId: job.taskId,
              urls: [],
              status: "err" as const,
              error: error instanceof Error ? error.message : "Échec",
            };
          }
        })
      );
      setJobs(done);
      const ok = done.filter((j) => j.status === "ok").length;
      toast.success(`${ok}/${done.length} créatives prêtes — sauvées dans Toutes les créas`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  async function zipAll() {
    const urls = jobs.flatMap((job) => job.urls);
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
              placeholder={"https://ton-produit.com/...\nUGC cuisine, femme 35 ans, lumière iPhone, packshot lisible"}
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
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ratio</p>
              <div className="flex flex-wrap gap-1">
                {RATIOS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRatio(item.id)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-[11px] font-medium",
                      ratio === item.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800"
                    )}
                  >
                    {item.id}
                    <span className="ml-1 text-[10px] opacity-70">{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Taille</p>
              <div className="flex gap-1">
                {(["1K", "2K"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setResolution(item)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-[11px] font-medium",
                      resolution === item ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Batch</p>
              <div className="flex flex-wrap gap-1">
                {COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-[11px] font-medium",
                      count === n ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800"
                    )}
                  >
                    ×{n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {pageLabel ? <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-400">Page lue : {pageLabel}</p> : null}

          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Prompts à générer</p>
            <textarea
              value={genPaste}
              onChange={(e) => setGenPaste(e.target.value)}
              rows={8}
              placeholder="Les prompts sortis du brief se collent ici — un prompt par bloc, ligne vide entre chaque. Tu peux coller / éditer, puis Générer."
              className="w-full resize-y rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] leading-relaxed outline-none dark:bg-slate-800"
            />
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Images de référence {refs.length ? `(${refs.length}/8)` : "(optionnel)"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pageRefs.map((url) => (
                <div key={url} className="relative h-14 w-14 overflow-hidden rounded-lg ring-1 ring-emerald-500/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetProxy(url)} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPageRefs((list) => list.filter((item) => item !== url))}
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {refs.map((ref) => (
                <div key={ref.id} className="relative h-14 w-14 overflow-hidden rounded-lg ring-1 ring-slate-900/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setRefs((list) => list.filter((item) => item.id !== ref.id))}
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {refs.length < 8 ? (
                <label className="flex h-14 w-14 cursor-pointer flex-col items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-dashed ring-slate-300 dark:bg-slate-800">
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
            </div>
          </div>

          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy !== null}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-slate-900 text-[13px] font-medium text-white dark:bg-white dark:text-slate-900"
          >
            {busy === "gen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Générer
          </button>
        </div>

        <div className="min-h-[48vh] rounded-2xl bg-slate-50/80 p-2 ring-1 ring-slate-900/[0.04] dark:bg-slate-950/40">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[11px] text-slate-400">{jobs.length ? `${jobs.length} jobs` : "Les visuels arrivent ici"}</p>
            {jobs.some((j) => j.urls.length) ? (
              <button type="button" onClick={() => void zipAll()} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <Download className="h-3 w-3" />
                ZIP batch
              </button>
            ) : null}
          </div>
          <div
            className={cn(
              "grid gap-2",
              ratio === "1:1" ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4"
            )}
          >
            {jobs.map((job, i) => (
              <article key={job.taskId || i} className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900">
                <div
                  className={cn(
                    "relative bg-slate-100 dark:bg-slate-800",
                    ratio === "1:1" ? "aspect-square" : ratio === "3:4" ? "aspect-[3/4]" : "aspect-[9/16]"
                  )}
                >
                  {job.urls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetProxy(job.urls[0])} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-slate-400">
                      {job.status === "run" ? <Loader2 className="h-5 w-5 animate-spin" /> : job.error || "…"}
                    </div>
                  )}
                </div>
                {job.urls[0] ? (
                  <a
                    href={assetProxy(job.urls[0])}
                    download
                    className="block px-2 py-1.5 text-center text-[10px] font-medium text-slate-500"
                  >
                    Télécharger
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function splitGeneratePrompts(raw: string) {
  return raw
    .split(/\n\s*\n/)
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
