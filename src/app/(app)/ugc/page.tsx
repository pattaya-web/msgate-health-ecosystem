"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  Clapperboard,
  Download,
  Film,
  FolderClock,
  GraduationCap,
  ImagePlus,
  Library,
  Link2,
  Loader2,
  Maximize2,
  PenLine,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import { RemakeStudio } from "@/components/ugc/remake-studio";
import { RuggCrea } from "@/components/ugc/rugg-crea";
import type { ScriptTemplate, StyleTemplate } from "@/lib/creative-library/types";
import { ANGLES } from "@/lib/ugc/angles";
import type { AvatarMeta } from "@/lib/ugc/avatar-store";
import { AGE_BANDS, DEFAULT_CASTING, GENDERS, type Casting } from "@/lib/ugc/casting";
import { toDataUrl } from "@/lib/ugc/creative-file";
import { DEFAULT_FORMAT, DEFAULT_NICHE, FORMATS, NICHES, type FormatId, type NicheId } from "@/lib/ugc/formats";
import { KINDS, isPhysical } from "@/lib/ugc/kinds";
import { angleFromStory, draftFromText, fitScenes, parseManualAngle, type StoryDraft, type StoryScene } from "@/lib/ugc/script-writer";
import type { UgcBatch } from "@/lib/ugc/store";
import {
  RESOLUTIONS,
  estimateCredits,
  formatUsd,
  type Angle,
  type ProductInput,
  type Resolution,
  type UgcJob,
} from "@/lib/ugc/types";
import { cn } from "@/lib/utils";
import { SendToDrive } from "@/components/drive/send-to-drive";

const POLL_MS = 5000;
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

const panel =
  "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";

const chip = (on: boolean) =>
  cn(
    "rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed",
    on
      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
  );

async function ugcPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/ugc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Requête refusée");
  return data;
}

async function libraryPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Bibliothèque indisponible");
  return data;
}

type Tab = "generate" | "remake" | "rugg" | "results" | "course";

