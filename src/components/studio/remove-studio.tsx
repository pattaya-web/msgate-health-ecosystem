"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eraser, Loader2, Redo2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { assetProxy, pollStudioTask, studioPost } from "@/lib/studio/client";
import { cn } from "@/lib/utils";

export function RemoveStudio() {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const drawing = useRef(false);
  const drewStroke = useRef(false);
  const [src, setSrc] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [maskStack, setMaskStack] = useState<string[]>([]);
  const [maskCursor, setMaskCursor] = useState(-1);
  const [painted, setPainted] = useState(false);
  const [brush, setBrush] = useState(28);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);

  const original = history[0] || src;
  const working = cursor >= 0 ? history[cursor] : src;
  const hasResult = cursor > 0;
  const canUndo = cursor > 0 || maskCursor >= 0;
  const canRedo = (cursor >= 0 && cursor < history.length - 1) || maskCursor < maskStack.length - 1;

  function onFile(file?: File) {
    if (!file) return;
    void (async () => {
      try {
        const raw = await fileToDataUrl(file);
        const data = await resizeImage(raw, 1600);
        setSrc(data);
        setHistory([data]);
        setCursor(0);
        setMaskStack([]);
        setMaskCursor(-1);
        setPainted(false);
        setCompare(false);
      } catch {
        toast.error("Image illisible");
      }
    })();
  }

  function fitMask() {
    const img = imgRef.current;
    const canvas = maskRef.current;
    if (!img || !canvas) return;
    if (img.naturalWidth < 2 || img.naturalHeight < 2) return;
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
  }

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = maskRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function stamp(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = "rgba(255, 40, 180, 0.62)";
    ctx.beginPath();
    ctx.arc(x, y, brush, 0, Math.PI * 2);
    ctx.fill();
  }

  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = maskRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!canvas.width || !canvas.height) fitMask();
    const { x, y } = point(e);
    if (last.current) {
      ctx.strokeStyle = "rgba(255, 40, 180, 0.62)";
      ctx.lineWidth = brush * 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    stamp(ctx, x, y);
    last.current = { x, y };
    drewStroke.current = true;
    setPainted(true);
  }

  function endStroke() {
    const canvas = maskRef.current;
    last.current = null;
    drawing.current = false;
    if (!canvas || !drewStroke.current) return;
    drewStroke.current = false;
    const snap = canvas.toDataURL();
    setMaskStack((stack) => [...stack.slice(0, maskCursor + 1), snap]);
    setMaskCursor((i) => i + 1);
  }

  function restoreMask(dataUrl: string | null) {
    const canvas = maskRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) {
      setPainted(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      setPainted(true);
    };
    img.src = dataUrl;
  }

  function clearMask() {
    const canvas = maskRef.current;
    const ctx = canvas?.getContext("2d");
    ctx?.clearRect(0, 0, canvas?.width || 0, canvas?.height || 0);
    setPainted(false);
    setMaskStack([]);
    setMaskCursor(-1);
  }

  function undo() {
    if (maskCursor >= 0) {
      const next = maskCursor - 1;
      setMaskCursor(next);
      restoreMask(next >= 0 ? maskStack[next] : null);
      return;
    }
    if (cursor > 0) {
      setCursor((i) => i - 1);
      clearMask();
    }
  }

  function redo() {
    if (maskCursor < maskStack.length - 1) {
      const next = maskCursor + 1;
      setMaskCursor(next);
      restoreMask(maskStack[next]);
      return;
    }
    if (cursor < history.length - 1) {
      setCursor((i) => i + 1);
      clearMask();
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function erase() {
    const img = imgRef.current;
    const mask = maskRef.current;
    if (!working || !img || !mask || !painted) {
      toast.error("Gomme le logo ou le texte, puis clique Effacer");
      return;
    }
    setBusy(true);
    setCompare(false);
    try {
      setStatus("Préparation…");
      if (!img.naturalWidth) throw new Error("Image pas encore chargée");
      const mix = document.createElement("canvas");
      mix.width = img.naturalWidth;
      mix.height = img.naturalHeight;
      const ctx = mix.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponible");
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(mask, 0, 0);
      setStatus("Envoi…");
      const started = await studioPost<{ taskId: string }>({
        action: "remove",
        imageDataUrl: mix.toDataURL("image/jpeg", 0.82),
        resolution: "1K",
      });
      setStatus("Gommage IA…");
      const done = await pollStudioTask(started.taskId, 40);
      if (!done.urls[0]) throw new Error("Aucune image renvoyée");
      setStatus("Résultat…");
      const blob = await fetch(assetProxy(done.urls[0])).then((res) => {
        if (!res.ok) throw new Error("Image résultat illisible");
        return res.blob();
      });
      const next = await blobToDataUrl(blob);
      setHistory((list) => [...list.slice(0, cursor + 1), next]);
      setCursor((i) => i + 1);
      clearMask();
      setCompare(true);
      setSplit(50);
      toast.success("Gommage prêt");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Effacer impossible";
      toast.error(/no message available/i.test(message) ? "Gommage échoué — réessaie" : message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  function download() {
    if (!working) return;
    const a = document.createElement("a");
    a.href = working;
    a.download = "gomme.png";
    a.click();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo || busy}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-[12px] font-medium ring-1 ring-slate-900/[0.08] disabled:opacity-40 dark:bg-slate-900"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo || busy}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-[12px] font-medium ring-1 ring-slate-900/[0.08] disabled:opacity-40 dark:bg-slate-900"
        >
          <Redo2 className="h-3.5 w-3.5" />
          Redo
        </button>
        <label className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800">
          Pinceau {brush}px
          <input
            type="range"
            min={6}
            max={90}
            value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
            className="w-28"
          />
        </label>
        <button
          type="button"
          onClick={() => void erase()}
          disabled={busy || !painted}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-3 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eraser className="h-3.5 w-3.5" />}
          {busy ? status || "Gommage…" : "Effacer"}
        </button>
        <button
          type="button"
          onClick={() => setCompare((v) => !v)}
          disabled={!hasResult || busy}
          className={cn(
            "inline-flex h-8 items-center rounded-lg px-2.5 text-[12px] font-medium ring-1 ring-slate-900/[0.08] disabled:opacity-40",
            compare ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-white dark:bg-slate-900"
          )}
        >
          Avant / après
        </button>
        <button
          type="button"
          onClick={download}
          disabled={!hasResult}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-[12px] font-medium ring-1 ring-slate-900/[0.08] disabled:opacity-40 dark:bg-slate-900"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
        {working ? (
          <label className="ml-auto cursor-pointer text-[11px] font-medium text-slate-500">
            Autre photo
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/[0.06] dark:bg-slate-900">
        {working ? (
          <div className="relative mx-auto w-fit max-w-full select-none">
            {compare && hasResult ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={working} alt="après" draggable={false} className="block max-h-[72vh] w-auto max-w-full" />
                <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${split}%` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={original} alt="avant" draggable={false} className="h-full max-w-none" />
                </div>
                <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${split}%` }} />
                <input
                  type="range"
                  min={2}
                  max={98}
                  value={split}
                  onChange={(e) => setSplit(Number(e.target.value))}
                  className="absolute inset-x-0 bottom-3 mx-4"
                />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Avant</span>
                <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Après</span>
              </div>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={working}
                  alt=""
                  draggable={false}
                  onLoad={fitMask}
                  className="max-h-[72vh] w-auto max-w-full object-contain"
                />
                <canvas
                  ref={maskRef}
                  className="absolute inset-0 h-full w-full touch-none"
                  style={{ cursor: busy ? "wait" : "crosshair" }}
                  onPointerDown={(e) => {
                    if (busy) return;
                    drawing.current = true;
                    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                    paint(e);
                  }}
                  onPointerMove={(e) => drawing.current && paint(e)}
                  onPointerUp={endStroke}
                  onPointerLeave={() => drawing.current && endStroke()}
                />
                {busy ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/35 text-[13px] font-medium text-white">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {status || "Gommage…"}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <label className="flex min-h-[48vh] cursor-pointer flex-col items-center justify-center gap-2 text-[12px] text-slate-500">
            <Upload className="h-5 w-5" />
            Drop une photo — gomme le logo ou le texte, puis Effacer
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        )}
      </div>
    </div>
  );
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture image impossible"));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture image impossible"));
    reader.readAsDataURL(blob);
  });
}

function resizeImage(dataUrl: string, max: number) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas indisponible"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = dataUrl;
  });
}
