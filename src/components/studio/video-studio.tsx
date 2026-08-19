"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { appleEmojiUrl, APPLE_EMOJIS } from "@/lib/studio/apple-emoji";
import { captionWindow, composeVerticalCreative, type CaptionPreset } from "@/lib/studio/compose-video";
import { cn } from "@/lib/utils";

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
  const [fill, setFill] = useState("#ffffff");
  const [stroke, setStroke] = useState("#000000");
  const [emojis, setEmojis] = useState<string[]>([]);
  const [script, setScript] = useState("");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [captions, setCaptions] = useState(true);
  const [preset, setPreset] = useState<CaptionPreset>("tiktok");
  const [highlight, setHighlight] = useState("#ffe14a");
  const [capY, setCapY] = useState(79);
  const [capSize, setCapSize] = useState(28);
  const [playHead, setPlayHead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [exportUrl, setExportUrl] = useState("");

  const previewSrc = clipUrls[clipIndex] || clipUrls[0] || "";
  const cap = useMemo(() => {
    const duration = audioRef.current?.duration || videoRef.current?.duration || 12;
    return captionWindow(script, playHead, duration);
  }, [script, playHead]);

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
      const blob = await composeVerticalCreative({
        clips,
        mode,
        captions: mode === "montage" && captions,
        voiceBlob: mode === "montage" ? voiceFile : null,
        script: mode === "montage" ? script : "",
        overlayText: mode === "overlay" ? overlayText : "",
        overlay: { align, size: Math.round(textSize * (1080 / 320)), y: textY, fill, stroke },
        emojiUrls: mode === "overlay" ? emojis.map((u) => appleEmojiUrl(u, 64)) : [],
        watermark: "none",
        caption: { preset, fill, stroke, highlight, y: capY, size: Math.round(capSize * (1080 / 320)) },
        seed: Date.now(),
        onProgress: (p, label) => setProgress(`${label} · ${p}%`),
      });
      setExportUrl(URL.createObjectURL(blob));
      toast.success("Vidéo prête");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export impossible");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const outline = `-3px -3px 0 ${stroke}, 3px -3px 0 ${stroke}, -3px 3px 0 ${stroke}, 3px 3px 0 ${stroke}`;

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
              Position {textY}%
              <input type="range" min={6} max={88} value={textY} onChange={(e) => setTextY(Number(e.target.value))} className="w-full" />
            </label>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <label className="flex items-center gap-1">
                Fill <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} />
              </label>
              <label className="flex items-center gap-1">
                Contour <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
              </label>
            </div>
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
                <label className="block text-[11px] text-slate-500">
                  Taille captions {capSize}px
                  <input type="range" min={16} max={48} value={capSize} onChange={(e) => setCapSize(Number(e.target.value))} className="w-full" />
                </label>
                <label className="block text-[11px] text-slate-500">
                  Position {capY}%
                  <input type="range" min={50} max={92} value={capY} onChange={(e) => setCapY(Number(e.target.value))} className="w-full" />
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
      </aside>

      <section className="rounded-2xl bg-slate-50/80 p-2 ring-1 ring-slate-900/[0.04] dark:bg-slate-950/40">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[11px] text-slate-400">
            {mode === "overlay" ? "Preview live du texte" : "Preview clips + captions + voix-off"}
          </p>
          {exportUrl ? (
            <a href={exportUrl} download={mode === "overlay" ? "texte.webm" : "montage.webm"} className="inline-flex items-center gap-1 text-[11px] font-medium">
              <Download className="h-3 w-3" />
              Télécharger
            </a>
          ) : null}
        </div>
        <div className="mx-auto w-fit max-w-full">
          {previewSrc ? (
            <div className="relative overflow-hidden rounded-xl bg-black" style={{ width: "min(360px, 100%)" }}>
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
              {mode === "overlay" && overlayText.trim() ? (
                <div
                  className="pointer-events-none absolute left-3 right-3 font-bold leading-tight"
                  style={{
                    top: `${textY}%`,
                    fontSize: `${textSize}px`,
                    textAlign: align,
                    color: fill,
                    textShadow: outline,
                    fontFamily: "var(--font-tiktok), sans-serif",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {overlayText}
                </div>
              ) : null}
              {mode === "overlay" && emojis.length ? (
                <div className="pointer-events-none absolute left-3 flex gap-1" style={{ top: `${Math.min(88, textY + 18)}%` }}>
                  {emojis.map((id) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={id} src={appleEmojiUrl(id, 64)} alt="" className="h-7 w-7" />
                  ))}
                </div>
              ) : null}
              {mode === "montage" && captions && cap.line.length ? (
                <div
                  className="pointer-events-none absolute left-3 right-3 text-center font-bold"
                  style={{
                    top: `${capY}%`,
                    fontSize: `${capSize}px`,
                    fontFamily: "var(--font-tiktok), sans-serif",
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
                            textShadow: outline,
                            marginRight: 6,
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
