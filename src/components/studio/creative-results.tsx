"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Copy, Download, Eraser, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { SendToDrive } from "@/components/drive/send-to-drive";
import { fileToDataUrl } from "@/components/mass-test/engine-client";
import { STUDIO_REMOVE_SOURCE_KEY } from "@/lib/studio/library-types";
import { isWideRatio, ratioAspect } from "@/lib/studio/ratios";
import { cn } from "@/lib/utils";

/**
 * La grille de rendus du studio, réutilisable : chaque créa dans son ratio,
 * clic pour voir en grand, sélection et ZIP, et dans l'aperçu les mêmes
 * actions qu'en Creatives — copier l'image, Drive, gomme IA, télécharger,
 * prompt et brief à copier, réutiliser.
 */

export type ResultItem = {
  id: string;
  /** URL affichable (proxy ou fichier servi par l'app) ; null tant que rien n'est sorti. */
  src: string | null;
  ratio: string;
  kind?: "image" | "video";
  status: "run" | "ok" | "err";
  error?: string | null;
  prompt: string;
  brief?: string;
  referenceUrls?: string[];
  createdAt: string;
  /** Nom de fichier proposé au téléchargement / Drive. */
  name: string;
  /** Ligne technique de l'aperçu : modèle, mode. */
  tech?: string;
  resolution?: string;
  /** Petite étiquette sous la vignette (angle, lot…). */
  caption?: string;
};

