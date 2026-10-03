"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api, useCollection, useLocalState } from "@/lib/client";
import { uploadFile } from "@/lib/upload-client";
import { fmtInt, fmtUsd } from "@/lib/format";
import { PROVIDERS, PROVIDER_IDS, MAX_VARIANTS } from "@/lib/studio-ia/config";
import { DEFAULT_NEGATIVE_PROMPT, STYLE_PROMPTS, TRANSFORM_LABELS } from "@/lib/studio-ia/prompts";
import { VOICE_AMBIENCE_LABEL, VOICE_MODE_LABEL } from "@/lib/studio-ia/labels";
import type {
  AspectChoice,
  ProviderChoice,
  Quote,
  Resolution,
  StudioCharacter,
  StudioJob,
  StyleId,
  TransformRequest,
  TransformType,
  VoiceAmbience,
  VoiceInfo,
  VoiceMode,
} from "@/lib/studio-ia/types";
import { toSupportedImage } from "./MediaField";
import { ErrorNote, Field, useToast } from "./ui";
import { VideoThumb } from "@/components/studio-ia/MediaThumb";
import { ThumbImg } from "@/components/studio-ia/MediaThumb";
import { forgetVoices, loadVoices } from "@/lib/client";
import { takeFiles } from "@/lib/upload-client";
import { clipboardFiles, droppedFiles } from "@/lib/upload-client";

/**
 * Onglet « Swap vidéo » du Studio, version simple.
 *
 * Une photo, une vidéo, éventuellement une voix, un clic. Tout le reste a une
 * valeur par défaut raisonnable et se règle en pastilles. Le travail lourd
 * (upload chez le fournisseur, génération, voix, assemblage) part en file
 * côté serveur : rien ne bloque, on prépare déjà la vidéo suivante.
 */

interface Media {
  url: string;
  name: string;
}
interface VideoMedia extends Media {
  durationSec: number;
}

export interface SwapPrefill {
  sourceVideo?: Media;
  referenceImage?: Media;
  referenceImages?: Media[];
  provider?: ProviderChoice;
  transform?: TransformType;
  style?: StyleId;
  userPrompt?: string;
  negativePrompt?: string;
  voiceMode?: VoiceMode;
  voiceId?: string;
  voiceName?: string;
  voiceAmbience?: VoiceAmbience;
  productImages?: Media[];
  productDescription?: string;
  sceneImage?: Media;
  resolution?: Resolution;
  aspectRatio?: AspectChoice;
  variants?: number;
}

/** « Refaire » : tout ce qu'il faut pour relancer un job à l'identique. */
export function prefillFromJob(job: StudioJob): SwapPrefill {
  return {
    sourceVideo: { url: job.sourceVideo, name: job.sourceVideoName || "vidéo" },
    referenceImage: { url: job.referenceImage, name: job.referenceImageName || "référence" },
    referenceImages: (job.referenceImages ?? []).slice(1).map((u, k) => ({ url: u, name: `vue ${k + 2}` })),
    provider: job.requestedProvider,
    transform: job.transform,
    style: job.style,
    userPrompt: job.userPrompt,
    negativePrompt: job.negativePrompt,
    voiceMode: job.voiceMode,
    voiceId: job.voiceId,
    voiceName: job.voiceName,
    voiceAmbience: job.voiceAmbience,
    productImages: (job.productImages ?? []).map((u, k) => ({ url: u, name: `produit ${k + 1}` })),
    productDescription: job.productDescription,
    sceneImage: job.sceneImage ? { url: job.sceneImage, name: "décor" } : undefined,
    resolution: job.resolution,
    aspectRatio: job.aspectRatio,
    variants: 1,
  };
}

const TRANSFORMS = Object.keys(TRANSFORM_LABELS) as TransformType[];
const STYLES = Object.keys(STYLE_PROMPTS) as StyleId[];
const VOICE_MODES: VoiceMode[] = ["keep", "transform", "none"];
const AMBIENCES: VoiceAmbience[] = ["room", "close", "far", "raw"];
const RESOLUTIONS: Resolution[] = ["720p", "1080p"];
const ASPECTS: { id: AspectChoice; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "9:16", label: "9:16" },
  { id: "16:9", label: "16:9" },
  { id: "1:1", label: "1:1" },
];
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Filtres de voix, traduits sur les étiquettes ElevenLabs (gender / age). */
const VOICE_STYLES: { id: string; label: string; test: (v: VoiceInfo) => boolean }[] = [
  { id: "all", label: "Naturelle", test: () => true },
  // Sans etiquette d'age (catalogue KIE), le genre suffit a filtrer.
  { id: "f-young", label: "Femme jeune", test: (v) => v.gender === "female" && (!v.age || /young/.test(v.age)) },
  { id: "f-mature", label: "Femme mature", test: (v) => v.gender === "female" && (!v.age || /middle|old|mature/.test(v.age)) },
  { id: "m-young", label: "Homme jeune", test: (v) => v.gender === "male" && (!v.age || /young/.test(v.age)) },
  { id: "m-mature", label: "Homme mature", test: (v) => v.gender === "male" && (!v.age || /middle|old|mature/.test(v.age)) },
];

const isVideoName = (n: string) => /\.(mp4|mov|webm|m4v)$/i.test(n);
const isImageName = (n: string) => /\.(jpe?g|png|webp|jfif|jpe|avif|heic|heif|bmp|gif)$/i.test(n);

