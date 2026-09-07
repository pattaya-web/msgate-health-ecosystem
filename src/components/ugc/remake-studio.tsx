"use client";

/**
 * Onglet « Remake » : on dépose une créative, elle est rejouée plan par plan
 * avec l'avatar enregistré et le produit, puis remontée sous la bande son
 * d'origine.
 *
 * Trois étapes distinctes et visibles — analyser, générer, remonter — parce que
 * chacune coûte du temps ou des crédits et qu'on ne lance pas la suivante sans
 * avoir vu le résultat de la précédente.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Film, ImagePlus, Loader2, Music, Star, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { Casting } from "@/lib/ugc/casting";
import { AGE_BANDS, DEFAULT_CASTING } from "@/lib/ugc/casting";
import { KINDS, type ProductKind } from "@/lib/ugc/kinds";
import type { Shot } from "@/lib/ugc/remake";
import { RESOLUTIONS, estimateCredits, formatUsd, type Resolution } from "@/lib/ugc/types";
import { cn } from "@/lib/utils";

type AvatarMeta = { id: string; name: string; casting: Casting; uploaded: boolean };

type Analysis = {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  shots: Shot[];
};

type Product = {
  handle: string;
  name: string;
  description: string;
  price: string;
  comparePrice: string;
  brand: string;
  keyPoints: string[];
  imageUrls: string[];
  kind: ProductKind;
};

type Job = {
  sceneLabel: string;
  duration: number;
  taskId: string | null;
  error: string | null;
  urls: string[];
  state: "pending" | "done" | "fail";
};

const field =
  "h-8 w-full rounded-lg bg-slate-50 px-2.5 text-[12px] text-slate-900 outline-none focus:ring-1 focus:ring-emerald-400 dark:bg-slate-800 dark:text-slate-100";

async function ugcPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Requête impossible");
  return data;
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}

export function RemakeStudio() {
  const [avatars, setAvatars] = useState<AvatarMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [source, setSource] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [resolution, setResolution] = useState<Resolution>("720p");

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [framing, setFraming] = useState<string[]>([]);
  const [framingNote, setFramingNote] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [batchId, setBatchId] = useState("");
  const [finalFile, setFinalFile] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const polling = useRef<number | null>(null);

  /* Avatar créé sur place : généré ou chargé, puis enregistré pour la suite. */
  const [casting, setCasting] = useState<Casting>(DEFAULT_CASTING);
  const [avatarPreview, setAvatarPreview] = useState("");

  async function makeAvatar() {
    setBusy("avatar");
    try {
      const { taskId } = await ugcPost<{ taskId: string }>("/api/ugc", { action: "avatar", casting });
      // Le portrait sort en une trentaine de secondes.
      for (let i = 0; i < 40; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, i < 4 ? 2000 : 3000));
        const body = await ugcPost<{
          results: Array<{ state: string; urls: string[]; failMsg: string | null }>;
        }>("/api/ugc", { action: "status", taskIds: [taskId] });
        const row = body.results?.[0];
        if (row?.state === "success" && row.urls[0]) {
          setAvatarPreview(row.urls[0]);
          toast.success("Avatar généré — enregistre-le pour l'utiliser");
          return;
        }
        if (row?.state === "fail") throw new Error(row.failMsg || "Génération échouée");
      }
      throw new Error("Timeout avatar");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Avatar impossible");
    } finally {
      setBusy(null);
    }
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setBusy("avatar");
    try {
      const { url } = await ugcPost<{ url: string }>("/api/ugc", {
        action: "upload-image",
        avatarDataUrl: await readAsDataUrl(file),
      });
      setAvatarPreview(url);
      toast.success("Photo chargée — enregistre-la pour l'utiliser");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    } finally {
      setBusy(null);
    }
  }

  async function persistAvatar() {
    if (!avatarPreview) return;
    setBusy("avatar-save");
    try {
      await ugcPost("/api/ugc", {
        action: "avatar-save",
        avatarUrl: avatarPreview,
        casting,
        // Une photo chargée fait foi sur le visage : le casting ne la décrit pas.
        avatarUploaded: true,
        avatarName: `Avatar ${avatars.length + 1}`,
      });
      setAvatarPreview("");
      await loadAvatars();
      toast.success("Avatar enregistré et actif");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  }

  const loadAvatars = useCallback(async () => {
    try {
      const body = await ugcPost<{ avatars: AvatarMeta[]; activeId: string | null }>("/api/ugc", {
        action: "avatar-list",
      });
      setAvatars(body.avatars || []);
      setActiveId(body.activeId);
    } catch {
      // aucun avatar enregistré pour l'instant
    }
  }, []);

  useEffect(() => {
    void loadAvatars();
    return () => {
      if (polling.current) window.clearInterval(polling.current);
    };
  }, [loadAvatars]);

  useEffect(() => {
    if (!source) {
      setSourceUrl("");
      return;
    }
    const url = URL.createObjectURL(source);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  function pickSource(file: File | undefined) {
    if (!file) return;
    setSource(file);
    setAnalysis(null);
    setProduct(null);
    setJobs([]);
    setBatchId("");
    setFinalFile("");
  }

  /* ---------------- 1. Analyse ---------------- */

  async function analyze() {
    if (!source) {
      toast.error("Dépose la créative à refaire");
      return;
    }
    setBusy("analyze");
    try {
      const body = await ugcPost<{
        analysis: Analysis;
        framing: string[];
        framingError: string | null;
        product: Product | null;
        productError: string | null;
        audioBase64: string | null;
      }>("/api/ugc/remake", {
        action: "analyze",
        videoBase64: await readAsDataUrl(source),
        productUrl: productUrl.trim() || undefined,
      });

      setAnalysis(body.analysis);
      setFraming(body.framing || []);
      setProduct(body.product);
      setAudioBase64(body.audioBase64);
      setFramingNote(
        body.framing?.length
          ? ""
          : `Cadrage non relevé (${body.framingError || "service indisponible"}) — le découpage et la musique sont conservés, les angles seront génériques.`
      );
      if (body.productError) toast.error(body.productError);
      toast.success(
        `${body.analysis.shots.length} plan(s) · ${body.analysis.duration}s · ${
          body.audioBase64 ? "musique extraite" : "pas de piste son"
        }`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analyse impossible");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------- 2. Génération ---------------- */

  async function generate() {
    if (!analysis || !product) {
      toast.error("Analyse d'abord la créative et charge le produit");
      return;
    }
    if (!activeId) {
      toast.error("Choisis un avatar enregistré");
      return;
    }
    setBusy("generate");
    try {
      const body = await ugcPost<{ jobs: Job[]; batchId: string }>("/api/ugc/remake", {
        action: "generate",
        shots: analysis.shots,
        framing,
        product,
        avatarId: activeId,
        resolution,
      });
      setBatchId(body.batchId);
      setJobs(body.jobs.map((job) => ({ ...job, urls: [], state: job.taskId ? "pending" : "fail" })));
      const started = body.jobs.filter((job) => job.taskId).length;
      toast.success(`${started} plan(s) en génération`);
      startPolling(body.jobs.map((job) => job.taskId).filter((id): id is string => Boolean(id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  function startPolling(taskIds: string[]) {
    if (!taskIds.length) return;
    if (polling.current) window.clearInterval(polling.current);
    const pending = new Set(taskIds);

    polling.current = window.setInterval(async () => {
      if (!pending.size) {
        if (polling.current) window.clearInterval(polling.current);
        return;
      }
      try {
        const body = await ugcPost<{
          results: Array<{ taskId: string; state: string; urls: string[]; failMsg: string | null }>;
        }>("/api/ugc", { action: "status", taskIds: [...pending] });

        setJobs((current) =>
          current.map((job) => {
            const row = body.results.find((item) => item.taskId === job.taskId);
            if (!row || row.state === "pending") return job;
            pending.delete(row.taskId);
            return row.state === "success"
              ? { ...job, urls: row.urls, state: "done" as const }
              : { ...job, state: "fail" as const, error: row.failMsg };
          })
        );
      } catch {
        // le tour suivant réessaiera
      }
    }, 5000);
  }

  /* ---------------- 3. Remontage ---------------- */

  async function assemble() {
    if (!batchId) return;
    setBusy("assemble");
    try {
      const body = await ugcPost<{ file: string; audio: boolean }>("/api/ugc/remake", {
        action: "assemble",
        batchId,
        audioBase64,
      });
      setFinalFile(body.file);
      toast.success(body.audio ? "Montage prêt avec la musique d'origine" : "Montage prêt (sans audio)");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Remontage impossible");
    } finally {
      setBusy(null);
    }
  }

  const done = jobs.filter((job) => job.state === "done").length;
  const credits = analysis ? estimateCredits(analysis.shots, resolution) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ---------------- Colonne gauche ---------------- */}
      <div className="space-y-3">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <h3 className="mb-2.5 text-[12px] font-semibold">1 · Vidéo de référence</h3>
          <label className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-[11px] text-slate-500 dark:border-slate-700">
            <Upload className="h-4 w-4" />
            {source ? source.name.slice(0, 32) : "Dépose la vidéo à refaire"}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => pickSource(event.target.files?.[0])}
            />
          </label>
          {sourceUrl ? (
            <video src={sourceUrl} controls playsInline className="mt-2 aspect-[9/16] w-full rounded-lg bg-black object-cover" />
          ) : null}
        </div>

        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <h3 className="mb-2.5 text-[12px] font-semibold">2 · Lien produit</h3>
          <input
            value={productUrl}
            onChange={(event) => setProductUrl(event.target.value)}
            placeholder="https://ta-boutique.com/products/…"
            className={field}
          />
          {product ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
              {product.imageUrls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrls[0]} alt="" className="h-10 w-10 rounded object-cover" />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold">{product.name}</p>
                <p className="text-[11px] text-slate-400">
                  {product.imageUrls.length} image(s) ·{" "}
                  {KINDS.find((kind) => kind.id === product.kind)?.label || product.kind}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <h3 className="mb-1 text-[12px] font-semibold">3 · Ton avatar</h3>
          <p className="mb-2.5 text-[11px] text-slate-400">
            Génère un visage ou charge ta photo. Il est enregistré et réutilisé à
            l&apos;identique sur tous les remakes suivants.
          </p>

          {avatars.length ? (
            <div className="space-y-1.5">
              {avatars.map((avatar) => (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() => void ugcPost("/api/ugc", { action: "avatar-use", avatarId: avatar.id }).then(loadAvatars)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ring-1",
                    activeId === avatar.id
                      ? "bg-emerald-50 ring-emerald-300 dark:bg-emerald-950/30"
                      : "bg-slate-50 ring-transparent dark:bg-slate-800/60"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{avatar.name}</span>
                  {activeId === avatar.id ? (
                    <Star className="h-3.5 w-3.5 shrink-0 fill-emerald-500 text-emerald-500" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-2 space-y-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <select
              value={casting.age}
              onChange={(event) => setCasting({ ...casting, age: event.target.value as Casting["age"] })}
              className={field}
            >
              {AGE_BANDS.map((band) => (
                <option key={band.id} value={band.id}>{band.label}</option>
              ))}
            </select>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void makeAvatar()}
                disabled={busy === "avatar"}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 text-[11px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                {busy === "avatar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />}
                Générer
              </button>
              <label className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-slate-100 text-[11px] font-semibold dark:bg-slate-800">
                <ImagePlus className="h-3.5 w-3.5" />
                Ma photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void uploadAvatar(event.target.files?.[0])}
                />
              </label>
            </div>

            {avatarPreview ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarPreview} alt="" className="aspect-[3/4] w-full rounded object-cover" />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void persistAvatar()}
                    disabled={busy === "avatar-save"}
                    className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "avatar-save" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Enregistrer et utiliser
                  </button>
                  <button
                    type="button"
                    onClick={() => setAvatarPreview("")}
                    className="rounded-md px-2 text-[11px] text-slate-400"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void analyze()}
          disabled={busy === "analyze" || !source}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {busy === "analyze" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}
          Analyser la vidéo
        </button>
      </div>

      {/* ---------------- Colonne droite ---------------- */}
      <div className="space-y-3">
        {analysis ? (
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-semibold">Ce que la vidéo contient</h3>
              <span className="text-[11px] text-slate-400">
                {analysis.duration}s · {analysis.width}×{analysis.height} ·{" "}
                {analysis.shots.length} plans
              </span>
              {audioBase64 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <Music className="h-3 w-3" />
                  musique conservée
                </span>
              ) : null}
            </div>

            {framingNote ? (
              <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">{framingNote}</p>
            ) : null}

            <div className="space-y-1">
              {analysis.shots.map((shot) => (
                <div key={shot.index} className="flex gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60">
                  <span className="w-14 shrink-0 font-bold">Plan {shot.index + 1}</span>
                  <span className="w-24 shrink-0 text-slate-400">
                    {shot.start}s · {shot.duration}s
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">
                    {framing[shot.index] || "cadrage générique"}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <select
                value={resolution}
                onChange={(event) => setResolution(event.target.value as Resolution)}
                className={cn(field, "w-24")}
              >
                {RESOLUTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
              <span className="text-[11px] text-slate-400">
                ~{credits.toLocaleString("fr-FR")} crédits ({formatUsd(credits)})
              </span>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy === "generate" || !product || !activeId}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
              >
                {busy === "generate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                Lancer le remake
              </button>
            </div>
          </div>
        ) : (
          <div className="grid place-items-center rounded-2xl bg-white p-10 text-[12px] text-slate-400 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
            Dépose une créative et lance l&apos;analyse.
          </div>
        )}

        {jobs.length ? (
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
            <div className="mb-2.5 flex items-center gap-2">
              <h3 className="text-[12px] font-semibold">
                Plans générés · {done}/{jobs.length}
              </h3>
              {done === jobs.length && jobs.length > 1 ? (
                <button
                  type="button"
                  onClick={() => void assemble()}
                  disabled={busy === "assemble"}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  {busy === "assemble" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music className="h-3.5 w-3.5" />}
                  Remonter avec la musique
                </button>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {jobs.map((job, index) => (
                <div key={job.taskId || index} className="overflow-hidden rounded-xl bg-slate-50 dark:bg-slate-800/60">
                  <div className="grid aspect-[9/16] place-items-center bg-slate-100 dark:bg-slate-800">
                    {job.urls[0] ? (
                      <video src={job.urls[0]} controls playsInline className="h-full w-full object-cover" />
                    ) : job.state === "fail" ? (
                      <span className="px-2 text-center text-[10px] text-rose-600">{job.error || "échec"}</span>
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    )}
                  </div>
                  <p className="truncate px-2 py-1.5 text-[10px] text-slate-500">
                    {job.sceneLabel} · {job.duration}s
                  </p>
                </div>
              ))}
            </div>

            {finalFile ? (
              <a
                href={`/api/ugc/file?id=${encodeURIComponent(batchId)}&file=${encodeURIComponent(finalFile)}`}
                download
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[12px] font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                Télécharger le remake
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
