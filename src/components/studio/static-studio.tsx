"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { cn } from "@/lib/utils";
import { assetProxy, pollStudioTask, saveStaticCreative, studioPost } from "@/lib/studio/client";
import { STUDIO_REUSE_KEY } from "@/lib/studio/library-types";
import { DEFAULT_RATIO, RATIOS, isWideRatio, ratioAspect } from "@/lib/studio/ratios";

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
  resolution: "1K" | "2K";
  referenceUrls: string[];
  createdAt: string;
};

function loadStoredJobs(): Job[] {
  try {
    const raw = window.localStorage.getItem(JOBS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Job[]) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type RefImage = { id: string; preview: string; dataUrl: string; name: string };

export function StaticStudio() {
  const [brief, setBrief] = useState("");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [promptsOpen, setPromptsOpen] = useState(true);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]["id"]>(DEFAULT_RATIO);
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<"expand" | "gen" | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  /** taskId déjà surveillés, pour ne pas ouvrir deux boucles sur la même tâche. */
  const watching = useRef<Set<string>>(new Set());
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [genPaste, setGenPaste] = useState("");
  const [pageRefs, setPageRefs] = useState<string[]>([]);
  const [pageLabel, setPageLabel] = useState("");

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
    if (stored.length) setJobs(stored);
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
              resolution: job.resolution,
              resultUrls: task.urls,
              referenceUrls: job.referenceUrls,
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
        watching.current.delete(job.taskId);
      }
    },
    [patchJob]
  );

  // Chaque tâche est suivie indépendamment : une image s'affiche et part en
  // bibliothèque dès qu'elle est prête, sans attendre le reste du lot.
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== "run" || !job.taskId) continue;
      if (watching.current.has(job.taskId)) continue;
      watching.current.add(job.taskId);
      void watchJob(job);
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
    const base = fromPaste.length ? fromPaste : activePrompts.length ? activePrompts : [];
    if (!base.length) {
      toast.error("Colle les prompts dans la zone Générer");
      return;
    }
    // Un seul prompt : Batch décide du nombre de variantes. Plusieurs prompts
    // (expand, ou séparés par `---`) : une image chacun, le Batch a déjà servi
    // à décider combien de prompts écrire.
    const list = base.length === 1 ? Array.from({ length: Math.max(1, count) }, () => base[0]) : base;

    // `busy` ne couvre que la création des tâches, pas leur exécution : dès que
    // Kie a rendu les taskId, la main est libre pour lancer un autre lot.
    setBusy("gen");
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
          })),
          ...current,
        ].slice(0, MAX_KEPT_JOBS)
      );

      toast.success(`${body.jobs.length} génération(s) lancée(s) — tu peux en relancer d'autres`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  function clearFinished() {
    setJobs((current) => current.filter((job) => job.status === "run"));
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
              placeholder="Ton prompt, en autant de paragraphes que tu veux. Pour en enchaîner plusieurs, sépare-les par une ligne ---"
              className="w-full resize-y rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] leading-relaxed outline-none dark:bg-slate-800"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {genCount === 1
                ? `1 prompt × Batch ×${count} → ${Math.max(1, count)} image${count > 1 ? "s" : ""}.`
                : `${genCount} prompts (séparés par ---) → ${genCount} images, une par prompt.`}
            </p>
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
              {jobs.length - running > 0 ? (
                <button type="button" onClick={clearFinished} className="text-[11px] font-medium text-slate-500">
                  Vider les terminées
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
              "grid gap-2",
              isWideRatio(ratio) || ratio === "1:1" ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4"
            )}
          >
            {jobs.map((job) => (
              <article key={job.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900">
                <div
                  className={cn(
                    "relative bg-slate-100 dark:bg-slate-800",
                    ratioAspect(ratio)
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
