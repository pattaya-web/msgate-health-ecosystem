"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { appleEmojiUrl, APPLE_EMOJIS } from "@/lib/studio/apple-emoji";
import {
  captionWindow,
  composeVerticalCreative,
  renderOverlayPng,
  type CaptionPreset,
} from "@/lib/studio/compose-video";
import { burnOverlay, probeDuration, randomVideoName, toMp4 } from "@/lib/studio/client";
import { cn } from "@/lib/utils";

/**
 * Même pile que celle utilisée par le canvas à l'export : la preview doit
 * montrer exactement la police du fichier final, pas une approximation.
 */
const TIKTOK_STACK =
  'var(--font-tiktok), "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const PRESETS: Array<{ id: CaptionPreset; label: string }> = [
  { id: "tiktok", label: "TikTok" },
  { id: "boxed", label: "Box" },
  { id: "pop", label: "Pop" },
  { id: "minimal", label: "Minimal" },
];

type Mode = "overlay" | "montage";
type Align = "left" | "center" | "right";

export function VideoStudio() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mode, setMode] = useState<Mode>("overlay");
  const [clips, setClips] = useState<File[]>([]);
  const [clipUrls, setClipUrls] = useState<string[]>([]);
  const [clipIndex, setClipIndex] = useState(0);
  const [overlayText, setOverlayText] = useState("");
  const [align, setAlign] = useState<Align>("center");
  const [textSize, setTextSize] = useState(42);
  const [textY, setTextY] = useState(16);
  const [textX, setTextX] = useState(50);
  /** Repères affichés pendant le glisser, façon CapCut. */
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [fill, setFill] = useState("#ffffff");
  const [stroke, setStroke] = useState("#000000");
  /** Épaisseur du contour, en % de la taille du texte. 25 = rendu TikTok. */
  const [strokeWidth, setStrokeWidth] = useState(25);
  const [emojis, setEmojis] = useState<string[]>([]);
  const [script, setScript] = useState("");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [captions, setCaptions] = useState(true);
  const [preset, setPreset] = useState<CaptionPreset>("tiktok");
  const [highlight, setHighlight] = useState("#ffe14a");
  const [capY, setCapY] = useState(79);
  const [capSize, setCapSize] = useState(28);
  const [capAlign, setCapAlign] = useState<Align>("center");
  /** Mots par sous-titre : 1 donne le rendu karaoke mot a mot. */
  const [capWords, setCapWords] = useState(4);
  const [playHead, setPlayHead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [exportUrl, setExportUrl] = useState("");
  const [exportName, setExportName] = useState("");
  /** Mesures affichees apres export, pour localiser une video tronquee. */
  const [diag, setDiag] = useState("");

  const previewSrc = clipUrls[clipIndex] || clipUrls[0] || "";
  const cap = useMemo(() => {
    const duration = audioRef.current?.duration || videoRef.current?.duration || 12;
    return captionWindow(script, playHead, duration, capWords);
  }, [script, playHead, capWords]);

  useEffect(() => {
    const urls = clips.map((file) => URL.createObjectURL(file));
    setClipUrls(urls);
    setClipIndex(0);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [clips]);

  useEffect(() => {
    if (!voiceFile) {
      setVoiceUrl("");
      return;
    }
    const url = URL.createObjectURL(voiceFile);
    setVoiceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voiceFile]);

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const next = Array.from(list);
    setClips((cur) => (mode === "overlay" ? next.slice(0, 1) : [...cur, ...next]));
    setExportUrl("");
  }

  /**
   * Magnétisme : on colle aux repères forts (centre, tiers, marges) quand on
   * passe à moins de 2,5 %, sinon on arrondit au pas de 1 % pour éviter les
   * positions à sept décimales.
   */
  function snap(value: number, anchors: number[]) {
    const hit = anchors.find((anchor) => Math.abs(value - anchor) < 2.5);
    return { value: hit ?? Math.round(value), snapped: hit !== undefined };
  }

  function moveText(event: React.PointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const rawX = ((event.clientX - rect.left) / rect.width) * 100;
    const rawY = ((event.clientY - rect.top) / rect.height) * 100;

    const x = snap(Math.min(98, Math.max(2, rawX)), [10, 25, 50, 75, 90]);
    const y = snap(Math.min(96, Math.max(4, rawY)), [10, 25, 50, 75, 90]);

    setTextX(x.value);
    setTextY(y.value);
    setGuides({ x: x.snapped, y: y.snapped });
  }

  function onTime() {
    const t = audioRef.current?.currentTime || videoRef.current?.currentTime || 0;
    setPlayHead(t);
  }

  async function render() {
    if (!clips.length) {
      toast.error(mode === "overlay" ? "Upload une vidéo" : "Empile au moins un clip");
      return;
    }
    setBusy(true);
    setExportUrl("");
    try {
      /**
       * Mode Texte : la vidéo d'origine est conservée telle quelle et ffmpeg y
       * incruste le calque. Plus de réenregistrement image par image, donc plus
       * de saccades ni d'images figées, et la durée est exactement celle de la
       * source.
       */
      if (mode === "overlay") {
        setProgress("Rendu du calque…");
        const overlayPng = await renderOverlayPng({
          overlayText,
          overlay: {
            align,
            size: Math.round(textSize * (1080 / 320)),
            y: textY,
            x: textX,
            fill,
            stroke,
            strokeWidth,
          },
          emojiUrls: emojis.map((id) => appleEmojiUrl(id, 64)),
        });

        setProgress("Incrustation sur la vidéo…");
        const burned = await burnOverlay(clips[0], overlayPng);
        const seconds = await probeDuration(burned);
        setExportUrl(URL.createObjectURL(burned));
        setExportName(randomVideoName("texte"));
        setDiag(`mp4 ${seconds}s — vidéo d'origine conservée`);
        toast.success(`MP4 prêt — ${seconds}s`);
        return;
      }

      const blob = await composeVerticalCreative({
        clips,
        mode,
        captions,
        voiceBlob: voiceFile,
        script,
        overlayText: "",
        overlay: {
          align,
          size: Math.round(textSize * (1080 / 320)),
          y: textY,
          x: textX,
          fill,
          stroke,
          strokeWidth,
        },
        emojiUrls: [],
        watermark: "none",
        caption: {
          preset,
          fill,
          stroke,
          highlight,
          y: capY,
          size: Math.round(capSize * (1080 / 320)),
          align: capAlign,
          words: capWords,
          strokeWidth,
        },
        seed: Date.now(),
        onMeta: (info) =>
          setDiag(
            `source ${info.clipSeconds.join(" + ")}s · vise ${info.target}s · capture ${info.recorded}s`
          ),
        onProgress: (p, label) => setProgress(`${label} · ${p}%`),
      });
      setProgress("Conversion MP4…");
      const webmSeconds = await probeDuration(blob);
      const mp4 = await toMp4(blob);
      const mp4Seconds = await probeDuration(mp4);
      setExportUrl(URL.createObjectURL(mp4));
      setExportName(randomVideoName("montage"));
      setDiag((current) => `${current} · capture lue ${webmSeconds}s · mp4 ${mp4Seconds}s`);
      toast.success(`MP4 prêt — ${mp4Seconds}s`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export impossible");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  /**
   * Le vrai contour TikTok, pas quatre ombres décalées : `-webkit-text-stroke`
   * trace un liseré régulier autour de chaque glyphe, et `paint-order` le passe
   * DERRIÈRE le remplissage — sans quoi il ronge la lettre et la rend illisible.
   * L'épaisseur suit la taille du texte, comme dans le canvas de l'export.
   */
  function outlineStyle(size: number): React.CSSProperties {
    const width = Math.max(1, (size * strokeWidth) / 100);
    return {
      WebkitTextStrokeWidth: `${width}px`,
      WebkitTextStrokeColor: stroke,
      paintOrder: "stroke fill",
    };
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-2 rounded-2xl bg-white p-2.5 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <div className="grid grid-cols-2 gap-0.5 rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setMode("overlay")}
            className={cn("rounded-lg px-2 py-1.5 text-[12px] font-medium", mode === "overlay" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
          >
            Texte
          </button>
          <button
            type="button"
            onClick={() => setMode("montage")}
            className={cn("rounded-lg px-2 py-1.5 text-[12px] font-medium", mode === "montage" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
          >
            Montage
          </button>
        </div>

        <label className="flex h-14 cursor-pointer items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-[12px] text-slate-500 dark:border-slate-700">
          <Plus className="h-3.5 w-3.5" />
          {mode === "overlay" ? "Upload une vidéo" : "Empiler des clips"}
          <input type="file" accept="video/*" multiple={mode === "montage"} className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </label>
        <div className="flex flex-wrap gap-1">
          {clipUrls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => (mode === "montage" ? setClipIndex(i) : setClips([]))}
              className={cn("relative h-12 w-9 overflow-hidden rounded-md bg-black", clipIndex === i && mode === "montage" ? "ring-2 ring-slate-900" : "")}
            >
              <video src={url} muted className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        {mode === "montage" && clips.length ? (
          <button type="button" onClick={() => setClips([])} className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Trash2 className="h-3 w-3" />
            Vider la pile
          </button>
        ) : null}

        {mode === "overlay" ? (
          <>
            <textarea
              value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)}
              rows={3}
              placeholder="Texte overlay — visible en live"
              className="w-full resize-none rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] outline-none dark:bg-slate-800"
            />
            <div className="flex gap-1">
              {(["left", "center", "right"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setAlign(item)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-[11px] font-medium",
                    align === item ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800"
                  )}
                >
                  {item === "left" ? "Gauche" : item === "right" ? "Droite" : "Centre"}
                </button>
              ))}
            </div>
            <label className="block text-[11px] text-slate-500">
              Taille {textSize}px
              <input type="range" min={18} max={72} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="w-full" />
            </label>
            <label className="block text-[11px] text-slate-500">
              Hauteur {textY}%
              <input type="range" min={4} max={96} value={textY} onChange={(e) => setTextY(Number(e.target.value))} className="w-full" />
            </label>
            <label className="block text-[11px] text-slate-500">
              Horizontale {textX}%
              <input type="range" min={2} max={98} value={textX} onChange={(e) => setTextX(Number(e.target.value))} className="w-full" />
            </label>
            <button
              type="button"
              onClick={() => {
                setTextX(50);
                setTextY(16);
              }}
              className="w-full rounded-md bg-slate-100 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              Recentrer le texte
            </button>
            <p className="text-[11px] leading-snug text-slate-400">
              Attrape le texte dans la preview pour le placer. Il s&apos;aimante au centre, aux
              tiers et aux marges.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <label className="flex items-center gap-1">
                Fill <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} />
              </label>
              <label className="flex items-center gap-1">
                Contour <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
              </label>
            </div>
            <label className="block text-[11px] text-slate-500">
              Épaisseur du contour {strokeWidth}%
              <input
                type="range"
                min={0}
                max={40}
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <div className="flex flex-wrap gap-1">
              {APPLE_EMOJIS.map((emo) => (
                <button
                  key={emo.unified}
                  type="button"
                  onClick={() =>
                    setEmojis((cur) =>
                      cur.includes(emo.unified) ? cur.filter((x) => x !== emo.unified) : [...cur, emo.unified].slice(0, 8)
                    )
                  }
                  className={cn("rounded-md p-0.5", emojis.includes(emo.unified) ? "ring-2 ring-slate-900 dark:ring-white" : "opacity-70")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={appleEmojiUrl(emo.unified, 64)} alt={emo.glyph} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="flex h-10 cursor-pointer items-center justify-center rounded-lg bg-slate-100 text-[12px] font-medium dark:bg-slate-800">
              {voiceFile ? voiceFile.name : "Upload voix-off (MP3)"}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => setVoiceFile(e.target.files?.[0] || null)}
              />
            </label>
            {voiceUrl ? <audio ref={audioRef} src={voiceUrl} controls className="w-full" onTimeUpdate={onTime} /> : null}
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={4}
              placeholder="Script captions (le texte de ta voix-off)"
              className="w-full resize-none rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] outline-none dark:bg-slate-800"
            />
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
              Captions
            </label>
            {captions ? (
              <>
                <div className="flex gap-1">
                  {PRESETS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPreset(item.id)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-medium",
                        preset === item.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setCapAlign(item)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1 text-[11px] font-medium",
                        capAlign === item
                          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                          : "bg-slate-100 dark:bg-slate-800"
                      )}
                    >
                      {item === "left" ? "Gauche" : item === "center" ? "Centre" : "Droite"}
                    </button>
                  ))}
                </div>
                <label className="block text-[11px] text-slate-500">
                  Taille captions {capSize}px
                  <input type="range" min={14} max={72} value={capSize} onChange={(e) => setCapSize(Number(e.target.value))} className="w-full" />
                </label>
                <label className="block text-[11px] text-slate-500">
                  Position {capY}%
                  <input type="range" min={5} max={95} value={capY} onChange={(e) => setCapY(Number(e.target.value))} className="w-full" />
                </label>
                <label className="block text-[11px] text-slate-500">
                  Épaisseur du contour {strokeWidth}%
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    className="w-full"
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  {capWords === 1 ? "1 mot à la fois (karaoké)" : `${capWords} mots par sous-titre`}
                  <input type="range" min={1} max={8} value={capWords} onChange={(e) => setCapWords(Number(e.target.value))} className="w-full" />
                </label>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <label className="flex items-center gap-1">
                    Fill <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} />
                  </label>
                  <label className="flex items-center gap-1">
                    Stroke <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
                  </label>
                  <label className="flex items-center gap-1">
                    HL <input type="color" value={highlight} onChange={(e) => setHighlight(e.target.value)} />
                  </label>
                </div>
              </>
            ) : null}
          </>
        )}

        <button
          type="button"
          onClick={() => void render()}
          disabled={busy}
          className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-slate-900 text-[12px] font-medium text-white dark:bg-white dark:text-slate-900"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {mode === "overlay" ? "Exporter" : "Assembler le montage"}
        </button>
        {progress ? <p className="text-[11px] text-slate-400">{progress}</p> : null}
        {diag ? (
          <p className="rounded-md bg-slate-100 px-2 py-1 text-[10px] leading-snug text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {diag}
          </p>
        ) : null}
      </aside>

      <section className="rounded-2xl bg-slate-50/80 p-2 ring-1 ring-slate-900/[0.04] dark:bg-slate-950/40">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[11px] text-slate-400">
            {mode === "overlay" ? "Preview live du texte" : "Preview clips + captions + voix-off"}
          </p>
          {exportUrl ? (
            <a href={exportUrl} download={exportName || "creative.mp4"} className="inline-flex items-center gap-1 text-[11px] font-medium">
              <Download className="h-3 w-3" />
              Télécharger
            </a>
          ) : null}
        </div>
        <div className="mx-auto w-fit max-w-full">
          {previewSrc ? (
            <div
              ref={stageRef}
              className="relative overflow-hidden rounded-xl bg-black"
              style={{ width: "min(360px, 100%)" }}
            >
              <video
                ref={videoRef}
                src={previewSrc}
                controls
                muted={mode === "montage"}
                playsInline
                onTimeUpdate={onTime}
                onEnded={() => {
                  if (mode === "montage" && clipUrls.length > 1) {
                    setClipIndex((i) => (i + 1) % clipUrls.length);
                  }
                }}
                className="aspect-[9/16] w-full object-cover"
              />
              {/* Repères de magnétisme, visibles seulement au moment où le
                  bloc s'aligne — comme les guides de CapCut. */}
              {dragging ? (
                <>
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="border border-white/15" />
                    ))}
                  </div>
                  {guides.x ? (
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 w-px bg-emerald-400"
                      style={{ left: `${textX}%` }}
                    />
                  ) : null}
                  {guides.y ? (
                    <div
                      className="pointer-events-none absolute left-0 right-0 h-px bg-emerald-400"
                      style={{ top: `${textY}%` }}
                    />
                  ) : null}
                </>
              ) : null}

              {/* Texte et emoji dans le même bloc, ancré par son centre : c'est
                  ce point qu'on déplace à la souris. Les emoji sont EN LIGNE, à
                  la suite du texte. */}
              {mode === "overlay" && (overlayText.trim() || emojis.length) ? (
                <div
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging(true);
                    moveText(event);
                  }}
                  onPointerMove={(event) => {
                    if (dragging) moveText(event);
                  }}
                  onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    setDragging(false);
                    setGuides({ x: false, y: false });
                  }}
                  className={cn(
                    "absolute leading-[1.12] touch-none select-none",
                    dragging ? "cursor-grabbing ring-1 ring-emerald-400/70" : "cursor-grab"
                  )}
                  style={{
                    left: `${textX}%`,
                    top: `${textY}%`,
                    transform: "translate(-50%, -50%)",
                    width: "88%",
                    fontSize: `${textSize}px`,
                    textAlign: align,
                    color: fill,
                    fontFamily: TIKTOK_STACK,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    whiteSpace: "pre-wrap",
                    ...outlineStyle(textSize),
                  }}
                >
                  {overlayText}
                  {emojis.map((id) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={id}
                      src={appleEmojiUrl(id, 64)}
                      alt=""
                      className="ml-[0.12em] inline-block align-[-0.18em]"
                      style={{ height: `${Math.round(textSize * 0.95)}px`, width: "auto" }}
                    />
                  ))}
                </div>
              ) : null}
              {mode === "montage" && captions && cap.line.length ? (
                <div
                  className="pointer-events-none absolute left-3 right-3"
                  style={{
                    top: `${capY}%`,
                    fontSize: `${capSize}px`,
                    fontFamily: TIKTOK_STACK,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    textAlign: capAlign,
                    transform: "translateY(-50%)",
                  }}
                >
                  {preset === "boxed" || preset === "pop" ? (
                    <span
                      className="inline-block rounded-lg px-2 py-1"
                      style={{ background: preset === "pop" ? highlight : "rgba(0,0,0,0.72)", color: fill }}
                    >
                      {cap.line.join(" ")}
                    </span>
                  ) : preset === "minimal" ? (
                    <span style={{ color: fill }}>{cap.line.join(" ")}</span>
                  ) : (
                    <span>
                      {cap.line.map((word, i) => (
                        <span
                          key={`${word}-${i}`}
                          style={{
                            color: i === cap.active ? highlight : fill,
                            marginRight: 6,
                            ...outlineStyle(capSize),
                          }}
                        >
                          {word}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex aspect-[9/16] w-[280px] items-center justify-center rounded-xl bg-slate-200 text-[12px] text-slate-500 dark:bg-slate-800">
              {mode === "overlay" ? "Upload une vidéo" : "Empile tes clips"}
            </div>
          )}
        </div>
        {exportUrl ? (
          <video src={exportUrl} controls className="mx-auto mt-3 max-h-48 rounded-lg" />
        ) : null}
      </section>
    </div>
  );
}
