"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { engineLabel, engineModel, engineVendor } from "@/lib/studio-ia/config";
import { STATUS_LABEL, stepsOf, VOICE_AMBIENCE_LABEL, VOICE_ENGINE_LABEL, VOICE_MODE_LABEL } from "@/lib/studio-ia/labels";
import type { VoiceAmbience, VoiceInfo } from "@/lib/studio-ia/types";
import { STYLE_PROMPTS, TRANSFORM_LABELS } from "@/lib/studio-ia/prompts";
import type { StudioJob } from "@/lib/studio-ia/types";
import { duration, fmtInt, relative } from "@/lib/format";
import { CopyButton, Modal, useToast } from "./ui";
import { thumbUrl, VideoThumb } from "@/components/studio-ia/MediaThumb";
import { ThumbImg } from "@/components/studio-ia/MediaThumb";
import { loadVoices } from "@/lib/client";

/**
 * Carte d'un job de Swap vidéo dans « Résultats ».
 *
 * Pendant le traitement : la référence en fond, les étapes en clair. Une fois
 * fini : la vidéo finale, et sur survol les actions rapides.
 */

export interface JobActions {
  onOpen: (job: StudioJob) => void;
  onRedo: (job: StudioJob) => void;
  onUseAsReference: (job: StudioJob) => void;
  onRetry: (job: StudioJob, scope: "all" | "voice") => void;
  /** Ouvre le choix de voix pour l'appliquer sur une video deja generee. */
  onChangeVoice: (job: StudioJob) => void;
  onDelete: (job: StudioJob) => void;
}

export function jobDownloadHref(job: StudioJob) {
  const url = job.finalOutput || job.videoOutput;
  const name = `${job.type === "talking-photo" ? "photo-parle" : job.type === "creation" ? "creation" : "swap"}-${engineLabel(job.provider).toLowerCase().replace(/\s+/g, "-")}-${job.id}.mp4`;
  return `${url}?download=1&name=${encodeURIComponent(name)}`;
}

function jobTitle(job: StudioJob) {
  if (job.type === "talking-photo") return `Photo qui parle · ${engineLabel(job.provider)}`;
  if (job.type === "creation") return `Création · ${engineLabel(job.provider)}`;
  return `${TRANSFORM_LABELS[job.transform]} · ${engineLabel(job.provider)}`;
}

/** Ce qu'on entend dans la vidéo, selon l'outil qui l'a produite. */
export function soundLabel(job: StudioJob): string {
  if (job.type === "talking-photo") return job.talkText ? `Texte lu · ${job.voiceName || job.voiceId}` : "Audio fourni";
  if (job.type === "creation") return "Voix générée par Seedance depuis le script";
  return VOICE_MODE_LABEL[job.voiceMode];
}

/**
 * Recette d'un rendu, en texte court : les reglages a refaire dans l'ordre de
 * l'interface, rien d'autre. C'est ce que le monteur copie dans son brief.
 */
