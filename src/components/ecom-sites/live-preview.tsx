"use client";

/**
 * Aperçu vivant de la boutique, à côté des réglages.
 *
 * L'éditeur était un formulaire : on modifiait à l'aveugle, on enregistrait, on
 * ouvrait le site dans un autre onglet pour juger. Ici la boutique se redessine
 * à chaque frappe, avec le BROUILLON et non ce qui est enregistré.
 *
 * Le rendu passe par une iframe, et c'est délibéré : les points de rupture CSS
 * se calculent sur la fenêtre, pas sur le conteneur. Réduire la boutique avec
 * `transform` ou `zoom` afficherait la mise en page ordinateur dans un cadre de
 * 390 px. Une iframe a sa propre fenêtre, donc l'aperçu téléphone est le vrai
 * rendu téléphone.
 */

import { useEffect, useRef, useState } from "react";
import { Copy, Home, Monitor, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import type { EcomSite } from "@/lib/ecom-sites/types";
import { cn } from "@/lib/utils";

/** Les trois largeurs qu'on regarde vraiment avant de publier. */
const DEVICES = [
  { id: "mobile", label: "Téléphone", width: 390, icon: Smartphone },
  { id: "tablet", label: "Tablette", width: 768, icon: Tablet },
  { id: "desktop", label: "Ordinateur", width: 1280, icon: Monitor },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

export function LivePreview({
  site,
  dirty,
  selected,
  onSelect,
  onPickImage,
  onReorder,
  onEditText,
  openPath = null,
}: {
  site: EcomSite;
  dirty: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPickImage: (key: string, src: string) => void;
  /** Une section déposée sur une autre, depuis l'aperçu. */
  onReorder: (id: string, over: string, place: "before" | "after") => void;
  /** Un texte retapé dans l'aperçu ; renvoie false si rien ne peut le recevoir. */
  onEditText: (from: string, to: string) => boolean;
  /** Une page que l'éditeur veut voir s'ouvrir dans le cadre (le nonce force l'envoi). */
  openPath?: { path: string; nonce: number } | null;
}) {
  /** Le chemin ouvert dans le cadre, tel qu'il le rapporte. */
  const [path, setPath] = useState("/");
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(900);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);

  const chosen = DEVICES.find((entry) => entry.id === device) ?? DEVICES[2];

  /* La colonne fait la largeur qu'elle fait : l'échelle s'y adapte. */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(shell);
    setWidth(shell.getBoundingClientRect().width);
    const onResize = () => setViewport(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /*
   * Le brouillon part à chaque changement.
   *
   * L'iframe signale quand elle écoute : sans ça, le premier envoi partirait
   * avant que la page d'aperçu ne soit montée, et le cadre resterait vide
   * jusqu'à la frappe suivante.
   */
  useEffect(() => {
    function onReady(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: string })?.type !== "msgate:preview-ready") return;
      readyRef.current = true;
      const frame = frameRef.current?.contentWindow;
      frame?.postMessage({ type: "msgate:preview", site }, window.location.origin);
      /* Changer d'appareil recharge le cadre : il repart sur l'accueil. On lui
         rend le chemin qu'on avait, sinon le simple passage au telephone
         ramenait a la page d'accueil sans prevenir. */
      frame?.postMessage({ type: "msgate:navigate", path }, window.location.origin);
    }
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [site, path]);

  /* Le cadre dit quelle section on vient de cliquer. */
  useEffect(() => {
    function onPick(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        id?: string | null;
        key?: string;
        src?: string;
        over?: string;
        place?: "before" | "after";
        path?: string;
        from?: string;
        to?: string;
        text?: string;
      };
      if (data?.type === "msgate:select") onSelect(data.id ?? null);
      // Un texte corrigé dans le cadre : l'éditeur l'écrit, et dit s'il a pu.
      if (data?.type === "msgate:text" && typeof data.from === "string" && typeof data.to === "string") {
        const ok = onEditText(data.from, data.to);
        frameRef.current?.contentWindow?.postMessage({ type: "msgate:text-result", ok }, window.location.origin);
      }
      // Le texte de la page ouverte, demandé pour le presse-papiers.
      if (data?.type === "msgate:copy" && typeof data.text === "string") {
        void navigator.clipboard
          .writeText(data.text)
          .then(() => toast.success("Texte de la page copié"))
          .catch(() => toast.error("Copie impossible"));
      }
      // Une image cliquée ouvre directement sa fenêtre de retouche.
      if (data?.type === "msgate:image" && data.key) onPickImage(data.key, data.src ?? "");
      // Le cadre dit où il en est, pour l'afficher dans la barre.
      if (data?.type === "msgate:path" && typeof data.path === "string") setPath(data.path);
      // Une section glissée sur une autre : l'ordre se règle dans l'éditeur.
      if (data?.type === "msgate:reorder" && data.id && data.over && data.place)
        onReorder(data.id, data.over, data.place);
    }
    window.addEventListener("message", onPick);
    return () => window.removeEventListener("message", onPick);
  }, [onSelect, onPickImage, onReorder, onEditText]);

  /* Et l'éditeur lui dit laquelle est sélectionnée, pour la cerner. */
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "msgate:selected", id: selected },
      window.location.origin
    );
  }, [selected]);

  useEffect(() => {
    if (!readyRef.current) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: "msgate:preview", site },
      window.location.origin
    );
  }, [site]);

  // Changer d'appareil recharge le cadre : on réattend son signal.
  useEffect(() => {
    readyRef.current = false;
  }, [device]);

  /* L'éditeur ouvre une page — celle qu'on vient d'ajouter, par exemple. */
  useEffect(() => {
    if (!openPath) return;
    frameRef.current?.contentWindow?.postMessage({ type: "msgate:navigate", path: openPath.path }, window.location.origin);
  }, [openPath]);

  const scale = width ? Math.min(1, width / chosen.width) : 1;
  /* Le cadre est plus haut que la fenêtre visible : réduit, il la remplit. */
  const frameHeight = scale ? Math.round((viewport - 150) / scale) : 900;

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
      <div className="flex items-center gap-2 border-b border-slate-100 p-2.5 dark:border-slate-800">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Aperçu</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            dirty
              ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
          )}
        >
          {dirty ? "non enregistré" : "à jour"}
        </span>
        <span className="hidden text-[10px] text-slate-400 md:inline">clique un texte pour le modifier · la croix le retire</span>
        <button
          type="button"
          onClick={() =>
            frameRef.current?.contentWindow?.postMessage({ type: "msgate:copy-request" }, window.location.origin)
          }
          title="Copier tout le texte de la page ouverte"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Copy className="h-3.5 w-3.5" />
          Copier le texte
        </button>

        {/* Ou l'on se trouve dans la boutique, et le retour a l'accueil. */}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() =>
              frameRef.current?.contentWindow?.postMessage(
                { type: "msgate:navigate", path: "/" },
                window.location.origin
              )
            }
            disabled={path === "/"}
            title="Revenir a l'accueil"
            className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          <code className="min-w-0 truncate rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800">
            {path}
          </code>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {DEVICES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setDevice(entry.id)}
              title={`${entry.label} · ${entry.width}px`}
              className={cn(
                "rounded-md p-1.5",
                device === entry.id
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                  : "text-slate-500"
              )}
            >
              <entry.icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{chosen.width}px</span>
      </div>

      {/*
        L'aperçu occupe la hauteur de l'écran.
        Un cadre de 900 px de haut réduit à moitié montrait un timbre-poste :
        on ne juge pas une page dessus, et c'est pourtant là qu'on travaille.
      */}
      <div ref={shellRef} className="overflow-hidden rounded-b-2xl bg-slate-100 p-2 dark:bg-slate-950">
        <div style={{ height: frameHeight * scale }} className="overflow-hidden">
          <iframe
            key={device}
            ref={frameRef}
            src={`/s/${site.slug}/preview`}
            title="Aperçu de la boutique"
            style={{
              width: chosen.width,
              height: frameHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              border: 0,
            }}
            className="rounded-xl bg-white shadow-sm"
          />
        </div>
      </div>
    </div>
  );
}
