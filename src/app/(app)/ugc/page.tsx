"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  Film,
  FolderClock,
  GraduationCap,
  Link2,
  Loader2,
  Maximize2,
  Scissors,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import { ANGLES } from "@/lib/ugc/angles";
import { AGE_BANDS, DEFAULT_CASTING, GENDERS, type Casting } from "@/lib/ugc/casting";
import { KINDS } from "@/lib/ugc/kinds";
import type { UgcBatch } from "@/lib/ugc/store";
import {
  RESOLUTIONS,
  estimateCredits,
  formatUsd,
  type ProductInput,
  type Resolution,
  type UgcJob,
} from "@/lib/ugc/types";
import { cn } from "@/lib/utils";

const POLL_MS = 10000;
const POLL_MAX_MS = 60000;

const EMPTY: ProductInput = {
  handle: "",
  name: "",
  description: "",
  price: "",
  comparePrice: "",
  keyPoints: ["", "", ""],
  imageUrls: [],
  brand: "",
  kind: "other",
};

export default function UgcPage() {
  const [product, setProduct] = useState<ProductInput>(EMPTY);
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [angles, setAngles] = useState<Set<string>>(new Set(["problem-solution"]));
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [jobs, setJobs] = useState<UgcJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [tab, setTab] = useState<"generate" | "results" | "course">("generate");
  const [batches, setBatches] = useState<UgcBatch[]>([]);
  const [casting, setCasting] = useState<Casting>(DEFAULT_CASTING);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarUploaded, setAvatarUploaded] = useState(false);
  const backoff = useRef(POLL_MS);

  const selected = useMemo(() => ANGLES.filter((angle) => angles.has(angle.id)), [angles]);
  const scenes = useMemo(() => selected.flatMap((angle) => angle.scenes), [selected]);
  const credits = estimateCredits(scenes, resolution);
  const seconds = scenes.reduce((total, scene) => total + scene.duration, 0);

  const pendingIds = useMemo(
    () => jobs.filter((job) => job.state === "pending" && job.taskId).map((job) => job.taskId as string),
    [jobs]
  );

  useEffect(() => {
    if (!pendingIds.length) {
      backoff.current = POLL_MS;
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch("/api/ugc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", taskIds: pendingIds }),
        });
        const body = await res.json();
        if (!alive) return;

        if (body.throttled) backoff.current = Math.min(backoff.current * 2, POLL_MAX_MS);
        else backoff.current = POLL_MS;

        setJobs((current) =>
          current.map((job) => {
            if (job.state !== "pending" || !job.taskId) return job;
            const hit = body.results?.find((r: { taskId: string }) => r.taskId === job.taskId);
            if (!hit) return job;
            if (hit.state === "success" && hit.urls?.length) {
              return { ...job, state: "done" as const, urls: hit.urls };
            }
            if (hit.state === "fail") {
              return { ...job, state: "fail" as const, error: hit.failMsg || "Échec" };
            }
            return job;
          })
        );
      } catch {
        // Un poll raté n'est pas un échec : la boucle repassera.
      }
      if (alive) timer = setTimeout(tick, backoff.current);
    };

    timer = setTimeout(tick, backoff.current);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pendingIds]);

  const loadBatches = useCallback(() => {
    void fetch("/api/ugc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "batches" }),
    })
      .then((res) => res.json())
      .then((body) => setBatches(body.batches ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadBatches, 0);
    return () => clearTimeout(timer);
  }, [loadBatches, jobs, tab]);

  useEffect(() => {
    const load = () => {
      void fetch("/api/kie-credit", { cache: "no-store" })
        .then((res) => res.json())
        .then((body) => setBalance(typeof body.credits === "number" ? body.credits : null))
        .catch(() => setBalance(null));
    };
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [jobs]);

  /** Colle l'URL de la fiche produit : tout le reste se remplit tout seul. */
  const loadUrl = useCallback(async () => {
    const target = url.trim();
    if (!target) return toast.error("Colle l'URL de ta page produit");

    setFetching(true);
    try {
      const res = await fetch("/api/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch", url: target }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      const found = body.product as ProductInput;
      // On garde toujours trois cases : les points vides restent éditables.
      const keyPoints = [...found.keyPoints, "", "", ""].slice(0, Math.max(3, found.keyPoints.length));
      setProduct({ ...found, keyPoints });
      toast.success(
        `${found.name} — ${found.imageUrls.length} image(s), ${found.keyPoints.length} point(s) clé(s)`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lecture impossible");
    } finally {
      setFetching(false);
    }
  }, [url]);

  /** Un visage déjà trouvé ailleurs : plus rapide qu'une génération. */
  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch("/api/ugc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "upload-avatar", avatarDataUrl: String(reader.result || "") }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setAvatarUrl(body.url);
        setAvatarUploaded(true);
        setAvatarOpen(true);
        toast.success("Avatar chargé — c'est lui qui fait foi, le casting est ignoré");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Upload impossible");
      } finally {
        setAvatarBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  /** Génère le portrait de référence, réutilisé sur tous les clips du lot. */
  async function makeAvatar() {
    setAvatarBusy(true);
    try {
      const res = await fetch("/api/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "avatar", casting }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      // L'image met une poignée de secondes : on interroge jusqu'à l'avoir.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const poll = await fetch("/api/ugc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", taskIds: [body.taskId] }),
        });
        const state = await poll.json();
        const hit = state.results?.[0];
        if (hit?.state === "success" && hit.urls?.[0]) {
          setAvatarUrl(hit.urls[0]);
          setAvatarUploaded(false);
          setAvatarOpen(true);
          toast.success("Avatar prêt — il sera identique sur tous les clips");
          return;
        }
        if (hit?.state === "fail") throw new Error(hit.failMsg || "Avatar impossible");
      }
      throw new Error("Avatar trop long à générer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Avatar impossible");
    } finally {
      setAvatarBusy(false);
    }
  }

  function setPoint(index: number, value: string) {
    setProduct((current) => {
      const keyPoints = [...current.keyPoints];
      keyPoints[index] = value;
      return { ...current, keyPoints };
    });
  }

  async function call(action: "preview" | "generate") {
    if (!product.name.trim()) return toast.error("Renseigne au moins le nom du produit");
    if (!angles.size) return toast.error("Sélectionne au moins un angle");

    setBusy(true);
    try {
      const res = await fetch("/api/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          resolution,
          angleIds: [...angles],
          casting,
          avatarUrl,
          avatarUploaded,
          product: { ...product, keyPoints: product.keyPoints.filter(Boolean) },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      if (action === "preview") {
        setPreview(
          body.scenes
            .map(
              (scene: { angleName: string; sceneLabel: string; duration: number; prompt: string }) =>
                `### ${scene.angleName} · ${scene.sceneLabel} (${scene.duration}s)\n\n${scene.prompt}`
            )
            .join("\n\n———\n\n")
        );
        return;
      }

      const fresh: UgcJob[] = body.jobs.map((job: Omit<UgcJob, "state" | "urls">) => ({
        ...job,
        state: job.taskId ? "pending" : "fail",
        urls: [],
      }));
      setJobs(fresh);
      toast.success(`${fresh.filter((job) => job.taskId).length} clips lancés`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible");
    } finally {
      setBusy(false);
    }
  }

  const byAngle = useMemo(() => {
    const map = new Map<string, UgcJob[]>();
    for (const job of jobs) map.set(job.angleId, [...(map.get(job.angleId) ?? []), job]);
    return map;
  }, [jobs]);

  const done = jobs.filter((job) => job.state === "done").length;

  /** Le solde décide : un lot trop cher est bloqué avant le premier appel. */
  const tooExpensive = balance !== null && credits > balance;

  return (
    <div>
      <PageHeader
        title="UGC Creative"
        description="Un produit, plusieurs angles, un lot de clips verticaux prêts à tester en ads. Seedance 2.0, 9:16, voix incluse."
        actions={
          tab === "generate" ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void call("preview")} disabled={busy}>
                <Sparkles className="h-3.5 w-3.5" />
                Voir les prompts
              </Button>
              <Button size="sm" onClick={() => void call("generate")} disabled={busy || !angles.size || tooExpensive}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                Lancer {scenes.length ? `(${scenes.length} clips)` : ""}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-4 flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
        {(
          [
            ["generate", "Générer", Film],
            ["results", `Résultats${batches.length ? ` (${batches.length})` : ""}`, FolderClock],
            ["course", "Leçons", GraduationCap],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
              tab === id
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "results" ? <Results batches={batches} onChange={loadBatches} /> : null}
      {tab === "course" ? <Course /> : null}

      <div className={cn("grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]", tab !== "generate" && "hidden")}>
        <div className="space-y-4">
          {/* 1. Le produit */}
          <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
            <h2 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              1. Produit
            </h2>

            <div className="mb-3 flex gap-2">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadUrl();
                  }}
                  placeholder="Colle l'URL de ta page produit et appuie sur Entrée"
                  className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2.5 text-[12px] dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadUrl()} disabled={fetching}>
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Charger
              </Button>
            </div>

            {product.imageUrls.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {product.imageUrls.map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={image}
                    src={image}
                    alt=""
                    className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                  />
                ))}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Nom du produit" value={product.name} onChange={(v) => setProduct((c) => ({ ...c, name: v }))} placeholder="Robe en lin écru" />
              <Field label="Description courte" value={product.description} onChange={(v) => setProduct((c) => ({ ...c, description: v }))} placeholder="Coupe droite, lin lavé, doublée" />
              <Field label="Prix affiché" value={product.price} onChange={(v) => setProduct((c) => ({ ...c, price: v }))} placeholder="39 €" />
              <Field label="Marque (citée dans le CTA)" value={product.brand} onChange={(v) => setProduct((c) => ({ ...c, brand: v }))} placeholder="Boomba" />
              <Field label="Prix barré" value={product.comparePrice} onChange={(v) => setProduct((c) => ({ ...c, comparePrice: v }))} placeholder="79 €" />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {product.keyPoints.map((point, index) => (
                <Field
                  key={index}
                  label={`Point clé ${index + 1}`}
                  value={point}
                  onChange={(value) => setPoint(index, value)}
                  placeholder={["ne se froisse pas", "taille vraiment", "livré en 3 jours"][index]}
                />
              ))}
            </div>

            <div className="mt-3">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Type de produit — change la façon dont il est manipulé
              </span>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setProduct((current) => ({ ...current, kind: item.id }))}
                    title={item.hint}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                      product.kind === item.id
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {product.imageUrls.length ? (
              <p className="mt-2 text-[11px] text-slate-500">
                {product.imageUrls.length} image(s) de référence — le produit restera identique.
              </p>
            ) : (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <strong>Aucune image de référence.</strong> La génération est bloquée : sans photo, le
                modèle inventerait un autre produit. Charge la fiche depuis son URL.
              </p>
            )}
          </section>

          {/* 2. Le personnage */}
          <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
            <h2 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              2. Personnage
            </h2>

            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 space-y-2">
                <div className={cn("space-y-2", avatarUploaded && "opacity-40")}>
                  <div className="flex flex-wrap gap-1.5">
                    {GENDERS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={avatarUploaded}
                        onClick={() => {
                          setCasting((current) => ({ ...current, gender: item.id }));
                          // Seul un avatar généré devient caduc : celui que tu as
                          // chargé reste le tien, quel que soit ce réglage.
                          setAvatarUrl("");
                        }}
                        className={cn(
                          "rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed",
                          casting.gender === item.id
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {AGE_BANDS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={avatarUploaded}
                        onClick={() => {
                          setCasting((current) => ({ ...current, age: item.id }));
                          setAvatarUrl("");
                        }}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed",
                          casting.age === item.id
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {avatarUploaded ? (
                  <p className="text-[10px] leading-snug text-slate-500">
                    Casting désactivé : ta photo fait foi sur le genre et l&apos;âge.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarUrl("");
                        setAvatarUploaded(false);
                      }}
                      className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      Retirer la photo
                    </button>
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void makeAvatar()} disabled={avatarBusy}>
                    {avatarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />}
                    {avatarUrl ? "Regénérer" : "Générer l'avatar"}
                  </Button>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void uploadAvatar(event.target.files?.[0])}
                    />
                    <Upload className="h-3 w-3" />
                    Charger un visage
                  </label>
                </div>
              </div>

              {avatarBusy && !avatarUrl ? (
                <div
                  className="flex shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800"
                  style={{ width: 84, height: 112 }}
                >
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : null}

              {avatarUrl ? (
                <button
                  type="button"
                  onClick={() => setAvatarOpen(true)}
                  title="Agrandir — vérifie le visage avant de lancer"
                  className="group relative shrink-0 overflow-hidden rounded-lg ring-2 ring-emerald-400 transition-opacity hover:opacity-90"
                  style={{ width: 84, height: 112 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-slate-950/60 py-0.5 text-center text-[9px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Agrandir
                  </span>
                </button>
              ) : null}
            </div>

            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              {avatarUrl
                ? "Cet avatar part en première image de référence sur chaque clip : même visage, mêmes cheveux, même tenue partout."
                : "Sans avatar, chaque clip montrera une personne différente. Génère-le avant de lancer le lot."}
            </p>
          </section>

          {/* 2. Les angles */}
          <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                3. Angles à tester
              </h2>
              <button
                type="button"
                onClick={() => setAngles(new Set(ANGLES.map((angle) => angle.id)))}
                className="text-[11px] font-medium text-emerald-600 hover:underline dark:text-emerald-400"
              >
                Tout sélectionner
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {ANGLES.map((angle) => {
                const on = angles.has(angle.id);
                return (
                  <button
                    key={angle.id}
                    type="button"
                    onClick={() =>
                      setAngles((current) => {
                        const next = new Set(current);
                        if (next.has(angle.id)) next.delete(angle.id);
                        else next.add(angle.id);
                        return next;
                      })
                    }
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      on
                        ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                        : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                        {angle.name}
                      </span>
                      {on ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-slate-500">{angle.pitch}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {angle.scenes.map((scene) => (
                        <span
                          key={scene.label}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        >
                          {scene.label} · {scene.duration}s
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Les rendus */}
          {jobs.length ? (
            <section className="space-y-3">
              {[...byAngle.entries()].map(([angleId, list]) => (
                <div
                  key={angleId}
                  className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]"
                >
                  <div className="mb-2 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                    {list[0]?.angleName}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((job, index) => (
                      <div key={`${job.angleId}-${index}`} className="w-[150px]">
                        <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                          {job.state === "done" && job.urls[0] ? (
                            <video
                              src={job.urls[0]}
                              controls
                              playsInline
                              className="h-full w-full object-cover"
                            />
                          ) : job.state === "fail" ? (
                            <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
                              <X className="h-4 w-4 text-rose-500" />
                              <span className="text-[9px] leading-tight text-rose-600">{job.error}</span>
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                            </div>
                          )}
                        </div>
                        <div className="mt-1 truncate text-[10px] text-slate-500">
                          {job.sceneLabel} · {job.duration}s
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <EmptyState
              title="Aucun clip généré"
              description="Renseigne un produit, coche les angles à tester, puis lance le lot."
            />
          )}
        </div>

        {/* Récapitulatif */}
        <aside className="h-fit space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] lg:sticky lg:top-4 dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Récapitulatif du lot
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Clips à générer</div>
            <div className="text-3xl font-semibold text-slate-900 dark:text-slate-100">{scenes.length}</div>
            <div className="text-[11px] text-slate-500">
              {selected.length} angle{selected.length > 1 ? "s" : ""} · {seconds}s de vidéo
            </div>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {RESOLUTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setResolution(value)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  resolution === value
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-500"
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <Row label="Produit" value={product.name || "—"} />
          <Row label="Références" value={String(product.imageUrls.length)} />
          <Row label="Format" value="9:16" />
          <Row label="Coût estimé" value={`${formatUsd(credits)}  ·  ~${credits.toLocaleString("fr-FR")} cr`} />
          <Row
            label="Solde Kie"
            value={balance === null ? "…" : balance.toLocaleString("fr-FR")}
          />
          {done ? <Row label="Terminés" value={`${done} / ${jobs.length}`} /> : null}

          {tooExpensive ? (
            <div className="rounded-lg bg-rose-50 p-2.5 text-[11px] leading-snug text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <strong>Lot bloqué.</strong> Il coûte ~{credits.toLocaleString("fr-FR")} crédits et il
              t&apos;en reste {balance?.toLocaleString("fr-FR")} ({formatUsd(balance ?? 0)}). Retire des
              angles, ou recharge Kie.
            </div>
          ) : (
            <p className="text-[10px] leading-snug text-slate-400">
              ~102 crédits/seconde en 720p (mesuré le 24/08), soit {formatUsd(102)} la seconde de
              vidéo. Vérifie toujours ce total avant de lancer.
            </p>
          )}
        </aside>
      </div>

      {avatarOpen && avatarUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onClick={() => setAvatarOpen(false)}
        >
          <div
            className="flex max-h-full flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt=""
              className="max-h-[75vh] w-auto max-w-full rounded-xl object-contain shadow-2xl"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void makeAvatar()} disabled={avatarBusy}>
                {avatarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />}
                Un autre visage
              </Button>
              <Button size="sm" onClick={() => setAvatarOpen(false)}>
                <Check className="h-3.5 w-3.5" />
                Je garde celui-là
              </Button>
            </div>
            <p className="max-w-md text-center text-[11px] text-slate-300">
              Ce visage sera identique sur les {scenes.length || "…"} clips du lot. Regarde-le bien
              maintenant : le regénérer après coup obligerait à relancer toute la génération.
            </p>
          </div>
        </div>
      ) : null}

      {preview !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                Prompts envoyés à Seedance
              </h3>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(preview);
                  toast.success("Copié");
                }}
                className="text-[11px] font-medium text-emerald-600 hover:underline"
              >
                Copier
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              {preview}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tous les lots lancés, relus depuis le disque. Chaque clip abouti est servi
 * depuis le mp4 rapatrié : il reste lisible même après l'expiration de l'URL Kie.
 */
function Results({ batches, onChange }: { batches: UgcBatch[]; onChange: () => void }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const [cutting, setCutting] = useState("");

  /** Recolle les clips d'un angle en une vidéo unique, prête à publier. */
  async function stitch(batchId: string, angleId: string) {
    setCutting(`${batchId}:${angleId}`);
    try {
      const res = await fetch("/api/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stitch", batchId, angleId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast.success("Montage prêt");
      onChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Montage impossible");
    } finally {
      setCutting("");
    }
  }

  if (!batches.length) {
    return (
      <EmptyState
        title="Aucun lot enregistré"
        description="Chaque lancement est écrit sur disque dès sa création — tu retrouveras tout ici, même après avoir fermé l'onglet."
      />
    );
  }

  return (
    <div className="space-y-3">
      {zoom ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4"
          onClick={() => setZoom(null)}
        >
          <video
            src={zoom}
            controls
            autoPlay
            playsInline
            onClick={(event) => event.stopPropagation()}
            className="max-h-[92vh] w-auto max-w-full rounded-xl shadow-2xl"
          />
        </div>
      ) : null}

      {batches.map((batch) => {
        const ready = batch.jobs.filter((job) => job.state === "done").length;
        const failed = batch.jobs.filter((job) => job.state === "fail").length;
        return (
          <section
            key={batch.id}
            className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                {batch.product.name || batch.product.handle || "Sans nom"}
              </span>
              <span className="text-[11px] text-slate-500">
                {new Date(batch.createdAt).toLocaleString("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                · {batch.resolution} · {ready}/{batch.jobs.length} prêts
                {failed ? ` · ${failed} échec(s)` : ""}
              </span>
            </div>

            {/* Un bloc par angle : les clips, puis le montage de cet angle. */}
            {[...new Set(batch.jobs.map((job) => job.angleId))].map((angleId) => {
              const jobs = batch.jobs.filter((job) => job.angleId === angleId);
              const allReady = jobs.every((job) => job.state === "done" && job.file);
              const cut = batch.cuts?.[angleId];
              const cutSrc = cut ? fileUrl(batch.id, cut) : null;
              const busy = cutting === `${batch.id}:${angleId}`;

              return (
                <div key={angleId} className="mb-3 last:mb-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      {jobs[0]?.angleName}
                    </span>
                    {allReady && !cut ? (
                      <button
                        type="button"
                        onClick={() => void stitch(batch.id, angleId)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:bg-emerald-500/15 dark:text-emerald-300"
                      >
                        {busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Scissors className="h-3 w-3" />
                        )}
                        Assembler les {jobs.length} clips
                      </button>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {jobs.map((job, index) => {
                      const src = job.file ? fileUrl(batch.id, job.file) : job.urls[0];
                      return (
                        <Clip
                          key={`${angleId}-${index}`}
                          src={src}
                          label={job.sceneLabel}
                          error={job.state === "fail" ? job.error : null}
                          download={`${angleId}-${job.sceneLabel}.mp4`}
                          onZoom={() => src && setZoom(src)}
                        />
                      );
                    })}

                    {cutSrc ? (
                      <Clip
                        src={cutSrc}
                        label="Montage complet"
                        error={null}
                        download={`${batch.product.handle || "ugc"}-${angleId}.mp4`}
                        onZoom={() => setZoom(cutSrc)}
                        highlight
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

type CourseDoc = { file: string; title: string };

/** Le cours Whop, consultable sans quitter l'outil qui s'en sert. */
function Course() {
  const [docs, setDocs] = useState<CourseDoc[]>([]);
  const [open, setOpen] = useState<string>("_cours-complet.md");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetch("/api/ugc/course")
        .then((res) => res.json())
        .then((body) => setDocs(body.docs ?? []))
        .catch(() => setDocs([]));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setLoading(true);
      void fetch(`/api/ugc/course?file=${encodeURIComponent(open)}`)
        .then((res) => res.json())
        .then((body) => setText(body.text ?? "Document illisible"))
        .catch(() => setText("Document illisible"))
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  if (!docs.length) {
    return (
      <EmptyState
        title="Cours indisponible"
        description="Les leçons se lisent depuis data/ugc-course. Relance le script d'aspiration si le dossier est vide."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav className="h-fit space-y-1 rounded-2xl bg-white p-2 ring-1 ring-slate-900/[0.06] lg:sticky lg:top-4 dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
        {docs.map((doc) => (
          <button
            key={doc.file}
            type="button"
            onClick={() => setOpen(doc.file)}
            className={cn(
              "block w-full rounded-lg px-2.5 py-2 text-left text-[12px] font-medium leading-snug transition-colors",
              open === doc.file
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
            )}
          >
            {doc.title}
          </button>
        ))}
      </nav>

      <article className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-slate-700 dark:text-slate-300">
            {text}
          </pre>
        )}
      </article>
    </div>
  );
}

function fileUrl(batchId: string, file: string) {
  return `/api/ugc/file?id=${encodeURIComponent(batchId)}&file=${encodeURIComponent(file)}`;
}

/**
 * Vignette de clip. La vidéo est en `object-contain` : un `cover` remplirait la
 * case mais rognerait le 9:16, donc précisément ce qu'on veut juger avant de
 * publier. Le clic ouvre le plein écran.
 */
function Clip({
  src,
  label,
  error,
  download,
  onZoom,
  highlight,
}: {
  src: string | undefined;
  label: string;
  error: string | null;
  download: string;
  onZoom: () => void;
  highlight?: boolean;
}) {
  return (
    <div className="w-[150px]">
      <div
        className={cn(
          "relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-900",
          highlight && "ring-2 ring-emerald-500"
        )}
      >
        {src ? (
          <>
            <video src={src} controls playsInline className="h-full w-full object-contain" />
            <button
              type="button"
              onClick={onZoom}
              title="Voir en grand, sans recadrage"
              className="absolute right-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 transition-opacity hover:opacity-100"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
            <X className="h-4 w-4 text-rose-500" />
            <span className="text-[9px] leading-tight text-rose-400">{error}</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span
          className={cn(
            "truncate text-[10px]",
            highlight ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-slate-500"
          )}
        >
          {label}
        </span>
        {src ? (
          <a
            href={src}
            download={download}
            className="shrink-0 text-slate-400 hover:text-emerald-600"
            title="Télécharger"
          >
            <Download className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950"
      />
    </label>
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
