"use client";

/**
 * Montage : une timeline simple pour fabriquer des créas vidéo.
 *
 * Des clips mis bout à bout (coupés, raccourcis par les bords, réordonnés), des
 * textes façon TikTok et des emojis iPhone qu'on déplace à la souris sur
 * l'aperçu, une musique de fond. L'export se fait sur le serveur avec ffmpeg, à
 * la résolution et à la cadence du premier clip : même qualité que les sources.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Download, FolderUp, Loader2, Music, Pause, Play, Plus, Scissors, Smile, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { APPLE_EMOJIS } from "@/lib/studio/apple-emoji";
import { renderOverlayPng } from "@/lib/montage/render";
import {
  appleEmoji,
  clipAt,
  clipLength,
  emojiUnified,
  newId,
  splitAt,
  textParts,
  totalLength,
  type MontageClip,
  type MontageMusic,
  type MontageOverlay,
  type MontageText,
  type TextStyle,
} from "@/lib/montage/timeline";
import { currentWorkspace, workspaceQuery } from "@/lib/workspace";
import { cn } from "@/lib/utils";

type Selection = { kind: "clip" | "overlay" | "music"; id: string } | null;

const COLORS = ["#ffffff", "#000000", "#ffe14a", "#ff3b30", "#34c759", "#0a84ff", "#ff2d92"];
const STYLES: Array<{ id: TextStyle; label: string }> = [
  { id: "tiktok", label: "Contour" },
  { id: "box", label: "Fond" },
  { id: "plain", label: "Simple" },
];

/** Durée et taille d'une vidéo locale, lues par le navigateur. */
function readVideo(src: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({ duration: video.duration || 0, width: video.videoWidth || 1080, height: video.videoHeight || 1920 });
    video.onerror = () => reject(new Error("Vidéo illisible"));
    video.src = src;
  });
}

function readAudio(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(audio.duration || 0);
    audio.onerror = () => reject(new Error("Musique illisible"));
    audio.src = src;
  });
}

