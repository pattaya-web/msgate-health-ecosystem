"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bouton « Actualiser » de l'en-tête, pour tous les rôles.
 *
 * Contrat : on émet `msgate:refresh` (annulable). Une page qui sait se relire
 * elle-même l'intercepte (preventDefault) et relance ses données : on se
 * contente alors de faire tourner l'icône une seconde. Sinon, rien ne l'a pris
 * en charge, et on recharge la page entière — l'équivalent du « tirer pour
 * actualiser » qui n'existe pas dans l'appli installée sur l'écran d'accueil.
 */
export function RefreshButton() {
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  function refresh() {
    const handled = !window.dispatchEvent(new CustomEvent("msgate:refresh", { cancelable: true }));
    setSpinning(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSpinning(false), 1000);
    if (!handled) window.location.reload();
  }

  return (
    <button type="button" className="pill-btn" onClick={refresh} aria-label="Actualiser" title="Actualiser">
      <RefreshCw className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
    </button>
  );
}