export function jobSheet(job: StudioJob): string {
  const q = (v: string) => `« ${v} »`;
  const L: string[] = [];
  if (job.type === "talking-photo") {
    L.push("PHOTO QUI PARLE — à refaire dans l'onglet « Photo qui parle »");
    L.push(`1. Photo : ${job.referenceImageName || "photo"}`);
    L.push(job.talkText
      ? `2. Texte lu par ${job.voiceName || job.voiceId} : ${q(job.talkText)}`
      : `2. Fichier audio : ${(job.talkAudio ?? "").split("/").pop() || "audio"}`);
    L.push(`3. Scène : ${job.userPrompt ? q(job.userPrompt) : "laisser vide"}`);
    L.push(`4. Résolution : ${job.talkResolution ?? "480p"}`);
  } else if (job.type === "creation") {
    L.push("CRÉATION — à refaire dans l'onglet « Création »");
    L.push(`1. Image de départ : ${job.referenceImageName || "image"}${job.productImages.length ? ` · Produit : ${job.productImages.length} photo(s)` : ""}`);
    L.push(`2. Script : ${q(job.talkText ?? "")}${job.createLanguage && job.createLanguage !== "fr" ? ` (langue : ${job.createLanguage})` : ""}`);
    L.push(`3. Attitude : ${job.userPrompt ? q(job.userPrompt) : "laisser vide"}`);
    L.push(`4. Durée : ${job.createDurationSec && job.createDurationSec > 0 ? `${job.createDurationSec} s` : "automatique"} · ${job.createResolution ?? "720p"} · Format ${job.aspectRatio === "original" ? "adaptatif" : job.aspectRatio}`);
  } else {
    L.push("SWAP VIDÉO — à refaire dans l'onglet « Swap vidéo »");
    const views = job.referenceImages?.length ?? 1;
    L.push(`1. Image de référence : ${job.referenceImageName || "image"}${views > 1 ? ` + ${views - 1} autre(s) vue(s)` : ""} · Vidéo : ${job.sourceVideoName || "vidéo"}${job.sourceDurationSec ? ` (${job.sourceDurationSec.toFixed(0)} s)` : ""}`);
    L.push(`2. Transformation : ${TRANSFORM_LABELS[job.transform]} · Style : ${STYLE_PROMPTS[job.style]?.label ?? job.style}`);
    L.push(job.productImages.length
      ? `3. Produit en main : ${job.productImages.length} photo(s) · ${q(job.productDescription || "sans description")}`
      : "3. Produit en main : aucun");
    if (job.sceneImage) L.push("3b. Décor : photo du nouveau lieu attachée");
    L.push(`4. Consigne : ${job.userPrompt ? (job.userPrompt.length > 300 ? `consigne rédigée automatiquement (${job.userPrompt.length} caractères, voir l'aperçu)` : q(job.userPrompt)) : "laisser vide"}`);
    const voice =
      job.voiceMode === "none" ? "Sans audio"
      : job.voiceMode === "keep" ? "Garder ma voix"
      : `Transformer ma voix → ${job.voiceName || "voix"} · Rendu ${VOICE_AMBIENCE_LABEL[job.voiceAmbience]}`;
    L.push(`5. Son : ${voice}${job.voiceMode !== "none" ? ` · Synchro des lèvres : ${job.lipSync ? (job.lipSyncError ? "cochée (a échoué, relancer)" : "cochée") : "non"}` : ""}`);
    L.push(`6. Modèle : ${engineLabel(job.provider)}${job.requestedProvider === "auto" ? " (choisi par Auto)" : " (forcé dans la liste)"} · ${job.resolution} · Format ${job.aspectRatio === "original" ? "original" : job.aspectRatio}`);
  }
  const mins = job.startedAt && job.completedAt ? Math.max(1, Math.round((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 60000)) : 0;
  L.push(`Coût : ${job.creditsConsumed ? `${job.creditsConsumed} crédits` : job.creditsEstimated ? `≈ ${job.creditsEstimated} crédits` : "—"}${mins ? ` · Temps : ${mins} min` : ""}`);
  if (job.voiceError) L.push(`Note : voix non transformée (${job.voiceError})`);
  return L.join("\n");
}

function useElapsed(from: string, running: boolean) {
  const compute = () => Math.max(0, Math.round((Date.now() - new Date(from || Date.now()).getTime()) / 1000));
  const [n, setN] = useState(compute);
  useEffect(() => {
    if (!running) return;
    setN(compute());
    const id = setInterval(() => setN(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, running]);
  return n;
}

function Steps({ job }: { job: StudioJob }) {
  const steps = stepsOf(job);
  return (
    <ul className="flex flex-col gap-[3px] w-full">
      {steps.map((s) => (
        <li
          key={s.key}
          className="flex items-center gap-1.5 text-[10.5px] leading-tight"
          style={{
            color:
              s.state === "done" ? "var(--good)"
              : s.state === "current" ? "var(--text)"
              : s.state === "skipped" ? "var(--warning)"
              : "var(--text-3)",
            fontWeight: s.state === "current" ? 600 : 400,
          }}
        >
          <span className="w-[10px] text-center shrink-0">
            {s.state === "done" ? "✓" : s.state === "current" ? "●" : s.state === "skipped" ? "!" : "○"}
          </span>
          <span className="truncate">
            {s.label}
            {s.state === "current" && s.key === "generating_video" && job.progress > 0 && ` · ${job.progress} %`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StudioJobCard({ job, actions }: { job: StudioJob; actions: JobActions }) {
  const done = job.status === "completed";
  const failed = job.status === "failed";
  const running = !done && !failed;
  const elapsed = useElapsed(job.startedAt || job.createdAt, running);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const output = job.finalOutput || job.videoOutput;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <article
      className="tile card-flat relative overflow-hidden"
      style={{ aspectRatio: "4 / 5", background: "var(--surface-3)" }}
      title={jobTitle(job)}
    >
      {done && output ? (
        <>
          <button type="button" onClick={() => actions.onOpen(job)} className="block w-full h-full" title="Voir" style={{ cursor: "zoom-in" }}>
            <VideoThumb src={output} />
          </button>
          <span
            className="absolute top-1.5 left-1.5 rounded-full grid place-items-center text-[11px] pointer-events-none"
            style={{ width: 22, height: 22, background: "rgb(0 0 0 / 0.55)", color: "#fff" }}
          >
            ▶
          </span>
          {job.voiceError && (
            <span className="absolute top-1.5 right-1.5 badge badge-warn !text-[10px] !py-0" title={job.voiceError}>
              voix ✕
            </span>
          )}
          <div className="tile-actions absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1">
            <button className="btn btn-sm !px-1.5" onClick={() => actions.onOpen(job)} title="Voir">▶</button>
            <a href={jobDownloadHref(job)} download className="btn btn-sm !px-1.5" title="Télécharger">⬇</a>
            <button className="btn btn-sm !px-1.5" onClick={() => actions.onRedo(job)} title="Refaire avec les mêmes réglages">⟳</button>
            <div className="relative ml-auto" ref={menuRef}>
              <button className="btn btn-sm !px-1.5" onClick={() => setMenu((v) => !v)} title="Plus">⋯</button>
              {menu && (
                <div
                  className="absolute bottom-full right-0 mb-1 rounded-[9px] overflow-hidden flex flex-col text-left min-w-[190px]"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", zIndex: 20 }}
                >
                  <button className="px-3 py-2 text-[12px] text-left hover:bg-[var(--surface-2)]" onClick={() => { setMenu(false); actions.onUseAsReference(job); }}>
                    Utiliser comme nouvelle référence
                  </button>
                  {job.voiceMode === "transform" && (
                    <button className="px-3 py-2 text-[12px] text-left hover:bg-[var(--surface-2)]" onClick={() => { setMenu(false); actions.onRetry(job, "voice"); }}>
                      Réessayer la voix
                    </button>
                  )}
                  <button className="px-3 py-2 text-[12px] text-left hover:bg-[var(--surface-2)]" onClick={() => { setMenu(false); actions.onChangeVoice(job); }}>
                    {job.voiceMode === "transform" ? "Changer de voix" : "Ajouter une voix"}
                  </button>
                  <button className="px-3 py-2 text-[12px] text-left hover:bg-[var(--surface-2)]" style={{ color: "var(--critical)" }} onClick={() => { setMenu(false); actions.onDelete(job); }}>
                    Supprimer
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="w-full h-full flex flex-col">
          {/* La référence en fond : on sait d'un coup d'oeil quel personnage tourne. */}
          <ThumbImg src={job.referenceImage} className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.18, filter: "grayscale(30%)" }} />
          <div className="relative flex-1 flex flex-col justify-center gap-2 px-2.5 py-2">
            {failed ? (
              <>
                <p className="text-[11.5px] leading-snug font-medium" style={{ color: "var(--critical)" }}>{job.error || "Échec"}</p>
                <div className="flex flex-wrap gap-1">
                  <button className="btn btn-sm" onClick={() => actions.onRetry(job, "all")}>Réessayer</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => actions.onDelete(job)}>✕</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-[11.5px] font-semibold truncate">
                    {job.status === "queued" ? "En attente" : "Transformation en cours"}
                  </span>
                  <span className="num text-[11px] tabular-nums shrink-0">{duration(elapsed)}</span>
                </div>
                <Steps job={job} />
                <div className="rounded-full overflow-hidden" style={{ height: 3, background: "var(--border)" }}>
                  {job.progress > 0 && job.status === "generating_video" ? (
                    <div className="h-full rounded-full" style={{ width: `${job.progress}%`, background: "var(--accent)", transition: "width .6s ease" }} />
                  ) : (
                    <div className="h-full rounded-full sliding" style={{ width: "35%", background: "var(--accent)" }} />
                  )}
                </div>
                <span className="dim text-[10px] truncate">{engineLabel(job.provider)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Aperçu détaillé d'un job : la vidéo finale et tout ce qui l'a produite. */
export function StudioJobPreview({ job, actions, onClose }: { job: StudioJob; actions: JobActions; onClose: () => void }) {
  const output = job.finalOutput || job.videoOutput;
  const talk = job.type === "talking-photo";
  const create = job.type === "creation";
  const simple = talk || create;
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={jobTitle(job)}
      footer={
        <>
          {!simple && <button className="btn mr-auto" onClick={() => { onClose(); actions.onRedo(job); }}>⟳ Refaire</button>}
          <button className="btn" onClick={() => { onClose(); actions.onUseAsReference(job); }}>Utiliser comme référence</button>
          {!simple && (
            <button className="btn" onClick={() => { onClose(); actions.onChangeVoice(job); }}>
              {job.voiceMode === "transform" ? "Changer de voix" : "Ajouter une voix"}
            </button>
          )}
          {output && <a href={jobDownloadHref(job)} download className="btn btn-primary">↓ Télécharger</a>}
        </>
      }
    >
      <div className="grid lg:grid-cols-[1fr_290px] gap-4 items-start">
        <div className="grid place-items-center overflow-hidden" style={{ background: "var(--surface-3)", borderRadius: 10 }}>
          {output ? (
            <video src={output} controls autoPlay playsInline className="w-full" style={{ maxHeight: "72vh" }} />
          ) : (
            <p className="dim text-[12px] p-6">{STATUS_LABEL[job.status]}</p>
          )}
        </div>
        <div className="flex flex-col gap-3.5 min-w-0">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="label-xs">Recette à refaire</span>
              <CopyButton text={jobSheet(job)} label="Copier la recette" />
            </div>
            <pre className="text-[11.5px] leading-relaxed p-2.5 rounded-[8px] whitespace-pre-wrap" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", fontFamily: "inherit" }}>
              {jobSheet(job)}
            </pre>
          </div>

          <div>
            <span className="label-xs block mb-1.5">Technologie</span>
            <p className="text-[13px] font-medium">{engineLabel(job.provider)}</p>
            <p className="dim text-[11px] mono break-all">{engineModel(job.provider)}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {engineVendor(job.provider) && <span className="badge">{engineVendor(job.provider)}</span>}
              <span className="badge">{talk ? job.talkResolution ?? "480p" : create ? job.createResolution ?? "720p" : job.resolution}</span>
              {!talk && <span className="badge">{job.aspectRatio === "original" ? "format original" : job.aspectRatio}</span>}
              {job.creditsConsumed > 0 ? (
                <span className="badge">{fmtInt(job.creditsConsumed)} crédits</span>
              ) : job.creditsEstimated > 0 ? (
                <span className="badge">≈ {fmtInt(job.creditsEstimated)} crédits</span>
              ) : null}
              <span className="badge">{relative(job.createdAt)}</span>
            </div>
          </div>

          <div>
            <span className="label-xs block mb-1.5">Son</span>
            <p className="text-[12.5px]">
              {soundLabel(job)}
              {job.voiceName && <span className="dim"> · {job.voiceName}</span>}
              {job.voiceEngine && <span className="dim"> · {VOICE_ENGINE_LABEL[job.voiceEngine]}</span>}
              {job.voiceMode === "transform" && job.voiceAmbience && <span className="dim"> · {VOICE_AMBIENCE_LABEL[job.voiceAmbience]}</span>}
              {job.lipSync && <span className="dim"> · lèvres synchronisées (IA)</span>}
            </p>
            {job.lipSyncError && (
              <p className="text-[11.5px] mt-1 leading-snug" style={{ color: "var(--warning)" }}>
                Synchro des lèvres non appliquée : {job.lipSyncError}
              </p>
            )}
            {job.voiceError && (
              <p className="text-[11.5px] mt-1 leading-snug" style={{ color: "var(--warning)" }}>
                {job.voiceError} — la vidéo est livrée avec la voix d&apos;origine.
              </p>
            )}
          </div>

          <div>
            <span className="label-xs block mb-1.5">Sources</span>
            <div className="flex gap-1.5">
              {(job.referenceImages?.length ? job.referenceImages : [job.referenceImage]).map((u, k) => (
                <a key={u + k} href={u} target="_blank" rel="noreferrer" className="rounded-[7px] overflow-hidden block" style={{ width: 54, height: 66, border: "1px solid var(--border)" }} title={k === 0 ? "Image de référence" : `Vue ${k + 1}`}>
                  <ThumbImg src={u} className="w-full h-full object-cover" />
                </a>
              ))}
              {job.sceneImage && (
                <a href={job.sceneImage} target="_blank" rel="noreferrer" className="rounded-[7px] overflow-hidden block" style={{ width: 88, height: 66, border: "1px solid var(--border)" }} title="Nouveau décor">
                  <ThumbImg src={job.sceneImage} className="w-full h-full object-cover" />
                </a>
              )}
              {job.referenceSheet && (
                <a href={job.referenceSheet} target="_blank" rel="noreferrer" className="rounded-[7px] overflow-hidden block" style={{ width: 96, height: 66, border: "1px dashed var(--border-strong)" }} title="Planche assemblée envoyée au modèle">
                  <ThumbImg src={job.referenceSheet} className="w-full h-full object-cover" />
                </a>
              )}
              {job.sourceVideo && (
                <a href={job.sourceVideo} target="_blank" rel="noreferrer" className="rounded-[7px] overflow-hidden block relative" style={{ width: 54, height: 66, border: "1px solid var(--border)", background: "var(--surface-3)" }} title="Vidéo source">
                  <VideoThumb src={job.sourceVideo} />
                  <span className="absolute inset-0 grid place-items-center text-[11px]" style={{ background: "rgb(0 0 0 / 0.3)", color: "#fff" }}>▶</span>
                </a>
              )}
              {talk && job.audioOutput && (
                <audio src={job.audioOutput} controls preload="none" style={{ height: 32, maxWidth: 220 }} />
              )}
            </div>
            {(job.productImages ?? []).length > 0 && (
              <div className="mt-2">
                <span className="label-xs block mb-1">Produit protégé</span>
                <div className="flex gap-1.5 flex-wrap items-center">
                  {job.productImages.map((u, k) => (
                    <a key={u + k} href={u} target="_blank" rel="noreferrer" className="rounded-[7px] overflow-hidden block" style={{ width: 44, height: 44, border: "1px solid var(--border)" }}>
                      <ThumbImg src={u} className="w-full h-full object-cover" />
                    </a>
                  ))}
                  {job.productDescription && <span className="dim text-[11.5px]">{job.productDescription}</span>}
                </div>
              </div>
            )}
          </div>

          {simple && job.talkText && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="label-xs">{create ? "Script" : "Texte lu"}</span>
                <CopyButton text={job.talkText} label="Copier" />
              </div>
              <p className="text-[11.5px] leading-relaxed p-2.5 rounded-[8px] whitespace-pre-wrap" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                {job.talkText}
              </p>
            </div>
          )}

          {job.userPrompt && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="label-xs">{talk ? "Scène" : "Ta consigne"}</span>
                <CopyButton text={job.userPrompt} label="Copier" />
              </div>
              <p className="text-[11.5px] leading-relaxed p-2.5 rounded-[8px] whitespace-pre-wrap" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                {job.userPrompt}
              </p>
            </div>
          )}

          <details>
            <summary className="label-xs cursor-pointer">Prompt complet envoyé</summary>
            <p className="text-[11px] leading-relaxed p-2.5 mt-1.5 rounded-[8px] max-h-[220px] overflow-y-auto whitespace-pre-wrap" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              {job.prompt}
            </p>
          </details>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ Choix de voix apres coup ------------------------------ */

const AMBIENCES: VoiceAmbience[] = ["room", "close", "far", "raw"];
const isAnglo = (v: VoiceInfo) => /american|british|australian|irish|canadian/i.test(v.accent);
const VOICE_FILTERS: { id: string; label: string; test: (v: VoiceInfo) => boolean }[] = [
  { id: "fr", label: "Françaises", test: (v) => v.category === "cloned" || v.category === "generated" || (!isAnglo(v) && v.category !== "premade") },
  { id: "cloned", label: "Clonées", test: (v) => v.category === "cloned" || v.category === "generated" },
  { id: "f", label: "Femme", test: (v) => v.gender === "female" && !isAnglo(v) },
  { id: "all", label: "Toutes", test: () => true },
];

/**
 * Applique (ou change) la voix d'un job deja genere : speech-to-speech de la
 * piste d'origine, puis assemblage. La video n'est pas regeneree.
 */
export function VoicePicker({ job, onClose, onApplied }: { job: StudioJob; onClose: () => void; onApplied: (job: StudioJob) => void }) {
  const toast = useToast();
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("fr");
  const [voiceId, setVoiceId] = useState(job.voiceId || "");
  const [ambience, setAmbience] = useState<VoiceAmbience>(job.voiceAmbience || "room");
  const [keepMine, setKeepMine] = useState(job.voiceMode !== "transform");
  const [lipSync, setLipSync] = useState(Boolean(job.lipSync));
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    loadVoices()
      .then((r) => {
        setVoices(r.voices);
        if (!r.configured) setError("Aucune clé ElevenLabs configurée.");
        else if (r.error) setError(r.error);
      })
      .catch((e: Error) => {
        setVoices([]);
        setError(e.message);
      });
    return () => audioRef.current?.pause();
  }, []);

  const list = useMemo(() => {
    const f = VOICE_FILTERS.find((x) => x.id === filter) ?? VOICE_FILTERS[0];
    return (voices ?? []).filter(f.test);
  }, [voices, filter]);
  const selected = voices?.find((v) => v.id === voiceId) ?? null;

  const preview = (v: VoiceInfo) => {
    if (!v.previewUrl) return;
    if (playing === v.id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const a = new Audio(v.previewUrl);
    audioRef.current = a;
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    setPlaying(v.id);
  };

  const apply = async () => {
    if (!keepMine && !selected) return;
    setBusy(true);
    try {
      const r = await api<{ job: StudioJob }>(`/api/studio-ia/jobs/${job.id}/retry`, {
        method: "POST",
        body: JSON.stringify(
          keepMine
            ? { scope: "voice", voiceMode: "keep", lipSync }
            : { scope: "voice", voiceId: selected!.id, voiceName: selected!.name, voiceAmbience: ambience, lipSync },
        ),
      });
      onApplied(r.job);
      toast(keepMine ? "Ta voix d'origine est reposée sur la vidéo." : `Voix « ${selected!.name} » en cours d'application. Quelques secondes.`);
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={job.voiceMode === "transform" ? "Changer de voix" : "Ajouter une voix"}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={busy || (!keepMine && !selected)}>
            {busy ? <span className="spinner" /> : "Appliquer sur cette vidéo"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="dim text-[12.5px] leading-snug">
          La vidéo n&apos;est pas regénérée : elle est recalée sur la durée de ta source, puis la voix est posée dessus (la tienne, ou une voix ElevenLabs en speech-to-speech).
        </p>
        <div className="flex gap-1.5 flex-wrap">
          <button className="btn btn-sm" onClick={() => setKeepMine(true)} style={keepMine ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>Garder ma voix</button>
          <button className="btn btn-sm" onClick={() => setKeepMine(false)} style={!keepMine ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>Voix ElevenLabs ✨</button>
        </div>
        <label className="flex items-start gap-2 text-[12.5px] cursor-pointer">
          <input type="checkbox" className="mt-[3px]" checked={lipSync} onChange={(e) => setLipSync(e.target.checked)} />
          <span>
            <span className="font-medium">Synchroniser les lèvres (IA)</span>
            <span className="dim block text-[11.5px] leading-snug">Une passe KIE refait la bouche sur la voix finale. Utile après Seedance ou Kling. Quelques crédits KIE, 2 à 5 minutes.</span>
          </span>
        </label>
        {keepMine ? null : voices === null ? (
          <span className="dim text-[12px]"><span className="spinner" /> Chargement des voix…</span>
        ) : error ? (
          <span className="text-[12px]" style={{ color: "var(--warning)" }}>{error}</span>
        ) : (
          <>
            <div className="flex gap-1.5 flex-wrap">
              {VOICE_FILTERS.map((f) => (
                <button key={f.id} className="btn btn-sm" onClick={() => setFilter(f.id)} style={filter === f.id ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>{f.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select className="select !w-auto !min-w-[260px]" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                <option value="">Choisir une voix…</option>
                {list.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.gender || v.age ? ` — ${[v.gender, v.age, v.accent].filter(Boolean).join(", ")}` : ""}{v.category === "cloned" ? " · clonée" : ""}
                  </option>
                ))}
              </select>
              {selected?.previewUrl && (
                <button className="btn btn-sm" onClick={() => preview(selected)}>{playing === selected.id ? "■ Stop" : "▶ Pré-écouter"}</button>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap items-center">
              <span className="label-xs mr-1">Rendu</span>
              {AMBIENCES.map((a) => (
                <button key={a} className="btn btn-sm" onClick={() => setAmbience(a)} style={ambience === a ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>{VOICE_AMBIENCE_LABEL[a]}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