function fmt(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

/** Glisser à la souris : renvoie le déplacement horizontal (et vertical) en pixels depuis le clic. */
function drag(event: ReactPointerEvent, onMove: (dx: number, dy: number, e: PointerEvent) => void, onEnd?: () => void) {
  event.preventDefault();
  event.stopPropagation();
  const x0 = event.clientX;
  const y0 = event.clientY;
  const move = (e: PointerEvent) => onMove(e.clientX - x0, e.clientY - y0, e);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Le texte tel qu'il s'affiche sur l'aperçu, avec les emojis en version iPhone. */
function TextPreview({ item, scale }: { item: MontageText; scale: number }) {
  const size = item.size * scale;
  const stroke = item.color.toLowerCase() === "#000000" ? "#ffffff" : "#000000";
  return (
    <span
      style={{
        fontFamily: "var(--font-tiktok), 'Segoe UI', sans-serif",
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.18,
        color: item.color,
        whiteSpace: "pre-wrap",
        textAlign: "center",
        display: "inline-block",
        maxWidth: "86%",
        padding: item.style === "box" ? `${size * 0.05}px ${size * 0.35}px` : 0,
        borderRadius: item.style === "box" ? 14 * scale : 0,
        background: item.style === "box" ? (item.color.toLowerCase() === "#ffffff" ? "rgba(0,0,0,0.88)" : "#ffffff") : "transparent",
        WebkitTextStroke: item.style === "tiktok" ? `${Math.max(1, size * 0.16)}px ${stroke}` : undefined,
        paintOrder: "stroke fill",
        boxDecorationBreak: "clone",
      }}
    >
      {textParts(item.text).map((part, index) =>
        part.emoji ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={index} src={appleEmoji(emojiUnified(part.value))} alt={part.value} style={{ width: size * 1.05, height: size * 1.05, display: "inline-block", verticalAlign: "middle" }} />
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </span>
  );
}

export function MontageEditor() {
  const [clips, setClips] = useState<MontageClip[]>([]);
  const [overlays, setOverlays] = useState<MontageOverlay[]>([]);
  const [music, setMusic] = useState<MontageMusic | null>(null);
  const [clipVolume, setClipVolume] = useState(1);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ url: string; width: number; height: number; fps: number } | null>(null);
  const [stageWidth, setStageWidth] = useState(300);
  const [timelineWidth, setTimelineWidth] = useState(800);
  /** Le projet sauvegardé a été relu : la sauvegarde automatique peut démarrer. */
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const videos = useRef(new Map<string, HTMLVideoElement>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  const tRef = useRef(0);
  const videoInput = useRef<HTMLInputElement | null>(null);
  const musicInput = useRef<HTMLInputElement | null>(null);

  const total = useMemo(() => totalLength(clips), [clips]);
  const current = clipAt(clips, Math.min(t, Math.max(0, total - 0.001)));
  const first = clips[0];
  const aspect = first ? first.width / first.height : 9 / 16;
  const scale = stageWidth / 1080;
  const pps = timelineWidth / Math.max(total, 5);
  const workspace = currentWorkspace();

  // Largeurs mesurées : l'aperçu et la timeline suivent la taille de l'écran.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (stageRef.current) setStageWidth(stageRef.current.clientWidth);
      if (timelineRef.current) setTimelineWidth(timelineRef.current.clientWidth);
    });
    if (stageRef.current) observer.observe(stageRef.current);
    if (timelineRef.current) observer.observe(timelineRef.current);
    return () => observer.disconnect();
  }, [clips.length]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  /** Place la tête de lecture : le bon clip, à la bonne image, et la musique au même instant. */
  function seek(next: number) {
    const time = Math.min(Math.max(0, next), total);
    setT(time);
    const hit = clipAt(clips, Math.min(time, Math.max(0, total - 0.001)));
    if (hit) {
      clips.forEach((clip, index) => {
        const video = videos.current.get(clip.id);
        if (!video) return;
        if (index === hit.index) video.currentTime = hit.local;
        else video.pause();
      });
    }
    if (audioRef.current && music) audioRef.current.currentTime = (music.offset + time) % Math.max(0.1, music.duration);
  }

  function stop() {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    videos.current.forEach((video) => video.pause());
    audioRef.current?.pause();
  }

  function play() {
    if (!clips.length) return;
    let start = tRef.current >= total - 0.05 ? 0 : tRef.current;
    seek(start);
    setPlaying(true);
    let index = clipAt(clips, start)?.index ?? 0;
    let video = videos.current.get(clips[index].id);
    void video?.play();
    if (audioRef.current && music) {
      audioRef.current.volume = Math.min(1, music.volume);
      void audioRef.current.play();
    }
    const tick = () => {
      const clip = clips[index];
      video = videos.current.get(clip.id);
      if (!video) return;
      const startsAt = clips.slice(0, index).reduce((sum, item) => sum + clipLength(item), 0);
      if (video.currentTime >= clip.out - 0.04 || video.ended) {
        video.pause();
        index += 1;
        if (index >= clips.length) {
          setT(total);
          stop();
          return;
        }
        const next = clips[index];
        const nextVideo = videos.current.get(next.id);
        if (nextVideo) {
          nextVideo.currentTime = next.in;
          void nextVideo.play();
        }
        start = startsAt + clipLength(clip);
        setT(start);
      } else {
        setT(startsAt + Math.max(0, video.currentTime - clip.in));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ---------------- Sauvegarde automatique ---------------- */

  // Au chargement : le montage en cours de cet espace (Moosha, général…), tel qu'on l'a laissé.
  useEffect(() => {
    let alive = true;
    void fetch(`/api/montage/project${workspaceQuery("?")}`, { cache: "no-store" })
      .then((res) => res.json() as Promise<{ project?: { clips?: MontageClip[]; overlays?: MontageOverlay[]; music?: MontageMusic | null; clipVolume?: number } | null }>)
      .then((body) => {
        if (!alive || !body.project) return;
        const project = body.project;
        setClips((project.clips ?? []).filter((clip) => clip.url).map((clip) => ({ ...clip, src: clip.url!, uploading: false })));
        setOverlays(project.overlays ?? []);
        setMusic(project.music?.url ? { ...project.music, src: project.music.url, uploading: false } : null);
        setClipVolume(project.clipVolume ?? 1);
        setSaveState("saved");
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Chaque changement est enregistré sur le serveur une seconde après la dernière retouche.
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      const project = {
        clips: clips.filter((clip) => clip.url).map(({ file: _f, src: _s, uploading: _u, ...clip }) => {
          void _f;
          void _s;
          void _u;
          return clip;
        }),
        overlays,
        music: music?.url ? { name: music.name, url: music.url, duration: music.duration, offset: music.offset, volume: music.volume } : null,
        clipVolume,
      };
      const empty = !project.clips.length && !overlays.length && !project.music;
      void fetch(`/api/montage/project${workspaceQuery("?")}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: empty ? null : project }),
      })
        .then((res) => setSaveState(res.ok ? "saved" : "error"))
        .catch(() => setSaveState("error"));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [loaded, clips, overlays, music, clipVolume]);

  /** Envoie un fichier dans les médias du site ; renvoie son adresse (/api/media/…). */
  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error || `Envoi impossible (${file.name})`);
    return body.url;
  }

  function newProject() {
    if ((clips.length || overlays.length || music) && !window.confirm("Repartir d'un montage vide ? Le montage actuel sera effacé (les vidéos déjà exportées restent).")) return;
    stop();
    setClips([]);
    setOverlays([]);
    setMusic(null);
    setClipVolume(1);
    setSelected(null);
    setResult(null);
    setT(0);
  }

  /* ---------------- Ajouts ---------------- */

  async function addVideos(files: FileList | null) {
    if (!files?.length) return;
    const added: MontageClip[] = [];
    for (const file of [...files]) {
      if (!file.type.startsWith("video/")) continue;
      const src = URL.createObjectURL(file);
      try {
        const meta = await readVideo(src);
        added.push({ id: newId("clip"), name: file.name, src, file, uploading: true, duration: meta.duration, in: 0, out: meta.duration, width: meta.width, height: meta.height });
      } catch {
        toast.error(`${file.name} : vidéo illisible`);
      }
    }
    setClips((list) => [...list, ...added]);
    setResult(null);
    // Envoi tout de suite : le montage est sauvegardé avec les vidéos, et l'export n'a plus rien à envoyer.
    for (const clip of added) {
      try {
        const url = await upload(clip.file!);
        setClips((list) => list.map((item) => (item.file === clip.file ? { ...item, url, uploading: false } : item)));
      } catch (error) {
        setClips((list) => list.map((item) => (item.file === clip.file ? { ...item, uploading: false } : item)));
        toast.error(error instanceof Error ? error.message : `${clip.name} : envoi impossible`);
      }
    }
  }

  async function addMusic(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const src = URL.createObjectURL(file);
    try {
      const duration = await readAudio(src);
      setMusic({ name: file.name, src, file, duration, offset: 0, volume: 0.5, uploading: true });
      setSelected({ kind: "music", id: "music" });
      setResult(null);
      const url = await upload(file);
      setMusic((current) => (current?.file === file ? { ...current, url, uploading: false } : current));
    } catch (error) {
      setMusic((current) => (current?.file === file ? { ...current, uploading: false } : current));
      toast.error(error instanceof Error ? error.message : "Musique illisible");
    }
  }

  function addText() {
    const start = Math.min(t, Math.max(0, total - 0.5));
    const item: MontageText = { id: newId("txt"), kind: "text", text: "Ton texte ici", start, end: Math.min(total || 3, start + 3), x: 50, y: 30, size: 64, style: "tiktok", color: "#ffffff" };
    setOverlays((list) => [...list, item]);
    setSelected({ kind: "overlay", id: item.id });
    setResult(null);
  }

  function addEmoji(glyph: string) {
    const clean = glyph.trim();
    if (!clean) return;
    const start = Math.min(t, Math.max(0, total - 0.5));
    const item: MontageOverlay = { id: newId("emo"), kind: "emoji", glyph: clean, unified: emojiUnified(clean), start, end: Math.min(total || 3, start + 3), x: 50, y: 50, size: 160 };
    setOverlays((list) => [...list, item]);
    setSelected({ kind: "overlay", id: item.id });
    setEmojiOpen(false);
    setCustomEmoji("");
    setResult(null);
  }

  /* ---------------- Édition ---------------- */

  const patchClip = (id: string, patch: Partial<MontageClip>) => {
    setClips((list) => list.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
    setResult(null);
  };
  const patchOverlay = (id: string, patch: Partial<MontageText> | Partial<MontageOverlay>) => {
    setOverlays((list) => list.map((item) => (item.id === id ? ({ ...item, ...patch } as MontageOverlay) : item)));
    setResult(null);
  };

  function cut() {
    if (!clips.length) return;
    const next = splitAt(clips, t);
    if (next.length === clips.length) return toast.error("Place la tête de lecture à l'intérieur d'un clip pour couper.");
    setClips(next);
    setResult(null);
  }

  function remove() {
    if (!selected) return;
    if (selected.kind === "clip") setClips((list) => list.filter((clip) => clip.id !== selected.id));
    if (selected.kind === "overlay") setOverlays((list) => list.filter((item) => item.id !== selected.id));
    if (selected.kind === "music") setMusic(null);
    setSelected(null);
    setResult(null);
  }

  function moveClip(id: string, direction: -1 | 1) {
    setClips((list) => {
      const index = list.findIndex((clip) => clip.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  }

  /** Glisser un texte ou un emoji sur l'aperçu, avec repères de centrage. */
  function dragOverlay(event: ReactPointerEvent, item: MontageOverlay) {
    setSelected({ kind: "overlay", id: item.id });
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x0 = item.x;
    const y0 = item.y;
    drag(event, (dx, dy) => {
      let x = Math.min(98, Math.max(2, x0 + (dx / rect.width) * 100));
      let y = Math.min(98, Math.max(2, y0 + (dy / rect.height) * 100));
      if (Math.abs(x - 50) < 2) x = 50;
      if (Math.abs(y - 50) < 2) y = 50;
      patchOverlay(item.id, { x, y });
    });
  }

  /* ---------------- Export ---------------- */

  async function exportVideo() {
    if (!clips.length) return toast.error("Ajoute au moins une vidéo.");
    if (clips.some((clip) => clip.uploading) || music?.uploading) return toast.error("Les vidéos finissent d'être envoyées, réessaie dans quelques secondes.");
    stop();
    setResult(null);
    try {
      // Normalement déjà envoyées à l'ajout ; un envoi raté est retenté ici (un fichier coupé en plusieurs clips ne part qu'une fois).
      const sent = new Map<string, string>();
      for (const [index, clip] of clips.entries()) {
        if (clip.url) {
          sent.set(clip.id, clip.url);
          continue;
        }
        if (!clip.file) throw new Error(`${clip.name} : fichier introuvable, ajoute-le de nouveau`);
        setBusy(`Envoi des vidéos ${index + 1}/${clips.length}…`);
        const url = await upload(clip.file);
        for (const other of clips) if (other.file === clip.file) sent.set(other.id, url);
        setClips((list) => list.map((item) => (item.file === clip.file ? { ...item, url } : item)));
      }
      let musicUrl = music?.url ?? "";
      if (music && !musicUrl && music.file) {
        setBusy("Envoi de la musique…");
        musicUrl = await upload(music.file);
      }
      const width = first.width;
      const height = first.height;
      setBusy("Textes et emojis…");
      const pngs = [];
      for (const item of overlays) {
        if (item.kind === "text" && !item.text.trim()) continue;
        pngs.push({ png: await renderOverlayPng(item, Math.min(1080, width), Math.round((Math.min(1080, width) * height) / width)), start: item.start, end: item.end });
      }
      setBusy("Rendu de la vidéo (1 à 3 min)…");
      const res = await fetch("/api/montage/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: clips.map((clip) => ({ url: sent.get(clip.id) ?? clip.url ?? "", in: clip.in, out: clip.out })),
          overlays: pngs,
          music: musicUrl && music ? { url: musicUrl, offset: music.offset, volume: music.volume } : null,
          clipVolume,
          width,
          height,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; width?: number; height?: number; fps?: number; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error || "Rendu impossible");
      setResult({ url: body.url, width: body.width ?? width, height: body.height ?? height, fps: body.fps ?? 30 });
      toast.success("Vidéo prête");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export impossible");
    } finally {
      setBusy("");
    }
  }

  async function sendToDrive() {
    if (!result) return;
    setBusy("Envoi au Drive…");
    try {
      const blob = await (await fetch(result.url)).blob();
      const name = `montage-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.mp4`;
      const form = new FormData();
      form.set("path", "");
      form.append("files", new File([blob], name, { type: "video/mp4" }));
      const res = await fetch(`/api/drive${workspaceQuery("?")}`, { method: "POST", body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Envoi impossible");
      toast.success(`Envoyée dans le Drive${workspace ? ` ${workspace.label}` : ""} : ${name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Envoi impossible");
    } finally {
      setBusy("");
    }
  }

  /* ---------------- Rendu ---------------- */

  const sel = selected;
  const selClip = sel?.kind === "clip" ? clips.find((clip) => clip.id === sel.id) : undefined;
  const selOverlay = sel?.kind === "overlay" ? overlays.find((item) => item.id === sel.id) : undefined;
  const visible = overlays.filter((item) => t >= item.start && t < item.end);
  const button = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-40";
  const field = "h-8 w-full rounded-lg bg-slate-50 px-2 text-[12px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800";

  return (
    <div className="space-y-3 pb-10">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-[20px] font-semibold tracking-tight">Montage{workspace ? ` · ${workspace.label}` : ""}</h1>
        <input ref={videoInput} type="file" accept="video/*" multiple hidden onChange={(e) => { void addVideos(e.target.files); e.target.value = ""; }} />
        <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => { void addMusic(e.target.files); e.target.value = ""; }} />
        <button type="button" onClick={() => videoInput.current?.click()} className={cn(button, "bg-slate-900 text-white dark:bg-white dark:text-slate-900")}>
          <Plus className="h-4 w-4" /> Vidéos
        </button>
        <button type="button" onClick={() => musicInput.current?.click()} className={cn(button, "bg-slate-100 dark:bg-slate-800")}>
          <Music className="h-4 w-4" /> Musique
        </button>
        <button type="button" disabled={!clips.length} onClick={addText} className={cn(button, "bg-slate-100 dark:bg-slate-800")}>
          <Type className="h-4 w-4" /> Texte
        </button>
        <div className="relative">
          <button type="button" disabled={!clips.length} onClick={() => setEmojiOpen((open) => !open)} className={cn(button, "bg-slate-100 dark:bg-slate-800")}>
            <Smile className="h-4 w-4" /> Emoji
          </button>
          {emojiOpen ? (
            <div className="absolute left-0 top-11 z-30 w-72 rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-900">
              <div className="grid grid-cols-8 gap-1">
                {APPLE_EMOJIS.map((emoji) => (
                  <button key={emoji.unified} type="button" onClick={() => addEmoji(emoji.glyph)} className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={appleEmoji(emoji.unified, 64)} alt={emoji.glyph} className="h-6 w-6" />
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                <input value={customEmoji} onChange={(e) => setCustomEmoji(e.target.value)} placeholder="Colle n'importe quel emoji" className={field} />
                <button type="button" onClick={() => addEmoji(customEmoji)} className="rounded-lg bg-slate-900 px-2 text-[12px] font-semibold text-white dark:bg-white dark:text-slate-900">OK</button>
              </div>
            </div>
          ) : null}
        </div>
        <button type="button" disabled={!clips.length} onClick={cut} title="Couper le clip à la tête de lecture" className={cn(button, "bg-slate-100 dark:bg-slate-800")}>
          <Scissors className="h-4 w-4" /> Couper
        </button>
        <button type="button" disabled={!selected} onClick={remove} className={cn(button, "bg-slate-100 text-rose-600 dark:bg-slate-800")}>
          <Trash2 className="h-4 w-4" /> Supprimer
        </button>
        <span className="ml-auto text-[11px] font-medium text-slate-400">
          {clips.some((clip) => clip.uploading) || music?.uploading
            ? "Envoi des fichiers…"
            : saveState === "saving"
              ? "Sauvegarde…"
              : saveState === "saved"
                ? "✓ Sauvegardé"
                : saveState === "error"
                  ? "⚠ Sauvegarde impossible"
                  : ""}
        </span>
        <button type="button" onClick={newProject} className={cn(button, "bg-slate-100 dark:bg-slate-800")}>
          Nouveau
        </button>
        <button type="button" disabled={!clips.length || Boolean(busy)} onClick={() => void exportVideo()} className={cn(button, "bg-emerald-600 text-white")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exporter
        </button>
      </div>
      {busy ? <p className="text-[12px] font-medium text-emerald-700">{busy}</p> : null}

      {!clips.length ? (
        <button
          type="button"
          onClick={() => videoInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void addVideos(e.dataTransfer.files); }}
          className="flex h-72 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-[13px] text-slate-500 dark:border-slate-700"
        >
          <FolderUp className="h-6 w-6" />
          Glisse tes vidéos ici, ou clique pour les choisir
        </button>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Aperçu */}
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-slate-950 p-3">
            <div ref={stageRef} className="relative overflow-hidden rounded-lg bg-black" style={{ width: `min(100%, ${Math.round(520 * aspect)}px)`, aspectRatio: `${first.width} / ${first.height}` }}>
              {clips.map((clip, index) => (
                <video
                  key={clip.id}
                  ref={(node) => {
                    if (node) videos.current.set(clip.id, node);
                    else videos.current.delete(clip.id);
                  }}
                  src={clip.src}
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(e) => {
                    e.currentTarget.volume = Math.min(1, clipVolume);
                    if (index === 0) e.currentTarget.currentTime = clip.in;
                  }}
                  className={cn("absolute inset-0 h-full w-full object-cover", current?.index === index ? "opacity-100" : "opacity-0")}
                />
              ))}
              {visible.map((item) => (
                <div
                  key={item.id}
                  onPointerDown={(e) => dragOverlay(e, item)}
                  className={cn("absolute flex -translate-x-1/2 -translate-y-1/2 cursor-move select-none justify-center", selected?.id === item.id && "outline outline-2 outline-dashed outline-sky-400")}
                  style={{ left: `${item.x}%`, top: `${item.y}%`, width: item.kind === "text" ? "100%" : undefined }}
                >
                  {item.kind === "text" ? (
                    <TextPreview item={item} scale={scale} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={appleEmoji(item.unified)} alt={item.glyph} draggable={false} style={{ width: item.size * scale, height: item.size * scale }} />
                  )}
                </div>
              ))}
              {selected?.kind === "overlay" ? (
                <>
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-sky-400/40" />
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-sky-400/40" />
                </>
              ) : null}
            </div>
            {music ? <audio ref={audioRef} src={music.src} preload="auto" /> : null}
            <div className="flex items-center gap-3 text-white">
              <button type="button" onClick={() => (playing ? stop() : play())} className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-900">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <span className="font-mono text-[12px] tabular-nums">
                {fmt(t)} / {fmt(total)}
              </span>
            </div>
          </div>

          {/* Réglages de l'élément choisi */}
          <div className="space-y-3 rounded-2xl bg-white p-3 text-[12px] ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
            {selClip ? (
              <>
                <p className="font-semibold">Clip · {selClip.name}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-slate-400">Début (s)</span>
                    <input type="number" step={0.1} min={0} max={selClip.out - 0.1} value={Number(selClip.in.toFixed(2))} onChange={(e) => patchClip(selClip.id, { in: Math.min(selClip.out - 0.1, Math.max(0, Number(e.target.value))) })} className={field} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">Fin (s)</span>
                    <input type="number" step={0.1} min={selClip.in + 0.1} max={selClip.duration} value={Number(selClip.out.toFixed(2))} onChange={(e) => patchClip(selClip.id, { out: Math.max(selClip.in + 0.1, Math.min(selClip.duration, Number(e.target.value))) })} className={field} />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => moveClip(selClip.id, -1)} className={cn(button, "h-8 bg-slate-100 dark:bg-slate-800")}><ChevronLeft className="h-4 w-4" /> Avant</button>
                  <button type="button" onClick={() => moveClip(selClip.id, 1)} className={cn(button, "h-8 bg-slate-100 dark:bg-slate-800")}>Après <ChevronRight className="h-4 w-4" /></button>
                </div>
                <p className="text-slate-400">Astuce : tire les bords du clip dans la timeline pour le raccourcir.</p>
              </>
            ) : selOverlay?.kind === "text" ? (
              <>
                <p className="font-semibold">Texte</p>
                <textarea value={selOverlay.text} onChange={(e) => patchOverlay(selOverlay.id, { text: e.target.value })} rows={3} className="w-full rounded-lg bg-slate-50 p-2 text-[13px] outline-none ring-1 ring-slate-900/10 dark:bg-slate-800" />
                <p className="text-slate-400">Les emojis tapés ici s&apos;affichent en version iPhone.</p>
                <div className="flex gap-1">
                  {STYLES.map((style) => (
                    <button key={style.id} type="button" onClick={() => patchOverlay(selOverlay.id, { style: style.id })} className={cn("flex-1 rounded-lg py-1.5 font-semibold", selOverlay.style === style.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800")}>
                      {style.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map((color) => (
                    <button key={color} type="button" onClick={() => patchOverlay(selOverlay.id, { color })} className={cn("h-7 w-7 rounded-full ring-2", selOverlay.color === color ? "ring-sky-500" : "ring-slate-200")} style={{ background: color }} />
                  ))}
                </div>
                <label className="block space-y-1">
                  <span className="text-slate-400">Taille</span>
                  <input type="range" min={28} max={160} value={selOverlay.size} onChange={(e) => patchOverlay(selOverlay.id, { size: Number(e.target.value) })} className="w-full" />
                </label>
              </>
            ) : selOverlay?.kind === "emoji" ? (
              <>
                <p className="font-semibold">Emoji {selOverlay.glyph}</p>
                <label className="block space-y-1">
                  <span className="text-slate-400">Taille</span>
                  <input type="range" min={60} max={500} value={selOverlay.size} onChange={(e) => patchOverlay(selOverlay.id, { size: Number(e.target.value) })} className="w-full" />
                </label>
              </>
            ) : selected?.kind === "music" && music ? (
              <>
                <p className="font-semibold">Musique · {music.name}</p>
                <label className="block space-y-1">
                  <span className="text-slate-400">Volume de la musique · {Math.round(music.volume * 100)} %</span>
                  <input type="range" min={0} max={1} step={0.05} value={music.volume} onChange={(e) => setMusic({ ...music, volume: Number(e.target.value) })} className="w-full" />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-400">Démarrer la musique à · {fmt(music.offset)}</span>
                  <input type="range" min={0} max={Math.max(0, music.duration - 1)} step={0.5} value={music.offset} onChange={(e) => setMusic({ ...music, offset: Number(e.target.value) })} className="w-full" />
                </label>
              </>
            ) : (
              <p className="text-slate-400">Clique un clip, un texte, un emoji ou la musique pour le régler. Glisse textes et emojis directement sur la vidéo.</p>
            )}

            {selOverlay ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-slate-400">Apparaît (s)</span>
                  <input type="number" step={0.1} min={0} value={Number(selOverlay.start.toFixed(2))} onChange={(e) => patchOverlay(selOverlay.id, { start: Math.min(selOverlay.end - 0.1, Math.max(0, Number(e.target.value))) })} className={field} />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400">Disparaît (s)</span>
                  <input type="number" step={0.1} max={total} value={Number(selOverlay.end.toFixed(2))} onChange={(e) => patchOverlay(selOverlay.id, { end: Math.max(selOverlay.start + 0.1, Math.min(total, Number(e.target.value))) })} className={field} />
                </label>
              </div>
            ) : null}

            <label className="block space-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className="text-slate-400">Son des vidéos · {Math.round(clipVolume * 100)} %</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={clipVolume}
                onChange={(e) => {
                  const volume = Number(e.target.value);
                  setClipVolume(volume);
                  videos.current.forEach((video) => (video.volume = volume));
                }}
                className="w-full"
              />
            </label>

            {result ? (
              <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="font-semibold text-emerald-700">
                  Vidéo prête · {result.width}×{result.height} · {result.fps} i/s
                </p>
                <video src={result.url} controls className="w-full rounded-lg bg-black" />
                <div className="flex gap-2">
                  <a href={`${result.url}?download=1&name=montage.mp4`} className={cn(button, "flex-1 justify-center bg-slate-900 text-white dark:bg-white dark:text-slate-900")}>
                    <Download className="h-4 w-4" /> Télécharger
                  </a>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void sendToDrive()} className={cn(button, "flex-1 justify-center bg-slate-100 dark:bg-slate-800")}>
                    <FolderUp className="h-4 w-4" /> Drive{workspace ? ` ${workspace.label}` : ""}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Timeline */}
      {clips.length ? (
        <div className="space-y-1 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <div ref={timelineRef} className="relative select-none" style={{ minHeight: 60 }}>
            {/* Règle : cliquer ou glisser déplace la tête de lecture. */}
            <div
              className="relative h-6 cursor-pointer border-b border-slate-200 dark:border-slate-700"
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek((e.clientX - rect.left) / pps);
                drag(e, (_dx, _dy, ev) => seek((ev.clientX - rect.left) / pps));
              }}
            >
              {Array.from({ length: Math.floor(total) + 1 }, (_, second) => second)
                .filter((second) => second % (total > 40 ? 5 : total > 15 ? 2 : 1) === 0)
                .map((second) => (
                  <span key={second} className="absolute top-0 text-[10px] text-slate-400" style={{ left: second * pps }}>
                    | {second}s
                  </span>
                ))}
            </div>

            {/* Vidéos */}
            <div className="relative mt-1 h-12">
              {clips.map((clip, index) => {
                const left = clips.slice(0, index).reduce((sum, item) => sum + clipLength(item), 0) * pps;
                const width = clipLength(clip) * pps;
                return (
                  <div
                    key={clip.id}
                    onPointerDown={() => setSelected({ kind: "clip", id: clip.id })}
                    className={cn("absolute top-0 flex h-12 items-center overflow-hidden rounded-md bg-sky-600 px-3 text-[11px] font-semibold text-white", selected?.id === clip.id && "ring-2 ring-amber-400")}
                    style={{ left, width: Math.max(8, width - 2) }}
                  >
                    <span className="truncate">{clip.name}</span>
                    {/* Bords : raccourcir le clip */}
                    <span
                      className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/25"
                      onPointerDown={(e) => {
                        const in0 = clip.in;
                        setSelected({ kind: "clip", id: clip.id });
                        drag(e, (dx) => patchClip(clip.id, { in: Math.min(clip.out - 0.1, Math.max(0, in0 + dx / pps)) }));
                      }}
                    />
                    <span
                      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/25"
                      onPointerDown={(e) => {
                        const out0 = clip.out;
                        setSelected({ kind: "clip", id: clip.id });
                        drag(e, (dx) => patchClip(clip.id, { out: Math.max(clip.in + 0.1, Math.min(clip.duration, out0 + dx / pps)) }));
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Textes et emojis : une ligne chacun */}
            {overlays.map((item) => (
              <div key={item.id} className="relative mt-1 h-7">
                <div
                  onPointerDown={(e) => {
                    setSelected({ kind: "overlay", id: item.id });
                    const s0 = item.start;
                    const e0 = item.end;
                    const len = e0 - s0;
                    drag(e, (dx) => {
                      const start = Math.min(Math.max(0, s0 + dx / pps), Math.max(0, total - len));
                      patchOverlay(item.id, { start, end: start + len });
                    });
                  }}
                  className={cn(
                    "absolute top-0 flex h-7 cursor-grab items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold",
                    item.kind === "text" ? "bg-violet-500 text-white" : "bg-amber-300 text-slate-900",
                    selected?.id === item.id && "ring-2 ring-amber-500"
                  )}
                  style={{ left: item.start * pps, width: Math.max(10, (item.end - item.start) * pps) }}
                >
                  <span className="truncate">{item.kind === "text" ? item.text || "Texte" : item.glyph}</span>
                  <span
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/20"
                    onPointerDown={(e) => {
                      const s0 = item.start;
                      drag(e, (dx) => patchOverlay(item.id, { start: Math.min(item.end - 0.1, Math.max(0, s0 + dx / pps)) }));
                    }}
                  />
                  <span
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/20"
                    onPointerDown={(e) => {
                      const e0 = item.end;
                      drag(e, (dx) => patchOverlay(item.id, { end: Math.max(item.start + 0.1, Math.min(total, e0 + dx / pps)) }));
                    }}
                  />
                </div>
              </div>
            ))}

            {/* Musique */}
            {music ? (
              <div className="relative mt-1 h-7">
                <div
                  onPointerDown={() => setSelected({ kind: "music", id: "music" })}
                  className={cn("absolute top-0 flex h-7 items-center overflow-hidden rounded-md bg-emerald-500 px-2 text-[11px] font-semibold text-white", selected?.kind === "music" && "ring-2 ring-amber-500")}
                  style={{ left: 0, width: total * pps }}
                >
                  <Music className="mr-1 h-3 w-3 shrink-0" />
                  <span className="truncate">{music.name}</span>
                </div>
              </div>
            ) : null}

            {/* Tête de lecture */}
            <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-rose-500" style={{ left: t * pps }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
