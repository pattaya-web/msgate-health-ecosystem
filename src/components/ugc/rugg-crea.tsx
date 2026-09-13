"use client";

import { useState } from "react";
import { CheckSquare, Download, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { pollStudioTask } from "@/lib/studio/client";
import { measureAspect, sleep, toDataUrl } from "@/lib/ugc/creative-file";
import { cn } from "@/lib/utils";

const COUNTS = [1, 3, 5, 10];

/** Une déclinaison, en cours ou terminée. */
type Shot = { id: string; url: string | null; error: string | null };

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/ugc/remake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Requête refusée");
  return data as T;
}

/**
 * Rugg Crea : la créa d'un concurrent, recopiée.
 *
 * L'onglet voisin traite le cas où le produit DIFFÈRE : il relève la mise en
 * page de la créa source, réécrit chaque accroche pour notre article et
 * remplace l'objet. Ici le produit est le même des deux côtés — on vend ce que
 * le concurrent vend — donc il n'y a rien à adapter, et tout ce travail de
 * relevé et de réécriture ne ferait que dégrader une copie.
 *
 * La créa part donc telle quelle en référence, et la consigne tient dans un
 * mot : recopie. D'où le lot — cinq copies ne sont pas cinq annonces, ce sont
 * cinq tentatives de la même, parce qu'un modèle image-vers-image est inégal
 * d'un rendu à l'autre. On garde la plus propre.
 */
