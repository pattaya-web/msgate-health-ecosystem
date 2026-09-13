"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileVideo, HardDrive, ImagePlus, Loader2, Maximize2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { DriveFile } from "@/lib/drive/store";
import { cn } from "@/lib/utils";

/**
 * Inspirations créatives d'une boutique suivie.
 *
 * Les fichiers vivent dans le Drive, dossier « Creative Spy / <boutique> » :
 * ce qu'on dépose ici se retrouve donc aussi dans le Drive, et inversement.
 * Tous les formats passent — webp, mp4, png, jpg, gif, mov — avec un aperçu
 * quand le navigateur sait l'afficher.
 */

const PLAYABLE = /\.(mp4|webm|m4v)$/i;

function fileUrl(path: string, download = false) {
  return `/api/drive/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

export function folderFor(shopName: string) {
  return `Creative Spy/${shopName.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()}`;
}

export function Inspirations({ shopName }: { shopName: string }) {
  const folder = folderFor(shopName);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<DriveFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/drive?path=${encodeURIComponent(folder)}`, { cache: "no-store" });
      const body = (await res.json()) as { files?: DriveFile[] };
      setFiles(body.files ?? []);
    } catch {
      setFiles([]);
    }
  }, [folder]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function upload(list: FileList | File[]) {
    const picked = [...list].filter((file) => file.size > 0);
    if (!picked.length) return;
    setUploading(picked.length);
    try {
      const form = new FormData();
      form.set("path", folder);
      for (const file of picked) form.append("files", file);
      const res = await fetch("/api/drive", { method: "POST", body: form });
      const body = (await res.json()) as { saved?: string[]; error?: string };
      if (!res.ok) throw new Error(body.error);
      toast.success(`${body.saved?.length ?? 0} inspiration(s) rangée(s) dans « ${folder} »`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Envoi impossible");
    } finally {
      setUploading(0);
    }
  }

  async function remove(file: DriveFile) {
    if (!window.confirm(`Supprimer « ${file.name} » ?`)) return;
    try {
      const res = await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", path: file.path }),
      });
      if (!res.ok) throw new Error("Suppression impossible");
      setPreview(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        if (event.dataTransfer.files?.length) void upload(event.dataTransfer.files);
      }}
      className={cn("rounded-xl border border-dashed p-2 transition-colors", over ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10" : "border-slate-200 dark:border-slate-700")}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Inspirations créatives{files?.length ? ` · ${files.length}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <Link href={`/drive?path=${encodeURIComponent(folder)}`} title="Ouvrir le dossier dans le Drive" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
            <HardDrive className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading > 0}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploading ? `Envoi de ${uploading}…` : "Ajouter"}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*,.webp,.mov,.gif"
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) void upload(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {files === null ? (
        <div className="py-2 text-[11px] text-slate-400">…</div>
      ) : files.length ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {files.map((file) => {
            const src = fileUrl(file.path);
            const playable = file.kind === "video" && PLAYABLE.test(file.name);
            return (
              <div key={file.path} className="group relative w-[76px] shrink-0">
                <button type="button" onClick={() => setPreview(file)} className="block aspect-square w-full overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700" title={file.name}>
                  {file.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : playable ? (
                    <video src={`${src}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                      <FileVideo className="h-5 w-5" />
                      <span className="text-[9px] uppercase">{file.name.split(".").pop()}</span>
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(file)}
                  title="Supprimer"
                  className="absolute right-0.5 top-0.5 hidden rounded-md bg-slate-950/60 p-0.5 text-white group-hover:block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-1 text-[11px] text-slate-400">Glisse ici les pubs et visuels de cette boutique : webp, mp4, png, jpg, gif, mov…</p>
      )}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="relative max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            {preview.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(preview.path)} alt="" className="max-h-[88vh] w-auto max-w-full rounded-xl object-contain" />
            ) : preview.kind === "video" && PLAYABLE.test(preview.name) ? (
              <video src={fileUrl(preview.path)} controls autoPlay playsInline className="max-h-[88vh] w-auto max-w-full rounded-xl" />
            ) : (
              <div className="rounded-xl bg-white p-8 text-center text-[12px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                Ce format ne se lit pas dans le navigateur.{" "}
                <a href={fileUrl(preview.path, true)} className="font-semibold underline">
                  Télécharger {preview.name}
                </a>
              </div>
            )}
            <div className="absolute right-2 top-2 flex items-center gap-1">
              <a href={fileUrl(preview.path, true)} title="Télécharger" className="rounded-md bg-slate-950/60 p-1.5 text-white hover:bg-slate-950/80">
                <Maximize2 className="h-3.5 w-3.5" />
              </a>
              <button type="button" onClick={() => setPreview(null)} className="rounded-md bg-slate-950/60 p-1.5 text-white hover:bg-slate-950/80" aria-label="Fermer">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
