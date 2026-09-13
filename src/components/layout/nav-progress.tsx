"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Barre de progression indéterminée dans le header pendant qu'une route se
 * charge. On la déclenche au clic sur un lien interne (capture au document,
 * donc avant que Next ne parte chercher la page) et on l'éteint dès que le
 * pathname a changé. Un garde-fou la coupe après 8 s si la navigation a été
 * annulée (lien vers la page courante, clic modifié, etc.).
 */
export function NavProgress() {
  const pathname = usePathname();
  // On mémorise la page d'où part la navigation : dès que le pathname change,
  // la barre s'éteint d'elle-même, sans effet ni setState supplémentaire.
  const [startedOn, setStartedOn] = useState<string | null>(null);
  const active = startedOn !== null && startedOn === pathname;

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const target = anchor.getAttribute("target");
      if (target && target !== "_self") return;
      if (!href.startsWith("/") || href.startsWith("//")) return;
      if (anchor.hasAttribute("download")) return;
      const next = href.split(/[?#]/)[0];
      if (next === window.location.pathname) return;
      setStartedOn(window.location.pathname);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setStartedOn(null), 8000);
    return () => clearTimeout(timer);
  }, [active]);

  return <div className="nav-progress" data-active={active ? "true" : "false"} aria-hidden />;
}
