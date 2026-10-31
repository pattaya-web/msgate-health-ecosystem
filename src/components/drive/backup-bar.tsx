"use client";

import { useEffect, useState } from "react";
import { CloudUpload, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { BackupStatus } from "@/lib/backup";

function ago(iso: string | null) {
  if (!iso) return "jamais";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
}

const size = (bytes: number) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} Go` : bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} Mo` : `${Math.round(bytes / 1e3)} Ko`);

/**
 * L'état de la copie de secours (OneDrive), en haut du Drive, pour l'admin :
 * dernière sauvegarde réussie, et un bouton pour en lancer une tout de suite.
 */
export function BackupBar() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/drive/backup", { cache: "no-store" })
        .then(async (res) => (res.ok ? ((await res.json()) as BackupStatus) : null))
        .then((next) => {
          if (alive && next) setStatus(next);
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  async function runNow() {
    setBusy(true);
    try {
      const res = await fetch("/api/drive/backup", { method: "POST" });
      const next = (await res.json()) as BackupStatus & { error?: string | null };
      if (!res.ok) throw new Error(next.error || `HTTP ${res.status}`);
      setStatus(next);
      if (next.error) toast.error(`Sauvegarde incomplète : ${next.error}`);
      else toast.success(next.copied ? `${next.copied} fichier(s) sauvegardé(s) (${size(next.bytes)})` : "Tout était déjà sauvegardé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sauvegarde impossible");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  if (!status.configured) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
        Copie de secours désactivée sur ce serveur (BACKUP_DIR non réglé).
      </div>
    );
  }
  const ok = !status.error;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-white px-3 py-2 text-[12px] ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
      {ok ? <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" /> : <TriangleAlert className="h-4 w-4 shrink-0 text-rose-600" />}
      <span className="font-medium text-slate-800 dark:text-slate-100">Copie de secours OneDrive</span>
      <span className="text-slate-500 dark:text-slate-400">
        {ok ? `dernière sauvegarde ${ago(status.lastSuccessAt)}` : `erreur : ${status.error}`} · Drive, Studio IA et Creatives, toutes les 15 min
      </span>
      <button
        type="button"
        onClick={() => void runNow()}
        disabled={busy || status.running}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[11.5px] font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {busy || status.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
        Sauvegarder maintenant
      </button>
    </div>
  );
}