function mmss(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r} s`;
}

/** Pastille de choix, dans le style des presets existants du Studio. */
function Chip({ active, onClick, children, title, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={active ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
    >
      {children}
    </button>
  );
}

/* ------------------------------ Zones de dépôt ------------------------------ */

function SourceZone({
  kind,
  media,
  progress,
  onFile,
  onClear,
  onDuration,
  onFrame,
  disabled,
}: {
  kind: "image" | "video";
  media: Media | VideoMedia | null;
  progress: number | null;
  onFile: (f: File) => void;
  onClear: () => void;
  onDuration?: (sec: number) => void;
  /** Vidéo : extraire une image fixe (pour préparer une référence dans la même scène). */
  onFrame?: () => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = kind === "image" ? "image/*,.jfif,.jpe,.heic,.heif,.avif" : "video/*,.mp4,.mov,.webm,.m4v";
  const title = kind === "image" ? "Image de référence" : "Vidéo originale";
  const hint = kind === "image" ? "JPG / PNG / WEBP — le personnage à obtenir" : "MP4 / MOV / WEBM — 100 Mo max";

  const pick = () => { if (!disabled) input.current?.click(); };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      className="rounded-[10px] overflow-hidden flex flex-col"
      style={{
        border: `1.5px ${media ? "solid" : "dashed"} ${over ? "var(--accent)" : media ? "var(--border)" : "var(--border-strong)"}`,
        background: over ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "var(--surface-2)",
        minHeight: 200,
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <span className="label-xs">{kind === "image" ? "Apparence" : "Vidéo"}</span>
        {media && !disabled && (
          <span className="flex gap-1">
            {kind === "video" && onFrame && (
              <button className="btn btn-sm btn-ghost !h-[22px] !px-1.5 !text-[11px]" onClick={onFrame} title="Enregistre une image de ta vidéo : fais-y un swap de visage (onglet Image) et réutilise le résultat comme référence, dans ta scène exacte">
                📷 Image fixe
              </button>
            )}
            <button className="btn btn-sm btn-ghost !h-[22px] !px-1.5 !text-[11px]" onClick={pick}>Remplacer</button>
            <button className="btn btn-sm btn-ghost !h-[22px] !px-1.5 !text-[11px]" onClick={onClear} title="Supprimer">✕</button>
          </span>
        )}
      </div>

      {progress !== null ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 py-6">
          <span className="text-[12.5px] font-medium">Envoi… {Math.round(progress * 100)} %</span>
          <div className="w-full h-[5px] rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
            <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: "var(--accent)", transition: "width .2s" }} />
          </div>
        </div>
      ) : media ? (
        <div className="flex-1 relative grid place-items-center p-2" style={{ minHeight: 170 }}>
          {kind === "image" ? (
            <img src={media.url} alt="" className="rounded-[8px] object-contain" style={{ maxHeight: 220, maxWidth: "100%", background: "var(--surface-3)" }} />
          ) : (
            <>
              <video
                src={media.url}
                controls
                playsInline
                preload="metadata"
                className="rounded-[8px]"
                style={{ maxHeight: 220, maxWidth: "100%", background: "#000" }}
                onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration || 0)}
              />
              {(media as VideoMedia).durationSec > 0 && (
                <span className="absolute top-3 left-3 badge !text-[10.5px]" style={{ background: "var(--surface)" }}>
                  {mmss((media as VideoMedia).durationSec)}
                </span>
              )}
            </>
          )}
          <span className="absolute bottom-2 left-3 right-3 dim text-[11px] truncate text-center" title={media.name}>{media.name}</span>
        </div>
      ) : (
        <button type="button" onClick={pick} disabled={disabled} className="flex-1 flex flex-col items-center justify-center gap-1.5 px-6 py-8 text-center" style={{ cursor: disabled ? "not-allowed" : "pointer" }}>
          <span className="text-[22px]">{kind === "image" ? "🖼" : "🎬"}</span>
          <span className="text-[13.5px] font-medium">{title}</span>
          <span className="dim text-[11.5px]">{hint}</span>
          <span className="dim text-[11px]">Glisse le fichier ici ou clique</span>
        </button>
      )}

      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        disabled={disabled}
        onChange={async (e) => {
          const f = (await takeFiles(e.currentTarget))[0];
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

/* ------------------------------ Composant ------------------------------ */

export function VideoSwap({
  prefill,
  prefillKey,
  jobs,
  onQueued,
  onAdvanced,
}: {
  prefill: SwapPrefill | null;
  prefillKey: number;
  jobs: StudioJob[];
  onQueued: (jobs: StudioJob[]) => void;
  onAdvanced: () => void;
}) {
  const toast = useToast();
  const characters = useCollection<StudioCharacter>("studioCharacters");

  const [image, setImage] = useState<Media | null>(null);
  /** Vues supplementaires du meme personnage (profil, dos, tenue), 2 au plus. */
  const [extraViews, setExtraViews] = useState<Media[]>([]);
  const [viewBusy, setViewBusy] = useState(0);
  const [video, setVideo] = useState<VideoMedia | null>(null);
  const [imgProgress, setImgProgress] = useState<number | null>(null);
  const [vidProgress, setVidProgress] = useState<number | null>(null);

  /* Memorises dans le navigateur : le modele prefere reste le defaut d'une fois sur l'autre. */
  const [transform, setTransform] = useLocalState<TransformType>("swap-transform", "full");
  const [style, setStyle] = useLocalState<StyleId>("swap-style", "ugc");
  const [provider, setProvider] = useLocalState<ProviderChoice>("swap-provider", "seedance25");
  const [userPrompt, setUserPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  /* Voix : transformee par defaut, derniere voix choisie memorisee. */
  const [voiceMode, setVoiceMode] = useLocalState<VoiceMode>("swap-voice-mode", "transform");
  const [voiceId, setVoiceId] = useLocalState<string>("swap-voice", "");
  /* Mode simple (prompt d'abord, a la Higgsfield) ou detaille. */
  const [simple, setSimple] = useLocalState<boolean>("swap-simple", true);
  /* Panneau replie : medias + bouton seulement, pour garder les resultats visibles. */
  const [collapsed, setCollapsed] = useLocalState<boolean>("swap-collapsed", false);
  // Telephone : replie par defaut la premiere fois, sinon le panneau mange tout l'ecran.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("swap-collapsed") === null && window.innerWidth < 768) setCollapsed(true);
    } catch {
      // stockage indisponible : on garde l'etat courant
    }
    // Une seule fois au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [voiceStyle, setVoiceStyle] = useState("all");
  const [voiceAmbience, setVoiceAmbience] = useLocalState<VoiceAmbience>("swap-ambience", "room");
  const [lipSync, setLipSync] = useLocalState<boolean>("swap-lipsync", true);
  const [product, setProduct] = useState<Media[]>([]);
  /* Nouveau lieu (optionnel) : remplace le decor de la video. */
  const [scene, setScene] = useState<Media | null>(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  /* Clonage de voix (Instant Voice Clone ElevenLabs). */
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneMedia, setCloneMedia] = useState<Media | null>(null);
  const [cloneBusy, setCloneBusy] = useState<"upload" | "clone" | null>(null);
  const [productDesc, setProductDesc] = useState("");
  const [productBusy, setProductBusy] = useState(0);
  const [resolution, setResolution] = useLocalState<Resolution>("swap-resolution", "720p");
  const [aspectRatio, setAspectRatio] = useLocalState<AspectChoice>("swap-aspect", "original");
  const [variants, setVariants] = useState(1);

  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [voicesConfigured, setVoicesConfigured] = useState(true);
  const [voiceEngine, setVoiceEngine] = useState<"elevenlabs-sts" | "kie-tts" | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);

  /* Pré-remplissage (Refaire, Utiliser comme référence, chaînage depuis la galerie). */
  useEffect(() => {
    if (!prefill) return;
    if (prefill.sourceVideo) setVideo({ ...prefill.sourceVideo, durationSec: 0 });
    if (prefill.referenceImage) setImage(prefill.referenceImage);
    if (prefill.referenceImages) setExtraViews(prefill.referenceImages.slice(0, 2));
    if (prefill.provider) setProvider(prefill.provider);
    if (prefill.transform) setTransform(prefill.transform);
    if (prefill.style) setStyle(prefill.style);
    if (prefill.userPrompt !== undefined) setUserPrompt(prefill.userPrompt);
    if (prefill.negativePrompt) setNegativePrompt(prefill.negativePrompt);
    if (prefill.voiceMode) setVoiceMode(prefill.voiceMode);
    if (prefill.voiceId !== undefined) setVoiceId(prefill.voiceId);
    if (prefill.voiceAmbience) setVoiceAmbience(prefill.voiceAmbience);
    if (prefill.productImages) setProduct(prefill.productImages);
    if (prefill.productDescription !== undefined) setProductDesc(prefill.productDescription);
    if (prefill.sceneImage !== undefined) setScene(prefill.sceneImage ?? null);
    if (prefill.resolution) setResolution(prefill.resolution);
    if (prefill.aspectRatio) setAspectRatio(prefill.aspectRatio);
    if (prefill.variants) setVariants(prefill.variants);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);

  /* Voix ElevenLabs, chargées à la demande. */
  useEffect(() => {
    if ((voiceMode !== "transform" && !simple) || voices !== null) return;
    void (async () => {
      try {
        const r = await loadVoices();
        setVoices(r.voices);
        setVoicesConfigured(r.configured);
        setVoiceEngine(r.engine ?? null);
        setVoicesError(r.error ?? null);
      } catch (e) {
        setVoices([]);
        setVoicesError((e as Error).message);
      }
    })();
  }, [voiceMode, voices]);

  /* Devis serveur, à chaque changement utile. */
  useEffect(() => {
    const d = video?.durationSec || 0;
    const t = setTimeout(() => {
      const q = new URLSearchParams({
        provider,
        transform,
        durationSec: String(d || 5),
        resolution,
        variants: String(variants),
        product: product.length ? "1" : "0",
      });
      api<Quote>(`/api/studio-ia/quote?${q}`).then(setQuote).catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [provider, transform, video?.durationSec, resolution, variants, product.length]);

  /* ---- Uploads : fichiers locaux vers data/media, avec progression ---- */

  const addViewFiles = async (files: File[]) => {
    const batch = files.filter((f) => isImageName(f.name) || f.type.startsWith("image/")).slice(0, Math.max(0, 2 - extraViews.length));
    if (!batch.length) return;
    setViewBusy((n) => n + batch.length);
    for (const f of batch) {
      try {
        const up = await uploadFile(await toSupportedImage(f));
        setExtraViews((v) => (v.length < 2 ? [...v, { url: up.url, name: f.name }] : v));
      } catch (e) {
        toast((e as Error).message, "err");
      } finally {
        setViewBusy((n) => n - 1);
      }
    }
  };

  const setSceneFile = async (f: File) => {
    if (!isImageName(f.name) && !f.type.startsWith("image/")) { toast("Choisis une image du lieu.", "err"); return; }
    setSceneBusy(true);
    try {
      const up = await uploadFile(await toSupportedImage(f));
      setScene({ url: up.url, name: f.name });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSceneBusy(false);
    }
  };

  /** Consigne structuree ecrite par le modele vision a partir de la video et des references. */
  const enhance = async () => {
    if (!video) { toast("Dépose d'abord ta vidéo.", "err"); return; }
    setEnhancing(true);
    try {
      const r = await api<{ prompt: string }>("/api/studio-ia/enhance", {
        method: "POST",
        body: JSON.stringify({
          sourceVideo: video.url,
          referenceImages: image ? [image.url, ...extraViews.map((v) => v.url)] : [],
          productImages: product.map((p) => p.url),
          productDescription: productDesc,
          sceneImage: scene?.url,
          userPrompt,
        }),
      });
      setUserPrompt(r.prompt);
      toast("Consigne rédigée. Relis-la, ajuste, puis Transformer.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setEnhancing(false);
    }
  };

  const setImageFile = async (f: File) => {
    if (!isImageName(f.name) && !f.type.startsWith("image/")) {
      toast("Choisis une image (JPG, PNG, WEBP).", "err");
      return;
    }
    setImgProgress(0);
    try {
      const norm = await toSupportedImage(f);
      const up = await uploadFile(norm, setImgProgress);
      setImage({ url: up.url, name: f.name });
      setError(null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setImgProgress(null);
    }
  };

  const setVideoFile = async (f: File) => {
    if (!isVideoName(f.name) && !f.type.startsWith("video/")) {
      toast("Choisis une vidéo (MP4, MOV, WEBM).", "err");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      toast(`Vidéo trop lourde (${Math.round(f.size / 1e6)} Mo). Limite : 100 Mo.`, "err");
      return;
    }
    setVidProgress(0);
    try {
      const up = await uploadFile(f, setVidProgress);
      setVideo({ url: up.url, name: f.name, durationSec: 0 });
      setError(null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setVidProgress(null);
    }
  };

  const addProductFiles = async (files: File[]) => {
    const batch = files.filter((f) => isImageName(f.name) || f.type.startsWith("image/")).slice(0, Math.max(0, 4 - product.length));
    if (!batch.length) return;
    setProductBusy((n) => n + batch.length);
    for (const f of batch) {
      try {
        const norm = await toSupportedImage(f);
        const up = await uploadFile(norm);
        setProduct((p) => (p.length < 4 ? [...p, { url: up.url, name: f.name }] : p));
      } catch (e) {
        toast((e as Error).message, "err");
      } finally {
        setProductBusy((n) => n - 1);
      }
    }
  };

  /** Dépôt n'importe où dans le bloc : l'extension décide de la case. */
  /*
   * Ou va un fichier qui arrive sans case precise (depot n'importe ou, Ctrl+V) ?
   * Une video : la video. Une image : le personnage s'il manque, sinon une vue
   * supplementaire (jusqu'a deux), sinon une photo du produit. L'etat est lu
   * dans une ref : le collage vient d'un ecouteur global, pas d'un rendu.
   */
  const slotsRef = useRef({ image, extraViews, product });
  slotsRef.current = { image, extraViews, product };
  const routeFiles = (files: File[], source: "collé" | "déposé") => {
    let views = slotsRef.current.extraViews.length;
    let products = slotsRef.current.product.length;
    let hasImage = Boolean(slotsRef.current.image);
    for (const f of files) {
      if (isVideoName(f.name) || f.type.startsWith("video/")) {
        void setVideoFile(f);
        toast(`Vidéo ${source}e → Vidéo.`);
      } else if (isImageName(f.name) || f.type.startsWith("image/")) {
        if (!hasImage) {
          hasImage = true;
          void setImageFile(f);
          toast(`Image ${source}e → Personnage.`);
        } else if (views < 2) {
          views++;
          void addViewFiles([f]);
          toast(`Image ${source}e → vue supplémentaire du personnage.`);
        } else if (products < 4) {
          products++;
          void addProductFiles([f]);
          toast(`Image ${source}e → Produit.`);
        } else {
          toast("Toutes les cases sont pleines : retire une image d'abord.", "err");
        }
      }
    }
  };

  const onDropAnywhere = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabledAll) return;
    routeFiles(droppedFiles(e), "déposé");
  };

  /* Depot cible sur une case : la case decide, pas la regle generale. */
  const slotDrop = (handler: (files: File[]) => void) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      if (disabledAll) return;
      const files = droppedFiles(e);
      if (files.length) handler(files);
    },
  });

  /* Ctrl+V n'importe ou dans la page pendant que l'onglet Swap est ouvert. */
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const files = clipboardFiles(e);
      if (!files.length) return;
      e.preventDefault();
      routeFiles(files, "collé");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // routeFiles lit l'etat via slotsRef : pas besoin de reabonner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Personnages et voix récents, dérivés de l'historique ---- */

  const savedUrls = useMemo(() => new Set(characters.rows.map((c) => c.imageUrl)), [characters.rows]);
  const recentImages = useMemo(() => {
    const seen = new Set<string>();
    const out: Media[] = [];
    for (const j of jobs) {
      if (!j.referenceImage || seen.has(j.referenceImage) || savedUrls.has(j.referenceImage)) continue;
      seen.add(j.referenceImage);
      out.push({ url: j.referenceImage, name: j.referenceImageName || "référence" });
      if (out.length >= 6) break;
    }
    return out;
  }, [jobs, savedUrls]);

  const recentVoices = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const j of jobs) {
      if (j.voiceMode !== "transform" || !j.voiceId || seen.has(j.voiceId)) continue;
      seen.add(j.voiceId);
      out.push({ id: j.voiceId, name: j.voiceName || j.voiceId });
      if (out.length >= 5) break;
    }
    return out;
  }, [jobs]);

  const filteredVoices = useMemo(() => {
    const f = VOICE_STYLES.find((s) => s.id === voiceStyle) ?? VOICE_STYLES[0];
    const list = (voices ?? []).filter(f.test);
    // Une voix choisie doit rester visible même si le filtre l'exclut.
    if (voiceId && !list.some((v) => v.id === voiceId)) {
      const picked = voices?.find((v) => v.id === voiceId);
      if (picked) list.unshift(picked);
    }
    return list;
  }, [voices, voiceStyle, voiceId]);

  useEffect(() => {
    if (!voices || !voices.length) return;
    if (voiceId && voices.some((v) => v.id === voiceId)) return;
    const female = voices.filter((v) => v.gender === "female");
    const french = (v: VoiceInfo) => v.category !== "premade" && !/american|british|australian|irish|canadian/i.test(v.accent);
    const pick =
      female.find((v) => v.category === "cloned") ??
      female.find((v) => /parisian|french/i.test(v.accent)) ??
      female.find(french) ??
      voices.find((v) => v.category === "cloned") ??
      female[0] ??
      voices[0];
    if (pick) setVoiceId(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices]);

  const selectedVoice = voices?.find((v) => v.id === voiceId) ?? null;
  const voiceName = selectedVoice?.name ?? recentVoices.find((v) => v.id === voiceId)?.name ?? "";

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
  useEffect(() => () => audioRef.current?.pause(), []);

  const cloneFile = async (f: File) => {
    setCloneBusy("upload");
    try {
      const up = await uploadFile(f);
      setCloneMedia({ url: up.url, name: f.name });
      setCloneUrl("");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setCloneBusy(null);
    }
  };

  const runClone = async () => {
    if (!cloneName.trim() || (!cloneUrl.trim() && !cloneMedia)) return;
    setCloneBusy("clone");
    try {
      const r = await api<{ voice: VoiceInfo }>("/api/studio-ia/voices/clone", {
        method: "POST",
        body: JSON.stringify({ name: cloneName.trim(), url: cloneUrl.trim() || undefined, mediaUrl: cloneMedia?.url }),
      });
      forgetVoices();
      setVoices((prev) => [r.voice, ...(prev ?? []).filter((v) => v.id !== r.voice.id)]);
      setVoiceStyle("all");
      setVoiceId(r.voice.id);
      setCloning(false);
      setCloneName("");
      setCloneUrl("");
      setCloneMedia(null);
      toast(`Voix « ${r.voice.name} » clonée et sélectionnée.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setCloneBusy(null);
    }
  };

  const saveCharacter = async () => {
    if (!image || savingName === null) return;
    const name = savingName.trim();
    if (!name) return;
    try {
      await characters.create({ name, imageUrl: image.url });
      setSavingName(null);
      toast(`Personnage « ${name} » enregistré.`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  /* ---- Lancement ---- */

  const ready = Boolean(image && video) && imgProgress === null && vidProgress === null && (voiceMode !== "transform" || Boolean(voiceId));

  const submit = async (mode: "now" | "queue") => {
    if (!image || !video) return;
    setBusy(true);
    setError(null);
    const body: TransformRequest = {
      sourceVideo: video.url,
      sourceVideoName: video.name,
      sourceDurationSec: video.durationSec,
      referenceImage: image.url,
      referenceImageName: image.name,
      referenceImages: extraViews.map((v) => v.url),
      provider,
      transform,
      style,
      userPrompt,
      negativePrompt,
      voiceMode,
      voiceId: voiceMode === "transform" ? voiceId : "",
      voiceName: voiceMode === "transform" ? voiceName : "",
      voiceAmbience,
      lipSync: voiceMode !== "none" && lipSync,
      productImages: product.map((p) => p.url),
      productDescription: productDesc,
      sceneImage: scene?.url ?? "",
      resolution,
      aspectRatio,
      variants,
    };
    try {
      const r = await api<{ jobs: StudioJob[] }>("/api/studio-ia/jobs", { method: "POST", body: JSON.stringify(body) });
      onQueued(r.jobs);
      toast(
        r.jobs.length > 1
          ? `${r.jobs.length} variantes en file. Tu peux préparer la suivante.`
          : mode === "queue" ? "Ajoutée à la file. Dépose la vidéo suivante." : "Transformation lancée. Le résultat arrive dans Résultats.",
      );
      // En mode file, on enchaîne : même personnage, même voix, vidéo suivante.
      if (mode === "queue") setVideo(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disabledAll = busy;

  /*
   * Voix proposees en mode simple : les clonees d'abord, puis les voix
   * francaises (bibliotheque FR). Les voix americaines et britanniques par
   * defaut d'ElevenLabs sonnent faux sur une diction francaise : ecartees.
   */
  const isAnglo = (v: VoiceInfo) => /american|british|australian|irish|canadian/i.test(v.accent);
  const simpleVoices = (voices ?? [])
    .filter((v) => v.category === "cloned" || v.category === "generated" || (!isAnglo(v) && v.category !== "premade"))
    .sort((a, b) => Number(b.category === "cloned") - Number(a.category === "cloned"));

  const attachInput = (accept: string, multiple: boolean, onFiles: (f: File[]) => void) => (
    <input
      type="file"
      hidden
      accept={accept}
      multiple={multiple}
      disabled={disabledAll}
      onChange={async (e) => {
        const files = await takeFiles(e.currentTarget);
        if (files.length) onFiles(files);
      }}
    />
  );

  const thumbStyle = { width: 64, height: 64, border: "1px solid var(--border)", background: "var(--surface-3)" } as const;

  if (simple) {
    return (
      <div
        className="swap-simple flex flex-col gap-3 pt-1 rounded-[14px]"
        data-collapsed={collapsed}
        style={dragging ? { outline: "2px dashed var(--accent)", outlineOffset: 4 } : undefined}
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={onDropAnywhere}
      >
        {/* Boite prompt : medias attaches, phrase, barre d'options. */}
        <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <div className="swap-attachments flex items-center gap-2 flex-wrap">
            {/* Video */}
            {video ? (
              <span className="relative rounded-[10px] overflow-hidden shrink-0" style={thumbStyle} title={video.name}>
                <VideoThumb src={video.url} />
                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5" style={{ background: "rgb(0 0 0 / 0.55)", color: "#fff" }}>
                  Vidéo{video.durationSec ? ` · ${mmss(video.durationSec)}` : ""}
                </span>
                <button type="button" className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[11px]" style={{ width: 16, height: 16, background: "rgb(0 0 0 / 0.62)", color: "#fff" }} onClick={() => setVideo(null)} disabled={disabledAll} title="Retirer">×</button>
              </span>
            ) : (
              <label className="rounded-[10px] grid place-items-center text-center shrink-0" style={{ ...thumbStyle, border: "1.5px dashed var(--border-strong)", cursor: disabledAll ? "not-allowed" : "pointer" }} title="Ta vidéo originale (MP4 / MOV, 100 Mo max). Tu peux aussi la déposer ici ou la coller (Ctrl+V)." {...slotDrop((f) => void setVideoFile(f[0]))}>
                {vidProgress !== null ? <span className="text-[10px] num">{Math.round(vidProgress * 100)} %</span> : <span className="text-[10px] leading-tight">🎬<br />Vidéo</span>}
                {attachInput("video/*,.mp4,.mov,.webm,.m4v", false, (f) => void setVideoFile(f[0]))}
              </label>
            )}
            {/* Personnage : vue principale + autres vues */}
            {image ? (
              <span className="relative rounded-[10px] overflow-hidden shrink-0" style={thumbStyle} title={image.name}>
                <ThumbImg src={image.url} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5" style={{ background: "rgb(0 0 0 / 0.55)", color: "#fff" }}>Personnage</span>
                <button type="button" className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[11px]" style={{ width: 16, height: 16, background: "rgb(0 0 0 / 0.62)", color: "#fff" }} onClick={() => { setImage(null); setExtraViews([]); }} disabled={disabledAll} title="Retirer">×</button>
              </span>
            ) : (
              <label className="rounded-[10px] grid place-items-center text-center shrink-0" style={{ ...thumbStyle, border: "1.5px dashed var(--border-strong)", cursor: disabledAll ? "not-allowed" : "pointer" }} title="La personne à obtenir (JPG / PNG). Dépose une image ici, ou colle une capture (Ctrl+V)." {...slotDrop((f) => void setImageFile(f[0]))}>
                {imgProgress !== null ? <span className="text-[10px] num">{Math.round(imgProgress * 100)} %</span> : <span className="text-[10px] leading-tight">🖼<br />Personnage</span>}
                {attachInput("image/*,.jfif,.jpe,.heic,.heif,.avif", false, (f) => void setImageFile(f[0]))}
              </label>
            )}
            {image && extraViews.map((v, k) => (
              <span key={v.url + k} className="relative rounded-[10px] overflow-hidden shrink-0" style={thumbStyle} title={v.name}>
                <ThumbImg src={v.url} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5" style={{ background: "rgb(0 0 0 / 0.55)", color: "#fff" }}>Vue {k + 2}</span>
                <button type="button" className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[11px]" style={{ width: 16, height: 16, background: "rgb(0 0 0 / 0.62)", color: "#fff" }} onClick={() => setExtraViews((arr) => arr.filter((_, j) => j !== k))} disabled={disabledAll}>×</button>
              </span>
            ))}
            {/* Les vues supplementaires restent disponibles en mode detaille : une planche 3 vues suffit ici. */}
            {/* Produit */}
            {product.map((pImg, k) => (
              <span key={pImg.url + k} className="relative rounded-[10px] overflow-hidden shrink-0" style={thumbStyle} title={pImg.name}>
                <ThumbImg src={pImg.url} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5" style={{ background: "rgb(0 0 0 / 0.55)", color: "#fff" }}>Produit</span>
                <button type="button" className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[11px]" style={{ width: 16, height: 16, background: "rgb(0 0 0 / 0.62)", color: "#fff" }} onClick={() => setProduct((arr) => arr.filter((_, j) => j !== k))} disabled={disabledAll}>×</button>
              </span>
            ))}
            {product.length + productBusy < 4 && (
              <label className="rounded-[10px] grid place-items-center text-center shrink-0" style={{ ...thumbStyle, border: "1.5px dashed var(--border-strong)", cursor: disabledAll ? "not-allowed" : "pointer", opacity: product.length ? 1 : 0.75 }} title="Photos du produit tenu en main (2 à 4) : il est reproduit à l'identique. Dépose-les ici." {...slotDrop((f) => void addProductFiles(f))}>
                {productBusy > 0 ? <span className="spinner" /> : <span className="text-[10px] leading-tight">📦<br />{product.length ? "+ photo" : "Produit"}</span>}
                {attachInput("image/*,.jfif,.jpe,.heic,.heif,.avif", true, (f) => void addProductFiles(f))}
              </label>
            )}
            {/* Decor : photo d'un nouveau lieu (optionnel) */}
            {scene ? (
              <span className="relative rounded-[10px] overflow-hidden shrink-0" style={thumbStyle} title={`Nouveau décor : ${scene.name}`}>
                <ThumbImg src={scene.url} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5" style={{ background: "rgb(0 0 0 / 0.55)", color: "#fff" }}>Décor</span>
                <button type="button" className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[11px]" style={{ width: 16, height: 16, background: "rgb(0 0 0 / 0.62)", color: "#fff" }} onClick={() => setScene(null)} disabled={disabledAll}>×</button>
              </span>
            ) : (
              <label className="rounded-[10px] grid place-items-center text-center shrink-0" style={{ ...thumbStyle, border: "1.5px dashed var(--border-strong)", cursor: disabledAll ? "not-allowed" : "pointer", opacity: 0.75 }} title="Photo d'un autre lieu : le décor de ta vidéo est remplacé par celui-ci (Seedance, Kling Omni, Genjutsu). Sans photo, ton décor est gardé. Dépose-la ici." {...slotDrop((f) => void setSceneFile(f[0]))}>
                {sceneBusy ? <span className="spinner" /> : <span className="text-[10px] leading-tight">🏠<br />Décor</span>}
                {attachInput("image/*,.jfif,.jpe,.heic,.heif,.avif", false, (f) => void setSceneFile(f[0]))}
              </label>
            )}
          </div>

          {product.length > 0 && (
            <input className="input !h-[32px] !text-[12px]" placeholder="Le produit en quelques mots : ex. vape NASTY rose, embout vert, logo NASTY" value={productDesc} disabled={disabledAll} onChange={(e) => setProductDesc(e.target.value)} />
          )}

          {!collapsed && (
            <>
          <div className="relative">
            <textarea
              className="textarea"
              style={{ minHeight: 96, background: "var(--surface)", paddingBottom: 34 }}
              placeholder="Remplace-moi par la personne des références. Ex. : peignoir blanc en éponge, serviette sur les cheveux, sortie de douche."
              value={userPrompt}
              disabled={disabledAll}
              onChange={(e) => setUserPrompt(e.target.value)}
            />
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
              <button type="button" className="btn btn-sm !h-[24px] !text-[11px]" onClick={() => void enhance()} disabled={disabledAll || enhancing || !video} title="Analyse ta vidéo et tes références, puis écrit une consigne structurée (plan par plan, décor, lumière) avec les balises @Video 1 / @Image N">
                {enhancing ? <span className="spinner" /> : "✨ Rédiger la consigne"}
              </button>
              {userPrompt && <button type="button" className="btn btn-sm btn-ghost !h-[24px] !text-[11px]" onClick={() => setUserPrompt("")} disabled={disabledAll}>Effacer</button>}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select className="select !w-auto !h-[32px] !text-[12px] !py-0" value={provider} disabled={disabledAll} onChange={(e) => setProvider(e.target.value as ProviderChoice)} title="Modèle">
              <option value="auto">Auto ✨{quote && provider === "auto" ? ` (${quote.providerLabel})` : ""}</option>
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>{PROVIDERS[id].label}</option>
              ))}
            </select>
            <div className="inline-flex rounded-full p-0.5" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
              {RESOLUTIONS.map((r) => (
                <button key={r} type="button" className="px-2.5 h-[26px] rounded-full text-[12px]" disabled={disabledAll} onClick={() => setResolution(r)} style={resolution === r ? { background: "var(--accent)", color: "var(--accent-on)" } : undefined}>{r}</button>
              ))}
            </div>
            <select
              className="select !w-auto !max-w-[260px] !h-[32px] !text-[12px] !py-0"
              value={voiceMode === "transform" ? voiceId : "__keep"}
              disabled={disabledAll}
              onChange={(e) => {
                if (e.target.value === "__keep") { setVoiceMode("keep"); return; }
                if (e.target.value === "__none") { setVoiceMode("none"); return; }
                setVoiceMode("transform");
                setVoiceId(e.target.value);
              }}
              title="Ta voix est convertie en speech-to-speech : mêmes mots, même rythme, timbre de la voix choisie"
            >
              <option value="__keep">🎙 Ma voix, inchangée</option>
              <option value="__none">🔇 Sans audio</option>
              {simpleVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  ✨ Voix : {v.name}{v.category === "cloned" ? " (clonée)" : ""}
                </option>
              ))}
            </select>
            {provider !== "auto" && PROVIDERS[provider].preservesMouth ? (
              <span className="dim text-[12px]" title="Ce modèle édite ta vidéo : ta bouche et ton timing sont conservés, la voix convertie garde ton rythme. Aucune passe lèvres nécessaire.">
                Lèvres : gardées par {PROVIDERS[provider].label}
              </span>
            ) : (
              <label className="inline-flex items-center gap-1.5 text-[12px] cursor-pointer" title="Une passe KIE refait la bouche sur la voix finale. Recommandé avec Seedance et Kling.">
                <input type="checkbox" checked={lipSync} disabled={disabledAll || voiceMode === "none"} onChange={(e) => setLipSync(e.target.checked)} />
                Lèvres synchro
              </label>
            )}
            <div className="inline-flex items-center rounded-full ml-auto" style={{ border: "1px solid var(--border)", background: "var(--surface)" }} title="Variantes">
              <button className="btn btn-sm btn-ghost !h-[26px] !px-2" disabled={disabledAll || variants <= 1} onClick={() => setVariants((v) => Math.max(1, v - 1))}>−</button>
              <span className="num text-[12px] font-medium w-[18px] text-center">{variants}</span>
              <button className="btn btn-sm btn-ghost !h-[26px] !px-2" disabled={disabledAll || variants >= MAX_VARIANTS} onClick={() => setVariants((v) => Math.min(MAX_VARIANTS, v + 1))}>+</button>
            </div>
          </div>
            </>
          )}

          {voiceMode === "transform" && voices !== null && !voicesConfigured && (
            <span className="text-[11.5px]" style={{ color: "var(--warning)" }}>Aucune clé ElevenLabs : la voix ne pourra pas être transformée (Réglages → Voix).</span>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          {collapsed && (
            <p className="swap-summary dim text-[11.5px] truncate" title={userPrompt}>
              {userPrompt ? `Consigne : ${userPrompt}` : "Sans consigne · "}{PROVIDERS[provider === "auto" ? (quote?.provider ?? "seedance25") : provider].label} · {resolution}
              {voiceMode === "transform" && selectedVoice ? ` · voix ${selectedVoice.name}` : voiceMode === "keep" ? " · ma voix" : " · sans audio"}
            </p>
          )}

          <div className="swap-actions flex items-center justify-between gap-3 flex-wrap">
            <span className="swap-quote dim text-[12px] leading-snug">
              {quote ? (
                quote.billedBy
                  ? <>≈ {fmtUsd(quote.usd)} · {quote.billedBy}{quote.variants > 1 ? ` · ${quote.variants} vidéos` : ""}</>
                  : <><span className="font-medium" style={{ color: "var(--text)" }}>{quote.verified ? "" : "≈ "}{fmtInt(quote.credits)} crédits</span> · {fmtUsd(quote.usd)}{quote.variants > 1 ? ` · ${quote.variants} vidéos` : ""} · {quote.providerLabel}</>
              ) : "Dépose une vidéo pour voir le coût."}
              {voiceMode === "transform" && selectedVoice && <> · voix {selectedVoice.name}</>}
            </span>
            <span className="flex items-center gap-2">
              <button className="btn btn-sm btn-ghost" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Afficher la consigne et les options" : "Réduire : garder seulement les médias et le bouton"}>
                {collapsed ? "▴ Ouvrir" : "▾ Réduire"}
              </button>
              <button className="btn" onClick={() => void submit("queue")} disabled={!ready || busy} title="Lance et garde le personnage : tu déposes la vidéo suivante">+ File</button>
              <button className="btn btn-primary" onClick={() => void submit("now")} disabled={!ready || busy}>
                {busy ? <span className="spinner" /> : "✨"} {variants > 1 ? `Générer ${variants} variantes` : "Transformer"}
              </button>
            </span>
          </div>
        </div>

        {(characters.rows.length > 0 || recentImages.length > 0) && (
          <div className="swap-extras flex items-center gap-1.5 flex-wrap">
            <span className="label-xs mr-1">Personnages récents</span>
            {characters.rows.map((c) => (
              <button key={c.id} type="button" className="rounded-[8px] overflow-hidden shrink-0" style={{ width: 40, height: 48, border: `2px solid ${image?.url === c.imageUrl ? "var(--accent)" : "var(--border)"}` }} title={c.name} onClick={() => { setImage({ url: c.imageUrl, name: c.name }); setExtraViews([]); }}>
                <ThumbImg src={c.imageUrl} className="w-full h-full object-cover" />
              </button>
            ))}
            {recentImages.map((m) => (
              <button key={m.url} type="button" className="rounded-[8px] overflow-hidden shrink-0" style={{ width: 40, height: 48, border: `2px solid ${image?.url === m.url ? "var(--accent)" : "var(--border)"}` }} title={m.name} onClick={() => { setImage(m); setExtraViews([]); }}>
                <ThumbImg src={m.url} className="w-full h-full object-cover" />
              </button>
            ))}
            {image && !savedUrls.has(image.url) && (
              savingName === null ? (
                <button className="btn btn-sm btn-ghost" onClick={() => setSavingName("")}>+ Enregistrer</button>
              ) : (
                <span className="flex gap-1">
                  <input className="input !h-[26px] !text-[12px] !w-[130px]" placeholder="Nom" autoFocus value={savingName} onChange={(e) => setSavingName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveCharacter(); if (e.key === "Escape") setSavingName(null); }} />
                  <button className="btn btn-sm btn-primary" onClick={() => void saveCharacter()} disabled={!savingName.trim()}>OK</button>
                </span>
              )
            )}
          </div>
        )}

        <div className="swap-extras flex items-center gap-3 text-[11.5px]">
          <button type="button" className="link" onClick={() => setSimple(false)}>Mode détaillé (préréglages, style, rendu voix, produit, guide des modèles)</button>
          <span className="dim">·</span>
          <button type="button" className="link" onClick={onAdvanced}>Formulaire avancé</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-1" onDragOver={(e) => e.preventDefault()} onDrop={onDropAnywhere}>
      {/* A. Sources */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <SourceZone kind="image" media={image} progress={imgProgress} onFile={(f) => void setImageFile(f)} onClear={() => { setImage(null); setExtraViews([]); }} disabled={disabledAll} />
          {image && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="label-xs mr-1" title="Comme dans l'interface Higgsfield : face, dos, tenue. Les modèles multi-images les reçoivent toutes, les autres une planche assemblée.">Autres vues</span>
              {extraViews.map((v, k) => (
                <span key={v.url + k} className="relative rounded-[8px] overflow-hidden shrink-0" style={{ width: 44, height: 56, border: "1px solid var(--border)" }} title={v.name}>
                  <ThumbImg src={v.url} className="w-full h-full object-cover" />
                  <button type="button" className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[10px]" style={{ width: 15, height: 15, background: "rgb(0 0 0 / 0.62)", color: "#fff" }} onClick={() => setExtraViews((arr) => arr.filter((_, j) => j !== k))} disabled={disabledAll}>×</button>
                </span>
              ))}
              {Array.from({ length: viewBusy }).map((_, k) => (
                <span key={`vb-${k}`} className="rounded-[8px] grid place-items-center shrink-0" style={{ width: 44, height: 56, background: "var(--surface-3)" }}><span className="spinner" /></span>
              ))}
              {extraViews.length < 2 && (
                <label className="btn btn-sm" style={{ cursor: disabledAll ? "not-allowed" : "pointer" }} title="Profil, dos ou tenue complète du même personnage">
                  + dos / tenue
                  <input type="file" hidden multiple accept="image/*,.jfif,.jpe,.heic,.heif,.avif" disabled={disabledAll} onChange={async (e) => { const files = await takeFiles(e.currentTarget); if (files.length) void addViewFiles(files); }} />
                </label>
              )}
            </div>
          )}
          {(characters.rows.length > 0 || recentImages.length > 0 || image) && (
            <div className="flex flex-col gap-1.5">
              <span className="label-xs">Personnages récents</span>
              <div className="flex gap-1.5 flex-wrap items-start">
                {characters.rows.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="relative rounded-[8px] overflow-hidden shrink-0 text-left"
                    style={{ width: 52, border: `2px solid ${image?.url === c.imageUrl ? "var(--accent)" : "var(--border)"}` }}
                    title={`${c.name} — clic droit pour supprimer`}
                    onClick={() => setImage({ url: c.imageUrl, name: c.name })}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (window.confirm(`Supprimer le personnage « ${c.name} » ?`)) void characters.destroy(c.id);
                    }}
                  >
                    <ThumbImg src={c.imageUrl} className="w-full object-cover" style={{ height: 62 }} />
                    <span className="block text-[9.5px] px-1 py-0.5 truncate" style={{ background: "var(--surface)" }}>{c.name}</span>
                  </button>
                ))}
                {recentImages.map((m) => (
                  <button
                    key={m.url}
                    type="button"
                    className="rounded-[8px] overflow-hidden shrink-0"
                    style={{ width: 52, height: 62, border: `2px solid ${image?.url === m.url ? "var(--accent)" : "var(--border)"}` }}
                    title={m.name}
                    onClick={() => setImage(m)}
                  >
                    <ThumbImg src={m.url} className="w-full h-full object-cover" />
                  </button>
                ))}
                {image && !savedUrls.has(image.url) && (
                  savingName === null ? (
                    <button className="btn btn-sm self-center" onClick={() => setSavingName("")}>+ Enregistrer comme personnage</button>
                  ) : (
                    <span className="flex gap-1 self-center">
                      <input
                        className="input !h-[28px] !text-[12px] !w-[150px]"
                        placeholder="Nom (ex. Sofia)"
                        autoFocus
                        value={savingName}
                        onChange={(e) => setSavingName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void saveCharacter(); if (e.key === "Escape") setSavingName(null); }}
                      />
                      <button className="btn btn-sm btn-primary" onClick={() => void saveCharacter()} disabled={!savingName.trim()}>OK</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setSavingName(null)}>✕</button>
                    </span>
                  )
                )}
              </div>
            </div>
          )}
        </div>
        <SourceZone
          kind="video"
          media={video}
          progress={vidProgress}
          onFile={(f) => void setVideoFile(f)}
          onClear={() => setVideo(null)}
          onDuration={(sec) => setVideo((v) => (v && v.durationSec !== sec ? { ...v, durationSec: sec } : v))}
          onFrame={() => {
            if (!video) return;
            void api<{ url: string }>("/api/studio-ia/frame", { method: "POST", body: JSON.stringify({ url: video.url }) })
              .then((r) => {
                window.open(`${r.url}?download=1&name=image-fixe.jpg`, "_blank");
                toast("Image fixe enregistrée. Onglet Image → Swap de visage : scène = cette image, visage = la fille, puis « Utiliser pour le swap ».");
              })
              .catch((e: Error) => toast(e.message, "err"));
          }}
          disabled={disabledAll}
        />
      </div>

      {/* B. Type de transformation */}
      <Field label="Transformation">
        <div className="flex gap-1.5 flex-wrap">
          {TRANSFORMS.map((t) => (
            <Chip key={t} active={transform === t} onClick={() => setTransform(t)} disabled={disabledAll}>{TRANSFORM_LABELS[t]}</Chip>
          ))}
        </div>
      </Field>

      {/* Produit tenu en main : ses photos le protègent (Kling 3.0 Omni, éléments). */}
      <Field
        label="Produit en main (optionnel)"
        hint={
          product.length
            ? "Le produit est envoyé en référence (Kling 3.0 Omni ou Seedance 2) et reproduit à l'identique : étiquette, couleurs, texte. Photos du produit seul, nettes, bien éclairées. 15 s de vidéo maximum."
            : "Si tu tiens un produit dans la vidéo, ajoute 2 à 4 photos nettes de ce produit : c'est ce qui le garde intact. Sans photos, il peut être réinventé."
        }
      >
        <div className="flex gap-2 items-center flex-wrap">
          {product.map((p, k) => (
            <span key={p.url + k} className="relative rounded-[8px] overflow-hidden shrink-0" style={{ width: 60, height: 60, border: "1px solid var(--border)", background: "var(--surface-3)" }} title={p.name}>
              <ThumbImg src={p.url} className="w-full h-full object-cover" />
              <button type="button" className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[11px]" style={{ width: 17, height: 17, background: "rgb(0 0 0 / 0.62)", color: "#fff" }} onClick={() => setProduct((arr) => arr.filter((_, j) => j !== k))} disabled={disabledAll}>×</button>
            </span>
          ))}
          {Array.from({ length: productBusy }).map((_, k) => (
            <span key={`pb-${k}`} className="rounded-[8px] grid place-items-center shrink-0" style={{ width: 60, height: 60, background: "var(--surface-3)" }}><span className="spinner" /></span>
          ))}
          {product.length < 4 && (
            <label className="rounded-[8px] flex flex-col items-center justify-center shrink-0" style={{ width: 60, height: 60, border: "1px dashed var(--border-strong)", cursor: disabledAll ? "not-allowed" : "pointer" }}>
              <span className="text-[16px] dim leading-none">+</span>
              <span className="dim text-[9.5px]">produit</span>
              <input type="file" hidden multiple accept="image/*,.jfif,.jpe,.heic,.heif,.avif" disabled={disabledAll} onChange={async (e) => { const files = await takeFiles(e.currentTarget); if (files.length) void addProductFiles(files); }} />
            </label>
          )}
          {product.length > 0 && (
            <input
              className="input !h-[34px] !text-[12px] flex-1 min-w-[220px]"
              placeholder="Décris-le en quelques mots : ex. flacon de sérum orange BYOMA, bouchon blanc"
              value={productDesc}
              disabled={disabledAll}
              onChange={(e) => setProductDesc(e.target.value)}
            />
          )}
        </div>
      </Field>

      {/* D. Style + consigne */}
      <div className="flex gap-1.5 flex-wrap">
        {STYLES.map((s) => (
          <Chip key={s} active={style === s} onClick={() => setStyle(s)} disabled={disabledAll} title={STYLE_PROMPTS[s].prompt}>{STYLE_PROMPTS[s].label}</Chip>
        ))}
      </div>
      <Field label="Consigne" hint="Optionnel. La consigne technique (garder mouvement, caméra, décor, timing) est ajoutée automatiquement.">
        <textarea
          className="textarea"
          style={{ minHeight: 76 }}
          placeholder="Ex. Transforme-moi en jeune femme brune de 24 ans portant une tenue de sport noire."
          value={userPrompt}
          disabled={disabledAll}
          onChange={(e) => setUserPrompt(e.target.value)}
        />
      </Field>

      {/* E. Negative prompt */}
      <Field label="À éviter">
        <input className="input !text-[12px]" value={negativePrompt} disabled={disabledAll} onChange={(e) => setNegativePrompt(e.target.value)} />
      </Field>

      {/* F. Voix */}
      <Field label="Son">
        <div className="flex flex-col gap-2.5">
          <div className="flex gap-1.5 flex-wrap">
            {VOICE_MODES.map((m) => (
              <Chip key={m} active={voiceMode === m} onClick={() => setVoiceMode(m)} disabled={disabledAll}>
                {VOICE_MODE_LABEL[m]}{m === "transform" ? " ✨" : ""}
              </Chip>
            ))}
          </div>

          {voiceMode !== "none" && (
            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer">
              <input type="checkbox" className="mt-[3px]" checked={lipSync} onChange={(e) => setLipSync(e.target.checked)} disabled={disabledAll} />
              <span>
                <span className="font-medium">Synchroniser les lèvres (IA)</span>
                <span className="dim block text-[11.5px] leading-snug">
                  Recommandé avec Seedance et Kling, qui rejouent la bouche approximativement : une passe KIE refait les lèvres sur la voix finale. Étape en plus après l&apos;assemblage, tarif KIE non encore relevé.
                </span>
              </span>
            </label>
          )}

          {voiceMode === "transform" && (
            <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              {voices === null ? (
                <span className="dim text-[12px]"><span className="spinner" /> Chargement des voix ElevenLabs…</span>
              ) : !voicesConfigured ? (
                <span className="text-[12px]" style={{ color: "var(--warning)" }}>
                  Aucune clé ElevenLabs ni KIE : ajoute-en une dans Réglages pour transformer la voix.
                </span>
              ) : voicesError ? (
                <span className="flex items-center gap-2 flex-wrap text-[12px]" style={{ color: "var(--warning)" }}>
                  {voicesError}
                  <button className="btn btn-sm" onClick={() => { setVoicesError(null); setVoices(null); }}>↻ Réessayer</button>
                </span>
              ) : (
                <>
                  {voiceEngine === "kie-tts" && (
                    <span className="text-[11.5px] leading-snug" style={{ color: "var(--text-2)" }}>
                      Mode KIE : KIE n&apos;expose pas le voice changer ElevenLabs. Pour garder ton rythme et ton intonation
                      exacts, ajoute une clé ElevenLabs directe dans Réglages.
                    </span>
                  )}
                  {recentVoices.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap items-center">
                      <span className="label-xs mr-1">Récentes</span>
                      {recentVoices.map((v) => (
                        <Chip key={v.id} active={voiceId === v.id} onClick={() => setVoiceId(v.id)} disabled={disabledAll}>{v.name}</Chip>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5 flex-wrap items-center">
                    <span className="label-xs mr-1">Style</span>
                    {VOICE_STYLES.map((s) => (
                      <Chip key={s.id} active={voiceStyle === s.id} onClick={() => setVoiceStyle(s.id)} disabled={disabledAll}>{s.label}</Chip>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select className="select !w-auto !min-w-[240px] !h-[34px] !text-[12.5px] !py-0" value={voiceId} disabled={disabledAll} onChange={(e) => setVoiceId(e.target.value)}>
                      <option value="">Choisir une voix ElevenLabs…</option>
                      {filteredVoices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.gender || v.age ? ` — ${[v.gender, v.age, v.accent].filter(Boolean).join(", ")}` : ""}
                          {voiceEngine === "elevenlabs-sts" && v.category && v.category !== "premade" ? ` · ${v.category === "cloned" ? "clonée" : v.category === "generated" ? "générée" : "bibliothèque"}` : ""}
                        </option>
                      ))}
                    </select>
                    {selectedVoice?.previewUrl && (
                      <button className="btn btn-sm" onClick={() => preview(selectedVoice)}>
                        {playing === selectedVoice.id ? "■ Stop" : "▶ Pré-écouter"}
                      </button>
                    )}
                    {voiceEngine === "elevenlabs-sts" && (
                      <button className="btn btn-sm" onClick={() => setCloning((v) => !v)} disabled={disabledAll} title="Copier la voix d'une vidéo (TikTok, reel, YouTube) ou d'un fichier">
                        {cloning ? "Fermer" : "+ Cloner une voix"}
                      </button>
                    )}
                  {cloning && (
                    <div className="flex flex-col gap-2 rounded-[9px] p-2.5" style={{ background: "var(--surface)", border: "1px dashed var(--border-strong)" }}>
                      <span className="text-[12px] font-medium">Cloner une voix (Instant Voice Clone)</span>
                      <span className="dim text-[11.5px] leading-snug">
                        Colle le lien d&apos;une vidéo où la voix parle seule 10 s ou plus, ou dépose un mp3 / mp4. Une voix copiée sonne mieux qu&apos;une voix par défaut.
                      </span>
                      <div className="flex gap-2 flex-wrap items-center">
                        <input className="input !h-[32px] !text-[12px] !w-[180px]" placeholder="Nom (ex. Sofia UGC)" value={cloneName} onChange={(e) => setCloneName(e.target.value)} disabled={cloneBusy !== null} />
                        <input className="input !h-[32px] !text-[12px] flex-1 min-w-[220px]" placeholder="Lien TikTok, Instagram, YouTube…" value={cloneUrl} onChange={(e) => { setCloneUrl(e.target.value); if (e.target.value) setCloneMedia(null); }} disabled={cloneBusy !== null} />
                        <span className="dim text-[11px]">ou</span>
                        {cloneMedia ? (
                          <span className="flex items-center gap-1 text-[12px] rounded-[7px] px-2 h-[32px]" style={{ background: "var(--surface-2)" }}>
                            <span className="truncate max-w-[160px]">{cloneMedia.name}</span>
                            <button className="btn btn-sm btn-ghost !h-[22px] !px-1" onClick={() => setCloneMedia(null)}>✕</button>
                          </span>
                        ) : (
                          <label className="btn btn-sm" style={{ cursor: cloneBusy ? "not-allowed" : "pointer" }}>
                            {cloneBusy === "upload" ? <span className="spinner" /> : "Fichier"}
                            <input type="file" hidden accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov" disabled={cloneBusy !== null} onChange={async (e) => { const f = (await takeFiles(e.currentTarget))[0]; if (f) void cloneFile(f); }} />
                          </label>
                        )}
                        <button className="btn btn-sm btn-primary" onClick={() => void runClone()} disabled={cloneBusy !== null || !cloneName.trim() || (!cloneUrl.trim() && !cloneMedia)}>
                          {cloneBusy === "clone" ? <span className="spinner" /> : "Cloner"}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-1.5 flex-wrap items-center">
                    <span className="label-xs mr-1" title="La voix est recalée sur ton attaque, mise à distance dans la pièce, calée sur ton niveau, et ton bruit de fond réel est remis dessous.">Rendu</span>
                    {AMBIENCES.map((a) => (
                      <Chip key={a} active={voiceAmbience === a} onClick={() => setVoiceAmbience(a)} disabled={disabledAll}>{VOICE_AMBIENCE_LABEL[a]}</Chip>
                    ))}
                  </div>
                    <span className="dim text-[11px]">
                      {filteredVoices.length} voix ·{" "}
                      {voiceEngine === "kie-tts"
                        ? "via KIE : tes mots sont transcrits puis relus par la voix (ton intonation exacte n'est pas gardée)"
                        : "speech-to-speech : mêmes mots et rythme, autre timbre"}
                      {voiceEngine === "elevenlabs-sts" && " · plan gratuit : seules les voix sans mention « bibliothèque » passent par l'API"}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Field>

      {/* C + G. Modèle et options rapides */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <label className="flex flex-col gap-1">
          <span className="label-xs">Modèle</span>
          <select className="select !w-auto !h-[34px] !text-[12px] !py-0" value={provider} disabled={disabledAll} onChange={(e) => setProvider(e.target.value as ProviderChoice)}>
            <option value="auto">Auto ✨{quote && provider === "auto" ? ` (${quote.providerLabel})` : ""}</option>
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>{PROVIDERS[id].label}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <span className="label-xs">Résolution</span>
          <div className="flex gap-1.5">
            {RESOLUTIONS.map((r) => <Chip key={r} active={resolution === r} onClick={() => setResolution(r)} disabled={disabledAll}>{r}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="label-xs">Format</span>
          <div className="flex gap-1.5">
            {ASPECTS.map((a) => <Chip key={a.id} active={aspectRatio === a.id} onClick={() => setAspectRatio(a.id)} disabled={disabledAll}>{a.label}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="label-xs">Variantes</span>
          <div className="inline-flex items-center rounded-full" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
            <button className="btn btn-sm btn-ghost !h-[30px] !px-2.5" disabled={disabledAll || variants <= 1} onClick={() => setVariants((v) => Math.max(1, v - 1))}>−</button>
            <span className="num text-[13px] font-medium w-[22px] text-center">{variants}</span>
            <button className="btn btn-sm btn-ghost !h-[30px] !px-2.5" disabled={disabledAll || variants >= MAX_VARIANTS} onClick={() => setVariants((v) => Math.min(MAX_VARIANTS, v + 1))}>+</button>
          </div>
        </div>
      </div>

      {provider !== "auto" && (
        <p className="dim text-[11.5px] -mt-1">{PROVIDERS[provider].blurb}</p>
      )}

      <details className="rounded-[10px] px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <summary className="text-[12.5px] font-medium cursor-pointer">Quel modèle pour quel type de vidéo ?</summary>
        <ul className="mt-2 flex flex-col gap-1.5">
          {(["seedance", "seedance25", "genjutsu", "kling", "wanAnimate", "klingMotion", "klingMotion26", "wan", "flashOmni"] as const).map((id) => (
            <li key={id} className="text-[12px] leading-snug">
              <span className="font-medium">{PROVIDERS[id].label}</span>
              <span className="dim"> · {PROVIDERS[id].creditsPerSec["720p"]} cr/s</span>
              <span> — {PROVIDERS[id].bestFor}</span>
              <span className="dim"> À éviter : {PROVIDERS[id].avoidFor}</span>
            </li>
          ))}
          <li className="text-[12px] leading-snug">
            <span className="font-medium">Photo qui parle (InfiniteTalk)</span>
            <span> — onglet à part : une photo + un texte ou un audio, lèvres générées depuis la voix, aucune vidéo à tourner.</span>
          </li>
        </ul>
      </details>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* H. Bouton principal */}
      <div className="flex items-center justify-between gap-3 pt-3 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
        <span className="dim text-[12px] leading-snug">
          {quote ? (
            <>
              {quote.billedBy ? (
                <span className="font-medium" style={{ color: "var(--text)" }}>≈ {fmtUsd(quote.usd)} facturés par {quote.billedBy}</span>
              ) : (
                <>
                  <span className="font-medium" style={{ color: "var(--text)" }}>
                    {quote.verified ? "" : "≈ "}{fmtInt(quote.credits)} crédits
                  </span>
                  {" "}· {fmtUsd(quote.usd)}
                </>
              )}
              {quote.variants > 1 && <> · {quote.variants} vidéos</>}
              <br />
              <span className="opacity-80">
                {quote.providerLabel} · {quote.durationSec} s · {resolution}
                {!quote.verified && " · tarif estimé"}
                {quote.billedBy && " · pas de crédits KIE"}
              </span>
            </>
          ) : (
            "Dépose une vidéo pour voir le coût."
          )}
          <br />
          <button type="button" className="link text-[11.5px]" onClick={() => setSimple(true)}>← Mode simple</button>
          <span className="dim text-[11.5px]"> · </span>
          <button type="button" className="link text-[11.5px]" onClick={onAdvanced}>Formulaire avancé (tous les modèles)</button>
        </span>
        <span className="flex items-center gap-2">
          <button className="btn" onClick={() => void submit("queue")} disabled={!ready || busy} title="Lance et garde le personnage : tu déposes la vidéo suivante">
            + Ajouter à la file
          </button>
          <button className="btn btn-primary" onClick={() => void submit("now")} disabled={!ready || busy}>
            {busy ? <span className="spinner" /> : "✨"} {variants > 1 ? `Générer ${variants} variantes` : "Transformer"}
          </button>
        </span>
      </div>
    </div>
  );
}
