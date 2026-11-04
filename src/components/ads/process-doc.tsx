"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Minus, Plus } from "lucide-react";

/**
 * L'onglet « Process » de l'Ads Manager : le document de référence du process
 * créa (public/docs/process-crea.html), affiché tel quel dans une iframe.
 *
 * Pour le mettre à jour, on remplace le fichier : rien ici ne dépend de son
 * contenu. La ligne du haut lit « Version N · <date> » dans le fichier quand
 * elle y est, sinon la date du fichier envoyée par le serveur.
 */

const DOC_URL = "/docs/process-crea.html";
const ZOOM_KEY = "msgate-process-zoom";
const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

function readStamp(html: string, lastModified: string | null) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = text.match(/Version\s+([\w.,-]+)\s*·\s*([^·]+?)\s*(?:·|$)/);
  if (match) {
    const date = match[2].trim();
    return `Version ${match[1]} · mise à jour ${/^\d/.test(date) ? "le" : "en"} ${date}`;
  }
  const at = lastModified ? new Date(lastModified) : null;
  if (at && !Number.isNaN(at.getTime())) return `Mise à jour le ${at.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
  return null;
}

/** L'iframe prend la hauteur du document (rétrécie d'abord, sinon elle ne redescend jamais quand on dézoome). */
function fitFrame(element: HTMLIFrameElement) {
  const root = element.contentDocument?.documentElement;
  if (!root) return;
  element.style.height = "0px";
  element.style.height = `${root.scrollHeight}px`;
}

export function ProcessDoc() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  /** Le zoom de l'affichage (le fichier n'est pas touché) ; retenu dans le navigateur. */
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = Number(localStorage.getItem(ZOOM_KEY));
        if (ZOOMS.includes(saved)) setZoom(saved);
      } catch {
        // stockage refusé : zoom 100 %
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Applique le zoom au document de l'iframe, puis recale sa hauteur.
  useEffect(() => {
    zoomRef.current = zoom;
    const element = frame.current;
    const root = element?.contentDocument?.documentElement;
    if (!element || !root) return;
    root.style.zoom = String(zoom);
    fitFrame(element);
  }, [zoom]);

  const pickZoom = (next: number) => {
    setZoom(next);
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // stockage refusé : sans gravité
    }
  };

  const changeZoom = (step: 1 | -1) => {
    const index = ZOOMS.indexOf(zoom);
    pickZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (index < 0 ? ZOOMS.indexOf(1) : index) + step))]);
  };

  useEffect(() => {
    let cancelled = false;
    fetch(DOC_URL, { cache: "no-store" })
      .then(async (res) => (res.ok ? { html: await res.text(), lastModified: res.headers.get("last-modified") } : null))
      .then((doc) => {
        if (!cancelled && doc) setStamp(readStamp(doc.html, doc.lastModified));
      })
      .catch(() => {
        // la ligne reste vide, le document s'affiche quand même
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // L'iframe prend la hauteur du document : une seule barre de défilement, celle de la page.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | null = null;
    const fit = () => fitFrame(element);
    const onLoad = () => {
      const root = element.contentDocument?.documentElement;
      if (root) root.style.zoom = String(zoomRef.current);
      fit();
      observer?.disconnect();
      const body = element.contentDocument?.body;
      if (body) {
        observer = new ResizeObserver(fit);
        observer.observe(body);
      }
    };
    element.addEventListener("load", onLoad);
    if (element.contentDocument?.readyState === "complete") onLoad();
    return () => {
      element.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="flex w-full flex-col gap-2 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-slate-500 dark:text-slate-400">{stamp ?? "Process créa"}</p>
        <div className="flex items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <button type="button" onClick={() => changeZoom(-1)} disabled={zoom <= ZOOMS[0]} title="Dézoomer" className="px-2 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => pickZoom(1)} title="Revenir à 100 %" className="min-w-[3.25rem] border-x border-slate-200 px-1 py-1 text-[12px] font-semibold tabular-nums text-slate-700 dark:border-slate-700 dark:text-slate-200">
            {Math.round(zoom * 100)} %
          </button>
          <button type="button" onClick={() => changeZoom(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} title="Zoomer" className="px-2 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <a
          href={DOC_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Ouvrir en plein écran
        </a>
        </div>
      </div>
      {/* color-scheme « light dark » : le document suit le réglage clair / sombre du système, comme ouvert seul, pas le thème du CRM. */}
      <iframe
        ref={frame}
        src={DOC_URL}
        title="Process créa"
        className="block min-h-[40vh] w-full rounded-xl border border-slate-200 dark:border-slate-800"
        style={{ colorScheme: "light dark" }}
      />
    </div>
  );
}
