"use client";

import { useEffect, useState } from "react";
import { CheckSquare, Download, ImagePlus, Library, Loader2, Wand2, X } from "lucide-react";
import { StylePoster } from "@/components/library/creative-library";
import type { StaticElement, StyleTemplate } from "@/lib/creative-library/types";
import { toast } from "sonner";
import JSZip from "jszip";
import { pollStudioTask } from "@/lib/studio/client";
import { measureAspect, sleep, toDataUrl } from "@/lib/ugc/creative-file";
import type { ProductInput } from "@/lib/ugc/types";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] outline-none dark:border-slate-700 dark:bg-slate-950";

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
 * Copie d'une créa concurrente avec notre produit.
 *
 * Deux entrées, un bouton. Le relevé de la mise en page, la réécriture des
 * accroches et le report du prix se font en interne : c'est du travail d'outil,
 * pas une suite d'étapes à faire traverser.
 *
 * Le prix vient de la fiche produit lue, et se force à la main quand ce qu'on
 * teste est l'offre plutôt que le prix catalogue.
 */
export function StaticRemake() {
  const [source, setSource] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [aspect, setAspect] = useState("9:16");

  const [productUrl, setProductUrl] = useState("");
  const [product, setProduct] = useState<ProductInput | null>(null);
  const [price, setPrice] = useState("");
  const [comparePrice, setComparePrice] = useState("");

  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);

  const [zoom, setZoom] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  /**
   * Styles enregistrés dans la bibliothèque : un clic remplace l'ad à copier.
   * Le relevé est déjà fait, seule l'adaptation des textes au produit reste.
   */
  const [styles, setStyles] = useState<StyleTemplate[]>([]);
  const [styleId, setStyleId] = useState<string | null>(null);
  const style = styles.find((item) => item.id === styleId) ?? null;

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetch("/api/library", { cache: "no-store" })
        .then((res) => res.json())
        .then((body) => setStyles((body.styles ?? []).filter((item: StyleTemplate) => item.kind === "static")))
        .catch(() => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function pick(file: File | undefined) {
    if (!file) return;
    setSource(file);
    setStyleId(null);
    setSourceUrl(URL.createObjectURL(file));
    void measureAspect(file).then(setAspect);
    setShots([]);
  }

  function pickStyle(item: StyleTemplate) {
    setStyleId(item.id);
    setSource(null);
    setSourceUrl("");
    setAspect(item.static?.aspect || "1:1");
    setShots([]);
  }

  /**
   * Du dépôt de l'ad aux images finies, en une commande.
   *
   * Le relevé n'est fait qu'une fois pour tout le lot : c'est la même créa
   * qu'on décline, seule la génération se répète. Les créations sont espacées
   * parce que Kie compte les appels et coupe au-delà d'une certaine cadence.
   */
  async function run() {
    if (!source && !style) return toast.error("Charge l'ad à reprendre, ou choisis un style enregistré");

    setBusy(true);
    setShots(
      Array.from({ length: count }, (_, i) => ({
        id: `s${Date.now()}-${i}`,
        url: null,
        error: null,
      }))
    );

    try {
      let read: {
        layout: string;
        elements: Array<Record<string, string>>;
        fontStyle?: string;
        compositionError: string | null;
        product: ProductInput | null;
        productError: string | null;
      };

      if (style?.static) {
        // Style enregistré : la fiche produit est lue ici, puis les textes du
        // style sont réécrits pour elle — aucun relevé d'image à refaire.
        let found: ProductInput | null = product;
        let productError: string | null = null;
        if (!found && productUrl.trim()) {
          try {
            const res = await fetch("/api/ugc", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "fetch", url: productUrl.trim() }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error);
            found = body.product as ProductInput;
          } catch (error) {
            productError = error instanceof Error ? error.message : "Fiche produit illisible";
          }
        }
        if (!found) throw new Error("Colle l'URL de ta fiche produit — elle porte le produit et son prix");
        const res = await fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "adapt-static", id: style.id, product: found }),
        });
        const adapted = (await res.json()) as { elements?: StaticElement[]; error?: string };
        if (!res.ok) throw new Error(adapted.error || "Adaptation impossible");
        read = {
          layout: style.static.layout,
          elements: (adapted.elements ?? []).map((element) => ({ ...element })) as Array<Record<string, string>>,
          fontStyle: style.static.fontStyle,
          compositionError: null,
          product: found,
          productError,
        };
      } else {
        const staticBase64 = await toDataUrl(source as File);
        read = await post({
          action: "static-analyze",
          staticBase64,
          productUrl: productUrl.trim() || undefined,
          product: product ?? undefined,
        });
      }

      if (read.compositionError) throw new Error(read.compositionError);
      if (read.productError) toast.error(read.productError);

      const found = read.product ?? product;
      if (!found) {
        throw new Error("Colle l'URL de ta fiche produit — elle porte le produit et son prix");
      }
      setProduct(found);
      if (!price.trim()) setPrice(found.price || "");
      if (!comparePrice.trim()) setComparePrice(found.comparePrice || "");

      // Les prix saisis priment sur ceux de la fiche.
      const withPrices = {
        ...found,
        price: price.trim() || found.price,
        comparePrice: comparePrice.trim() || found.comparePrice,
      };

      await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          await sleep(index * 1200);
          try {
            const { taskId } = await post<{ taskId: string }>({
              action: "static-generate",
              product: withPrices,
              layout: read.layout,
              elements: read.elements,
              fontStyle: read.fontStyle,
              aspect,
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
        zip.file(`remake-${i + 1}.png`, blob);
      })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `remake-${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const done = shots.filter((shot) => shot.url).length;

  return (
    <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <p className="mb-2 text-[12px] font-semibold">1 · Ad de référence</p>
          {styles.length ? (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                <Library className="h-3 w-3" />
                Styles enregistrés
              </div>
              <div className="rail flex gap-1.5 overflow-x-auto pb-1">
                {styles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => pickStyle(item)}
                    title={`${item.name} — ${item.pitch}`}
                    className={cn(
                      "shrink-0 overflow-hidden rounded-lg ring-2 transition-transform hover:scale-[1.03]",
                      styleId === item.id ? "ring-slate-900 dark:ring-white" : "ring-transparent"
                    )}
                    style={{ width: 54, height: 68 }}
                  >
                    <StylePoster style={item} />
                  </button>
                ))}
              </div>
              {style ? (
                <p className="mt-1 text-[10px] leading-snug text-slate-500">
                  <strong className="text-slate-800 dark:text-slate-200">{style.name}</strong> — {style.pitch}
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-[12px] text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            <ImagePlus className="h-3.5 w-3.5" />
            {source ? source.name : style ? "Ou charge une autre ad" : "Charger l'ad à copier"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => pick(event.target.files?.[0])}
            />
          </label>

          {sourceUrl ? (
            <div className="relative mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sourceUrl} alt="" className="w-full rounded-lg" />
              <button
                type="button"
                onClick={() => {
                  setSource(null);
                  setSourceUrl("");
                  setShots([]);
                }}
                className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white"
              >
                <X className="h-3 w-3" />
              </button>
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">
                {aspect}
              </span>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <p className="mb-2 text-[12px] font-semibold">2 · Ton produit</p>
          <input
            value={productUrl}
            onChange={(event) => setProductUrl(event.target.value)}
            placeholder="https://ta-boutique.com/products/..."
            className={field}
          />

          {product ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
              {product.imageUrls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrls[0]} alt="" className="h-10 w-10 rounded object-cover" />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium">{product.name}</p>
                <p className="text-[10px] text-slate-500">
                  {product.imageUrls.length} image(s) de référence
                </p>
              </div>
            </div>
          ) : null}

          {/* Le prix vient de la fiche, et se force quand on teste une offre. */}
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="Prix"
              className={field}
            />
            <input
              value={comparePrice}
              onChange={(event) => setComparePrice(event.target.value)}
              placeholder="Prix barré"
              className={field}
            />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <p className="mb-2 text-[12px] font-semibold">3 · Déclinaisons</p>
          <div className="flex gap-1">
            {COUNTS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCount(value)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-[12px] font-semibold",
                  count === value
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                ×{value}
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || (!source && !style)}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[13px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {busy ? "Copie en cours" : `Copier ×${count}`}
        </button>
      </aside>

      <section className="min-h-[50vh] rounded-2xl bg-slate-50/80 p-2 ring-1 ring-slate-900/[0.04] dark:bg-slate-950/40">
        <div className="mb-2 flex items-center gap-3 px-1">
          <p className="mr-auto text-[11px] text-slate-400">
            {shots.length ? `${done}/${shots.length} prête(s)` : "Les copies arrivent ici"}
          </p>
          {done ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setSelectMode((value) => !value);
                  setPicked([]);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold",
                  selectMode
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                <CheckSquare className="h-3 w-3" />
                {selectMode ? "Terminer" : "Sélectionner"}
              </button>
              <button
                type="button"
                onClick={() => void zipPicked()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300"
              >
                <Download className="h-3 w-3" />
                ZIP
              </button>
            </>
          ) : null}
        </div>

        {shots.length ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {shots.map((shot) => {
              const chosen = shot.url ? picked.includes(shot.url) : false;
              return (
                <article
                  key={shot.id}
                  className={cn(
                    "overflow-hidden rounded-xl bg-white ring-1 dark:bg-slate-900",
                    chosen ? "ring-2 ring-emerald-500" : "ring-slate-900/[0.06]"
                  )}
                >
                  <div className="relative aspect-[3/4] bg-slate-100 dark:bg-slate-800">
                    {shot.url ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const url = shot.url as string;
                            if (!selectMode) return setZoom(url);
                            setPicked((current) =>
                              current.includes(url)
                                ? current.filter((item) => item !== url)
                                : [...current, url]
                            );
                          }}
                          className="block h-full w-full"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={shot.url}
                            alt=""
                            className={cn(
                              "h-full w-full object-cover transition-opacity",
                              selectMode && !chosen && "opacity-60"
                            )}
                          />
                        </button>
                        {selectMode ? (
                          <span
                            className={cn(
                              "pointer-events-none absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md text-[11px] font-bold",
                              chosen
                                ? "bg-emerald-500 text-white"
                                : "bg-slate-950/40 text-white/60 ring-1 ring-white/40"
                            )}
                          >
                            {chosen ? "✓" : ""}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-slate-400">
                        {shot.error ? (
                          <span className="text-rose-500">{shot.error}</span>
                        ) : (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        )}
                      </div>
                    )}
                  </div>
                  {shot.url ? (
                    <a
                      href={shot.url}
                      download
                      className="block px-2 py-1.5 text-center text-[10px] font-medium text-slate-500"
                    >
                      Télécharger
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid h-[46vh] place-items-center px-6 text-center text-[12px] text-slate-400">
            Charge l&apos;ad d&apos;un concurrent et ton lien produit, puis lance la copie.
          </div>
        )}
      </section>

      {selectMode && picked.length ? (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-950/80 px-3 py-2 text-white shadow-2xl backdrop-blur-md">
            <span className="px-1 text-[12px] font-semibold">{picked.length} copie(s)</span>
            <button
              type="button"
              onClick={() => void zipPicked()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-slate-900"
            >
              <Download className="h-3.5 w-3.5" />
              Télécharger le ZIP
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
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom}
            alt=""
            onClick={(event) => event.stopPropagation()}
            className="max-h-[80vh] w-auto rounded-xl shadow-2xl"
          />
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <a
              href={zoom}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-[12px] font-semibold text-slate-900"
            >
              <Download className="h-3.5 w-3.5" />
              Télécharger
            </a>
            <button
              type="button"
              onClick={() => setZoom(null)}
              className="h-9 rounded-lg px-3 text-[12px] font-medium text-slate-300 hover:text-white"
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
