"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CheckSquare,
  ChevronRight,
  ClipboardPaste,
  Copy,
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
  Scissors,
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
 * Tout se fait à la souris, comme dans un explorateur de fichiers : un
 * fichier lâché sur un dossier y entre, un dossier se glisse dans un autre,
 * une sélection (clic, Ctrl/Maj + clic) se déplace d'un bloc, le clic droit
 * ouvre renommer / copier / couper / coller / supprimer, et la liste se trie
 * et se filtre comme on veut. Le tri est retenu d'une visite à l'autre.
 */

const panel = "rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";

/** Type MIME maison posé sur un glisser interne : il distingue un déplacement d'un dépôt. Les chemins sont séparés par des sauts de ligne. */
const INTERNAL = "text/x-drive-path";

/** Les formats que le navigateur sait lire en ligne ; les autres gardent une icône. */
const PLAYABLE = /\.(mp4|webm|m4v)$/i;

const SORT_KEY = "msgate.drive.sort";

type SortBy = "name" | "date" | "size" | "kind";
type TypeFilter = "all" | "image" | "video" | "audio" | "file";
type Clipboard = { mode: "copy" | "cut"; paths: string[] };
type Menu = { x: number; y: number; target: { path: string; name: string; kind: "folder" | "file" } | null };

function fileUrl(path: string, download = false) {
  return `/api/drive/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

function baseName(path: string) {
  return path.split("/").pop() ?? path;
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

function loadSort(): { by: SortBy; dir: "asc" | "desc" } {
  try {
    const parsed = JSON.parse(localStorage.getItem(SORT_KEY) || "") as { by?: SortBy; dir?: "asc" | "desc" };
    if (parsed && ["name", "date", "size", "kind"].includes(parsed.by ?? "") && (parsed.dir === "asc" || parsed.dir === "desc")) return { by: parsed.by as SortBy, dir: parsed.dir };
  } catch {
    // premier passage ou stockage indisponible
  }
  return { by: "name", dir: "asc" };
}

/** Les chemins d'un glisser interne : la sélection entière si l'élément saisi en fait partie, sinon lui seul. */
function readInternal(transfer: DataTransfer): string[] {
  return transfer
    .getData(INTERNAL)
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  const [sort, setSort] = useState<{ by: SortBy; dir: "asc" | "desc" }>(loadSort);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [picker, setPicker] = useState<{ mode: "move" | "copy"; paths: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPick = useRef<string | null>(null);

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

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    } catch {
      // le tri tient pour la session
    }
  }, [sort]);

  /* Le menu contextuel se ferme au clic ailleurs ou à Échap. */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

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
      toast.success(`${body.saved?.length ?? 0} fichier(s) déposé(s) dans ${into ? `« ${baseName(into)} »` : "le Drive"}`);
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Envoi impossible");
    } finally {
      setUploading(null);
    }
  }

  async function newFolder(into = path) {
    const name = window.prompt("Nom du dossier");
    if (!name?.trim()) return;
    try {
      await driveJson({ action: "mkdir", path: into, name });
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dossier impossible");
    }
  }

  /** Les cibles d'une action : la sélection si l'élément visé en fait partie, sinon lui seul. */
  function targetsOf(target: string): string[] {
    return selected.has(target) && selected.size > 1 ? [...selected] : [target];
  }

  async function remove(target: string) {
    const targets = targetsOf(target);
    const label = targets.length > 1 ? `${targets.length} éléments` : `« ${baseName(target)} »`;
    if (!window.confirm(`Supprimer ${label} ? C'est définitif.`)) return;
    setBusy("Suppression…");
    try {
      for (const entry of targets) await driveJson({ action: "delete", path: entry });
      setPreview(null);
      setSelected(new Set());
      await load(path);
      if (results) setResults(results.filter((file) => !targets.includes(file.path)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    } finally {
      setBusy(null);
    }
  }

  async function renameItem(target: string, current: string) {
    const name = window.prompt("Nouveau nom", current);
    if (!name?.trim() || name === current) return;
    try {
      await driveJson({ action: "rename", path: target, name });
      setPreview(null);
      setSelected(new Set());
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Renommage impossible");
    }
  }

  /** Déplace (ou copie) une liste d'entrées dans un dossier ; un dossier ne rentre jamais dans lui-même. */
  async function transfer(sources: string[], into: string, mode: "move" | "copy") {
    const list = sources.filter((source) => source && source !== into && !into.startsWith(`${source}/`) && (mode === "copy" || source.split("/").slice(0, -1).join("/") !== into));
    if (!list.length) return;
    setBusy(mode === "move" ? "Déplacement…" : "Copie…");
    try {
      for (const source of list) await driveJson({ action: mode, path: source, into });
      toast.success(`${list.length > 1 ? `${list.length} éléments` : `« ${baseName(list[0]) } »`} ${mode === "move" ? "déplacé" : "copié"}${list.length > 1 ? "s" : ""} dans ${into ? `« ${baseName(into)} »` : "la racine"}`);
      setSelected(new Set());
      await load(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Opération impossible");
    } finally {
      setBusy(null);
    }
  }

  function copyToClipboard(target: string, mode: "copy" | "cut") {
    const paths = targetsOf(target);
    setClipboard({ mode, paths });
    toast.success(`${paths.length > 1 ? `${paths.length} éléments` : `« ${baseName(target)} »`} ${mode === "copy" ? "copié" : "coupé"}${paths.length > 1 ? "s" : ""} — colle dans un dossier (Ctrl+V ou clic droit)`);
  }

  async function paste(into = path) {
    if (!clipboard) return;
    await transfer(clipboard.paths, into, clipboard.mode === "cut" ? "move" : "copy");
    if (clipboard.mode === "cut") setClipboard(null);
  }

  /** « Déplacer vers… » / « Copier vers… » : on choisit le dossier de destination dans l'arbre entier. */
  function openPicker(target: string, mode: "move" | "copy") {
    setPicker({ mode, paths: targetsOf(target) });
  }

  /** Un dépôt sur un dossier : des fichiers du disque, ou des vignettes du Drive. */
  function dropInto(into: string, transfer_: DataTransfer) {
    const internal = readInternal(transfer_);
    if (internal.length) return void transfer(internal, into, "move");
    if (transfer_.files?.length) return void upload(transfer_.files, into);
  }

  /** Clic simple : sélection ; Ctrl : ajoute ; Maj : plage depuis le dernier cliqué. */
  function pick(target: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, order: string[]) {
    setSelected((current) => {
      const next = new Set(event.ctrlKey || event.metaKey || event.shiftKey ? current : []);
      if (event.shiftKey && lastPick.current && order.includes(lastPick.current)) {
        const a = order.indexOf(lastPick.current);
        const b = order.indexOf(target);
        for (const entry of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(entry);
      } else if ((event.ctrlKey || event.metaKey) && next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
    lastPick.current = target;
  }

  /** Ce que porte un glisser : la sélection si l'élément saisi en fait partie. */
  function dragPayload(target: string) {
    return targetsOf(target).join("\n");
  }

  const searching = results !== null;
  const rawFolders = useMemo(() => listing?.folders ?? [], [listing]);
  const rawFiles = useMemo(() => results ?? listing?.files ?? [], [results, listing]);
  const needle = filter.trim().toLowerCase();
  const folders = useMemo(() => {
    const list = rawFolders.filter((folder) => !needle || folder.name.toLowerCase().includes(needle));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => (sort.by === "size" ? (a.count - b.count) * dir : a.name.localeCompare(b.name, "fr") * dir));
  }, [rawFolders, needle, sort]);
  const files = useMemo(() => {
    const list = rawFiles.filter((file) => (typeFilter === "all" || file.kind === typeFilter) && (!needle || file.name.toLowerCase().includes(needle)));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort.by) {
        case "date":
          return (new Date(a.mtime).getTime() - new Date(b.mtime).getTime()) * dir;
        case "size":
          return (a.size - b.size) * dir;
        case "kind":
          return (a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "fr")) * dir;
        default:
          return a.name.localeCompare(b.name, "fr") * dir;
      }
    });
  }, [rawFiles, typeFilter, needle, sort]);
  const order = useMemo(() => [...folders.map((folder) => folder.path), ...files.map((file) => file.path)], [folders, files]);
  const dragging = dragDepth > 0;
  const counts = useMemo(() => ({ image: rawFiles.filter((f) => f.kind === "image").length, video: rawFiles.filter((f) => f.kind === "video").length, audio: rawFiles.filter((f) => f.kind === "audio").length, file: rawFiles.filter((f) => f.kind === "file").length }), [rawFiles]);

  /* Raccourcis clavier : Ctrl+C / X / V, Suppr, F2, Ctrl+A, Échap. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (preview) return;
      const one = selected.size === 1 ? [...selected][0] : null;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selected.size) {
        event.preventDefault();
        setClipboard({ mode: "copy", paths: [...selected] });
        toast.success(`${selected.size} élément(s) copié(s)`);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x" && selected.size) {
        event.preventDefault();
        setClipboard({ mode: "cut", paths: [...selected] });
        toast.success(`${selected.size} élément(s) coupé(s)`);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && clipboard) {
        event.preventDefault();
        void paste(path);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set(order));
      } else if (event.key === "Delete" && selected.size) {
        event.preventDefault();
        void remove([...selected][0]);
      } else if (event.key === "F2" && one) {
        event.preventDefault();
        void renameItem(one, baseName(one));
      } else if (event.key === "Escape") {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function openMenu(event: React.MouseEvent, target: Menu["target"]) {
    event.preventDefault();
    event.stopPropagation();
    if (target && !selected.has(target.path)) setSelected(new Set([target.path]));
    setMenu({ x: Math.min(event.clientX, window.innerWidth - 240), y: Math.min(event.clientY, window.innerHeight - 320), target });
  }

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
      onContextMenu={(event) => openMenu(event, null)}
      onClick={() => setSelected(new Set())}
      className="min-h-[75vh]"
      data-drive
    >
      <PageHeader
        title="Drive"
        description="Tes créas retenues, tes médias, tes pubs : des dossiers, et tout se retrouve par le nom. Glisse pour ranger, clic droit pour renommer, copier, coller, supprimer."
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

      <div className={cn(panel, "mb-3 flex flex-wrap items-center gap-2")} onClick={(event) => event.stopPropagation()}>
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[12px]">
          <CrumbButton
            active={!path}
            onClick={() => {
              setPath("");
              setQuery("");
            }}
            onDropInto={(t) => dropInto("", t)}
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
                onDropInto={(t) => dropInto(crumb.path, t)}
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

      {/* Tri, filtres et actions sur la sélection : la barre d'un explorateur. */}
      <div className={cn(panel, "mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]")} onClick={(event) => event.stopPropagation()} data-drive-toolbar>
        <label className="flex items-center gap-1 text-slate-500">
          <span className="font-semibold uppercase tracking-wide">Trier</span>
          <select value={sort.by} onChange={(event) => setSort((current) => ({ ...current, by: event.target.value as SortBy }))} className="rounded-lg bg-slate-100 px-2 py-1 font-medium dark:bg-slate-800" data-drive-sort>
            <option value="name">Nom</option>
            <option value="date">Date</option>
            <option value="size">Taille</option>
            <option value="kind">Type</option>
          </select>
          <button type="button" onClick={() => setSort((current) => ({ ...current, dir: current.dir === "asc" ? "desc" : "asc" }))} className="rounded-lg bg-slate-100 p-1 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300" title={sort.dir === "asc" ? "Croissant" : "Décroissant"} data-drive-sort-dir={sort.dir}>
            {sort.dir === "asc" ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
          </button>
        </label>
        <div className="flex items-center gap-1 text-slate-500">
          <span className="font-semibold uppercase tracking-wide">Type</span>
          <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800" role="group">
            {(
              [
                ["all", "Tout"],
                ["image", `Images${counts.image ? ` ${counts.image}` : ""}`],
                ["video", `Vidéos${counts.video ? ` ${counts.video}` : ""}`],
                ["audio", `Audio${counts.audio ? ` ${counts.audio}` : ""}`],
                ["file", `Autres${counts.file ? ` ${counts.file}` : ""}`],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={typeFilter === id} onClick={() => setTypeFilter(id)} className={cn("rounded px-2 py-0.5 text-[10.5px] font-medium", typeFilter === id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")} data-drive-type={id}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrer ce dossier" className="w-40 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950" data-drive-filter />
        <div className="ml-auto flex items-center gap-2">
          {selected.size ? (
            <>
              <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200" data-drive-selected={selected.size}>
                <CheckSquare className="h-3.5 w-3.5" /> {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
              </span>
              <button type="button" onClick={() => openPicker([...selected][0], "move")} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300" data-drive-move-to><FolderInput className="h-3.5 w-3.5" /> Déplacer vers…</button>
              <button type="button" onClick={() => copyToClipboard([...selected][0], "copy")} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Copier</button>
              <button type="button" onClick={() => copyToClipboard([...selected][0], "cut")} className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Couper</button>
              <button type="button" onClick={() => void remove([...selected][0])} className="rounded-md border border-rose-200 px-2 py-0.5 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-500/10">Supprimer</button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-slate-700" aria-label="Désélectionner"><X className="h-3.5 w-3.5" /></button>
            </>
          ) : null}
          {clipboard ? (
            <button type="button" onClick={() => void paste(path)} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900" title={clipboard.paths.map(baseName).join(", ")} data-drive-paste>
              <ClipboardPaste className="h-3.5 w-3.5" /> Coller {clipboard.paths.length} ici{clipboard.mode === "cut" ? " (déplacer)" : " (copier)"}
            </button>
          ) : null}
          {busy ? <span className="inline-flex items-center gap-1 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}</span> : null}
        </div>
      </div>

      {dragging ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center">
          <div className="rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg">
            Lâche sur un dossier pour l&apos;y ranger, ou n&apos;importe où pour déposer dans {path ? `« ${baseName(path)} »` : "le Drive"}
          </div>
        </div>
      ) : null}

      {loading && !listing ? (
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Lecture du Drive…
        </div>
      ) : null}

      {!searching && folders.length ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-drive-folders>
          {folders.map((folder) => (
            <FolderTile
              key={folder.path}
              folder={folder}
              selected={selected.has(folder.path)}
              receiving={uploading?.into === folder.path}
              cut={clipboard?.mode === "cut" && clipboard.paths.includes(folder.path)}
              onOpen={() => setPath(folder.path)}
              onPick={(event) => pick(folder.path, event, order)}
              onMenu={(event) => openMenu(event, { path: folder.path, name: folder.name, kind: "folder" })}
              dragPayload={() => dragPayload(folder.path)}
              onDropInto={(t) => dropInto(folder.path, t)}
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6" data-drive-files>
          {files.map((file) => (
            <FileTile
              key={file.path}
              file={file}
              showPath={searching}
              selected={selected.has(file.path)}
              cut={clipboard?.mode === "cut" && clipboard.paths.includes(file.path)}
              onOpen={() => setPreview(file)}
              onPick={(event) => pick(file.path, event, order)}
              onMenu={(event) => openMenu(event, { path: file.path, name: file.name, kind: "file" })}
              dragPayload={() => dragPayload(file.path)}
              onGoTo={() => {
                setQuery("");
                setPath(file.path.split("/").slice(0, -1).join("/"));
              }}
            />
          ))}
        </div>
      ) : listing && !folders.length && !loading ? (
        <EmptyState
          title={searching ? "Rien trouvé" : needle || typeFilter !== "all" ? "Rien ne passe ce filtre" : "Dossier vide"}
          description={searching ? "Essaie un autre mot du nom de fichier." : needle || typeFilter !== "all" ? "Change le filtre de type ou le texte du filtre." : "Glisse des fichiers ici, ou clique « Envoyer des fichiers ». Crée des dossiers par boutique ou par campagne."}
        />
      ) : null}

      {menu ? (
        <div className="fixed z-50 w-56 overflow-hidden rounded-xl bg-white py-1 text-[12px] shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-slate-100/10" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()} data-drive-menu>
          {menu.target ? (
            <>
              <div className="truncate px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{selected.size > 1 && selected.has(menu.target.path) ? `${selected.size} éléments` : menu.target.name}</div>
              <MenuItem icon={menu.target.kind === "folder" ? FolderOpen : Maximize2} label={menu.target.kind === "folder" ? "Ouvrir" : "Aperçu"} onClick={() => { const t = menu.target!; setMenu(null); if (t.kind === "folder") setPath(t.path); else setPreview(rawFiles.find((file) => file.path === t.path) ?? null); }} />
              {menu.target.kind === "file" ? <MenuItem icon={Download} label="Télécharger" href={fileUrl(menu.target.path, true)} onClick={() => setMenu(null)} /> : null}
              <MenuItem icon={Pencil} label="Renommer" shortcut="F2" onClick={() => { const t = menu.target!; setMenu(null); void renameItem(t.path, t.name); }} data="rename" />
              <MenuItem icon={FolderInput} label="Déplacer vers…" onClick={() => { const t = menu.target!; setMenu(null); openPicker(t.path, "move"); }} data="move-to" />
              <MenuItem icon={Copy} label="Copier vers…" onClick={() => { const t = menu.target!; setMenu(null); openPicker(t.path, "copy"); }} data="copy-to" />
              <MenuItem icon={Copy} label="Copier" shortcut="Ctrl+C" onClick={() => { const t = menu.target!; setMenu(null); copyToClipboard(t.path, "copy"); }} data="copy" />
              <MenuItem icon={Scissors} label="Couper" shortcut="Ctrl+X" onClick={() => { const t = menu.target!; setMenu(null); copyToClipboard(t.path, "cut"); }} data="cut" />
              {menu.target.kind === "folder" && clipboard ? <MenuItem icon={ClipboardPaste} label={`Coller dedans (${clipboard.paths.length})`} onClick={() => { const t = menu.target!; setMenu(null); void paste(t.path); }} data="paste-into" /> : null}
              <MenuItem icon={Trash2} label="Supprimer" shortcut="Suppr" danger onClick={() => { const t = menu.target!; setMenu(null); void remove(t.path); }} data="delete" />
            </>
          ) : (
            <>
              <div className="truncate px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{path ? baseName(path) : "Drive"}</div>
              <MenuItem icon={FolderPlus} label="Nouveau dossier" onClick={() => { setMenu(null); void newFolder(path); }} data="mkdir" />
              <MenuItem icon={Upload} label="Envoyer des fichiers" onClick={() => { setMenu(null); inputRef.current?.click(); }} />
              {clipboard ? <MenuItem icon={ClipboardPaste} label={`Coller ici (${clipboard.paths.length})`} shortcut="Ctrl+V" onClick={() => { setMenu(null); void paste(path); }} data="paste" /> : null}
              <MenuItem icon={CheckSquare} label="Tout sélectionner" shortcut="Ctrl+A" onClick={() => { setMenu(null); setSelected(new Set(order)); }} />
            </>
          )}
        </div>
      ) : null}

      {picker ? (
        <DestinationPicker
          mode={picker.mode}
          sources={picker.paths}
          current={path}
          onClose={() => setPicker(null)}
          onPick={(dest) => {
            setPicker(null);
            void transfer(picker.paths, dest, picker.mode);
          }}
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
              <a href={fileUrl(preview.path, true)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
                <Download className="h-3.5 w-3.5" />
                Télécharger
              </a>
              <button type="button" onClick={() => void renameItem(preview.path, preview.name)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                <Pencil className="h-3.5 w-3.5" />
                Renommer
              </button>
              <button type="button" onClick={() => { openPicker(preview.path, "move"); setPreview(null); }} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                <FolderInput className="h-3.5 w-3.5" />
                Déplacer vers…
              </button>
              <button type="button" onClick={() => { copyToClipboard(preview.path, "copy"); setPreview(null); }} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                <Copy className="h-3.5 w-3.5" />
                Copier
              </button>
              <button type="button" onClick={() => void remove(preview.path)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
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

function MenuItem({ icon: Icon, label, shortcut, onClick, href, danger = false, data }: { icon: React.ComponentType<{ className?: string }>; label: string; shortcut?: string; onClick: () => void; href?: string; danger?: boolean; data?: string }) {
  const className = cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800", danger ? "text-rose-600" : "text-slate-700 dark:text-slate-200");
  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="flex-1 truncate">{label}</span>
      {shortcut ? <span className="text-[10px] text-slate-400">{shortcut}</span> : null}
    </>
  );
  if (href) return <a href={href} className={className} onClick={onClick} data-menu-item={data}>{inner}</a>;
  return <button type="button" className={className} onClick={onClick} data-menu-item={data}>{inner}</button>;
}

/**
 * Le choix d'un dossier de destination : l'arbre entier du Drive, filtrable,
 * sans les éléments déplacés ni leurs sous-dossiers (un dossier ne rentre pas
 * dans lui-même) ni le dossier où ils sont déjà.
 */
function DestinationPicker({ mode, sources, current, onClose, onPick }: { mode: "move" | "copy"; sources: string[]; current: string; onClose: () => void; onPick: (dest: string) => void }) {
  const [tree, setTree] = useState<string[] | null>(null);
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    let alive = true;
    void fetch("/api/drive?tree=1", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { folders?: string[] }) => {
        if (alive) setTree(body.folders ?? []);
      })
      .catch(() => {
        if (alive) setTree([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const parents = new Set(sources.map((source) => source.split("/").slice(0, -1).join("/")));
  const blocked = (dest: string) => sources.some((source) => dest === source || dest.startsWith(`${source}/`)) || (mode === "move" && parents.has(dest));
  const q = needle.trim().toLowerCase();
  const options = ["", ...(tree ?? [])].filter((dest) => !q || dest.toLowerCase().includes(q));
  const label = sources.length > 1 ? `${sources.length} éléments` : `« ${baseName(sources[0])} »`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()} data-drive-picker={mode}>
        <div className="flex items-start justify-between gap-2 p-4 pb-2">
          <div>
            <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{mode === "move" ? "Déplacer" : "Copier"} {label}</div>
            <div className="text-[11px] text-slate-500">Choisis le dossier de destination.</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 pb-2">
          <input autoFocus value={needle} onChange={(event) => setNeedle(event.target.value)} placeholder="Filtrer les dossiers" className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {tree === null ? (
            <div className="flex items-center gap-2 p-3 text-[12px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Lecture des dossiers…</div>
          ) : (
            options.map((dest) => {
              const depth = dest ? dest.split("/").length : 0;
              const off = blocked(dest);
              return (
                <button
                  key={dest || "__root"}
                  type="button"
                  disabled={off}
                  onClick={() => onPick(dest)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800", dest === current && "font-semibold")}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  data-drive-dest={dest}
                >
                  {dest ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <HardDrive className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
                  <span className="truncate">{dest ? baseName(dest) : "Drive (racine)"}</span>
                  {dest === current ? <span className="ml-auto text-[10px] text-slate-400">ici</span> : null}
                  {off && dest !== current ? <span className="ml-auto text-[10px] text-slate-400">{parents.has(dest) ? "déjà là" : "lui-même"}</span> : null}
                </button>
              );
            })
          )}
          {tree !== null && !options.length ? <div className="p-3 text-[12px] text-slate-500">Aucun dossier ne correspond.</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Un fil d'Ariane qui accepte aussi un dépôt : lâcher sur « Drive » range à la racine. */
function CrumbButton({ active, onClick, onDropInto, children }: { active: boolean; onClick: () => void; onDropInto: (transfer: DataTransfer) => void; children: React.ReactNode }) {
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

function FolderTile({ folder, selected, receiving, cut, onOpen, onPick, onMenu, dragPayload, onDropInto }: { folder: DriveFolder; selected: boolean; receiving: boolean; cut: boolean; onOpen: () => void; onPick: (event: React.MouseEvent) => void; onMenu: (event: React.MouseEvent) => void; dragPayload: () => string; onDropInto: (transfer: DataTransfer) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(INTERNAL, dragPayload());
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
      onClick={(event) => {
        event.stopPropagation();
        onPick(event);
      }}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      className={cn(
        panel,
        "group flex cursor-default select-none items-center gap-2 transition-shadow",
        selected && "ring-2 ring-slate-900 dark:ring-slate-100",
        over && "bg-emerald-50 ring-2 ring-emerald-400 dark:bg-emerald-500/10",
        receiving && "opacity-70",
        cut && "opacity-50"
      )}
      data-drive-folder={folder.path}
      data-selected={selected ? "true" : "false"}
    >
      <div role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); if (event.ctrlKey || event.metaKey || event.shiftKey) onPick(event); else onOpen(); }} onKeyDown={(event) => { if (event.key === "Enter") onOpen(); }} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" title="Ouvrir · Ctrl/Maj + clic : sélectionner · glisser pour déplacer">
        {receiving ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-500" /> : <FolderOpen className="h-5 w-5 shrink-0 text-amber-500" />}
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-medium text-slate-900 dark:text-slate-100">{folder.name}</span>
          <span className="block text-[10px] text-slate-500">{receiving ? "Réception…" : `${folder.count} élément(s)`}</span>
        </span>
      </div>
      <input type="checkbox" checked={selected} onChange={() => undefined} onClick={(event) => { event.stopPropagation(); onPick({ ...event, ctrlKey: true } as React.MouseEvent); }} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 data-[on=true]:opacity-100" data-on={selected ? "true" : "false"} aria-label={`Sélectionner ${folder.name}`} />
    </div>
  );
}

function FileTile({ file, showPath, selected, cut, onOpen, onPick, onMenu, dragPayload, onGoTo }: { file: DriveFile; showPath: boolean; selected: boolean; cut: boolean; onOpen: () => void; onPick: (event: React.MouseEvent) => void; onMenu: (event: React.MouseEvent) => void; dragPayload: () => string; onGoTo: () => void }) {
  const src = fileUrl(file.path);
  const playable = file.kind === "video" && PLAYABLE.test(file.name);
  return (
    <div
      className={cn("group select-none", cut && "opacity-50")}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(INTERNAL, dragPayload());
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={(event) => {
        event.stopPropagation();
        onPick(event);
      }}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      data-drive-file={file.path}
      data-selected={selected ? "true" : "false"}
    >
      <div className={cn("relative aspect-[3/4] overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/[0.06] dark:bg-slate-800 dark:ring-slate-100/[0.06]", selected && "ring-2 ring-slate-900 dark:ring-slate-100")}>
        <div className="h-full w-full" title="Clic : sélectionner · double-clic : ouvrir">
          {file.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
          ) : playable ? (
            <video src={`${src}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400">
              {file.kind === "video" ? <FileVideo className="h-8 w-8" /> : file.kind === "audio" ? <FileAudio className="h-8 w-8" /> : <FileIcon className="h-8 w-8" />}
              <span className="text-[10px] uppercase">{file.name.split(".").pop()}</span>
            </div>
          )}
        </div>
        <input type="checkbox" checked={selected} onChange={() => undefined} onClick={(event) => { event.stopPropagation(); onPick({ ...event, ctrlKey: true } as React.MouseEvent); }} className="absolute left-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 data-[on=true]:opacity-100" data-on={selected ? "true" : "false"} aria-label={`Sélectionner ${file.name}`} />
        <div className="absolute inset-x-1 top-1 flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex items-center gap-0.5">
            <a href={fileUrl(file.path, true)} title="Télécharger" onClick={(event) => event.stopPropagation()} className="rounded-md bg-slate-950/60 p-1 text-white hover:bg-slate-950/80">
              <Download className="h-3 w-3" />
            </a>
            <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }} title="Agrandir" className="rounded-md bg-slate-950/60 p-1 text-white hover:bg-slate-950/80">
              <Maximize2 className="h-3 w-3" />
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
          <button type="button" onClick={(event) => { event.stopPropagation(); onGoTo(); }} className="truncate hover:underline" title={file.path}>
            {file.path.split("/").slice(0, -1).join(" / ") || "Racine"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
