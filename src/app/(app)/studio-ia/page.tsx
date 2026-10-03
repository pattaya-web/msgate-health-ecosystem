"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, useCollection, useLocalState } from "@/lib/client";
import { getModel, MODELS, modelsOfKind, type ModelDef, type ModelKind } from "@/lib/models";
import {
  Card,
  CopyButton,
  Empty,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Tabs,
  Toggle,
  ToastHost,
  useToast,
} from "@/components/studio-ia/ui";
const FaceSwap = dynamic(() => import("@/components/studio-ia/FaceSwap").then((m) => m.FaceSwap), { ssr: false });
import { prefillFromJob, VideoSwap, type SwapPrefill } from "@/components/studio-ia/VideoSwap";
import { StudioJobCard, StudioJobPreview, VoicePicker, type JobActions } from "@/components/studio-ia/StudioJobCard";
import dynamic from "next/dynamic";
// Onglets secondaires charges a la demande : le premier ecran du Studio n'a pas a les embarquer.
const TalkingPhoto = dynamic(() => import("@/components/studio-ia/TalkingPhoto").then((m) => m.TalkingPhoto), { ssr: false });
const VideoCreate = dynamic(() => import("@/components/studio-ia/VideoCreate").then((m) => m.VideoCreate), { ssr: false });
import { ACTIVE_STATUSES, type StudioJob } from "@/lib/studio-ia/types";
import { MediaField } from "@/components/studio-ia/MediaField";
import { ElementField, ELEMENT_NAME, EMPTY_ELEMENT, type ElementValue } from "@/components/studio-ia/ElementField";
import { SkPage } from "@/components/studio-ia/Skeleton";
import { fetchStudioJobs, GENERATIONS_EVENT, JobsDock, readStudioJobsCache, STUDIO_JOBS_EVENT } from "@/components/studio-ia/JobsDock";
// Styles du Studio, limités au conteneur `.studio-ia` : la page les porte, le reste de l'application garde sa charte.
import "./studio-ia.css";
import { duration, estimateSec, fmtInt, fmtUsd, label, relative } from "@/lib/format";
import type { Generation } from "@/lib/types";
import { ThumbImg, VideoThumb } from "@/components/studio-ia/MediaThumb";

const CREDIT_USD = 0.005;

const KIND_LABEL: Record<ModelKind, string> = {
  image: "Image",
  video: "Vidéo",
  swap: "Swap vidéo",
};

/** Onglets du Studio : les trois familles de modeles, la photo qui parle, la creation depuis zero. */
type StudioTab = ModelKind | "talk" | "create";

function defaultsFor(model: ModelDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of model.fields) {
    out[f.key] =
      f.type === "files" ? [] : f.type === "element" ? { ...EMPTY_ELEMENT } : (f.default ?? "");
  }
  return out;
}

/**
 * Prompt a conserver en changeant de modele.
 *
 * On ne reporte que ce que l'utilisateur a lui-meme ecrit. Reporter aveuglement
 * l'ancienne valeur ecrasait la consigne par defaut du nouveau modele — et un
 * champ vide restait vide, ce qui laissait partir des generations sans consigne.
 */
function carryPrompt(prev: unknown, from: ModelDef, to: ModelDef): string {
  const typed = String(prev ?? "").trim();
  const fallback = String(to.fields.find((f) => f.key === "prompt")?.default ?? "");
  if (!typed) return fallback;
  const previousDefault = String(from.fields.find((f) => f.key === "prompt")?.default ?? "").trim();
  // Une consigne laissee telle quelle n'est pas un travail a preserver.
  return typed === previousDefault ? fallback : typed;
}

function firstOfKind(kind: ModelKind) {
  return modelsOfKind(kind)[0] ?? MODELS[0];
}

