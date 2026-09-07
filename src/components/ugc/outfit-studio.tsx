"use client";

/**
 * Onglet « Outfit » : des clips muets où la même personne porte la tenue et la
 * montre face caméra, à la TikTok.
 *
 * Deux différences avec l'UGC parlant : les prompts viennent de `OUTFIT_ANGLES`
 * et imposent le silence, et l'avatar n'est pas jetable — on choisit un avatar
 * enregistré, réutilisé tel quel à chaque lot.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Star, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { AGE_BANDS, DEFAULT_CASTING, type AgeBand, type Casting } from "@/lib/ugc/casting";
import { OUTFIT_ANGLES } from "@/lib/ugc/outfit";
import {
  CLIP_DURATIONS,
  RESOLUTIONS,
  estimateCredits,
  formatUsd,
  withDuration,
  type Resolution,
} from "@/lib/ugc/types";
import { cn } from "@/lib/utils";

type AvatarMeta = {
  id: string;
  name: string;
  createdAt: string;
  casting: Casting;
  uploaded: boolean;
};

type Job = {
  angleId: string;
  angleName: string;
  sceneLabel: string;
  duration: number;
  taskId: string | null;
  error: string | null;
  urls: string[];
  state: "pending" | "done" | "fail";
};

const field =
  "h-8 w-full rounded-lg bg-slate-50 px-2.5 text-[12px] text-slate-900 outline-none focus:ring-1 focus:ring-emerald-400 dark:bg-slate-800 dark:text-slate-100";

async function ugcPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/ugc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "UGC indisponible");
  return data;
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture image impossible"));
    reader.readAsDataURL(file);
  });
}

export function OutfitStudio() {
  const [avatars, setAvatars] = useState<AvatarMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [casting, setCasting] = useState<Casting>(DEFAULT_CASTING);

  const [outfitName, setOutfitName] = useState("");
  const [outfitUrls, setOutfitUrls] = useState<string[]>([]);
  const [angleIds, setAngleIds] = useState<string[]>(["outfit-mirror"]);
  const [resolution, setResolution] = useState<Resolution>("720p");
  /** Vide = on garde la durée propre à chaque plan du montage. */
  const [clipDuration, setClipDuration] = useState<number | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const polling = useRef<number | null>(null);

  const loadAvatars = useCallback(async () => {
    try {
      const body = await ugcPost<{ avatars: AvatarMeta[]; activeId: string | null }>({
        action: "avatar-list",
      });
      setAvatars(body.avatars || []);
      setActiveId(body.activeId);
    } catch {
      // liste vide au premier lancement
    }
  }, []);

  useEffect(() => {
    void loadAvatars();
    return () => {
      if (polling.current) window.clearInterval(polling.current);
    };
  }, [loadAvatars]);

  const scenes = OUTFIT_ANGLES.filter((angle) => angleIds.includes(angle.id)).flatMap((angle) =>
    withDuration(angle.scenes, clipDuration ?? undefined)
  );
  const credits = estimateCredits(scenes, resolution);
  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.duration, 0);

  /* ---------------- Avatar ---------------- */

  async function generateAvatar() {
    setBusy("avatar");
    try {
      const { taskId } = await ugcPost<{ taskId: string }>({ action: "avatar", casting });
      // Le portrait sort en une trentaine de secondes : on interroge jusqu'au bout.
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, i < 4 ? 2000 : 3000));
        const body = await ugcPost<{ results: Array<{ state: string; urls: string[]; failMsg: string | null }> }>({
          action: "status",
          taskIds: [taskId],
        });
        const row = body.results?.[0];
        if (row?.state === "success" && row.urls[0]) {
          setAvatarPreview(row.urls[0]);
          toast.success("Avatar généré — enregistre-le pour le réutiliser");
          return;
        }
        if (row?.state === "fail") throw new Error(row.failMsg || "Génération avatar échouée");
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
      const dataUrl = await readFile(file);
      const { url } = await ugcPost<{ url: string }>({ action: "upload-image", avatarDataUrl: dataUrl });
      setAvatarPreview(url);
      toast.success("Photo chargée — enregistre-la pour la réutiliser");
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
      await ugcPost({
        action: "avatar-save",
        avatarUrl: avatarPreview,
        casting,
        avatarName: `Avatar ${avatars.length + 1}`,
      });
      setAvatarPreview("");
      await loadAvatars();
      toast.success("Avatar enregistré — il servira à toutes les générations");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  }

  async function chooseAvatar(id: string) {
    const body = await ugcPost<{ avatars: AvatarMeta[]; activeId: string | null }>({
      action: "avatar-use",
      avatarId: id,
    });
    setAvatars(body.avatars || []);
    setActiveId(body.activeId);
  }

  async function removeAvatar(id: string) {
    if (!confirm("Supprimer cet avatar ?")) return;
    const body = await ugcPost<{ avatars: AvatarMeta[]; activeId: string | null }>({
      action: "avatar-delete",
      avatarId: id,
    });
    setAvatars(body.avatars || []);
    setActiveId(body.activeId);
  }

  /* ---------------- Tenue ---------------- */

  async function addOutfitImages(files: FileList | null) {
    if (!files?.length) return;
    setBusy("outfit");
    try {
      const uploaded: string[] = [];
      for (const file of [...files].slice(0, 6 - outfitUrls.length)) {
        const dataUrl = await readFile(file);
        const { url } = await ugcPost<{ url: string }>({ action: "upload-image", avatarDataUrl: dataUrl });
        uploaded.push(url);
      }
      setOutfitUrls((current) => [...current, ...uploaded]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------- Génération ---------------- */

  async function generate() {
    if (!activeId) {
      toast.error("Choisis un avatar enregistré — c'est lui qui garde le même visage");
      return;
    }
    if (!outfitName.trim()) {
      toast.error("Donne un nom à la tenue");
      return;
    }
    if (!outfitUrls.length) {
      toast.error("Charge au moins une photo de la tenue");
      return;
    }
    if (!angleIds.length) {
      toast.error("Sélectionne au moins un montage");
      return;
    }

    setBusy("gen");
    try {
      const body = await ugcPost<{ jobs: Job[]; batchId: string }>({
        action: "generate",
        mode: "outfit",
        avatarId: activeId,
        // L'avatar enregistré fait foi sur la personne : pas de re-description.
        avatarUploaded: true,
        casting,
        resolution,
        angleIds,
        ...(clipDuration ? { clipDuration } : {}),
        product: {
          handle: outfitName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: outfitName,
          description: "",
          price: "",
          comparePrice: "",
          brand: "",
          keyPoints: [],
          imageUrls: outfitUrls,
          kind: "fashion",
        },
      });
      setJobs(body.jobs.map((job) => ({ ...job, urls: [], state: job.taskId ? "pending" : "fail" })));
      toast.success(`${body.jobs.filter((j) => j.taskId).length} clip(s) lancé(s)`);
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
        }>({ action: "status", taskIds: [...pending] });

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
        // le prochain tour réessaiera
      }
    }, 5000);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ---------------- Avatar ---------------- */}
      <div className="space-y-3">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <h3 className="mb-1 text-[12px] font-semibold">Avatar</h3>
          <p className="mb-2.5 text-[11px] leading-relaxed text-slate-400">
            Enregistre une personne une fois : elle est réutilisée à l&apos;identique sur toutes les
            générations, même après un redémarrage.
          </p>

          <div className="space-y-1.5">
            {avatars.map((avatar) => (
              <div
                key={avatar.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1",
                  activeId === avatar.id
                    ? "bg-emerald-50 ring-emerald-300 dark:bg-emerald-950/30"
                    : "bg-slate-50 ring-transparent dark:bg-slate-800/60"
                )}
              >
                <button
                  type="button"
                  onClick={() => void chooseAvatar(avatar.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[12px] font-medium">{avatar.name}</span>
                  <span className="block text-[10px] text-slate-400">
                    {avatar.uploaded ? "photo chargée" : `généré · ${avatar.casting.age}`}
                  </span>
                </button>
                {activeId === avatar.id ? (
                  <Star className="h-3.5 w-3.5 shrink-0 fill-emerald-500 text-emerald-500" />
                ) : null}
                <button
                  type="button"
                  onClick={() => void removeAvatar(avatar.id)}
                  className="shrink-0 text-slate-300 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {!avatars.length ? (
              <p className="text-[11px] text-slate-400">Aucun avatar enregistré.</p>
            ) : null}
          </div>

          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <select
              value={casting.age}
              onChange={(e) => setCasting({ ...casting, age: e.target.value as AgeBand })}
              className={field}
            >
              {AGE_BANDS.map((band) => (
                <option key={band.id} value={band.id}>{band.label}</option>
              ))}
            </select>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void generateAvatar()}
                disabled={busy === "avatar"}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 text-[11px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                {busy === "avatar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />}
                Générer
              </button>
              <label className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-slate-100 text-[11px] font-semibold dark:bg-slate-800">
                <ImagePlus className="h-3.5 w-3.5" />
                Charger
                <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
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
                    {busy === "avatar-save" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => setAvatarPreview("")}
                    className="rounded-md px-2 text-[11px] text-slate-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------------- Tenue + montages ---------------- */}
      <div className="space-y-3">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <h3 className="mb-2.5 text-[12px] font-semibold">Tenue</h3>
          <input
            value={outfitName}
            onChange={(e) => setOutfitName(e.target.value)}
            placeholder="Nom de la tenue — ex. Set satin noir"
            className={field}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {outfitUrls.map((url) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setOutfitUrls((current) => current.filter((item) => item !== url))}
                  className="absolute -right-1 -top-1 rounded-full bg-white p-0.5 text-slate-500 shadow dark:bg-slate-900"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {outfitUrls.length < 6 ? (
              <label className="grid h-16 w-16 cursor-pointer place-items-center rounded-lg bg-slate-50 text-slate-400 dark:bg-slate-800">
                {busy === "outfit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void addOutfitImages(e.target.files)} />
              </label>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Des packshots suffisent : la personne vient de l&apos;avatar, seule la tenue est reprise de ces photos.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <h3 className="mb-2.5 text-[12px] font-semibold">Montages</h3>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {OUTFIT_ANGLES.map((angle) => {
              const on = angleIds.includes(angle.id);
              return (
                <button
                  key={angle.id}
                  type="button"
                  onClick={() =>
                    setAngleIds((current) =>
                      on ? current.filter((id) => id !== angle.id) : [...current, angle.id]
                    )
                  }
                  className={cn(
                    "rounded-xl p-2.5 text-left ring-1 transition",
                    on
                      ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900"
                      : "bg-slate-50 ring-transparent hover:bg-slate-100 dark:bg-slate-800/60"
                  )}
                >
                  <span className="block text-[12px] font-semibold">{angle.name}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug opacity-70">{angle.pitch}</span>
                  <span className="mt-1 block text-[10px] opacity-60">
                    {angle.scenes.length} plans ·{" "}
                    {withDuration(angle.scenes, clipDuration ?? undefined).reduce(
                      (total, scene) => total + scene.duration,
                      0
                    )}
                    s
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as Resolution)}
              className={cn(field, "w-24")}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>

            <select
              value={clipDuration ?? ""}
              onChange={(e) => setClipDuration(e.target.value ? Number(e.target.value) : null)}
              className={cn(field, "w-36")}
            >
              <option value="">Durée du montage</option>
              {CLIP_DURATIONS.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}s par plan</option>
              ))}
            </select>

            <span className="text-[11px] text-slate-400">
              {scenes.length} clips · {totalSeconds}s au total · ~{credits.toLocaleString("fr-FR")} crédits (
              {formatUsd(credits)})
            </span>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy === "gen"}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              {busy === "gen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Générer
            </button>
          </div>
        </div>

        {jobs.length ? (
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
            <h3 className="mb-2.5 text-[12px] font-semibold">
              Clips · {jobs.filter((j) => j.state === "done").length}/{jobs.length}
            </h3>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {jobs.map((job, index) => (
                <div key={`${job.taskId || index}`} className="overflow-hidden rounded-xl bg-slate-50 dark:bg-slate-800/60">
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
                    {job.angleName} · {job.sceneLabel}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Les clips sont enregistrés sur disque au lancement — retrouve-les dans l&apos;onglet Résultats
              pour les monter bout à bout.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