async function copyImage(url: string) {
  try {
    const res = await fetch(url);
    let blob = await res.blob();
    if (blob.type !== "image/png") {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("Conversion impossible"))), "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success("Image copiée");
  } catch {
    toast.error("Copie impossible — télécharge l'image à la place");
  }
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copié`);
  } catch {
    toast.error("Copie impossible");
  }
}

export function CreativeResults({
  items,
  title,
  actions,
  emptyText = "Les visuels arrivent ici",
  zipName = "creatives",
  columns = "auto",
  onReuse,
}: {
  items: ResultItem[];
  title?: ReactNode;
  /** Actions supplémentaires dans l'en-tête (lien Mass test, etc.). */
  actions?: ReactNode;
  emptyText?: string;
  zipName?: string;
  /** « auto » : 3 colonnes pour un paysage ou un carré, 4 sinon ; ou un nombre fixe. */
  columns?: "auto" | 3 | 4;
  /** Remet le prompt / brief de la créa dans le formulaire de l'écran hôte. */
  onReuse?: (item: ResultItem) => void;
}) {
  const router = useRouter();
  const [zoom, setZoom] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const running = items.filter((item) => item.status === "run").length;
  const withSrc = items.filter((item) => item.src);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoom(null);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [zoom]);

  async function eraseWithAi(url: string) {
    try {
      const blob = await (await fetch(url)).blob();
      const dataUrl = await fileToDataUrl(new File([blob], "creative.png", { type: blob.type || "image/png" }));
      sessionStorage.setItem(STUDIO_REMOVE_SOURCE_KEY, dataUrl);
      setZoom(null);
      router.push("/studio/remove");
    } catch {
      toast.error("Image illisible");
    }
  }

  async function zipAll(only?: string[]) {
    const chosen = withSrc.filter((item) => !only?.length || only.includes(item.src as string));
    if (!chosen.length) return;
    const zip = new JSZip();
    await Promise.all(
      chosen.map(async (item) => {
        const res = await fetch(item.src as string);
        zip.file(`${item.name}.${item.kind === "video" ? "mp4" : "png"}`, await res.blob());
      })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${zipName}.zip`;
    a.click();
  }

  const cols = columns === 3 || (columns === "auto" && (isWideRatio(items[0]?.ratio) || items[0]?.ratio === "1:1")) ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4";
  const open = zoom ? items.find((item) => item.src === zoom) ?? null : null;
  const section = "mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500";

  return (
    <div className="min-h-[24vh] rounded-2xl bg-slate-50/80 p-2 ring-1 ring-slate-900/[0.04] dark:bg-slate-950/40" data-results>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-slate-400">
          {title ? <span className="mr-2 font-semibold uppercase tracking-wide text-slate-400">{title}</span> : null}
          {items.length ? (
            <>
              {running ? <span className="font-medium text-slate-600 dark:text-slate-300">{running} en cours · </span> : null}
              {items.length - running} terminée(s)
            </>
          ) : (
            emptyText
          )}
        </p>
        <div className="flex items-center gap-3">
          {actions}
          {withSrc.length ? (
            <button
              type="button"
              onClick={() => {
                setSelectMode((value) => !value);
                setPicked([]);
              }}
              className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold", selectMode ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
            >
              <CheckSquare className="h-3 w-3" />
              {selectMode ? "Terminer" : "Sélectionner"}
            </button>
          ) : null}
          {withSrc.length ? (
            <button type="button" onClick={() => void zipAll()} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <Download className="h-3 w-3" />
              ZIP batch
            </button>
          ) : null}
        </div>
      </div>

      <div className={cn("grid items-start gap-2", cols)}>
        {items.map((item) => {
          const src = item.src;
          const chosen = src ? picked.includes(src) : false;
          return (
            <article key={item.id} className={cn("overflow-hidden rounded-xl bg-white ring-1 dark:bg-slate-900", chosen ? "ring-2 ring-emerald-500" : "ring-slate-900/[0.06]")} data-result-item data-result-ratio={item.ratio}>
              {/* Chaque rendu garde le ratio avec lequel il a été généré. */}
              <div className={cn("relative bg-slate-100 dark:bg-slate-800", ratioAspect(item.ratio))}>
                {src ? (
                  <>
                    <button
                      type="button"
                      onClick={() => (selectMode ? setPicked((current) => (current.includes(src) ? current.filter((entry) => entry !== src) : [...current, src])) : setZoom(src))}
                      title={selectMode ? (chosen ? "Retirer" : "Sélectionner") : "Voir en grand"}
                      className="block h-full w-full"
                      data-result-open
                    >
                      {item.kind === "video" ? (
                        <video src={src} muted playsInline loop autoPlay preload="metadata" className={cn("h-full w-full object-cover transition-opacity", selectMode && !chosen && "opacity-60")} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className={cn("h-full w-full object-cover transition-opacity", selectMode && !chosen && "opacity-60")} loading="lazy" />
                      )}
                    </button>
                    {selectMode ? (
                      <span className={cn("pointer-events-none absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md text-[11px] font-bold", chosen ? "bg-emerald-500 text-white" : "bg-slate-950/40 text-white/60 ring-1 ring-white/40")}>{chosen ? "✓" : ""}</span>
                    ) : null}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-slate-400">
                    {item.status === "run" ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="text-rose-500">{item.error || "échec"}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-[10px] text-slate-500">
                <span className="truncate" title={item.caption ?? item.name}>{item.caption ?? ""}</span>
                {src ? (
                  <a href={src} download={`${item.name}.${item.kind === "video" ? "mp4" : "png"}`} className="shrink-0 font-medium hover:text-slate-800 dark:hover:text-slate-200">
                    Télécharger
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {selectMode && picked.length ? (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-950/80 px-3 py-2 text-white shadow-2xl backdrop-blur-md">
            <span className="px-1 text-[12px] font-semibold">
              {picked.length} créa{picked.length > 1 ? "s" : ""}
            </span>
            <button type="button" onClick={() => void zipAll(picked)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-slate-900">
              <Download className="h-3.5 w-3.5" />
              Télécharger le ZIP
            </button>
            <button type="button" onClick={() => setPicked([])} className="h-8 rounded-lg px-2 text-[12px] font-medium text-white/70 hover:text-white">
              Vider
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false);
                setPicked([]);
              }}
              className="h-8 rounded-lg px-2 text-[12px] font-medium text-white/70 hover:text-white"
            >
              Quitter
            </button>
          </div>
        </div>
      ) : null}

      {zoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={() => setZoom(null)} data-result-zoom>
          <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 md:flex-row" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
              {open?.kind === "video" ? (
                <video src={zoom} controls autoPlay playsInline className="max-h-[85vh] w-auto max-w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={zoom} alt="" className="max-h-[85vh] w-auto max-w-full object-contain" />
              )}
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto p-4 md:w-[340px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{open?.tech ?? "Créa"}</div>
                  <div className="text-[11px] text-slate-500">
                    {open ? [open.ratio, open.resolution, `${open.referenceUrls?.length ?? 0} référence(s)`, new Date(open.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })].filter(Boolean).join(" · ") : ""}
                  </div>
                </div>
                <button type="button" onClick={() => setZoom(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPicked((current) => (current.includes(zoom) ? current.filter((entry) => entry !== zoom) : [...current, zoom]))}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold", picked.includes(zoom) ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200")}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  {picked.includes(zoom) ? "Sélectionnée" : "Sélectionner"}
                </button>
                {open?.kind !== "video" ? (
                  <button type="button" onClick={() => void copyImage(zoom)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                    <Copy className="h-3.5 w-3.5" />
                    Copier l&apos;image
                  </button>
                ) : null}
                <SendToDrive url={zoom} name={`${open?.name ?? "crea"}.${open?.kind === "video" ? "mp4" : "png"}`} />
                {open?.kind !== "video" ? (
                  <button type="button" onClick={() => void eraseWithAi(zoom)} title="Gomme un élément au pinceau, l'IA rebouche la zone (Remove Magic)" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200" data-erase-ai>
                    <Eraser className="h-3.5 w-3.5" />
                    Effacer avec l&apos;IA
                  </button>
                ) : null}
                <a href={zoom} download={`${open?.name ?? "crea"}.${open?.kind === "video" ? "mp4" : "png"}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                  <Download className="h-3.5 w-3.5" />
                  Télécharger
                </a>
                {open && onReuse ? (
                  <button
                    type="button"
                    onClick={() => {
                      onReuse(open);
                      setZoom(null);
                    }}
                    title="Remet le brief et le prompt dans le formulaire"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
                    data-result-reuse
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Réutiliser
                  </button>
                ) : null}
              </div>

              {open?.prompt ? (
                <div>
                  <div className="flex items-center justify-between">
                    <div className={section}>Prompt</div>
                    <button type="button" onClick={() => void copyText(open.prompt, "Prompt")} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline">
                      <Copy className="h-3 w-3" />
                      Copier
                    </button>
                  </div>
                  <p className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">{open.prompt}</p>
                </div>
              ) : null}

              {open?.brief ? (
                <div>
                  <div className="flex items-center justify-between">
                    <div className={section}>Brief</div>
                    <button type="button" onClick={() => void copyText(open.brief as string, "Brief")} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline">
                      <Copy className="h-3 w-3" />
                      Copier
                    </button>
                  </div>
                  <p className="max-h-[18vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">{open.brief}</p>
                </div>
              ) : null}

              {open?.referenceUrls?.length ? (
                <div>
                  <div className={section}>Références — clic : copier l&apos;image</div>
                  <div className="flex flex-wrap gap-1.5">
                    {open.referenceUrls.map((url) => (
                      <button key={url} type="button" onClick={() => void copyImage(url)} className="h-14 w-14 overflow-hidden rounded-lg ring-1 ring-slate-900/10" title="Copier cette référence">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