function StudioInner() {
  const params = useSearchParams();
  const toast = useToast();
  const { rows, setRows, reload, destroyMany } = useCollection<Generation>("generations");

  const [kind, setKind] = useState<ModelKind>("image");
  const [talkTab, setTalkTab] = useState(false);
  // « Création » : image de depart + script → video Seedance avec la voix, sans rien filmer.
  const [createTab, setCreateTab] = useState(false);
  /* Monteur : un rappel des trois gestes du swap, qu'il peut fermer. */
  // Pas de rôles ici : le Studio est ouvert au propriétaire, le guide du monteur n'a pas lieu d'être.
  const isEditor = false;
  const [guideClosed, setGuideClosed] = useLocalState("studio-editor-guide-closed", false);
  const [modelId, setModelId] = useState(() => firstOfKind("image").id);
  const [input, setInput] = useState<Record<string, unknown>>(() => defaultsFor(firstOfKind("image")));
  const [swap, setSwap] = useState(false);
  /* Swap video : la version simple par defaut, l'ancien formulaire en « avance ». */
  const [advancedSwap, setAdvancedSwap] = useState(false);
  const [prefill, setPrefill] = useState<SwapPrefill | null>(null);
  const [prefillKey, setPrefillKey] = useState(0);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [jobPreview, setJobPreview] = useState<string | null>(null);
  const [voiceJob, setVoiceJob] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "running" | "done" | "failed">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const picking = picked.size > 0;

  const model = useMemo(() => MODELS.find((m) => m.id === modelId) ?? MODELS[0], [modelId]);
  const visible = useMemo(() => modelsOfKind(kind), [kind]);

  /*
   * Les champs se rangent par nature plutot que dans l'ordre du catalogue :
   * les reglages courts en pastilles sur la ligne du modele, les consignes en
   * pleine largeur, les sources en vignettes. Une grille uniforme etirait un
   * menu « Format » sur 300 px et noyait le prompt au milieu.
   */
  const shownFields = useMemo(() => model.fields.filter((f) => !f.hidden), [model]);
  const compact = useMemo(() => shownFields.filter((f) => f.compact), [shownFields]);
  const texts = useMemo(() => shownFields.filter((f) => f.type === "textarea"), [shownFields]);
  const media = useMemo(
    () => shownFields.filter((f) => f.type === "file" || f.type === "files" || f.type === "element"),
    [shownFields],
  );
  const others = useMemo(
    () =>
      shownFields.filter(
        (f) => !f.compact && f.type !== "textarea" && f.type !== "file" && f.type !== "files" && f.type !== "element",
      ),
    [shownFields],
  );

  // Le Swipe file peut envoyer un prompt tout prêt via l'URL.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    const prompt = params.get("prompt");
    const wanted = params.get("kind");
    if (wanted === "talk") {
      setTalkTab(true);
    } else if (wanted === "create") {
      setCreateTab(true);
    } else if (wanted === "video" || wanted === "image" || wanted === "swap") {
      setTalkTab(false);
      setCreateTab(false);
      const first = firstOfKind(wanted);
      setKind(wanted);
      setModelId(first.id);
      setInput({ ...defaultsFor(first), ...(prompt ? { prompt } : {}) });
    } else if (prompt) {
      setInput((v) => ({ ...v, prompt }));
    }
    if (prompt) seeded.current = true;
  }, [params]);

  const switchModel = (id: string) => {
    const next = MODELS.find((m) => m.id === id);
    if (!next) return;
    setModelId(id);
    // Sinon l'erreur du modele precedent semble decrire le nouveau.
    setError(null);
    // On conserve le prompt en changeant de modèle : c'est le travail qu'on ne veut pas reperdre.
    setInput((prev) => ({ ...defaultsFor(next), prompt: carryPrompt(prev.prompt, model, next) }));
  };

  const switchKind = (k: ModelKind) => {
    const first = firstOfKind(k);
    setKind(k);
    setError(null);
    setSwap(false);
    setModelId(first.id);
    setInput((prev) => ({ ...defaultsFor(first), prompt: carryPrompt(prev.prompt, model, first) }));
  };

  /**
   * Chaînage : on envoie un résultat de la galerie dans le premier champ média
   * du bon type. C'est le geste central du workflow — on génère le personnage
   * en image, puis on l'applique à sa vidéo sans jamais rien retélécharger.
   */
  const reuse = useCallback(
    (url: string, from: "image" | "video") => {
      const name = url.split("/").pop() ?? (from === "video" ? "vidéo" : "image");
      setKind("swap");
      setSwap(false);
      setAdvancedSwap(false);
      setPrefill(from === "video" ? { sourceVideo: { url, name } } : { referenceImage: { url, name } });
      setPrefillKey((k) => k + 1);
      toast(from === "video" ? "Envoyée comme vidéo originale." : "Envoyée comme image de référence.");
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    },
    [toast],
  );

  /**
   * Recharge une generation passee dans le formulaire.
   *
   * Les entrees sont stockees telles qu'elles sont parties chez KIE : on les
   * retraduit vers la forme attendue par les champs, sinon un tableau atterrit
   * dans un champ simple et le formulaire se casse.
   */
  const restore = useCallback(
    (gen: Generation) => {
      const def = MODELS.find((m) => m.id === gen.model);
      if (!def) {
        toast("Ce modèle n'est plus au catalogue.", "err");
        return;
      }
      const raw = (gen.input ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...defaultsFor(def) };

      for (const f of def.fields) {
        const v = raw[f.key];
        if (v === undefined || v === null) continue;

        if (f.type === "files") {
          next[f.key] = Array.isArray(v) ? v.map(String) : [String(v)];
        } else if (f.type === "file") {
          next[f.key] = Array.isArray(v) ? String(v[0] ?? "") : String(v);
        } else if (f.type === "element") {
          const el = (Array.isArray(v) ? v[0] : null) as
            | { description?: string; element_input_urls?: string[] }
            | null;
          next[f.key] = el
            ? { urls: el.element_input_urls ?? [], description: el.description ?? "" }
            : { ...EMPTY_ELEMENT };
        } else {
          next[f.key] = typeof v === "boolean" ? String(v) : String(v);
        }
      }

      setKind(def.kind);
      setSwap(false);
      setModelId(def.id);
      setInput(next);
      setError(null);
      toast("Réglages rechargés dans le formulaire.");
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    },
    [toast],
  );

  const pending = rows.filter((g) => g.state !== "success" && g.state !== "fail");
  const previewed = rows.find((g) => g.id === preview && g.state === "success") ?? null;
  // Ce que ce modele a reellement mis, sur ce compte.
  const eta = estimateSec(modelId, rows);
  // Calculee une fois par modele et par lot de lignes : la faire par
  // vignette parcourait toute la galerie pour chacune d'elles, a chaque rendu.
  const etaByModel = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const g of rows) {
      if (!m.has(g.model)) m.set(g.model, estimateSec(g.model, rows)?.sec ?? null);
    }
    return m;
  }, [rows]);

  // Polling tant qu'une génération est en cours. KIE est asynchrone :
  // createTask ne renvoie qu'un identifiant, jamais le résultat.
  /*
   * Le sondage vit dans le Shell, pour continuer quand on quitte cette page.
   * Ici on se contente d'ecouter ce qu'il diffuse : deux boucles concurrentes
   * doubleraient les appels pour rien.
   */
  useEffect(() => {
    const onJobs = (e: Event) => {
      const rows = (e as CustomEvent<Generation[]>).detail;
      if (Array.isArray(rows)) setRows(rows);
    };
    window.addEventListener(GENERATIONS_EVENT, onJobs);
    return () => window.removeEventListener(GENERATIONS_EVENT, onJobs);
  }, [setRows]);

  /*
   * Jobs du Swap video : un premier chargement (le dock n'a peut-etre rien
   * diffuse depuis qu'on est arrive), puis on ecoute ce qu'il diffuse.
   */
  useEffect(() => {
    let alive = true;
    // Le dock sonde deja la file : sa derniere liste suffit, sinon un appel.
    const cached = readStudioJobsCache();
    if (cached) setJobs(cached);
    else {
      fetchStudioJobs(2000)
        .then((b) => { if (alive && b.jobs) setJobs(b.jobs); })
        .catch(() => {});
    }
    const onStudio = (e: Event) => {
      const list = (e as CustomEvent<StudioJob[]>).detail;
      if (Array.isArray(list)) setJobs(list);
    };
    window.addEventListener(STUDIO_JOBS_EVENT, onStudio);
    return () => { alive = false; window.removeEventListener(STUDIO_JOBS_EVENT, onStudio); };
  }, []);

  const jobActions = useMemo<JobActions>(
    () => ({
      onOpen: (j) => setJobPreview(j.id),
      onRedo: (j) => {
        setKind("swap");
        setSwap(false);
        setAdvancedSwap(false);
        setPrefill(prefillFromJob(j));
        setPrefillKey((k) => k + 1);
        toast("Réglages du job rechargés : vidéo, image, consigne, modèle et voix.");
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      },
      onUseAsReference: async (j) => {
        try {
          const r = await api<{ url: string }>("/api/studio-ia/frame", { method: "POST", body: JSON.stringify({ jobId: j.id }) });
          setKind("swap");
          setSwap(false);
          setAdvancedSwap(false);
          setPrefill({ referenceImage: { url: r.url, name: `image de ${j.id}` } });
          setPrefillKey((k) => k + 1);
          toast("Première image du résultat posée en référence.");
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        } catch (e) {
          toast((e as Error).message, "err");
        }
      },
      onChangeVoice: (j) => setVoiceJob(j.id),
      onRetry: async (j, scope) => {
        try {
          const r = await api<{ job: StudioJob }>(`/api/studio-ia/jobs/${j.id}/retry`, { method: "POST", body: JSON.stringify({ scope }) });
          setJobs((prev) => prev.map((x) => (x.id === r.job.id ? r.job : x)));
          toast(scope === "voice" ? "Voix relancée." : "Génération relancée.");
        } catch (e) {
          toast((e as Error).message, "err");
        }
      },
      onDelete: async (j) => {
        if (!window.confirm("Supprimer ce résultat ?")) return;
        setJobs((prev) => prev.filter((x) => x.id !== j.id));
        setJobPreview(null);
        await api(`/api/studio-ia/jobs?id=${encodeURIComponent(j.id)}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "err"));
      },
    }),
    [toast],
  );

  const jobCounts = useMemo(() => {
    const c = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const j of jobs) {
      if (j.status === "queued") c.queued++;
      else if (ACTIVE_STATUSES.includes(j.status)) c.running++;
      else if (j.status === "completed") c.done++;
      else c.failed++;
    }
    return c;
  }, [jobs]);

  /* Galerie unifiee : jobs de swap et generations classiques, du plus recent au plus ancien. */
  /* 24 tuiles d'abord : une galerie de 200 rendus ne charge pas 200 vignettes d'un coup. */
  const PAGE = 24;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [filter]);
  const gallery = useMemo(() => {
    type Item = { at: string; job?: StudioJob; gen?: Generation };
    const genState = (g: Generation) => (g.state === "success" ? "done" : g.state === "fail" ? "failed" : "running");
    const jobState = (j: StudioJob) => (j.status === "completed" ? "done" : j.status === "failed" ? "failed" : "running");
    const items: Item[] = [
      ...jobs.filter((j) => filter === "all" || jobState(j) === filter).map((j) => ({ at: j.createdAt, job: j })),
      ...rows.filter((g) => filter === "all" || genState(g) === filter).map((g) => ({ at: g.createdAt, gen: g })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [jobs, rows, filter]);
  const previewedJob = jobs.find((j) => j.id === jobPreview) ?? null;
  const voicePickedJob = jobs.find((j) => j.id === voiceJob) ?? null;

  const launch = async () => {
    const missing = model.fields.filter((f) => {
      if (!f.required) return false;
      const v = input[f.key];
      return Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim();
    });
    if (missing.length) {
      setError(`Champ obligatoire manquant : ${missing.map((f) => f.label).join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of model.fields) {
        const raw = input[f.key];
        if (raw === "" || raw === undefined || raw === null) continue;

        if (f.type === "element") {
          // KIE attend un tableau de sujets nommes ; sans image, on n'envoie rien.
          const el = raw as ElementValue;
          if (el?.urls?.length) {
            payload[f.key] = [
              {
                name: ELEMENT_NAME,
                description: el.description?.trim() || "le produit tenu dans la main",
                element_input_urls: el.urls,
              },
            ];
          }
        } else if (f.type === "files") {
          const urls = (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean);
          if (urls.length) payload[f.key] = urls;
        } else if (f.type === "urls") {
          const urls = String(raw).split("\n").map((s) => s.trim()).filter(Boolean);
          if (urls.length) payload[f.key] = urls;
        } else if (f.type === "number") {
          const n = Number(raw);
          if (Number.isFinite(n)) payload[f.key] = n;
        } else if (raw === "true" || raw === "false") {
          payload[f.key] = raw === "true";
        } else {
          payload[f.key] = raw;
        }
      }
      const gen = await api<Generation>("/api/kie/generate", {
        method: "POST",
        body: JSON.stringify({ model: model.id, input: payload }),
      });
      setRows((prev) => [gen, ...prev]);
      toast("Génération lancée. Le résultat arrive dans la galerie.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Studio IA"
        actions={
          <>
            {pending.length > 0 && (
              <span className="badge badge-accent">
                <span className="spinner" /> {pending.length} en cours
              </span>
            )}
            <button className="btn" onClick={() => void reload()}>↻ Actualiser</button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Card
          title="Résultats"
          subtitle={
            picking
              ? `${picked.size} sélectionnée${picked.size > 1 ? "s" : ""}`
              : jobs.length
                ? `En attente : ${jobCounts.queued} · En cours : ${jobCounts.running} · Terminées : ${jobCounts.done + rows.filter((g) => g.state === "success").length} · Échec : ${jobCounts.failed + rows.filter((g) => g.state === "fail").length}`
                : `${rows.length} génération${rows.length > 1 ? "s" : ""}`
          }
          padded={false}
          actions={
            picking ? (
              <>
                <button className="btn btn-sm" onClick={() => setPicked(new Set())}>
                  Annuler
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setPicked(new Set(rows.map((g) => g.id)))}
                >
                  Tout
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    const ids = [...picked];
                    if (!window.confirm(`Supprimer ${ids.length} génération${ids.length > 1 ? "s" : ""} ?`)) return;
                    setPicked(new Set());
                    void destroyMany(ids).catch((e) => toast((e as Error).message, "err"));
                  }}
                >
                  Supprimer ({picked.size})
                </button>
              </>
            ) : (
              <Tabs
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "Toutes" },
                  { value: "running", label: "En cours" },
                  { value: "done", label: "Terminées" },
                  { value: "failed", label: "Échec" },
                ]}
              />
            )
          }
        >
          {!gallery.length ? (
            <Empty>{filter === "all" ? "Rien de généré pour l'instant. Lance ta première génération ci-dessous." : "Rien dans ce filtre."}</Empty>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 p-3">
              {gallery.slice(0, shown).map((it) =>
                it.job ? (
                  <StudioJobCard key={it.job.id} job={it.job} actions={jobActions} />
                ) : it.gen ? (
                <GenerationCard
                  key={it.gen.id}
                  gen={it.gen}
                  eta={etaByModel.get(it.gen.model) ?? null}
                  picking={picking}
                  picked={picked.has(it.gen.id)}
                  onPick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(it.gen!.id)) next.delete(it.gen!.id);
                      else next.add(it.gen!.id);
                      return next;
                    })
                  }
                  onOpen={() => setPreview(it.gen!.id)}
                />
                ) : null,
              )}
            </div>
          )}
          {gallery.length > shown && (
            <div className="px-3 pb-3 flex justify-center">
              <button type="button" className="btn btn-sm" onClick={() => setShown((n) => n + PAGE)}>
                Afficher plus ({gallery.length - shown} restants)
              </button>
            </div>
          )}
        </Card>

        {/*
          Le panneau de swap reste collé en bas de l'écran : on parcourt les
          résultats au-dessus sans redescendre pour relancer. Borné en hauteur,
          il défile à l'intérieur si le mode détaillé est déplié.
        */}
        <div
          className={kind === "swap" && !advancedSwap && !talkTab && !createTab ? "swap-dock sticky z-20" : undefined}
          style={kind === "swap" && !advancedSwap && !talkTab && !createTab ? { bottom: 12, maxHeight: "78vh", overflowY: "auto", borderRadius: 14, boxShadow: "var(--shadow-lg)" } : undefined}
        >
          <Card>
            <div className="flex flex-col gap-3.5">
              <Tabs<StudioTab>
                value={talkTab ? "talk" : createTab ? "create" : kind}
                onChange={(t) => {
                  if (t === "talk") { setTalkTab(true); setCreateTab(false); return; }
                  if (t === "create") { setCreateTab(true); setTalkTab(false); return; }
                  setTalkTab(false);
                  setCreateTab(false);
                  switchKind(t);
                }}
                options={[
                  ...(["image", "video", "swap"] as ModelKind[]).map((k) => ({ value: k as StudioTab, label: KIND_LABEL[k] })),
                  { value: "create" as StudioTab, label: "Création" },
                  { value: "talk" as StudioTab, label: "Photo qui parle" },
                ]}
              />

              {isEditor && !guideClosed && kind === "swap" && !talkTab && !createTab && (
                <div
                  className="rounded-[10px] px-3.5 py-2.5 flex items-start gap-3 text-[12.5px] leading-relaxed"
                  style={{ background: "color-mix(in srgb, var(--accent) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)" }}
                >
                  <p className="flex-1 min-w-0">
                    <strong>Swap vidéo en 3 gestes.</strong> 1) <strong>Vidéo</strong> : le rush à transformer. 2){" "}
                    <strong>Personnage</strong> : la photo de la personne à mettre à la place. 3) <strong>Transformer</strong>.
                    Le rendu arrive dans « Résultats » en haut : passe la souris dessus, ↓ pour le télécharger, puis monte avec.
                    Sans consigne, l&apos;IA remplace simplement la personne ; « Rédiger la consigne » l&apos;écrit pour toi.
                  </p>
                  <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setGuideClosed(true)} aria-label="Fermer le guide">
                    ✕
                  </button>
                </div>
              )}
              {kind === "image" && !talkTab && !createTab && (
                <Toggle checked={swap} onChange={setSwap} label="Swap de visage" />
              )}
              {kind === "swap" && advancedSwap && (
                <button type="button" className="link text-[12px] self-start" onClick={() => setAdvancedSwap(false)}>
                  ← Retour au mode simple
                </button>
              )}

              {talkTab ? (
                <TalkingPhoto jobs={jobs} onQueued={(created) => setJobs((prev) => [...created, ...prev])} />
              ) : createTab ? (
                <VideoCreate jobs={jobs} onQueued={(created) => setJobs((prev) => [...created, ...prev])} />
              ) : swap && kind === "image" ? (
                <FaceSwap onQueued={(g) => setRows((prev) => [g, ...prev])} />
              ) : kind === "swap" && !advancedSwap ? (
                <VideoSwap
                  prefill={prefill}
                  prefillKey={prefillKey}
                  jobs={jobs}
                  onQueued={(created) => setJobs((prev) => [...created, ...prev])}
                  onAdvanced={() => setAdvancedSwap(true)}
                />
              ) : (
                <>
                  <div className="flex items-end gap-2.5 flex-wrap">
                    <select
                      className="select !w-auto !min-w-[220px] font-medium"
                      value={modelId}
                      onChange={(e) => switchModel(e.target.value)}
                    >
                      {visible.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.best ? "★ " : ""}
                          {m.name} — {m.vendor}
                        </option>
                      ))}
                    </select>

                    {media.length === 0 &&
                      compact.map((f) => (
                      <label key={f.key} className="flex flex-col gap-1" title={f.help}>
                        <span className="label-xs">{f.label}</span>
                        {f.type === "text" ? (
                          <input
                            className="input !w-[210px] !h-[34px] !text-[12px] !py-0"
                            placeholder={f.placeholder}
                            value={String(input[f.key] ?? "")}
                            onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                          />
                        ) : f.type === "select" ? (
                          <select
                            className="select !w-auto !h-[34px] !text-[12px] !py-0"
                            value={String(input[f.key] ?? "")}
                            onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                          >
                            {f.options?.map((o) => (
                              <option key={o} value={o}>{f.optionLabels?.[o] ?? (o || "Auto")}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input !w-[84px] !h-[34px] !text-[12px] !py-0"
                            type="number"
                            value={String(input[f.key] ?? "")}
                            onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                          />
                        )}
                        </label>
                      ))}
                  </div>

                  {/* Sources d'abord : on choisit ses images avant d'ecrire. */}
                  {media.length > 0 && (
                    <div className="flex flex-wrap gap-x-6 gap-y-3 items-start">
                      {media.map((f) =>
                        f.type === "element" ? (
                          <ElementField
                            key={`${model.id}:${f.key}`}
                            field={f}
                            value={(input[f.key] as ElementValue) ?? EMPTY_ELEMENT}
                            onChange={(v) => setInput((prev) => ({ ...prev, [f.key]: v }))}
                            disabled={busy}
                          />
                        ) : (
                          <MediaField
                            key={`${model.id}:${f.key}`}
                            field={f}
                            value={(input[f.key] as string | string[]) ?? (f.type === "files" ? [] : "")}
                            onChange={(v) => setInput((prev) => ({ ...prev, [f.key]: v }))}
                            disabled={busy}
                          />
                        ),
                      )}
                    </div>
                  )}

                  {/* Consignes : pleine largeur, c'est le coeur du travail. */}
                  {texts.map((f) => (
                    <Field key={f.key} label={f.label}>
                      <textarea
                        className="textarea"
                        style={{ minHeight: f.key === "prompt" ? 104 : 76 }}
                        placeholder={f.placeholder}
                        value={String(input[f.key] ?? "")}
                        onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                      />
                    </Field>
                  ))}

                  {/* Reglages en pied, quand les sources occupent le haut. */}
                  {media.length > 0 && (compact.length > 0 || others.length > 0) && (
                    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                      {[...compact, ...others].map((f) => (
                        <label key={f.key} className="flex flex-col gap-1" title={f.help}>
                          <span className="label-xs">{f.label}</span>
                          {f.type === "select" ? (
                            <select
                              className="select !w-auto !h-[34px] !text-[12px] !py-0"
                              value={String(input[f.key] ?? "")}
                              onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                            >
                              {f.options?.map((o) => (
                                <option key={o} value={o}>{f.optionLabels?.[o] ?? (o || "Auto")}</option>
                              ))}
                            </select>
                          ) : f.type === "number" ? (
                            <input
                              className="input !w-[84px] !h-[34px] !text-[12px] !py-0"
                              type="number"
                              value={String(input[f.key] ?? "")}
                              onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                            />
                          ) : (
                            <input
                              className="input !w-[210px] !h-[34px] !text-[12px] !py-0"
                              placeholder={f.placeholder}
                              value={String(input[f.key] ?? "")}
                              onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Sans source, le reste tient sur la ligne du modele. */}
                  {media.length === 0 && others.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                      {others.map((f) => (
                        <Field key={f.key} label={f.label}>
                          <input
                            className="input"
                            placeholder={f.placeholder}
                            value={String(input[f.key] ?? "")}
                            onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                          />
                        </Field>
                      ))}
                    </div>
                  )}

                  {error && <ErrorNote>{error}</ErrorNote>}

                  <div
                    className="flex items-center justify-between gap-3 pt-3"
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <span className="dim text-[12px] leading-snug">
                      {eta && (
                        <>
                          ≈ {duration(eta.sec)} d&apos;attente
                          <span className="opacity-70">
                            {" "}
                            (médiane sur {eta.sample} génération{eta.sample > 1 ? "s" : ""})
                          </span>
                          <br />
                        </>
                      )}
                      {model.creditsPerSec ? (
                        <>
                          {fmtInt(model.creditsPerSec)} crédits/s — soit ≈{" "}
                          {fmtInt(model.approxCredits)} · {fmtUsd(model.approxCredits * CREDIT_USD)} pour 10 s
                        </>
                      ) : (
                        <>
                          ≈ {fmtInt(model.approxCredits)} crédits · {fmtUsd(model.approxCredits * CREDIT_USD)}
                        </>
                      )}
                    </span>
                    <button className="btn btn-primary" onClick={() => void launch()} disabled={busy}>
                      {busy ? <span className="spinner" /> : "✦"} {kind === "swap" ? "Swap" : "Générer"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </Card>

        </div>
      </div>

      {previewed && <Preview gen={previewed} onClose={() => setPreview(null)} onReuse={reuse} onRestore={restore} />}
      {previewedJob && <StudioJobPreview job={previewedJob} actions={jobActions} onClose={() => setJobPreview(null)} />}
      {voicePickedJob && (
        <VoicePicker
          job={voicePickedJob}
          onClose={() => setVoiceJob(null)}
          onApplied={(updated) => setJobs((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
        />
      )}
    </>
  );
}

/** Nom de fichier lisible, construit a partir du prompt. */
function fileName(gen: Generation) {
  const slug = gen.prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return slug || gen.model.split("/").pop() || "generation";
}

function downloadHref(gen: Generation, url: string) {
  return `/api/kie/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(fileName(gen))}`;
}

function GenerationCard({
  gen,
  eta,
  onOpen,
  picking,
  picked,
  onPick,
}: {
  gen: Generation;
  eta: number | null;
  onOpen: () => void;
  picking: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const done = gen.state === "success";
  const failed = gen.state === "fail";
  const url = gen.resultUrls[0];
  const isVideo = gen.kind === "video";

  return (
    <article
      className="tile card-flat relative overflow-hidden"
      style={{
        aspectRatio: "4 / 5",
        background: "var(--surface-3)",
        outline: picked ? "2px solid var(--accent)" : undefined,
        outlineOffset: -2,
      }}
    >
      {/* La case reste visible des qu'une selection est en cours. */}
      <button
        type="button"
        onClick={onPick}
        title={picked ? "Désélectionner" : "Sélectionner"}
        className={`${picking ? "" : "tile-actions "}absolute top-1.5 left-1.5 z-10 grid place-items-center rounded-[6px] text-[12px] leading-none`}
        style={{
          width: 22,
          height: 22,
          background: picked ? "var(--accent)" : "rgb(0 0 0 / 0.5)",
          color: "#fff",
          border: "1px solid rgb(255 255 255 / 0.35)",
        }}
      >
        {picked ? "✓" : ""}
      </button>
      {done && url ? (
        <>
          <button
            type="button"
            onClick={picking ? onPick : onOpen}
            className="block w-full h-full"
            title={picking ? "Sélectionner" : "Voir en grand"}
            style={{ cursor: picking ? "pointer" : "zoom-in" }}
          >
            {isVideo ? (
              <VideoThumb src={url} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <ThumbImg src={url} />
            )}
          </button>
          <a
            href={downloadHref(gen, url)}
            download
            onClick={(e) => e.stopPropagation()}
            className="tile-actions absolute bottom-1.5 right-1.5 btn btn-sm"
            hidden={picking}
            title="Télécharger"
          >
            ↓
          </a>
          {isVideo && (
            <span
              className="absolute top-1.5 left-1.5 rounded-full grid place-items-center text-[11px] pointer-events-none"
              style={{ width: 22, height: 22, background: "rgb(0 0 0 / 0.55)", color: "#fff" }}
            >
              ▶
            </span>
          )}
        </>
      ) : failed ? (
        <div className="w-full h-full grid place-items-center text-center px-3">
          <p className="text-[11.5px] leading-snug" style={{ color: "var(--critical)" }}>
            {gen.failMsg || "Génération échouée"}
          </p>
        </div>
      ) : (
        <Working gen={gen} eta={eta} />
      )}
    </article>
  );
}

/**
 * Durees relevees sur les generations reelles de ce compte :
 * nano-banana-pro 1 min 42, Kling 2.6 motion-control 3 min 20 et 6 min,
 * Kling 3.0 Omni 8 min 16. On prend le haut de la fourchette : une barre qui
 * sature avant la fin est plus penible qu'une barre qui avance lentement.
 */
const TYPICAL_SEC: Record<string, number> = { image: 120, video: 480 };

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")}` : `${s} s`;
}

/**
 * Attente d'une generation.
 *
 * KIE ne publie un pourcentage que pour une partie des modeles. Quand il
 * manque, on se rabat sur le temps ecoule rapporte a une duree typique : ce
 * n'est pas la verite du moteur, mais ca repond a la seule question qu'on se
 * pose devant l'ecran — est-ce que ca avance, et j'en ai pour combien.
 */
function Working({ gen, eta }: { gen: Generation; eta: number | null }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.round((Date.now() - new Date(gen.createdAt).getTime()) / 1000)),
  );

  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.max(0, Math.round((Date.now() - new Date(gen.createdAt).getTime()) / 1000))),
      1000,
    );
    return () => clearInterval(id);
  }, [gen.createdAt]);

  const vendor = getModel(gen.model)?.vendor;
  // L'historique prime sur la valeur generique : il colle au modele choisi.
  const typical = eta ?? TYPICAL_SEC[gen.kind] ?? 300;
  const real = gen.progress > 0;
  /*
   * KIE ne publie que « waiting » puis « success » sur les modeles video :
   * on ne sait pas si la tache attend ou calcule. On montre donc une barre
   * indeterminee plutot qu'un pourcentage invente.
   */
  const opaque = gen.state === "waiting" || gen.state === "queuing";
  const left = typical - elapsed;
  const pct = real ? gen.progress : Math.min(95, Math.round((elapsed / typical) * 100));

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2.5 px-4">
      <span className="num text-[19px] font-semibold tabular-nums">{mmss(elapsed)}</span>
      <span className="dim text-[11px]">
        {opaque ? `En cours chez ${vendor ?? "le fournisseur"}` : label(gen.state)}
      </span>

      <div className="w-full rounded-full overflow-hidden" style={{ height: 5, background: "var(--border)" }}>
        {opaque ? (
          // Rien a mesurer tant que rien n'a demarre : on montre juste que c'est vivant.
          <div className="h-full rounded-full sliding" style={{ width: "35%", background: "var(--accent)" }} />
        ) : (
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(pct, 4)}%`,
              background: "var(--accent)",
              transition: "width .6s ease",
            }}
          />
        )}
      </div>

      <span className="dim text-[10.5px] text-center leading-snug">
        {opaque
          ? left > 0
            ? `≈ ${mmss(left)} restantes`
            : "Ça dépasse la durée habituelle"
          : real
            ? `${pct} %`
            : left > 0
              ? `≈ ${mmss(left)} restantes`
              : "Bientôt fini — ça dépasse la durée habituelle"}
      </span>
    </div>
  );
}

/** Cles d'entree portant des medias, par type. */
const MEDIA_KEYS = {
  image: [
    "image_urls",
    "input_urls",
    "image_input",
    "reference_image",
    "reference_image_urls",
    "first_frame_url",
    "last_frame_url",
    "image_url",
    "tail_image_url",
  ],
  video: ["video_urls", "video_url", "reference_video_urls"],
};

/** Cles deja affichees ailleurs : on ne les repete pas dans les reglages. */
const HIDDEN_SETTINGS = new Set([...MEDIA_KEYS.image, ...MEDIA_KEYS.video, "prompt", "elements"]);

function asUrls(v: unknown): string[] {
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

interface ElementRef {
  name?: string;
  description?: string;
  element_input_urls?: string[];
}

function Source({ url, kind }: { url: string; kind: "image" | "video" }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="rounded-[7px] overflow-hidden shrink-0 relative block"
      style={{ width: 54, height: 66, border: "1px solid var(--border)", background: "var(--surface-3)" }}
      title={kind === "video" ? "Ouvrir la vidéo source" : "Ouvrir l'image source"}
    >
      {kind === "video" ? (
        <>
          <VideoThumb src={url} />
          <span
            className="absolute inset-0 grid place-items-center text-[11px]"
            style={{ background: "rgb(0 0 0 / 0.3)", color: "#fff" }}
          >
            ▶
          </span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <ThumbImg src={url} />
      )}
    </a>
  );
}

/**
 * Apercu detaille d'une generation.
 *
 * Une vignette seule ne dit pas comment elle a ete obtenue. Retrouver le
 * modele, la consigne et les images de reference deux jours plus tard imposait
 * de fouiller la base — alors que c'est exactement ce qu'on veut relire pour
 * reproduire un resultat qui a marche.
 */
function Preview({
  gen,
  onClose,
  onReuse,
  onRestore,
}: {
  gen: Generation;
  onClose: () => void;
  onReuse: (url: string, from: "image" | "video") => void;
  onRestore: (gen: Generation) => void;
}) {
  const url = gen.resultUrls[0];
  const def = getModel(gen.model);
  const input = (gen.input ?? {}) as Record<string, unknown>;

  const images = MEDIA_KEYS.image.flatMap((k) => asUrls(input[k]));
  const videos = MEDIA_KEYS.video.flatMap((k) => asUrls(input[k]));
  const elements = (Array.isArray(input.elements) ? input.elements : []) as ElementRef[];
  const settings = Object.entries(input).filter(
    ([k, v]) => !HIDDEN_SETTINGS.has(k) && v !== "" && v !== null && v !== undefined,
  );

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={def?.name ?? gen.model}
      footer={
        <>
          <button
            className="btn mr-auto"
            onClick={() => {
              onRestore(gen);
              onClose();
            }}
            title="Recharger le modèle, les sources et la consigne dans le formulaire"
          >
            ↻ Reprendre ces réglages
          </button>
          <button
            className="btn"
            onClick={() => {
              onReuse(url, gen.kind === "video" ? "video" : "image");
              onClose();
            }}
          >
            Utiliser pour le swap
          </button>
          <a href={downloadHref(gen, url)} download className="btn btn-primary">
            ↓ Télécharger
          </a>
        </>
      }
    >
      <div className="grid lg:grid-cols-[1fr_290px] gap-4 items-start">
        <div
          className="grid place-items-center overflow-hidden"
          style={{ background: "var(--surface-3)", borderRadius: 10 }}
        >
          {gen.kind === "video" ? (
            <video src={url} controls autoPlay playsInline className="w-full" style={{ maxHeight: "72vh" }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="w-full object-contain" style={{ maxHeight: "72vh" }} />
          )}
        </div>

        <div className="flex flex-col gap-3.5 min-w-0">
          <div>
            <span className="label-xs block mb-1.5">Technologie</span>
            <p className="text-[13px] font-medium">{def?.name ?? gen.model}</p>
            <p className="dim text-[11px] mono break-all">{gen.model}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {def?.vendor && <span className="badge">{def.vendor}</span>}
              {gen.creditsConsumed > 0 && <span className="badge">{fmtInt(gen.creditsConsumed)} crédits</span>}
              {gen.costTimeSec > 0 && <span className="badge">{duration(gen.costTimeSec)}</span>}
              <span className="badge">{relative(gen.createdAt)}</span>
            </div>
          </div>

          {gen.prompt && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="label-xs">Consigne</span>
                <CopyButton text={gen.prompt} label="Copier" />
              </div>
              <p
                className="text-[11.5px] leading-relaxed p-2.5 rounded-[8px] max-h-[170px] overflow-y-auto whitespace-pre-wrap"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              >
                {gen.prompt}
              </p>
            </div>
          )}

          {(images.length > 0 || videos.length > 0) && (
            <div>
              <span className="label-xs block mb-1.5">Sources utilisées</span>
              <div className="flex gap-1.5 flex-wrap">
                {images.map((u, i) => (
                  <Source key={`i${i}`} url={u} kind="image" />
                ))}
                {videos.map((u, i) => (
                  <Source key={`v${i}`} url={u} kind="video" />
                ))}
              </div>
            </div>
          )}

          {elements.length > 0 && (
            <div>
              <span className="label-xs block mb-1.5">Produit déclaré</span>
              {elements.map((el, i) => (
                <div key={i} className="flex gap-1.5 items-center flex-wrap">
                  {(el.element_input_urls ?? []).map((u, j) => (
                    <Source key={j} url={u} kind="image" />
                  ))}
                  {el.description && <span className="dim text-[11.5px]">{el.description}</span>}
                </div>
              ))}
            </div>
          )}

          {settings.length > 0 && (
            <div>
              <span className="label-xs block mb-1.5">Réglages</span>
              <dl className="flex flex-col gap-1">
                {settings.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 text-[11.5px]">
                    <dt className="dim shrink-0">{k}</dt>
                    <dd className="font-medium text-right break-all">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function StudioPage() {
  /*
   * Dans princexd, les toasts et la file de rendus (JobsDock) vivent dans le
   * Shell et la mise en page racine. Ici le Studio est une page parmi
   * d'autres : elle embarque les deux, à l'intérieur du conteneur `.studio-ia`
   * qui porte ses styles.
   */
  return (
    <div className="studio-ia">
      <ToastHost>
        <Suspense fallback={<SkPage />}>
          <StudioInner />
        </Suspense>
        <JobsDock />
      </ToastHost>
    </div>
  );
}
