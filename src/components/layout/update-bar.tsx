"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

const POLL_MS = 30_000;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/version", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version || null;
  } catch {
    return null;
  }
}

/**
 * La barre « Nouvelle version » : dès qu'une mise à jour de l'outil est
 * publiée (merge sur main en local, déploiement Vercel en ligne), elle
 * apparaît en haut de la page avec un bouton Recharger. Rien n'est rechargé
 * d'office : un formulaire en cours de saisie n'est jamais perdu sans clic.
 *
 * Vérifie toutes les 30 s, et aussitôt quand on revient sur l'onglet.
 */
export function UpdateBar() {
  const loaded = useRef<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      const version = await fetchVersion();
      if (!alive || !version) return;
      if (!loaded.current) loaded.current = version;
      else if (version !== loaded.current) setLatest(version);
    };
    void check();
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  if (!latest || latest === dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-3 bg-slate-900 px-4 py-2 text-[13px] text-white shadow-[0_8px_24px_-12px_rgba(11,19,21,0.6)] dark:bg-slate-100 dark:text-slate-900"
    >
      <span className="truncate">Nouvelle version de l&apos;outil disponible.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12px] font-medium text-slate-900 transition-opacity hover:opacity-90 dark:bg-slate-900 dark:text-white"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Recharger
      </button>
      <button
        type="button"
        onClick={() => setDismissed(latest)}
        aria-label="Plus tard"
        title="Plus tard"
        className="shrink-0 rounded-full p-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
