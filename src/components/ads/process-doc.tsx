"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

/**
 * L'onglet « Process » de l'Ads Manager : le document de référence du process
 * créa (public/docs/process-crea.html), affiché tel quel dans une iframe.
 *
 * Pour le mettre à jour, on remplace le fichier : rien ici ne dépend de son
 * contenu. La ligne du haut lit « Version N · <date> » dans le fichier quand
 * elle y est, sinon la date du fichier envoyée par le serveur.
 */

const DOC_URL = "/docs/process-crea.html";

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

export function ProcessDoc() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [stamp, setStamp] = useState<string | null>(null);

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
    const fit = () => {
      const doc = element.contentDocument;
      if (!doc?.documentElement) return;
      element.style.height = `${doc.documentElement.scrollHeight}px`;
    };
    const onLoad = () => {
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
      {/* color-scheme « light dark » : le document suit le réglage clair / sombre du système, comme ouvert seul, pas le thème du CRM. */}
      <iframe
        ref={frame}
        src={DOC_URL}
        title="Process créa"
        className="block min-h-[80vh] w-full rounded-xl border border-slate-200 dark:border-slate-800"
        style={{ colorScheme: "light dark" }}
      />
    </div>
  );
}