export default function UgcPage() {
  const [product, setProduct] = useState<ProductInput>(EMPTY);
  const [subjectMode, setSubjectMode] = useState<"product" | "topic">("product");
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [angles, setAngles] = useState<Set<string>>(new Set(["problem-solution"]));
  const [customAngles, setCustomAngles] = useState<Angle[]>([]);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [jobs, setJobs] = useState<UgcJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  // `?tab=remake` ouvre directement l'onglet demandé (depuis Reproduire).
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "generate";
    const wanted = new URLSearchParams(window.location.search).get("tab");
    return wanted === "remake" || wanted === "rugg" || wanted === "results" || wanted === "course" ? wanted : "generate";
  });
  const [batches, setBatches] = useState<UgcBatch[]>([]);
  const [casting, setCasting] = useState<Casting>(DEFAULT_CASTING);
  /** Sujet libre : aucun casting pré-coché, la personne vient du prompt. */
  const [castingFree, setCastingFree] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  /** Description libre de l'avatar : elle prime sur les puces genre / âge. */
  const [avatarDesc, setAvatarDesc] = useState("");
  /** Lot en cours dans cet onglet : montage et fichiers locaux. */
  const [batchId, setBatchId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Record<string, string>>({});
  const [stitching, setStitching] = useState<string | null>(null);
  const [clipZoom, setClipZoom] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarUploaded, setAvatarUploaded] = useState(false);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [savedAvatars, setSavedAvatars] = useState<AvatarMeta[]>([]);
  const [formatId, setFormatId] = useState<FormatId>(DEFAULT_FORMAT);
  const [nicheId, setNicheId] = useState<NicheId>(DEFAULT_NICHE);
  const [styleBlock, setStyleBlock] = useState("");
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(2);
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [writing, setWriting] = useState(false);
  const [manual, setManual] = useState("");
  const [library, setLibrary] = useState<{ styles: StyleTemplate[]; scripts: ScriptTemplate[] }>({ styles: [], scripts: [] });
  const [adapting, setAdapting] = useState("");
  const [uploadingRef, setUploadingRef] = useState(false);
  const [story, setStory] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyDraft, setStoryDraft] = useState<StoryDraft | null>(null);
  const [targetSeconds, setTargetSeconds] = useState(30);
  const backoff = useRef(POLL_MS);
  const seq = useRef(0);

  const allAngles = useMemo(() => [...customAngles, ...ANGLES], [customAngles]);
  const selected = useMemo(() => allAngles.filter((angle) => angles.has(angle.id)), [allAngles, angles]);
  const scenes = useMemo(() => selected.flatMap((angle) => angle.scenes), [selected]);
  const credits = estimateCredits(scenes, resolution);
  const seconds = scenes.reduce((total, scene) => total + scene.duration, 0);
  const physical = isPhysical(product.kind);

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
        const body = await ugcPost<{
          throttled?: boolean;
          results?: Array<{ taskId: string; state?: string; urls?: string[]; failMsg?: string | null }>;
        }>({ action: "status", taskIds: pendingIds });
        if (!alive) return;
        backoff.current = body.throttled ? Math.min(backoff.current * 2, POLL_MAX_MS) : POLL_MS;
        setJobs((current) =>
          current.map((job) => {
            if (job.state !== "pending" || !job.taskId) return job;
            const hit = body.results?.find((r) => r.taskId === job.taskId);
            if (!hit) return job;
            if (hit.state === "success" && hit.urls?.length) return { ...job, state: "done" as const, urls: hit.urls };
            if (hit.state === "fail") return { ...job, state: "fail" as const, error: hit.failMsg || "Échec" };
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
    void ugcPost<{ batches?: UgcBatch[] }>({ action: "batches" })
      .then((body) => setBatches(body.batches ?? []))
      .catch(() => undefined);
  }, []);

  const loadAvatars = useCallback(() => {
    void ugcPost<{ avatars?: AvatarMeta[]; activeId?: string | null }>({ action: "avatar-list" })
      .then((body) => setSavedAvatars(body.avatars ?? []))
      .catch(() => undefined);
  }, []);

  const loadLibrary = useCallback(() => {
    void fetch("/api/library")
      .then((res) => res.json())
      .then((body) => setLibrary({ styles: body.styles ?? [], scripts: body.scripts ?? [] }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadBatches, 0);
    return () => clearTimeout(timer);
  }, [loadBatches, jobs, tab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadAvatars();
      loadLibrary();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadAvatars, loadLibrary]);

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
      const body = await ugcPost<{ product: ProductInput }>({ action: "fetch", url: target });
      const found = body.product;
      const keyPoints = [...found.keyPoints, "", "", ""].slice(0, Math.max(3, found.keyPoints.length));
      setProduct({ ...found, keyPoints });
      setSubjectMode("product");
      toast.success(`${found.name} — ${found.imageUrls.length} image(s), ${found.keyPoints.length} point(s) clé(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lecture impossible");
    } finally {
      setFetching(false);
    }
  }, [url]);

  /** Une image de référence pour un sujet libre (couverture, capture, visuel). */
  async function uploadReference(file: File | undefined) {
    if (!file) return;
    setUploadingRef(true);
    try {
      const dataUrl = await toDataUrl(file);
      const body = await ugcPost<{ url: string }>({ action: "upload-image", avatarDataUrl: dataUrl });
      setProduct((current) => ({ ...current, imageUrls: [...current.imageUrls, body.url] }));
      toast.success("Image ajoutée en référence");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    } finally {
      setUploadingRef(false);
    }
  }

  /** Un visage déjà trouvé ailleurs : plus rapide qu'une génération. */
  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const dataUrl = await toDataUrl(file);
      const body = await ugcPost<{ url: string }>({ action: "upload-avatar", avatarDataUrl: dataUrl });
      setAvatarUrl(body.url);
      setAvatarUploaded(true);
      setAvatarId(null);
      setAvatarOpen(true);
      toast.success("Avatar chargé — c'est lui qui fait foi, le casting est ignoré");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload impossible");
    } finally {
      setAvatarBusy(false);
    }
  }

  /** Génère le portrait de référence, réutilisé sur tous les clips du lot. */
  async function makeAvatar() {
    const description = avatarDesc.trim();
    if (!description && castingFree) {
      return toast.error("Décris l'avatar dans le champ, ou choisis un genre et un âge");
    }
    setAvatarBusy(true);
    try {
      const body = await ugcPost<{ taskId: string }>({ action: "avatar", casting, description: description || undefined });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const state = await ugcPost<{ results?: Array<{ state?: string; urls?: string[]; failMsg?: string }> }>({
          action: "status",
          taskIds: [body.taskId],
        });
        const hit = state.results?.[0];
        if (hit?.state === "success" && hit.urls?.[0]) {
          setAvatarUrl(hit.urls[0]);
          // Décrit en toutes lettres : l'image fait foi, le casting n'est pas redit.
          setAvatarUploaded(Boolean(description));
          setAvatarId(null);
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

  /** Garde ce visage pour les prochains lots : même créateur, même marque. */
  async function saveCurrentAvatar() {
    if (!avatarUrl) return;
    const name = window.prompt("Nom de cet avatar (ex. Léa, 25-35, mode)") ?? "";
    try {
      const body = await ugcPost<{ avatar: AvatarMeta }>({
        action: "avatar-save",
        avatarUrl,
        casting,
        avatarUploaded,
        avatarName: name,
      });
      setAvatarId(body.avatar.id);
      loadAvatars();
      toast.success("Avatar enregistré");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    }
  }

  function pickSavedAvatar(avatar: AvatarMeta) {
    setAvatarId(avatar.id);
    setAvatarUrl(`/api/ugc/avatar-image?id=${encodeURIComponent(avatar.id)}`);
    setAvatarUploaded(avatar.uploaded);
    setCasting(avatar.casting);
  }

  function setPoint(index: number, value: string) {
    setProduct((current) => {
      const keyPoints = [...current.keyPoints];
      keyPoints[index] = value;
      return { ...current, keyPoints };
    });
  }

  /**
   * Le script écrit devient l'angle « story » : il remplace le précédent,
   * il est coché seul, et le sujet prend le titre et les faits relevés.
   */
  function applyStory(draft: StoryDraft, found?: ProductInput | null) {
    setStoryDraft(draft);
    setProduct((current) => {
      const base = found
        ? { ...found, keyPoints: [...found.keyPoints, "", "", ""].slice(0, Math.max(3, found.keyPoints.length)) }
        : current;
      const hasImages = base.imageUrls.length > 0;
      return {
        ...base,
        name: draft.title || base.name,
        description: draft.description || base.description,
        keyPoints: draft.keyPoints.length ? [...draft.keyPoints, "", "", ""].slice(0, 3) : base.keyPoints,
        kind: found ? found.kind : hasImages ? (base.kind === "topic" ? "other" : base.kind) : "topic",
      };
    });
    const angle = angleFromStory(draft);
    setCustomAngles((current) => [angle, ...current.filter((item) => item.id !== "story")]);
    setAngles(new Set([angle.id]));
  }

  function patchStory(patch: Partial<StoryDraft>) {
    if (!storyDraft) return;
    applyStory({ ...storyDraft, ...patch });
  }

  function patchScene(index: number, patch: Partial<StoryScene>) {
    if (!storyDraft) return;
    patchStory({ scenes: storyDraft.scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)) });
  }

  function refitStory(seconds: number) {
    setTargetSeconds(seconds);
    if (storyDraft) applyStory({ ...storyDraft, scenes: fitScenes(storyDraft.scenes, seconds) });
  }

  /** Reformule l'histoire et écrit le script, en lisant la source si elle est donnée. */
  /**
   * Sujet libre : l'utilisateur invente ses scènes. Le format, la niche et
   * les angles préfabriqués n'ont rien à y faire ; ils restent des réglages
   * du mode fiche produit.
   */
  const freeMode = subjectMode === "topic";

  async function writeTheStory() {
    if (!story.trim()) return toast.error("Écris ton histoire d'abord");
    setStoryBusy(true);
    try {
      const body = await ugcPost<{ draft: StoryDraft; product: ProductInput | null; sourceError: string | null }>({
        action: "write-story",
        story,
        sourceUrl: sourceUrl.trim() || undefined,
        scriptId: scriptId ?? undefined,
        imageUrls: product.imageUrls,
        formatId: freeMode ? "free" : formatId,
        nicheId: freeMode ? "none" : nicheId,
        language,
        targetSeconds,
      });
      if (body.sourceError) toast.error(`Source : ${body.sourceError}`);
      applyStory(body.draft, body.product);
      toast.success("Script écrit — relis, corrige si besoin, puis Lancer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Écriture impossible");
    } finally {
      setStoryBusy(false);
    }
  }

  function addCustom(list: Angle[]) {
    if (!list.length) return;
    setCustomAngles((current) => [...list, ...current]);
    setAngles((current) => new Set([...current, ...list.map((angle) => angle.id)]));
  }

  function removeCustom(id: string) {
    setCustomAngles((current) => current.filter((angle) => angle.id !== id));
    setAngles((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  /** Claude écrit les angles depuis le sujet, le format et le brief. */
  async function writeWithClaude() {
    if (!product.name.trim()) return toast.error("Renseigne d'abord le sujet");
    setWriting(true);
    try {
      const body = await ugcPost<{ angles: Angle[] }>({
        action: "write-angles",
        product: { ...product, keyPoints: product.keyPoints.filter(Boolean) },
        brief,
        count,
        formatId,
        nicheId,
        language,
      });
      addCustom(body.angles);
      toast.success(`${body.angles.length} angle(s) écrit(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rédaction impossible");
    } finally {
      setWriting(false);
    }
  }

  function addManual() {
    const angle = parseManualAngle(manual, `Manuel ${customAngles.length + 1}`);
    if (!angle) return toast.error("Écris au moins une ligne de dialogue");
    addCustom([angle]);
    setManual("");
  }

  /** Rejoue un style vidéo ou un script gagnant sur le sujet courant. */
  async function adaptFromLibrary(kind: "video" | "script", id: string) {
    if (!product.name.trim()) return toast.error("Renseigne d'abord le sujet");
    setAdapting(id);
    try {
      const clean = { ...product, keyPoints: product.keyPoints.filter(Boolean) };
      // Un même style rejoué deux fois donne deux angles distincts.
      seq.current += 1;
      if (kind === "video") {
        const body = await libraryPost<{ angle: Angle; styleBlock?: string }>({ action: "adapt-video", id, product: clean });
        addCustom([{ ...body.angle, id: `${body.angle.id}-${seq.current}` }]);
        if (body.styleBlock) setStyleBlock(body.styleBlock);
      } else {
        const body = await libraryPost<{ angle: Angle }>({ action: "adapt-script", id, product: clean });
        addCustom([{ ...body.angle, id: `${body.angle.id}-${seq.current}` }]);
      }
      toast.success("Adapté au sujet — l'angle est coché");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Adaptation impossible");
    } finally {
      setAdapting("");
    }
  }

  async function call(action: "preview" | "generate") {
    /*
     * Sujet libre : le nom n'a pas de champ, il vient du titre du script écrit
     * ou, à défaut, de la première ligne du texte. Et sans script écrit il n'y
     * a aucune scène à lancer — le message dit quoi faire, pas ce qui manque.
     */
    const subjectName =
      product.name.trim() || (freeMode ? story.trim().split("\n")[0].slice(0, 80).trim() : "");
    if (!subjectName) {
      return toast.error(freeMode ? "Écris ton sujet dans la zone de texte d'abord" : "Renseigne au moins le nom du sujet");
    }
    if (!angles.size) {
      /*
       * Sujet libre sans scènes : on découpe le texte ici même plutôt que de
       * renvoyer vers un autre bouton. Le lancement reste un second clic,
       * pour que les scènes soient relues avant de dépenser.
       */
      if (freeMode && story.trim()) {
        applyStory(draftFromText(story));
        return toast.success("Scènes créées depuis ton texte — relis-les ci-dessous, puis clique Lancer");
      }
      return toast.error(freeMode ? "Colle ton texte dans la zone Sujet d'abord" : "Coche au moins un angle");
    }
    if (action === "generate" && tooExpensive) {
      return toast.error("Solde Kie insuffisant pour ce lot — réduis le nombre de scènes ou recharge");
    }
    if (action === "generate" && !avatarUrl && !avatarId) {
      const go = window.confirm(
        "Aucun avatar : sans image de référence, le visage changera d'un clip à l'autre. Génère ou charge un avatar dans la section 2 pour garder la même personne. Lancer quand même ?"
      );
      if (!go) return;
    }

    setBusy(true);
    try {
      const body = await ugcPost<{
        scenes?: Array<{ angleName: string; sceneLabel: string; duration: number; prompt: string }>;
        jobs?: Array<Omit<UgcJob, "state" | "urls">>;
        batchId?: string;
      }>({
        action,
        resolution,
        angleIds: [...angles],
        customAngles: customAngles.filter((angle) => angles.has(angle.id)),
        formatId: freeMode ? "free" : formatId,
        nicheId: freeMode ? "none" : nicheId,
        styleBlock: styleBlock || undefined,
        casting,
        castingFree: castingFree && !avatarUrl && !avatarId,
        avatarUrl: avatarId ? undefined : avatarUrl,
        avatarId: avatarId ?? undefined,
        avatarUploaded,
        product: { ...product, name: subjectName, keyPoints: product.keyPoints.filter(Boolean) },
      });

      if (action === "preview") {
        setPreview(
          (body.scenes ?? [])
            .map((scene) => `### ${scene.angleName} · ${scene.sceneLabel} (${scene.duration}s)\n\n${scene.prompt}`)
            .join("\n\n———\n\n")
        );
        return;
      }

      const fresh: UgcJob[] = (body.jobs ?? []).map((job) => ({
        ...job,
        state: job.taskId ? "pending" : "fail",
        urls: [],
      }));
      setJobs(fresh);
      setBatchId(body.batchId ?? null);
      setCuts({});
      toast.success(`${fresh.filter((job) => job.taskId).length} clips lancés`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible");
    } finally {
      setBusy(false);
    }
  }

  /** Recolle les clips d'un angle du lot en cours, en local, sans rien dépenser. */
  async function stitchCurrent(angleId: string) {
    if (!batchId) return toast.error("Lot introuvable — retrouve-le dans l'onglet Résultats");
    setStitching(angleId);
    try {
      const body = await ugcPost<{ file: string }>({ action: "stitch", batchId, angleId });
      setCuts((current) => ({ ...current, [angleId]: body.file }));
      toast.success("Montage prêt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Montage impossible");
    } finally {
      setStitching(null);
    }
  }

  const byAngle = useMemo(() => {
    const map = new Map<string, UgcJob[]>();
    for (const job of jobs) map.set(job.angleId, [...(map.get(job.angleId) ?? []), job]);
    return map;
  }, [jobs]);

  const done = jobs.filter((job) => job.state === "done").length;
  const tooExpensive = balance !== null && credits > balance;
  const videoStyles = library.styles.filter((style) => style.kind === "video");

  return (
    <div>
      <PageHeader
        title="UGC Creative"
        description="Un sujet — produit, livre, app, histoire — un créateur, un format, des angles. Un lot de clips verticaux prêts à tester. Seedance 2.0, 9:16, voix incluse."
        actions={
          tab === "generate" ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void call("preview")} disabled={busy}>
                <Sparkles className="h-3.5 w-3.5" />
                Voir les prompts
              </Button>
              <Button
                size="sm"
                onClick={() => void call("generate")}
                disabled={busy}
                title={
                  tooExpensive
                    ? "Solde Kie insuffisant pour ce lot"
                    : !angles.size
                      ? freeMode
                        ? "Colle ton texte : le premier clic le découpe en scènes, le second lance"
                        : "Coche au moins un angle"
                      : "Lancer la génération"
                }
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                Lancer {scenes.length ? `(${scenes.length} clips)` : ""}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              ["generate", "Générer", Film],
              ["remake", "Remake Creative", Clapperboard],
              ["rugg", "Rugg Crea", Wand2],
              ["results", `Résultats${batches.length ? ` (${batches.length})` : ""}`, FolderClock],
              ["course", "Leçons", GraduationCap],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-[background-color,color,box-shadow]",
                tab === id
                  ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(35,49,55,0.08),0_4px_12px_-6px_rgba(35,49,55,0.25)] dark:bg-slate-950 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-medium text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          <Library className="h-3.5 w-3.5" />
          Bibliothèque styles & scripts
        </Link>
      </div>

      {tab === "remake" ? <RemakeStudio /> : null}
      {tab === "rugg" ? <RuggCrea /> : null}
      {tab === "results" ? <Results batches={batches} onChange={loadBatches} /> : null}
      {tab === "course" ? <Course /> : null}

      <div className={cn("grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]", tab !== "generate" && "hidden")}>
        <div className="space-y-4">
          {/* 1. Le sujet */}
          <section className={panel}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">1. Sujet</h2>
              <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                {(
                  [
                    ["product", "Fiche produit (URL)", Link2],
                    ["topic", "Sujet libre", BookOpen],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setSubjectMode(id);
                      setCastingFree(id === "topic");
                      /*
                       * L'angle « Problème → solution » est le défaut de la
                       * fiche produit. Laissé coché en sujet libre, Lancer
                       * partait avec ses scènes génériques au lieu du texte.
                       */
                      setAngles((current) =>
                        id === "topic"
                          ? new Set([...current].filter((angleId) => angleId === "story"))
                          : current.size
                            ? current
                            : new Set(["problem-solution"])
                      );
                      if (id === "topic" && isPhysical(product.kind) && !product.imageUrls.length) {
                        setProduct((current) => ({ ...current, kind: "topic" }));
                      }
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                      subjectMode === id
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
                        : "text-slate-500"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {subjectMode === "product" ? (
              <>
            {subjectMode === "product" ? (
              <div className="mb-3 flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void loadUrl();
                    }}
                    placeholder="Colle l'URL de ta page produit et appuie sur Entrée"
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => void loadUrl()} disabled={fetching}>
                  {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Charger
                </Button>
              </div>
            ) : null}

            {product.imageUrls.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {product.imageUrls.map((image) => (
                  <div key={image} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                    <button
                      type="button"
                      onClick={() => setProduct((current) => ({ ...current, imageUrls: current.imageUrls.filter((item) => item !== image) }))}
                      className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white group-hover:flex"
                      title="Retirer"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={physical ? "Nom du produit" : "Titre du sujet"} value={product.name} onChange={(v) => setProduct((c) => ({ ...c, name: v }))} placeholder={physical ? "Robe en lin écru" : "Atomic Habits, mon app de méditation, l'histoire de…"} />
              <Field label="Description courte" value={product.description} onChange={(v) => setProduct((c) => ({ ...c, description: v }))} placeholder={physical ? "Coupe droite, lin lavé, doublée" : "De quoi ça parle, en une phrase"} />
              <Field label="Prix affiché" value={product.price} onChange={(v) => setProduct((c) => ({ ...c, price: v }))} placeholder="39 €" />
              <Field label="Marque / auteur (cité dans le CTA)" value={product.brand} onChange={(v) => setProduct((c) => ({ ...c, brand: v }))} placeholder="Boomba" />
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
              <span className="eyebrow mb-1.5 block">Type de sujet — change la façon dont il est manipulé</span>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setProduct((current) => ({ ...current, kind: item.id }))}
                    title={item.hint}
                    className={chip(product.kind === item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadReference(event.target.files?.[0])} />
                {uploadingRef ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                Ajouter une image de référence
              </label>
              {product.imageUrls.length ? (
                <span className="text-[11px] text-slate-500">
                  {product.imageUrls.length} image(s) de référence — le sujet restera identique.
                </span>
              ) : physical ? (
                <span className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  <strong>Aucune image.</strong> Un objet physique sans photo serait inventé : charge la fiche ou ajoute une image.
                </span>
              ) : (
                <span className="text-[11px] text-slate-500">Sujet sans objet : aucune image requise.</span>
              )}
            </div>
              </>
            ) : (
            <div className="space-y-3">
              <textarea
                value={story}
                onChange={(event) => setStory(event.target.value)}
                rows={6}
                placeholder="Écris ton histoire ici, comme tu la raconterais : qui parle, ce qui s'est passé, ce que la personne doit ressentir, la chute. Un livre, une app, un service, un site, une anecdote… L'IA reformule et écrit le script scène par scène."
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[12px] leading-relaxed dark:border-slate-700 dark:bg-slate-950"
              />

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <span className="eyebrow mb-1 block">Durée de la vidéo</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[15, 20, 30, 45, 60, 90].map((n) => (
                      <button key={n} type="button" onClick={() => refitStory(n)} className={chip(targetSeconds === n)}>
                        {n}s
                      </button>
                    ))}
                    <input
                      type="number"
                      min={8}
                      max={180}
                      value={targetSeconds}
                      onChange={(event) => refitStory(Math.min(180, Math.max(8, Number(event.target.value) || 8)))}
                      className="h-8 w-16 rounded-full border border-slate-200 px-2.5 text-center text-[11px] tabular-nums dark:border-slate-700 dark:bg-slate-950"
                    />
                    <span className="text-[11px] text-slate-500">≈ {Math.round(targetSeconds * 2.4)} mots dits</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="Lien produit, ou lien du site entier si c'est un service (facultatif)"
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadReference(event.target.files?.[0])} />
                  {uploadingRef ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                  Image produit (facultatif)
                </label>
              </div>

            {product.imageUrls.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {product.imageUrls.map((image) => (
                  <div key={image} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                    <button
                      type="button"
                      onClick={() => setProduct((current) => ({ ...current, imageUrls: current.imageUrls.filter((item) => item !== image) }))}
                      className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white group-hover:flex"
                      title="Retirer"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="eyebrow">Script de base (facultatif) — la structure est gardée, l&apos;histoire est la tienne</span>
                  <Link href="/library" className="text-[11px] font-medium text-slate-700 hover:underline dark:text-slate-300">
                    Mettre à jour la liste
                  </Link>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setScriptId(null)} className={chip(scriptId === null)}>
                    Aucun
                  </button>
                  {library.scripts.map((script) => (
                    <button
                      key={script.id}
                      type="button"
                      onClick={() => setScriptId(script.id)}
                      title={script.text.slice(0, 160)}
                      className={chip(scriptId === script.id)}
                    >
                      {script.name}
                    </button>
                  ))}
                  {!library.scripts.length ? (
                    <span className="text-[11px] text-slate-400">Aucun script enregistré pour l&apos;instant.</span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                  {(["en", "fr"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setLanguage(lang)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium uppercase",
                        language === lang ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500"
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
                <Button size="sm" onClick={() => void writeTheStory()} disabled={storyBusy}>
                  {storyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {storyDraft ? "Réécrire le script" : "Reformuler et écrire le script"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  title="Sans IA : tes lignes CHARACTER / LOCATION / CAMERA font la mise en place, tes repères de temps ou tes paragraphes font les scènes, la phrase entre guillemets est la réplique"
                  onClick={() => {
                    if (!story.trim()) return toast.error("Écris ton script d'abord");
                    applyStory(draftFromText(story));
                    toast.success("Texte découpé en scènes — relis, corrige, puis Lancer");
                  }}
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Découper mon texte tel quel
                </Button>
                <span className="text-[11px] text-slate-500">Chaque scène fixe son lieu et son cadrage. L&apos;avatar plus bas est facultatif : sans lui, le casting décrit la personne.</span>
              </div>

              {storyDraft ? (
                <div className="space-y-3 rounded-xl border border-slate-900 p-3 dark:border-slate-100">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_2fr]">
                    <Field label="Titre" value={storyDraft.title} onChange={(v) => patchStory({ title: v })} />
                    <label className="block">
                      <span className="eyebrow mb-1 block">Histoire reformulée</span>
                      <textarea
                        value={storyDraft.summary}
                        onChange={(event) => patchStory({ summary: event.target.value })}
                        rows={2}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] leading-snug dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="eyebrow mb-1 block">Personnage, lieu, caméra — répété dans chaque clip</span>
                    <textarea
                      value={storyDraft.setting ?? ""}
                      onChange={(event) => patchStory({ setting: event.target.value })}
                      rows={3}
                      placeholder="Fictional American woman, 24, brown hair, black fitted top. Bathroom mirror near a window. iPhone front camera, handheld, natural light."
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] leading-snug dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>

                  <div>
                    <span className="eyebrow mb-1.5 block">
                      Script — un clip par scène, dialogue exact · {storyDraft.scenes.reduce((total, scene) => total + scene.duration, 0)}s au total pour {targetSeconds}s visées
                    </span>
                    <div className="space-y-2">
                      {storyDraft.scenes.map((scene, index) => (
                        <div key={index} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                              {index + 1}
                            </span>
                            <input
                              value={scene.label}
                              onChange={(event) => patchScene(index, { label: event.target.value })}
                              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-[12px] font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:outline-none dark:text-slate-100"
                            />
                            <select
                              value={scene.duration}
                              onChange={(event) => patchScene(index, { duration: Number(event.target.value) })}
                              className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-950"
                            >
                              {[4, 5, 6, 7, 8, 9, 10, 12, 15].map((n) => (
                                <option key={n} value={n}>
                                  {n}s
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => patchStory({ scenes: storyDraft.scenes.filter((_, i) => i !== index) })}
                              className="text-slate-400 hover:text-rose-600"
                              title="Retirer la scène"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <textarea
                            value={scene.line}
                            onChange={(event) => patchScene(index, { line: event.target.value })}
                            rows={2}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] leading-snug dark:border-slate-700 dark:bg-slate-950"
                          />
                          <input
                            value={scene.action}
                            onChange={(event) => patchScene(index, { action: event.target.value })}
                            placeholder="Ce que fait la créatrice à l'écran"
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          patchStory({
                            scenes: [...storyDraft.scenes, { label: `Scène ${storyDraft.scenes.length + 1}`, duration: 6, action: "The protagonist talks to the camera.", line: "" }],
                          })
                        }
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:underline dark:text-slate-300"
                      >
                        <PenLine className="h-3 w-3" />
                        Ajouter une scène
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] leading-snug text-slate-500">
                    Quand c&apos;est bon : vérifie l&apos;avatar plus bas, puis clique <strong className="text-slate-900 dark:text-slate-100">Lancer</strong> en haut — {storyDraft.scenes.filter((scene) => scene.line.trim()).length} clips.
                  </p>
                </div>
              ) : null}
            </div>
            )}
          </section>

          {/* 2. Le personnage */}
          <section className={panel}>
            <h2 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              2. Créateur / créatrice{freeMode ? " — facultatif" : ""}
            </h2>

            {savedAvatars.length ? (
              <div className="mb-3">
                <span className="eyebrow mb-1.5 block">Avatars enregistrés — le même visage d&apos;un lot à l&apos;autre</span>
                <div className="rail flex gap-2 overflow-x-auto pb-1">
                  {savedAvatars.map((avatar) => (
                    <button
                      key={avatar.id}
                      type="button"
                      onClick={() => pickSavedAvatar(avatar)}
                      title={avatar.name}
                      className={cn(
                        "shrink-0 overflow-hidden rounded-xl ring-2 transition-[transform,box-shadow] hover:scale-[1.02]",
                        avatarId === avatar.id ? "ring-slate-900 dark:ring-white" : "ring-transparent"
                      )}
                      style={{ width: 56, height: 74 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/ugc/avatar-image?id=${encodeURIComponent(avatar.id)}`} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 space-y-2">
                <div className={cn("space-y-2", avatarUploaded && "opacity-40")}>
                  <div className="flex flex-wrap gap-1.5">
                    {freeMode ? (
                      <button
                        type="button"
                        disabled={avatarUploaded}
                        onClick={() => {
                          setCastingFree(true);
                          setAvatarUrl("");
                          setAvatarId(null);
                        }}
                        title="Aucun casting : c'est ton prompt qui décrit la personne"
                        className={chip(castingFree)}
                      >
                        Décrit dans le prompt
                      </button>
                    ) : null}
                    {GENDERS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={avatarUploaded}
                        onClick={() => {
                          setCastingFree(false);
                          setCasting((current) => ({ ...current, gender: item.id }));
                          setAvatarUrl("");
                          setAvatarId(null);
                        }}
                        className={chip(!castingFree && casting.gender === item.id)}
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
                          setCastingFree(false);
                          setCasting((current) => ({ ...current, age: item.id }));
                          setAvatarUrl("");
                          setAvatarId(null);
                        }}
                        className={chip(!castingFree && casting.age === item.id)}
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
                        setAvatarId(null);
                      }}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      Retirer la photo
                    </button>
                  </p>
                ) : null}
                <label className="block">
                  <span className="eyebrow mb-1 block">Décris l&apos;avatar — prime sur les puces</span>
                  <textarea
                    value={avatarDesc}
                    onChange={(event) => setAvatarDesc(event.target.value)}
                    rows={2}
                    placeholder="Ex. femme 24 ans, brune, un peu ronde, visage ordinaire, pas maquillée — ou : homme 45 ans, barbe grise, cheveux courts, moche mais sympathique"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] leading-snug dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void makeAvatar()} disabled={avatarBusy}>
                    {avatarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />}
                    {avatarUrl ? "Regénérer" : avatarDesc.trim() ? "Générer depuis la description" : "Générer l'avatar"}
                  </Button>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
                    <Upload className="h-3 w-3" />
                    Charger un visage
                  </label>
                  {avatarUrl && !avatarId ? (
                    <button
                      type="button"
                      onClick={() => void saveCurrentAvatar()}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:underline dark:text-slate-300"
                    >
                      <Save className="h-3 w-3" />
                      Enregistrer cet avatar
                    </button>
                  ) : null}
                </div>
              </div>

              {avatarBusy && !avatarUrl ? (
                <div className="flex shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800" style={{ width: 84, height: 112 }}>
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : null}

              {avatarUrl ? (
                <button
                  type="button"
                  onClick={() => setAvatarOpen(true)}
                  title="Agrandir — vérifie le visage avant de lancer"
                  className="group relative shrink-0 overflow-hidden rounded-xl ring-2 ring-slate-900 transition-opacity hover:opacity-90 dark:ring-white"
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
                : "Sans avatar, chaque clip montrera une personne différente. Génère-le ou choisis-en un enregistré avant de lancer."}
            </p>
          </section>

          {/* 3. Format & niche — sans objet en sujet libre : la scène écrite décide */}
          {!freeMode ? (
          <section className={panel}>
            <h2 className="mb-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100">3. Format & niche</h2>
            <p className="mb-3 text-[11px] leading-snug text-slate-500">
              Le format dit comment c&apos;est filmé, la niche dit qui parle et d&apos;où. Ils s&apos;appliquent à tous les angles du lot.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FORMATS.map((item) => (
                <button key={item.id} type="button" onClick={() => setFormatId(item.id)} title={item.hint} className={chip(formatId === item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">{FORMATS.find((item) => item.id === formatId)?.hint}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {NICHES.map((item) => (
                <button key={item.id} type="button" onClick={() => setNicheId(item.id)} className={chip(nicheId === item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            {styleBlock ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 text-[11px] leading-snug text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <span className="flex-1">
                  <strong className="text-slate-900 dark:text-slate-100">Style de référence actif :</strong> {styleBlock}
                </span>
                <button type="button" onClick={() => setStyleBlock("")} className="text-slate-400 hover:text-slate-700" title="Retirer">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </section>
          ) : null}

          {/* 4. Les angles — en sujet libre, le script écrit est l'angle */}
          {!freeMode ? (
          <section className={panel}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">4. Angles à tester</h2>
              <button
                type="button"
                onClick={() => setAngles(new Set(allAngles.map((angle) => angle.id)))}
                className="text-[11px] font-medium text-slate-700 hover:underline dark:text-slate-300"
              >
                Tout sélectionner
              </button>
            </div>

            {/* Sur mesure : Claude, bibliothèque, main */}
            <div className="mb-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  Écrire des angles avec Claude
                </div>
                <textarea
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  rows={3}
                  placeholder="Ce que tu veux dire, le ton, les objections à traiter, la cible… (facultatif : le sujet suffit)"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                    {[1, 2, 3, 4].map((n) => (
                      <button key={n} type="button" onClick={() => setCount(n)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", count === n ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                        ×{n}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
                    {(["en", "fr"] as const).map((lang) => (
                      <button key={lang} type="button" onClick={() => setLanguage(lang)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium uppercase", language === lang ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500")}>
                        {lang}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" onClick={() => void writeWithClaude()} disabled={writing}>
                    {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
                    Écrire
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                  <PenLine className="h-3.5 w-3.5" />
                  Écrire un angle à la main
                </div>
                <textarea
                  value={manual}
                  onChange={(event) => setManual(event.target.value)}
                  rows={3}
                  placeholder={"Une ligne par scène. Ex :\nHook | 6 | Okay I need to talk about this…\nPreuve | 8 | It actually does…"}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400">Label | secondes | dialogue — label et secondes facultatifs</span>
                  <Button size="sm" variant="outline" onClick={addManual}>
                    Ajouter
                  </Button>
                </div>
              </div>
            </div>

            {videoStyles.length || library.scripts.length ? (
              <div className="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                    <Library className="h-3.5 w-3.5" />
                    Depuis la bibliothèque — réadapté au sujet
                  </div>
                  <Link href="/library" className="text-[11px] font-medium text-slate-600 hover:underline dark:text-slate-300">
                    Gérer
                  </Link>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {videoStyles.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      disabled={Boolean(adapting)}
                      onClick={() => void adaptFromLibrary("video", style.id)}
                      title={style.pitch}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {adapting === style.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Film className="h-3 w-3" />}
                      {style.name}
                    </button>
                  ))}
                  {library.scripts.map((script) => (
                    <button
                      key={script.id}
                      type="button"
                      disabled={Boolean(adapting)}
                      onClick={() => void adaptFromLibrary("script", script.id)}
                      title={script.text.slice(0, 160)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {adapting === script.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3" />}
                      {script.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {customAngles.length ? (
              <div className="mb-4">
                <span className="eyebrow mb-1.5 block">Angles sur mesure</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {customAngles.map((angle) => (
                    <AngleCard
                      key={angle.id}
                      angle={angle}
                      on={angles.has(angle.id)}
                      onToggle={() =>
                        setAngles((current) => {
                          const next = new Set(current);
                          if (next.has(angle.id)) next.delete(angle.id);
                          else next.add(angle.id);
                          return next;
                        })
                      }
                      onRemove={() => removeCustom(angle.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <span className="eyebrow mb-1.5 block">Bibliothèque d&apos;angles</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {ANGLES.map((angle) => (
                <AngleCard
                  key={angle.id}
                  angle={angle}
                  on={angles.has(angle.id)}
                  onToggle={() =>
                    setAngles((current) => {
                      const next = new Set(current);
                      if (next.has(angle.id)) next.delete(angle.id);
                      else next.add(angle.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </section>
          ) : null}

          {/* 5. Les rendus */}
          {jobs.length ? (
            <section className="space-y-3">
              {[...byAngle.entries()].map(([angleId, list]) => {
                const allDone = list.length > 1 && list.every((job) => job.state === "done" && job.urls[0]);
                const cut = cuts[angleId];
                const cutSrc = cut && batchId ? fileUrl(batchId, cut) : null;
                return (
                <div key={angleId} className={cn(panel, "p-3")}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{list[0]?.angleName}</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>Gardé dans l&apos;onglet Résultats</span>
                      {allDone ? (
                        <Button size="sm" variant="outline" onClick={() => void stitchCurrent(angleId)} disabled={stitching === angleId}>
                          {stitching === angleId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                          {cut ? "Réassembler" : "Assembler les clips"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {cutSrc ? (
                      <Clip src={cutSrc} label="Montage complet" error={null} download={`${product.handle || "ugc"}-${angleId}.mp4`} onZoom={() => setClipZoom(cutSrc)} highlight />
                    ) : null}
                    {list.map((job, index) => {
                      const src = job.state === "done" ? (job.file && batchId ? fileUrl(batchId, job.file) : job.urls[0]) : undefined;
                      return (
                      <div key={`${job.angleId}-${index}`} className="w-[150px]">
                        <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                          {src ? (
                            <>
                              <video src={src} controls playsInline className="h-full w-full object-cover" />
                              <button
                                type="button"
                                onClick={() => setClipZoom(src)}
                                title="Voir en grand, sans recadrage"
                                className="absolute right-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 transition-opacity hover:opacity-100"
                              >
                                <Maximize2 className="h-3 w-3" />
                              </button>
                              <a
                                href={src}
                                download={`${product.handle || "ugc"}-${angleId}-${index + 1}.mp4`}
                                title="Télécharger ce clip"
                                className="absolute left-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 transition-opacity hover:opacity-100"
                              >
                                <Download className="h-3 w-3" />
                              </a>
                              <SendToDrive url={src} name={`${product.handle || "ugc"}-${angleId}-${index + 1}.mp4`} compact className="absolute left-1 top-7" />
                            </>
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
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </section>
          ) : (
            batches.length ? (
              /* Aucun lot en cours : on montre ce qui a déjà été fait, sans changer d'onglet. */
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Tes lots précédents — {batches.length} gardé(s)</h2>
                  <span className="text-[11px] text-slate-500">Clic sur un clip : agrandir · Assembler : recolle l&apos;angle</span>
                </div>
                <Results batches={batches} onChange={loadBatches} />
              </section>
            ) : (
              <EmptyState title="Aucun clip généré" description="Écris un sujet, découpe-le en scènes, puis lance le lot." />
            )
          )}
        </div>

        {/* Récapitulatif */}
        <aside className={cn(panel, "h-fit space-y-3 lg:sticky lg:top-20")}>
          <div className="eyebrow">Récapitulatif du lot</div>
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
            <div className="eyebrow">Clips à générer</div>
            <div className="font-display text-4xl text-slate-900 dark:text-slate-100">{scenes.length}</div>
            <div className="text-[11px] text-slate-500">
              {selected.length} angle{selected.length > 1 ? "s" : ""} · {seconds}s de vidéo
            </div>
          </div>

          <div className="flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
            {RESOLUTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setResolution(value)}
                className={cn(
                  "flex-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors",
                  resolution === value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500"
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <Row label="Sujet" value={product.name || "—"} />
          {subjectMode === "topic" ? <Row label="Durée visée" value={`${targetSeconds}s`} /> : null}
          {!freeMode ? (
            <>
              <Row label="Format" value={FORMATS.find((item) => item.id === formatId)?.label ?? "—"} />
              <Row label="Niche" value={NICHES.find((item) => item.id === nicheId)?.label ?? "—"} />
            </>
          ) : null}
          <Row label="Références" value={String(product.imageUrls.length)} />
          <Row label="Avatar" value={avatarId ? "enregistré" : avatarUrl ? "prêt" : "—"} />
          <Row label="Coût estimé" value={`${formatUsd(credits)}  ·  ~${credits.toLocaleString("fr-FR")} cr`} />
          <Row label="Solde Kie" value={balance === null ? "…" : balance.toLocaleString("fr-FR")} />
          {done ? <Row label="Terminés" value={`${done} / ${jobs.length}`} /> : null}

          {tooExpensive ? (
            <div className="rounded-lg bg-rose-50 p-2.5 text-[11px] leading-snug text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <strong>Lot bloqué.</strong> Il coûte ~{credits.toLocaleString("fr-FR")} crédits et il t&apos;en reste{" "}
              {balance?.toLocaleString("fr-FR")} ({formatUsd(balance ?? 0)}). Retire des angles, ou recharge Kie.
            </div>
          ) : (
            <p className="text-[10px] leading-snug text-slate-400">
              ~102 crédits/seconde en 720p (mesuré le 24/08), soit {formatUsd(102)} la seconde de vidéo. Vérifie toujours ce total avant de lancer.
            </p>
          )}
        </aside>
      </div>

      {avatarOpen && avatarUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setAvatarOpen(false)}>
          <div className="flex max-h-full flex-col items-center gap-3" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl} alt="" className="max-h-[75vh] w-auto max-w-full rounded-xl object-contain shadow-2xl" />
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
              Ce visage sera identique sur les {scenes.length || "…"} clips du lot. Regarde-le bien maintenant : le regénérer après coup obligerait à relancer toute la génération.
            </p>
          </div>
        </div>
      ) : null}

      {clipZoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4" onClick={() => setClipZoom(null)}>
          <video src={clipZoom} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} className="max-h-[92vh] w-auto max-w-full rounded-xl shadow-2xl" />
        </div>
      ) : null}

      {preview !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Prompts envoyés à Seedance</h3>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(preview);
                  toast.success("Copié");
                }}
                className="text-[11px] font-medium text-slate-700 hover:underline dark:text-slate-300"
              >
                Copier
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{preview}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AngleCard({
  angle,
  on,
  onToggle,
  onRemove,
}: {
  angle: Angle;
  on: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl border p-3 text-left transition-colors",
        on
          ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800/60"
          : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
      )}
    >
      <button type="button" onClick={onToggle} className="block w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{angle.name}</span>
          {on ? <Check className="h-3.5 w-3.5 shrink-0 text-slate-900 dark:text-slate-100" /> : null}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">{angle.pitch}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {angle.scenes.map((scene, index) => (
            <span key={`${scene.label}-${index}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {scene.label} · {scene.duration}s
            </span>
          ))}
        </div>
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          title="Retirer cet angle"
          className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
        >
          <Trash2 className="h-3 w-3" />
        </button>
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

  async function stitch(batchId: string, angleId: string) {
    setCutting(`${batchId}:${angleId}`);
    try {
      await ugcPost({ action: "stitch", batchId, angleId });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4" onClick={() => setZoom(null)}>
          <video src={zoom} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} className="max-h-[92vh] w-auto max-w-full rounded-xl shadow-2xl" />
        </div>
      ) : null}

      {batches.map((batch) => {
        const ready = batch.jobs.filter((job) => job.state === "done").length;
        const failed = batch.jobs.filter((job) => job.state === "fail").length;
        return (
          <section key={batch.id} className={cn(panel, "p-3")}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                {batch.product.name || batch.product.handle || "Sans nom"}
              </span>
              <span className="text-[11px] text-slate-500">
                {new Date(batch.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {batch.resolution} · {ready}/{batch.jobs.length} prêts
                {failed ? ` · ${failed} échec(s)` : ""}
              </span>
            </div>

            {[...new Set(batch.jobs.map((job) => job.angleId))].map((angleId) => {
              const jobs = batch.jobs.filter((job) => job.angleId === angleId);
              const allReady = jobs.every((job) => job.state === "done" && job.file);
              const cut = batch.cuts?.[angleId];
              const cutSrc = cut ? fileUrl(batch.id, cut) : null;
              const busy = cutting === `${batch.id}:${angleId}`;

              return (
                <div key={angleId} className="mb-3 last:mb-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{jobs[0]?.angleName}</span>
                    {allReady && !cut ? (
                      <button
                        type="button"
                        onClick={() => void stitch(batch.id, angleId)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
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
                      <Clip src={cutSrc} label="Montage complet" error={null} download={`${batch.product.handle || "ugc"}-${angleId}.mp4`} onZoom={() => setZoom(cutSrc)} highlight />
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
      <EmptyState title="Cours indisponible" description="Les leçons se lisent depuis data/ugc-course. Relance le script d'aspiration si le dossier est vide." />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav className={cn(panel, "h-fit space-y-1 p-2 lg:sticky lg:top-20")}>
        {docs.map((doc) => (
          <button
            key={doc.file}
            type="button"
            onClick={() => setOpen(doc.file)}
            className={cn(
              "block w-full rounded-lg px-2.5 py-2 text-left text-[12px] font-medium leading-snug transition-colors",
              open === doc.file
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
            )}
          >
            {doc.title}
          </button>
        ))}
      </nav>

      <article className={panel}>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-slate-700 dark:text-slate-300">{text}</pre>
        )}
      </article>
    </div>
  );
}

function fileUrl(batchId: string, file: string) {
  return `/api/ugc/file?id=${encodeURIComponent(batchId)}&file=${encodeURIComponent(file)}`;
}

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
      <div className={cn("relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-900", highlight && "ring-2 ring-slate-900 dark:ring-white")}>
        {src ? (
          <>
            <video src={src} controls playsInline className="h-full w-full object-contain" />
            <button type="button" onClick={onZoom} title="Voir en grand, sans recadrage" className="absolute right-1 top-1 rounded-md bg-slate-950/60 p-1 text-white opacity-70 transition-opacity hover:opacity-100">
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
        <span className={cn("truncate text-[10px]", highlight ? "font-medium text-slate-900 dark:text-slate-100" : "text-slate-500")}>{label}</span>
        {src ? (
          <span className="flex shrink-0 items-center gap-1">
            <SendToDrive url={src} name={download} compact className="[&>button]:bg-transparent [&>button]:p-0 [&>button]:text-slate-400 [&>button]:opacity-100 hover:[&>button]:text-slate-900" />
            <a href={src} download={download} className="text-slate-400 hover:text-slate-900" title="Télécharger">
              <Download className="h-3 w-3" />
            </a>
          </span>
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
      <span className="eyebrow mb-1 block">{label}</span>
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