export function RuggCrea() {
  const [source, setSource] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [count, setCount] = useState(5);
  const [hd, setHd] = useState(false);
  /** Copier au plus près, ou laisser bouger un détail d'une version à l'autre. */
  const [loose, setLoose] = useState(false);
  /** La marque du concurrent n'a rien à faire sur nos annonces. */
  const [stripBrand, setStripBrand] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);

  const [zoom, setZoom] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  function pick(file: File | undefined) {
    if (!file) return;
    setSource(file);
    setSourceUrl(URL.createObjectURL(file));
    void measureAspect(file).then(setAspect);
    setShots([]);
  }

  /**
   * Du dépôt de la créa aux déclinaisons finies, en une commande.
   *
   * La créa n'est déposée chez Kie qu'une fois : les déclinaisons pointent
   * toutes la même référence, sinon on ne déclinerait pas une créa mais
   * plusieurs envois. Les créations sont espacées parce que Kie compte les
   * appels et coupe au-delà d'une certaine cadence.
   */
  async function run() {
    if (!source) return toast.error("Charge la créa à copier");

    setBusy(true);
    setShots(
      Array.from({ length: count }, (_, i) => ({
        id: `r${Date.now()}-${i}`,
        url: null,
        error: null,
      }))
    );

    try {
      const staticBase64 = await toDataUrl(source);
      const { url: hosted } = await post<{ url: string }>({
        action: "rugg-upload",
        staticBase64,
      });

      await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          await sleep(index * 1200);
          try {
            const { taskId } = await post<{ taskId: string }>({
              action: "rugg-generate",
              sourceUrl: hosted,
              aspect,
              variation: index,
              loose,
              stripBrand,
              hd,
            });
            const task = await pollStudioTask(taskId);
            const url = task.urls[0];
            setShots((current) =>
              current.map((shot, i) =>
                i === index
                  ? { ...shot, url: url || null, error: url ? null : "Aucune image" }
                  : shot
              )
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "Échec";
            setShots((current) =>
              current.map((shot, i) => (i === index ? { ...shot, error: message } : shot))
            );
          }
        })
      );

      toast.success("Copies prêtes");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Copie impossible");
      setShots([]);
    } finally {
      setBusy(false);
    }
  }

  async function zipPicked() {
    const urls = picked.length
      ? picked
      : shots.map((shot) => shot.url).filter((url): url is string => Boolean(url));
    if (!urls.length) return;
    const zip = new JSZip();
    await Promise.all(
      urls.map(async (url, i) => {
        const blob = await fetch(url).then((res) => res.blob());
        zip.file(`rugg-${i + 1}.png`, blob);
      })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rugg-${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const done = shots.filter((shot) => shot.url).length;

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-500">
        La créa d&apos;un concurrent, recopiée. Même produit, mêmes textes, même mise en
        page : rien n&apos;est réécrit ni réinterprété. Le lot sert à garder le rendu le plus
        propre, pas à obtenir plusieurs annonces.
      </p>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Le dépôt et les réglages. */}
        <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-center",
              source
                ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-500/5"
                : "border-slate-300 dark:border-slate-700"
            )}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => pick(event.target.files?.[0])}
            />
            {sourceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sourceUrl} alt="Créa source" className="max-h-40 rounded-lg object-contain" />
            ) : (
              <ImagePlus className="h-6 w-6 text-slate-400" />
            )}
            <span className="text-[12px] font-medium">
              {source ? source.name : "Charge ta créa"}
            </span>
            <span className="text-[11px] text-slate-400">Format détecté : {aspect}</span>
          </label>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Copies
            </span>
            <div className="mt-1 flex gap-1">
              {COUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCount(value)}
                  className={cn(
                    "h-8 flex-1 rounded-lg text-[12px] font-semibold",
                    count === value
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          {/* Une copie stricte par défaut ; la variante se demande. */}
          <button
            type="button"
            onClick={() => setLoose(!loose)}
            className={cn(
              "h-8 w-full rounded-lg text-[12px] font-semibold",
              loose
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            {loose ? "Légères variantes" : "Copie stricte"}
          </button>

          {/* Le produit se copie — c'est le même. La marque du concurrent, non. */}
          <button
            type="button"
            onClick={() => setStripBrand(!stripBrand)}
            className={cn(
              "h-8 w-full rounded-lg text-[12px] font-semibold",
              stripBrand
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            {stripBrand ? "Sans les logos source" : "Logos de la source gardés"}
          </button>

          {/* Le 2K double le temps de rendu : il se garde pour une créa validée. */}
          <button
            type="button"
            onClick={() => setHd(!hd)}
            className={cn(
              "h-8 w-full rounded-lg text-[12px] font-semibold",
              hd
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            {hd ? "2K — plus lent" : "1K — rapide"}
          </button>

          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !source}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loose ? `Décliner ${count} fois` : `Copier ${count} fois`}
          </button>
        </div>

        {/* Les résultats. */}
        <div className="space-y-2">
          {shots.length ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">
                {done}/{shots.length} prêtes
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectMode(!selectMode);
                  setPicked([]);
                }}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {selectMode ? "Annuler" : "Choisir"}
              </button>
              <button
                type="button"
                onClick={() => void zipPicked()}
                disabled={!done}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
              >
                <Download className="h-3.5 w-3.5" />
                {picked.length ? `ZIP (${picked.length})` : "ZIP"}
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shots.map((shot) => (
              <div
                key={shot.id}
                className="relative overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/[0.06] dark:bg-slate-800"
                style={{ aspectRatio: aspect.replace(":", "/") }}
              >
                {shot.url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={shot.url}
                      alt="Copie"
                      onClick={() => {
                        if (!selectMode) return setZoom(shot.url);
                        setPicked((current) =>
                          current.includes(shot.url as string)
                            ? current.filter((url) => url !== shot.url)
                            : [...current, shot.url as string]
                        );
                      }}
                      className={cn(
                        "h-full w-full cursor-pointer object-cover",
                        selectMode && picked.includes(shot.url) && "ring-4 ring-emerald-400"
                      )}
                    />
                  </>
                ) : shot.error ? (
                  <p className="grid h-full place-items-center p-2 text-center text-[11px] text-rose-500">
                    {shot.error}
                  </p>
                ) : (
                  <div className="grid h-full place-items-center">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {!shots.length ? (
            <p className="rounded-xl bg-slate-50 p-6 text-center text-[12px] text-slate-400 dark:bg-slate-800/40">
              Charge la créa à copier, choisis le nombre de rendus, lance.
            </p>
          ) : null}
        </div>
      </div>

      {/* Une déclinaison en grand, pour la juger avant de la garder. */}
      {zoom ? (
        <div
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Copie" className="max-h-full max-w-full rounded-xl object-contain" />
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white"
            onClick={() => setZoom(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
