"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import {
  applyGeneratedImages,
  groupProducts,
  parseCsv,
  serializeCsv,
  type CsvProduct,
  type CsvTable,
} from "@/lib/product-images/csv";
import {
  AGE_BANDS,
  SHOTS,
  orderShots,
  shotLabel,
  type AgeBand,
  type ShotId,
} from "@/lib/product-images/shots";
import { autoReferences, scoreImages } from "@/lib/product-images/references";
import { cn } from "@/lib/utils";

type Job = {
  handle: string;
  shot: ShotId;
  prompt: string;
  taskId: string | null;
  error: string | null;
  state: "pending" | "done" | "fail";
  urls: string[];
};

const POLL_MS = 8000;
const POLL_MAX_MS = 45000;
/** Nombre de produits par requête de génération. */
const SUBMIT_CHUNK = 3;

/** « handle::Rouge » désigne une couleur du produit « handle ». */
const baseHandle = (handle: string) => handle.split("::")[0];
const colorOf = (handle: string) => handle.split("::")[1] ?? "";

export default function ProductImagesPage() {
  const [table, setTable] = useState<CsvTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [products, setProducts] = useState<CsvProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shots, setShots] = useState<Set<ShotId>>(new Set(["flatlay", "model_front", "packaging"]));
  const [logoUrl, setLogoUrl] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [approved, setApproved] = useState<Map<string, string[]>>(new Map());
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState<"1K" | "2K">("2K");
  const [age, setAge] = useState<AgeBand>("any");
  const [refs, setRefs] = useState<Map<string, string[]>>(new Map());
  const [perColor, setPerColor] = useState(true);
  const [throttled, setThrottled] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const dropRef = useRef<HTMLLabelElement>(null);

  const pendingIds = useMemo(
    () => jobs.filter((job) => job.state === "pending" && job.taskId).map((job) => job.taskId as string),
    [jobs]
  );

  /**
   * Les tâches Kie sont asynchrones. Un seul appel à la fois — sans le verrou, un
   * poll plus lent que l'intervalle empile les requêtes et Kie répond « call
   * frequency is too high ». Quand ça arrive quand même, on espace davantage.
   */
  useEffect(() => {
    if (!pendingIds.length) return;

    let stopped = false;
    let inFlight = false;
    let delay = POLL_MS;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped || inFlight) return schedule();
      inFlight = true;
      try {
        const res = await fetch("/api/product-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", taskIds: pendingIds }),
        });
        const body = await res.json();

        if (res.ok) {
          delay = body.throttled ? Math.min(delay * 2, POLL_MAX_MS) : POLL_MS;
          setThrottled(Boolean(body.throttled));
          setJobs((current) =>
            current.map((job) => {
              const hit = body.results?.find((r: { taskId: string }) => r.taskId === job.taskId);
              if (!hit) return job;
              if (hit.urls?.length) return { ...job, state: "done", urls: hit.urls };
              if (String(hit.state || "").toLowerCase().includes("fail")) {
                return { ...job, state: "fail", error: hit.failMsg || "Génération échouée" };
              }
              return job;
            })
          );
        } else {
          delay = Math.min(delay * 2, POLL_MAX_MS);
        }
      } catch {
        delay = Math.min(delay * 2, POLL_MAX_MS);
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, delay);
    };

    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pendingIds]);

  const readCsv = useCallback(async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.headers.includes("Handle")) {
      toast.error("Ce CSV n'a pas de colonne Handle — ce n'est pas un export Shopify.");
      return;
    }
    const grouped = groupProducts(parsed);
    setTable(parsed);
    setProducts(grouped);
    setFileName(file.name);
    setSelected(new Set(grouped.map((product) => product.handle)));
    setJobs([]);
    setApproved(new Map());
    toast.success(`${grouped.length} produits chargés`);
  }, []);

  async function onLogo(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      setLogoPreview(dataUrl);
      try {
        const res = await fetch("/api/product-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logo", logoDataUrl: dataUrl }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setLogoUrl(body.url);
        toast.success("Logo envoyé");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Logo non envoyé");
      }
    };
    reader.readAsDataURL(file);
  }

  /**
   * Photos envoyées au modèle. Par défaut la première seulement : sur un
   * ensemble coordonné, les suivantes montrent le haut assorti, et le modèle
   * fusionne les deux vêtements en inventant des bandes qui n'existent pas.
   */
  const refsOf = useCallback(
    (product: CsvProduct) => refs.get(product.handle) ?? autoReferences(product),
    [refs]
  );

  function toggleRef(product: CsvProduct, image: string) {
    setRefs((current) => {
      const next = new Map(current);
      const list = next.get(product.handle) ?? autoReferences(product);
      // On garde l'ordre d'origine : la première photo reste la principale.
      const wanted = new Set(list.includes(image) ? list.filter((item) => item !== image) : [...list, image]);
      next.set(product.handle, product.images.filter((item) => wanted.has(item)));
      return next;
    });
  }

  /**
   * Envoi par petits lots : une seule requête pour cent rendus dépasserait la
   * durée max de la route, et les tuiles n'apparaîtraient qu'à la toute fin.
   */
  const submit = useCallback(
    async (batch: CsvProduct[], replace: boolean) => {
      setBusy(true);
      if (replace) setJobs([]);
      let launched = 0;

      try {
        for (let i = 0; i < batch.length; i += SUBMIT_CHUNK) {
          const slice = batch.slice(i, i + SUBMIT_CHUNK);
          const res = await fetch("/api/product-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "generate",
              logoUrl,
              resolution,
              shots: orderShots(shots),
              age,
              products: slice.flatMap((product) =>
                perColor && product.colors.length > 1
                  ? product.colors.map((color) => ({
                      handle: `${product.handle}::${color.name}`,
                      title: `${product.title} — ${color.name}`,
                      type: product.type,
                      referenceUrls: [color.image],
                    }))
                  : [
                      {
                        handle: product.handle,
                        title: product.title,
                        type: product.type,
                        referenceUrls: refsOf(product),
                      },
                    ]
              ),
            }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error);

          const fresh: Job[] = body.jobs.map((job: Omit<Job, "state" | "urls">) => ({
            ...job,
            state: job.taskId ? "pending" : "fail",
            urls: [],
          }));
          launched += fresh.filter((job) => job.taskId).length;
          setJobs((current) => [...current, ...fresh]);
        }
        toast.success(`${launched} rendus lancés`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Génération impossible");
      } finally {
        setBusy(false);
      }
    },
    [age, logoUrl, perColor, refsOf, resolution, shots]
  );

  function generate() {
    const picked = products.filter((product) => selected.has(product.handle));
    if (!picked.length) return toast.error("Sélectionne au moins un produit");
    if (!shots.size) return toast.error("Sélectionne au moins un plan");
    if (shots.has("packaging") && !logoUrl) return toast.error("Charge ton logo pour le plan packaging");
    void submit(picked, true);
  }

  /** Relance uniquement les produits dont au moins un plan a échoué. */
  function retryFailed() {
    const handles = new Set(jobs.filter((job) => job.state === "fail").map((job) => job.handle));
    const batch = products.filter((product) => handles.has(product.handle));
    if (!batch.length) return;
    setJobs((current) => current.filter((job) => !handles.has(job.handle) || job.state === "done"));
    void submit(batch, false);
  }

  /** Tous les rendus aboutis d'un coup : le tri fin reste possible ensuite. */
  function approveAll() {
    const next = new Map<string, string[]>();
    for (const job of jobs) {
      if (job.state !== "done" || !job.urls[0]) continue;
      next.set(job.handle, [...(next.get(job.handle) ?? []), job.urls[0]]);
    }
    if (!next.size) return toast.error("Aucun rendu abouti à valider");
    setApproved(next);
  }

  function toggleApproval(handle: string, url: string) {
    setApproved((current) => {
      const next = new Map(current);
      const list = next.get(handle) ?? [];
      next.set(handle, list.includes(url) ? list.filter((item) => item !== url) : [...list, url]);
      if (!next.get(handle)?.length) next.delete(handle);
      return next;
    });
  }

  function exportCsv() {
    if (!table || !approved.size) return toast.error("Valide au moins une image");
    // Les couleurs d'un même produit se rejoignent sur sa fiche CSV.
    const merged = new Map<string, string[]>();
    for (const [handle, urls] of approved) {
      const key = baseHandle(handle);
      merged.set(key, [...(merged.get(key) ?? []), ...urls]);
    }
    const rebuilt = applyGeneratedImages(table, merged);
    const blob = new Blob([serializeCsv(rebuilt)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName.replace(/\.csv$/i, "") + "_images.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${merged.size} produits réécrits`);
  }

  /** Un lot décliné par couleur pèse bien plus lourd : on l'annonce avant. */
  const renderCount = useMemo(() => {
    const chosen = products.filter((product) => selected.has(product.handle));
    const subjects = chosen.reduce(
      (total, product) => total + (perColor && product.colors.length > 1 ? product.colors.length : 1),
      0
    );
    return subjects * shots.size;
  }, [products, selected, perColor, shots]);

  const byProduct = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobs) {
      const key = baseHandle(job.handle);
      map.set(key, [...(map.get(key) ?? []), job]);
    }
    return map;
  }, [jobs]);

  const done = jobs.filter((job) => job.state === "done").length;
  const failedCount = jobs.filter((job) => job.state === "fail").length;

  /** Seuls les rendus aboutis sont navigables dans la preview. */
  const gallery = useMemo(() => jobs.filter((job) => job.state === "done" && job.urls[0]), [jobs]);
  const current = preview !== null ? gallery[preview] : null;

  const step = useCallback(
    (delta: number) => {
      setPreview((index) => {
        if (index === null || !gallery.length) return index;
        return (index + delta + gallery.length) % gallery.length;
      });
    },
    [gallery.length]
  );

  useEffect(() => {
    if (preview === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, step]);

  return (
    <div>
      <PageHeader
        title="Image Product"
        description="Dépose un CSV Shopify, génère les visuels produit en 3:4, valide, puis retélécharge le CSV avec les nouvelles images pour le réimporter dans Shopify."
        actions={
          gallery.length ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={approveAll}>
                <Check className="h-3.5 w-3.5" />
                Tout valider ({gallery.length})
              </Button>
              <Button size="sm" onClick={exportCsv} disabled={!approved.size}>
                <Download className="h-3.5 w-3.5" />
                CSV ({approved.size} produits)
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <label
          ref={dropRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void readCsv(file);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 bg-white px-4 py-6 text-center transition-colors hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900/70"
        >
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readCsv(file);
            }}
          />
          <Upload className="h-5 w-5 text-emerald-500" />
          <span className="text-[12px] font-medium text-slate-900 dark:text-slate-100">
            {fileName || "Glisse ton CSV Shopify ici"}
          </span>
          <span className="text-[11px] text-slate-500">
            {products.length ? `${products.length} produits détectés` : "ou clique pour choisir un fichier"}
          </span>
        </label>

        <div className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Ton logo
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Imprimé sur une boîte blanche nue pour le plan packaging.
          </p>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-2 text-[12px] dark:border-slate-700">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onLogo(e.target.files?.[0])}
            />
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-8 w-8 rounded object-contain" />
            ) : (
              <ImageIcon className="h-4 w-4 text-slate-400" />
            )}
            <span className={cn(logoUrl ? "text-emerald-600" : "text-slate-500")}>
              {logoUrl ? "Logo prêt" : "Charger le logo"}
            </span>
          </label>
        </div>
      </div>

      {products.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          {SHOTS.map((shot) => (
            <button
              key={shot.id}
              type="button"
              onClick={() =>
                setShots((current) => {
                  const next = new Set(current);
                  if (next.has(shot.id)) next.delete(shot.id);
                  else next.add(shot.id);
                  return next;
                })
              }
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                shots.has(shot.id)
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              )}
            >
              {shot.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2 text-[12px] text-slate-500">
            <select
              value={age}
              onChange={(event) => setAge(event.target.value as AgeBand)}
              title="Âge du mannequin sur les plans avec modèle"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
            >
              {AGE_BANDS.map((band) => (
                <option key={band.id} value={band.id}>
                  {band.label}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              {(["1K", "2K"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setResolution(value)}
                  title={value === "2K" ? "Plus de détail, plus cher" : "Plus rapide, moins cher"}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    resolution === value
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5" title="Une série de photos par couleur déclinée">
              <input
                type="checkbox"
                checked={perColor}
                onChange={() => setPerColor((value) => !value)}
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              Par couleur
            </label>
            <span>
              {selected.size} / {products.length} produits · {renderCount} rendus
            </span>
            <Button size="sm" onClick={generate} disabled={busy}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Générer
            </Button>
          </div>
        </div>
      ) : null}

      {jobs.length ? (
        <div className="mb-3 text-[12px] text-slate-600 dark:text-slate-300">
          {done} / {jobs.length} rendus prêts
          {pendingIds.length ? <span className="ml-2 text-slate-400">génération en cours…</span> : null}
          {throttled ? (
            <span className="ml-2 text-amber-600">
              Kie limite la cadence — vérification espacée, les rendus arrivent quand même.
            </span>
          ) : null}
          {failedCount ? (
            <button
              type="button"
              onClick={retryFailed}
              disabled={busy}
              className="ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-rose-600 underline-offset-2 hover:underline disabled:opacity-50"
            >
              Relancer les {failedCount} échecs
            </button>
          ) : null}
        </div>
      ) : null}

      {products.length === 0 ? (
        <EmptyState
          title="Aucun CSV chargé"
          description="Dépose un export Shopify — celui du Shopify scraper fonctionne directement."
        />
      ) : (
        <div className="space-y-3">
          {products.map((product) => {
            const productJobs = byProduct.get(product.handle) ?? [];
            const picked = approved.get(product.handle) ?? [];
            return (
              <div
                key={product.handle}
                className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(product.handle)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(product.handle)) next.delete(product.handle);
                        else next.add(product.handle);
                        return next;
                      })
                    }
                    className="mt-1 h-3.5 w-3.5 accent-emerald-600"
                  />
                  {product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.images[0]}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-slate-900 dark:text-slate-100">
                      {product.title || product.handle}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {product.images.length} photo{product.images.length > 1 ? "s" : ""} d&apos;origine
                      {picked.length ? ` · ${picked.length} validée(s)` : ""}
                    </div>
                  </div>
                </div>

                {selected.has(product.handle) && product.images.length ? (
                  <div className="mt-2.5">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      Photos de référence — triées automatiquement, corrige au clic
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {scoreImages(product).map((scored) => {
                        const on = refsOf(product).includes(scored.url);
                        return (
                          <button
                            key={scored.url}
                            type="button"
                            onClick={() => toggleRef(product, scored.url)}
                            title={`${scored.reason}${scored.alt ? ` — « ${scored.alt} »` : ""}`}
                            className={cn(
                              "relative h-14 w-14 overflow-hidden rounded-md ring-2 transition-opacity",
                              on ? "ring-emerald-500" : "opacity-40 ring-transparent hover:opacity-70"
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={scored.url} alt="" className="h-full w-full object-cover" />
                            {on ? (
                              <span className="absolute right-0.5 top-0.5 rounded-full bg-emerald-600 p-0.5">
                                <Check className="h-2 w-2 text-white" />
                              </span>
                            ) : (
                              <span className="absolute inset-x-0 bottom-0 bg-slate-950/70 py-0.5 text-center text-[8px] leading-tight text-white">
                                écartée
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {product.colors.length > 1 ? (
                      <p className="mt-1 text-[10px] text-slate-500">
                        {product.colors.length} couleurs détectées
                        {perColor ? " — une série de photos sera générée pour chacune." : "."}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {productJobs.length ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {productJobs.map((job) => (
                      <div key={`${job.shot}-${job.taskId}`} className="w-[132px]">
                        <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                          {job.state === "done" && job.urls[0] ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setPreview(gallery.findIndex((item) => item.taskId === job.taskId))
                                }
                                className="group h-full w-full"
                                title="Agrandir pour vérifier"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={job.urls[0]} alt="" className="h-full w-full object-cover" />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleApproval(product.handle, job.urls[0])}
                                title={picked.includes(job.urls[0]) ? "Retirer" : "Valider"}
                                className={cn(
                                  "absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-white transition-colors",
                                  picked.includes(job.urls[0])
                                    ? "bg-emerald-600"
                                    : "bg-slate-900/40 hover:bg-slate-900/70"
                                )}
                              >
                                <Check className="h-3 w-3" />
                              </button>
                            </>
                          ) : job.state === "fail" ? (
                            <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
                              <X className="h-4 w-4 text-rose-500" />
                              <span className="text-[9px] leading-tight text-rose-600">
                                {job.error}
                              </span>
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                            </div>
                          )}
                        </div>
                        <div className="mt-1 truncate text-[10px] text-slate-500">
                          {colorOf(job.handle) ? `${colorOf(job.handle)} · ` : ""}
                          {shotLabel(job.shot)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {current ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 md:flex-row"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.urls[0]}
                alt=""
                className="max-h-[78vh] w-auto max-w-full object-contain"
              />
              {gallery.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    className="absolute left-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-slate-900"
                    aria-label="Précédente"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-slate-900"
                    aria-label="Suivante"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </div>

            <div className="flex w-full shrink-0 flex-col gap-2 overflow-y-auto p-3 md:w-[300px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                    {shotLabel(current.shot)}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{current.handle}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="text-[11px] text-slate-500">
                {preview !== null ? `${preview + 1} / ${gallery.length}` : ""} · format 3:4
              </div>

              <Button
                size="sm"
                variant={
                  (approved.get(current.handle) ?? []).includes(current.urls[0])
                    ? "default"
                    : "outline"
                }
                onClick={() => toggleApproval(current.handle, current.urls[0])}
              >
                <Check className="h-3.5 w-3.5" />
                {(approved.get(current.handle) ?? []).includes(current.urls[0])
                  ? "Validée"
                  : "Valider"}
              </Button>

              <a
                href={current.urls[0]}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-emerald-600 hover:underline"
              >
                Ouvrir en taille réelle
              </a>

              <div className="mt-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Prompt
                </div>
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {current.prompt}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
