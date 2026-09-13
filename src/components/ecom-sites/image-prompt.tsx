"use client";

/**
 * Refaire une image en la décrivant, en français.
 *
 * Les visuels se régénéraient par fournées, avec des consignes écrites dans le
 * code : pour changer une seule bannière, il fallait tout relancer et espérer.
 * Ici on décrit ce qu'on veut, on joint au besoin une photo de référence, et
 * l'image remplace la précédente dès qu'elle sort.
 *
 * La consigne part telle quelle au modèle, en français : ce sont les mots de
 * l'opérateur. Le serveur l'encadre de la direction artistique du site, pour
 * que l'image régénérée ne détonne pas à côté des autres.
 */

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { EcomSite } from "@/lib/ecom-sites/types";

const RATIOS = ["9:16", "3:4", "1:1", "4:3", "16:9"] as const;

export type ImageTarget = {
  /** Ce qu'on remplace, en clair, pour le titre de la fenêtre. */
  label: string;
  /** L'image actuelle : elle sert de point de départ au modèle. */
  current?: string;
  /** Où ranger le résultat. */
  apply: (url: string) => void;
};

export function ImagePromptDialog({
  site,
  target,
  onClose,
}: {
  site: EcomSite;
  target: ImageTarget;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<string>(site.imageRatio || "1:1");
  const [keepCurrent, setKeepCurrent] = useState(Boolean(target.current));
  const [usePacks, setUsePacks] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const clockRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (clockRef.current) window.clearInterval(clockRef.current);
    };
  }, []);

  function addFiles(files: FileList | null) {
    for (const file of Array.from(files ?? []).slice(0, 3)) {
      const reader = new FileReader();
      reader.onload = () =>
        setUploads((current) => [...current, { name: file.name, dataUrl: String(reader.result || "") }]);
      reader.readAsDataURL(file);
    }
  }

  async function run() {
    if (!prompt.trim()) {
      toast.error("Décris ce que tu veux voir");
      return;
    }
    setBusy(true);
    setResult(null);
    setSeconds(0);
    clockRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    try {
      const res = await fetch("/api/ecom-sites/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          siteId: site.id,
          prompt,
          ratio,
          usePacks,
          refs: keepCurrent && target.current ? [target.current] : [],
          uploads,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      poll(body.taskId);
    } catch (error) {
      stopClock();
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    }
  }

  function stopClock() {
    if (clockRef.current) window.clearInterval(clockRef.current);
    clockRef.current = null;
  }

  function poll(taskId: string) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const res = await fetch("/api/ecom-sites/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", taskId }),
      });
      const body = await res.json();
      if (body.urls?.length) {
        setResult(body.urls[0]);
      } else if (body.state !== "fail") {
        return;
      } else {
        toast.error(body.failMsg || "Image impossible");
      }
      if (pollRef.current) window.clearInterval(pollRef.current);
      stopClock();
      setBusy(false);
    }, 4000);
  }

  const field =
    "h-9 rounded-lg border-0 bg-slate-100 px-2.5 text-[13px] outline-none ring-1 ring-transparent focus:ring-slate-300 dark:bg-slate-800";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-slate-400" />
          <h3 className="text-[14px] font-bold">Refaire l&apos;image · {target.label}</h3>
          <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          autoFocus
          placeholder="Écris en français. Ex. : une salle de bain claire le matin, mes produits posés sur le rebord du lavabo, une serviette pliée, lumière douce venant de la fenêtre à gauche."
          className="w-full rounded-lg border-0 bg-slate-100 p-3 text-[13px] leading-relaxed outline-none ring-1 ring-transparent focus:ring-slate-300 dark:bg-slate-800"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Format</label>
          <select value={ratio} onChange={(event) => setRatio(event.target.value)} className={field}>
            {RATIOS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
                {entry === site.imageRatio ? " · format du site" : ""}
              </option>
            ))}
          </select>

          <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={keepCurrent}
              disabled={!target.current}
              onChange={(event) => setKeepCurrent(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            Partir de l&apos;image actuelle
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={usePacks}
              onChange={(event) => setUsePacks(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            Mettre mes produits dedans
          </label>
        </div>

        {/* Références jointes : une photo à imiter, un décor, un pack précis. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800">
            <ImagePlus className="h-3.5 w-3.5" />
            Joindre une référence
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
          {uploads.map((upload, index) => (
            <span key={upload.name + index} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={upload.dataUrl} alt="" className="h-9 w-12 rounded-md object-cover" />
              <button
                type="button"
                onClick={() => setUploads((current) => current.filter((_, i) => i !== index))}
                className="absolute -right-1 -top-1 rounded-full bg-white p-0.5 text-rose-600 shadow dark:bg-slate-900"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {target.current ? (
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
              actuelle
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={target.current} alt="" className="h-9 w-12 rounded-md object-cover" />
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[13px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {busy ? `Génération… ${seconds}s` : "Générer"}
          </button>
          <p className="text-[11px] text-slate-400">
            gpt-image-2 · une image met une à deux minutes
          </p>
        </div>

        {/* Rien ne remplace l'existant sans que tu aies vu le résultat. */}
        {result ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result} alt="" className="max-h-[42vh] w-full rounded-lg object-contain" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  target.apply(result);
                  toast.success("Image remplacée — enregistre pour la garder");
                  onClose();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[13px] font-semibold text-white"
              >
                Remplacer l&apos;image
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[13px] font-semibold disabled:opacity-50 dark:bg-slate-700"
              >
                Refaire
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
