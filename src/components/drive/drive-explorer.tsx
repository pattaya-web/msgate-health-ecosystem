"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  FileAudio,
  File as FileIcon,
  FileVideo,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Loader2,
  Maximize2,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import type { DriveFile, DriveFolder, DriveListing } from "@/lib/drive/store";
import { cn } from "@/lib/utils";

/**
 * Le Drive : l'endroit où l'on range ce qu'on garde.
 *
 * Un dossier par boutique, par campagne, par ce qu'on veut. On y dépose les
 * créas retenues et les médias reçus, on les retrouve par le nom. Rien de
 * plus : pas de tags, pas de statut, un arbre de dossiers qu'on lit d'un
 * coup d'œil.
 *
 * Tout se fait à la souris : un fichier lâché sur un dossier y entre, un
 * fichier lâché ailleurs entre dans le dossier ouvert, et une vignette du
 * Drive se glisse d'un dossier à l'autre.
 */

const panel = "rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";

/** Type MIME maison posé sur un glisser interne : il distingue un déplacement d'un dépôt. */
const INTERNAL = "text/x-drive-path";

/** Les formats que le navigateur sait lire en ligne ; les autres gardent une icône. */
const PLAYABLE = /\.(mp4|webm|m4v)$/i;

function fileUrl(path: string, download = false) {
  return `/api/drive/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

async function driveJson<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/drive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Opération impossible");
  return data;
}

export function DriveExplorer() {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriveFile[] | null>(null);
  const [uploading, setUploading] = useState<{ count: number; into: string } | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [preview, setPreview] = useState<DriveFile | null>(null);
  const [moving, setMoving] = useState<{ path: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/drive?path=${encodeURIComponent(target)}`, { cache: "no-store" });
      const body = (await res.json()) as DriveListing & { error?: string };
      if (!res.ok) throw new Error(body.error);
      setListing(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Drive illisible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(path), 0);
    return () => clearTimeout(timer);
  }, [load, path]);

  /* Un lien vers un dossier précis : /drive?path=Creative%20Spy/Marque. */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("path");
    if (!wanted) return;
    const timer = setTimeout(() => setPath(wanted.replace(/^\/+|\/+$/g, "")), 0);
    return () => clearTimeout(timer);
  }, []);

  /* Recherche dans tout l'arbre, avec un léger délai pour ne pas interroger à chaque touche. */
  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      const clear = setTimeout(() => setResults(null), 0);
      return () => clearTimeout(clear);
    }
    const timer = setTimeout(() => {
      void fetch(`/api/drive?q=${encodeURIComponent(needle)}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((body: { results?: DriveFile[] }) => setResults(body.results ?? []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const crumbs = useMemo(() => {
    const parts = path.split("/").filter(Boolean);
    return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
  }, [path]);

  async function upload(files: FileList | File[], into = path) {
    const list = [...files].filter((file) => file.size > 0);
    if (!list.length) return;
    setUploading({ count: list.length, into });
    try {
      const form = new FormData();
      form.set("path", into);
      for (const file of list) form.append("files", file);
      const res = await fetch("/api/drive", { method: "POST", body: form });
      const body = (await res.json()) as { saved?: string[]; error?: string };
      if (!res.ok) throw new Error(body.error);
      toast.success(`${body.saved?.length ?? 0} fichier(s) déposé(s) dans ${into ? `« ${into.split("/").pop()} »` : "le Drive"}`);
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Envoi impossible");
    } finally {
      setUploading(null);
    }
  }

  async function newFolder() {
    const name = window.prompt("Nom du dossier");
    if (!name?.trim()) return;
    try {
      await driveJson({ action: "mkdir", path, name });
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dossier impossible");
    }
  }

  async function remove(target: string, label: string) {
    if (!window.confirm(`Supprimer « ${label} » ? C'est définitif.`)) return;
    try {
      await driveJson({ action: "delete", path: target });
      setPreview(null);
      await load(path);
      if (results) setResults(results.filter((file) => file.path !== target));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  async function renameItem(target: string, current: string) {
    const name = window.prompt("Nouveau nom", current);
    if (!name?.trim() || name === current) return;
    try {
      await driveJson({ action: "rename", path: target, name });
      setPreview(null);
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Renommage impossible");
    }
  }

  async function moveEntry(source: string, into: string) {
    if (!source || source === into || into.startsWith(`${source}/`)) return;
    try {
      await driveJson({ action: "move", path: source, into });
      toast.success(`« ${source.split("/").pop()} » déplacé dans ${into ? `« ${into.split("/").pop()} »` : "la racine"}`);
      setMoving(null);
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Déplacement impossible");
    }
  }

  /** Un dépôt sur un dossier : des fichiers du disque, ou une vignette du Drive. */
  function dropInto(into: string, transfer: DataTransfer) {
    const internal = transfer.getData(INTERNAL);
    if (internal) return void moveEntry(internal, into);
    if (transfer.files?.length) return void upload(transfer.files, into);
  }

  const folders = listing?.folders ?? [];
  const files = results ?? listing?.files ?? [];
  const searching = results !== null;
  const dragging = dragDepth > 0;

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={(event) => {
        event.preventDefault();
        setDragDepth(0);
        dropInto(path, event.dataTransfer);
      }}
    >
      <PageHeader
        title="Drive"
        description="Tes créas retenues, tes médias, tes pubs : des dossiers, et tout se retrouve par le nom. Lâche un fichier sur un dossier pour l'y ranger."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void newFolder()}>
              <FolderPlus className="h-3.5 w-3.5" />
              Nouveau dossier
            </Button>
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={Boolean(uploading)}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? `Envoi de ${uploading.count} fichier(s)…` : "Envoyer des fichiers"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) void upload(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        }
      />

      <div className={cn(panel, "mb-4 flex flex-wrap items-center gap-2")}>
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[12px]">
          <CrumbButton
            active={!path}
            onClick={() => {
              setPath("");
              setQuery("");
            }}
            onDropInto={(transfer) => dropInto("", transfer)}
          >
            <HardDrive className="h-3.5 w-3.5" />
            Drive
          </CrumbButton>
          {crumbs.map((crumb) => (
            <span key={crumb.path} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-slate-400" />
              <CrumbButton
                active={crumb.path === path}
                onClick={() => {
                  setPath(crumb.path);
                  setQuery("");
                }}
                onDropInto={(transfer) => dropInto(crumb.path, transfer)}
              >
                {crumb.name}
              </CrumbButton>
            </span>
          ))}
        </nav>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Chercher dans tout le Drive"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-[12px] dark:border-slate-700 dark:bg-slate-950"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Effacer">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {moving ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <FolderInput className="h-3.5 w-3.5" />
          Déplacer « {moving.name} » : ouvre le dossier de destination, puis
          <Button size="sm" variant="outline" onClick={() => void moveEntry(moving.path, path)}>
            Déposer ici{path ? ` (${path.split("/").pop()})` : " (racine)"}
          </Button>
          <button type="button" onClick={() => setMoving(null)} className="text-[11px] underline-offset-2 hover:underline">
            Annuler
          </button>
        </div>
      ) : null}

      {dragging ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center">
          <div className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg">
            Lâche sur un dossier pour l&apos;y ranger, ou n&apos;importe où pour déposer dans {path ? `« ${path.split("/").pop()} »` : "le Drive"}
          </div>
        </div>
      ) : null}

      {loading && !listing ? (
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Lecture du Drive…
        </div>
      ) : null}

      {!searching && folders.length ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {folders.map((folder) => (
            <FolderTile
              key={folder.path}
              folder={folder}
              receiving={uploading?.into === folder.path}
              onOpen={() => setPath(folder.path)}
              onRename={() => void renameItem(folder.path, folder.name)}
              onMove={() => setMoving({ path: folder.path, name: folder.name })}
              onDelete={() => void remove(folder.path, folder.name)}
              onDropInto={(transfer) => dropInto(folder.path, transfer)}
            />
          ))}
        </div>
      ) : null}

      {searching ? (
        <p className="mb-2 text-[11px] text-slate-500">
          {files.length} résultat(s) pour « {query.trim()} » dans tout le Drive
        </p>
      ) : null}

      {files.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {files.map((file) => (
            <FileTile
              key={file.path}
              file={file}
              showPath={searching}
              onOpen={() => setPreview(file)}
              onGoTo={() => {
                setQuery("");
                setPath(file.path.split("/").slice(0, -1).join("/"));
              }}
              onMove={() => setMoving({ path: file.path, name: file.name })}
              onDelete={() => void remove(file.path, file.name)}
            />
          ))}
        </div>
      ) : listing && !folders.length && !loading ? (
        <EmptyState
          title={searching ? "Rien trouvé" : "Dossier vide"}
          description={searching ? "Essaie un autre mot du nom de fichier." : "Glisse des fichiers ici, ou clique « Envoyer des fichiers ». Crée des dossiers par boutique ou par campagne."}
        />
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 md:flex-row" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
              {preview.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(preview.path)} alt="" className="max-h-[85vh] w-auto max-w-full object-contain" />
              ) : preview.kind === "video" && PLAYABLE.test(preview.name) ? (
                <video src={fileUrl(preview.path)} controls autoPlay playsInline className="max-h-[85vh] w-auto max-w-full" />
              ) : preview.kind === "audio" ? (
                <audio src={fileUrl(preview.path)} controls className="w-full max-w-md p-6" />
              ) : (
                <div className="p-10 text-center text-[12px] text-slate-300">
                  {preview.kind === "video" ? <FileVideo className="mx-auto mb-2 h-10 w-10" /> : <FileIcon className="mx-auto mb-2 h-10 w-10" />}
                  {preview.kind === "video"
                    ? "Ce format ne se lit pas dans le navigateur (.mov, par exemple). Télécharge-le pour le voir."
                    : "Pas d'aperçu pour ce type de fichier"}
                </div>
              )}
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 p-4 md:w-[280px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-[13px] font-semibold text-slate-900 dark:text-slate-100">{preview.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {formatSize(preview.size)} · {new Date(preview.mtime).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                  <div className="truncate text-[11px] text-slate-400" title={preview.path}>
                    {preview.path.split("/").slice(0, -1).join(" / ") || "Racine"}
                  </div>
                </div>
                <button type="button" onClick={() => setPreview(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <a
                href={fileUrl(preview.path, true)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger
              </a>
              <button
                type="button"
                onClick={() => void renameItem(preview.path, preview.name)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
              >
                <Pencil className="h-3.5 w-3.5" />
                Renommer
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoving({ path: preview.path, name: preview.name });
                  setPreview(null);
                }}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
              >
                <FolderInput className="h-3.5 w-3.5" />
                Déplacer
              </button>
              <button
                type="button"
                onClick={() => void remove(preview.path, preview.name)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Un fil d'Ariane qui accepte aussi un dépôt : lâcher sur « Drive » range à la racine. */
function CrumbButton({
  active,
  onClick,
  onDropInto,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onDropInto: (transfer: DataTransfer) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        onDropInto(event.dataTransfer);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800",
        active && "font-semibold text-slate-900 dark:text-slate-100",
        over && "bg-emerald-50 ring-2 ring-emerald-400 dark:bg-emerald-500/10"
      )}
    >
      {children}
    </button>
  );
}

function FolderTile({
  folder,
  receiving,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onDropInto,
}: {
  folder: DriveFolder;
  receiving: boolean;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDropInto: (transfer: DataTransfer) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(INTERNAL, folder.path);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(INTERNAL) ? "move" : "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        onDropInto(event.dataTransfer);
      }}
      className={cn(
        panel,
        "group flex items-center gap-2 transition-shadow",
        over && "bg-emerald-50 ring-2 ring-emerald-400 dark:bg-emerald-500/10",
        receiving && "opacity-70"
      )}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {receiving ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-500" /> : <FolderOpen className="h-5 w-5 shrink-0 text-amber-500" />}
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-medium text-slate-900 dark:text-slate-100">{folder.name}</span>
          <span className="block text-[10px] text-slate-500">{receiving ? "Réception…" : `${folder.count} élément(s)`}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" onClick={onRename} title="Renommer" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onMove} title="Déplacer" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
          <FolderInput className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onDelete} title="Supprimer" className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function FileTile({
  file,
  showPath,
  onOpen,
  onGoTo,
  onMove,
  onDelete,
}: {
  file: DriveFile;
  showPath: boolean;
  onOpen: () => void;
  onGoTo: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const src = fileUrl(file.path);
  const playable = file.kind === "video" && PLAYABLE.test(file.name);
  return (
    <div
      className="group"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(INTERNAL, file.path);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/[0.06] dark:bg-slate-800 dark:ring-slate-100/[0.06]">
        <button type="button" onClick={onOpen} className="h-full w-full" title="Ouvrir">
          {file.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : playable ? (
            <video src={`${src}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400">
              {file.kind === "video" ? <FileVideo className="h-8 w-8" /> : file.kind === "audio" ? <FileAudio className="h-8 w-8" /> : <FileIcon className="h-8 w-8" />}
              <span className="text-[10px] uppercase">{file.name.split(".").pop()}</span>
            </div>
          )}
        </button>
        <div className="absolute inset-x-1 top-1 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
          <a href={fileUrl(file.path, true)} title="Télécharger" className="rounded-md bg-slate-950/60 p-1 text-white hover:bg-slate-950/80">
            <Download className="h-3 w-3" />
          </a>
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={onMove} title="Déplacer" className="rounded-md bg-slate-950/60 p-1 text-white hover:bg-slate-950/80">
              <FolderInput className="h-3 w-3" />
            </button>
            <button type="button" onClick={onOpen} title="Agrandir" className="rounded-md bg-slate-950/60 p-1 text-white hover:bg-slate-950/80">
              <Maximize2 className="h-3 w-3" />
            </button>
            <button type="button" onClick={onDelete} title="Supprimer" className="rounded-md bg-slate-950/60 p-1 text-white hover:bg-rose-600">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-700 dark:text-slate-200" title={file.name}>
        {file.name}
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span>{formatSize(file.size)}</span>
        {showPath ? (
          <button type="button" onClick={onGoTo} className="truncate hover:underline" title={file.path}>
            {file.path.split("/").slice(0, -1).join(" / ") || "Racine"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
