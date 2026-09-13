"use client";

import { useEffect, useRef, useState } from "react";
import { FolderPlus, HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * « Envoyer au Drive », posé à côté de n'importe quelle créa de l'outil.
 *
 * Le fichier ne transite pas par le navigateur : on donne son URL au serveur,
 * qui le copie dans le dossier choisi. Une créa de 100 Mo part donc aussi vite
 * qu'une vignette, et une URL Kie temporaire est sauvée avant d'expirer.
 */
export function SendToDrive({
  url,
  name,
  className,
  compact = false,
  send,
  label = "Drive",
  disabled = false,
}: {
  /** URL http(s) ou chemin local de l'app (/api/…). Facultatif quand `send` est fourni. */
  url?: string;
  /** Nom de fichier souhaité, extension comprise si possible. */
  name?: string;
  className?: string;
  /** Icône seule, pour les vignettes. */
  compact?: boolean;
  /** Envoi sur mesure vers le dossier choisi — un lot entier, une sélection. Retourne le message de succès. */
  send?: (folder: string) => Promise<string | void>;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [into, setInto] = useState("");
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetch("/api/drive?tree=1", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { folders?: string[] }) => {
        if (!alive) return;
        setFolders(body.folders ?? []);
        try {
          const last = window.localStorage.getItem("msgate.drive.last");
          if (last && (body.folders ?? []).includes(last)) setInto(last);
        } catch {
          // stockage indisponible : on part de la racine
        }
      })
      .catch(() => alive && setFolders([]));
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      alive = false;
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      let target = into;
      if (fresh.trim()) {
        const res = await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mkdir", path: into, name: fresh }),
        });
        const body = (await res.json()) as { path?: string; error?: string };
        if (!res.ok || !body.path) throw new Error(body.error || "Dossier impossible");
        target = body.path;
      }
      let message: string | void = undefined;
      if (send) {
        message = await send(target);
      } else {
        const res = await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "import", url, into: target, name }),
        });
        const body = (await res.json()) as { path?: string; error?: string };
        if (!res.ok) throw new Error(body.error || "Envoi impossible");
      }
      try {
        window.localStorage.setItem("msgate.drive.last", target);
      } catch {
        // sans importance
      }
      toast.success(message || `Envoyé dans ${target ? `« ${target.split("/").pop()} »` : "le Drive"}`);
      setOpen(false);
      setFresh("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Envoi impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className={cn("relative inline-block", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        title="Envoyer au Drive"
        className={
          compact
            ? "rounded-md bg-slate-950/60 p-1 text-white opacity-70 transition-opacity hover:opacity-100"
            : "inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
        }
      >
        <HardDrive className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        {compact ? null : label}
      </button>

      {open ? (
        <div
          onClick={(event) => event.stopPropagation()}
          className="absolute right-0 z-50 mt-1 w-64 rounded-xl bg-white p-2.5 text-left shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-slate-100/10"
        >
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Envoyer au Drive</div>
          {folders === null ? (
            <div className="flex items-center gap-1.5 py-2 text-[11px] text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Dossiers…
            </div>
          ) : (
            <select
              value={into}
              onChange={(event) => setInto(event.target.value)}
              className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">Racine du Drive</option>
              {folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder.replace(/\//g, " / ")}
                </option>
              ))}
            </select>
          )}
          <div className="mb-2 flex items-center gap-1.5">
            <FolderPlus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              value={fresh}
              onChange={(event) => setFresh(event.target.value)}
              placeholder="Nouveau sous-dossier (facultatif)"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || folders === null}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDrive className="h-3.5 w-3.5" />}
            Envoyer
          </button>
        </div>
      ) : null}
    </div>
  );
}
