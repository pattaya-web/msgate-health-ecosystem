"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Dices, Link2, Loader2, Shuffle, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { usePublishHermesContext } from "@/components/ask-hermes/page-context";
import {
  CREATIVE_CATEGORIES,
  CREATIVE_TYPES,
  MARKETING_ANGLES,
  PRODUCT_CATEGORIES,
  VISUAL_ELEMENTS,
  buildCreativePrompt,
  creativeTypesFor,
  type CreativeType,
  type Preview,
  type PreviewAccent,
  type ProductCategory,
} from "@/lib/studio/creative-types";
import { RATIOS, type Ratio } from "@/lib/studio/ratios";
import { cn } from "@/lib/utils";

const QUICK_COUNTS = [3, 5, 10];

/** Ce que la lecture de la fiche produit rapporte, et qui nourrit les prompts. */
type FetchedProduct = {
  name: string;
  description: string;
  price: string;
  comparePrice: string;
  brand: string;
  keyPoints: string[];
  imageUrls: string[];
};

/**
 * Production de créatives en lot.
 *
 * Le geste tient en quatre temps — produit, types, déclinaisons, lancer — et
 * tout le reste est replié. Un écran de test se juge à la vitesse à laquelle on
 * peut lancer trente créas, pas au nombre de réglages qu'il expose.
 *
 * Le panneau ne génère rien lui-même : il fabrique les prompts et les remet à
 * la machinerie existante de l'onglet Static, qui sait déjà téléverser les
 * références, suivre les tâches et ranger les images en bibliothèque.
 */
export function CreativeBatch({
  productName,
  onLaunch,
  onProduct,
  ratio,
  onRatio,
  resolution,
  onResolution,
  busy,
}: {
  productName: string;
  onLaunch: (prompts: string[]) => void;
  /** Remonte les photos de la fiche pour qu'elles servent de références. */
  onProduct?: (imageUrls: string[]) => void;
  ratio: Ratio;
  onRatio: (value: Ratio) => void;
  resolution: "1K" | "2K";
  onResolution: (value: "1K" | "2K") => void;
  busy: boolean;
}) {
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [openFamilies, setOpenFamilies] = useState<string[]>(["performance"]);
  const [angles, setAngles] = useState<string[]>([]);
  const [elements, setElements] = useState<string[]>([]);
  const [autoMix, setAutoMix] = useState(true);
  const [randomElements, setRandomElements] = useState(true);
  /** Graine du lot : renouvelée à chaque lancement, gardée pour rejouer. */
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [product, setProduct] = useState<FetchedProduct | null>(null);
  usePublishHermesContext(
    "creative-batch-product",
    product ? { pageType: "product", productName: product.name, ...(url.trim() ? { productUrl: url.trim() } : {}), ...(product.brand ? { storeName: product.brand } : {}) } : null
  );
  const [echoOn, setEchoOn] = useState(false);
  const [echoColor, setEchoColor] = useState("#2f6fd0");

  const recommended = useMemo(() => creativeTypesFor(category), [category]);
  const ids = Object.keys(selected);
  const total = Object.values(selected).reduce((sum, value) => sum + value, 0);
  const subject = name.trim() || productName.trim();

  /**
   * Lit la fiche produit et remplit tout d'un coup.
   *
   * Les arguments de vente ne s'inventent pas au moment du prompt : ils sont
   * déjà écrits sur la page produit. Les remplir à la main pour chaque lot
   * serait le vrai coût de l'outil.
   */
  async function fetchProduct() {
    const target = url.trim();
    if (!target) return;
    setFetching(true);
    try {
      const res = await fetch("/api/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch", url: target }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Lecture impossible");

      const found = body.product as FetchedProduct;
      setProduct(found);
      setName(found.name || "");
      // Les photos de la fiche deviennent les références de génération.
      onProduct?.(found.imageUrls || []);
      toast.success(
        `${found.name} — ${found.keyPoints?.filter(Boolean).length || 0} point(s) clé(s), ${found.imageUrls?.length || 0} image(s)`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fiche illisible");
    } finally {
      setFetching(false);
    }
  }

  function toggle(type: CreativeType) {
    setSelected((current) => {
      const next = { ...current };
      if (next[type.id]) delete next[type.id];
      else next[type.id] = type.defaultVariations;
      return next;
    });
  }

  function setCount(id: string, value: number) {
    setSelected((current) => ({ ...current, [id]: Math.max(1, Math.min(50, value)) }));
  }

  function applyEach(value: number) {
    setSelected((current) => {
      const next: Record<string, number> = {};
      for (const id of Object.keys(current)) next[id] = value;
      return next;
    });
  }

  function selectMany(list: string[]) {
    setSelected((current) => {
      const next = { ...current };
      for (const id of list) {
        if (!next[id]) {
          next[id] = CREATIVE_TYPES.find((type) => type.id === id)?.defaultVariations ?? 5;
        }
      }
      return next;
    });
  }

  function launch() {
    if (!subject) return;
    const prompts: string[] = [];
    for (const [id, count] of Object.entries(selected)) {
      const type = CREATIVE_TYPES.find((item) => item.id === id);
      if (!type) continue;
      for (let variation = 0; variation < count; variation += 1) {
        prompts.push(
          buildCreativePrompt({
            creativeType: type,
            angleIds: angles,
            visualElementIds: elements.length ? elements : type.defaultVisualElements,
            productName: subject,
            productCategory: category,
            productDescription: product?.description,
            price: product?.price,
            comparePrice: product?.comparePrice,
            keyPoints: product?.keyPoints,
            variation,
            autoMix,
            echoColor: echoOn ? echoColor : null,
            seed,
            randomElements,
          })
        );
      }
    }
    onLaunch(prompts);
    // Le lot suivant tire autre chose : la graine ne sert qu'une fois.
    setSeed(Math.floor(Math.random() * 1e9));
  }

  return (
    <div className="space-y-3">
      {/* 1 — le produit, en une ligne */}
      <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold">1 · Produit</span>
          <div className="relative min-w-[240px] flex-1">
            <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void fetchProduct();
              }}
              placeholder="Colle l'URL de ta fiche produit et appuie sur Entrée"
              className="w-full rounded-lg bg-slate-50 py-1.5 pl-8 pr-2.5 text-[12px] outline-none dark:bg-slate-800"
            />
          </div>
          <button
            type="button"
            onClick={() => void fetchProduct()}
            disabled={fetching || !url.trim()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[11px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Charger
          </button>
        </div>

        {product ? (
          <div className="mb-2 flex gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
            {product.imageUrls?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrls[0]}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold">{product.name}</p>
              <p className="text-[11px] text-slate-500">
                {product.price}
                {product.comparePrice ? (
                  <span className="ml-1 text-slate-400 line-through">{product.comparePrice}</span>
                ) : null}
                {product.imageUrls?.length ? ` · ${product.imageUrls.length} image(s)` : ""}
              </p>
              {product.keyPoints?.filter(Boolean).length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {product.keyPoints.filter(Boolean).map((point, index) => (
                    <span
                      key={index}
                      className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-900 dark:text-slate-300"
                    >
                      {point}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={productName || "…ou saisis le nom du produit à la main"}
          className="mb-2 w-full rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] outline-none dark:bg-slate-800"
        />

        {/* Rappel de couleur : un seul détail de l'image reprend celle du
            produit. Optionnel, parce que sur un fond neutre ça ne sert à rien. */}
        <label className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={echoOn} onChange={(e) => setEchoOn(e.target.checked)} />
          Rappeler la couleur du produit
          {echoOn ? (
            <>
              <input
                type="color"
                value={echoColor}
                onChange={(event) => setEchoColor(event.target.value)}
                className="h-6 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <span className="text-[10px] text-slate-400">
                un seul détail la reprend — jamais toute l&apos;image
              </span>
            </>
          ) : (
            <span className="text-[10px] text-slate-400">
              ex. robe bleue → un accessoire ou le texte dans le même bleu
            </span>
          )}
        </label>
        {/* La catégorie ne verrouille rien : elle ne fait que suggérer. */}
        <div className="flex flex-wrap gap-1">
          {PRODUCT_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(category === item.id ? null : item.id)}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                category === item.id
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {/* 2 — les types, cœur de la page */}
      <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-auto text-[12px] font-semibold">2 · Types de créatives</span>
          {recommended.length ? (
            <button type="button" onClick={() => selectMany(recommended)} className={quick}>
              Recommandés
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => selectMany(CREATIVE_TYPES.map((type) => type.id))}
            className={quick}
          >
            Tout
          </button>
          <button type="button" onClick={() => setSelected({})} className={quick}>
            Vider
          </button>
          {QUICK_COUNTS.map((value) => (
            <button key={value} type="button" onClick={() => applyEach(value)} className={quick}>
              ×{value}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAutoMix((value) => !value)}
            title="Fait varier fond, cadrage, lumière et position d'une déclinaison à l'autre"
            className={cn(
              quick,
              autoMix && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            )}
          >
            <Shuffle className="mr-1 inline h-3 w-3" />
            Auto Mix
          </button>
          <button
            type="button"
            onClick={() => setRandomElements((value) => !value)}
            title="Tire au sort les éléments visuels et leur nombre, différemment sur chaque créa"
            className={cn(
              quick,
              randomElements && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            )}
          >
            <Dices className="mr-1 inline h-3 w-3" />
            Aléatoire
          </button>
        </div>

        <div className="space-y-1.5">
          {CREATIVE_CATEGORIES.map((family) => {
            const types = CREATIVE_TYPES.filter((type) => type.category === family.id && type.enabled);
            if (!types.length) return null;
            const open = openFamilies.includes(family.id);
            const picked = types.filter((type) => selected[type.id]).length;

            return (
              <div key={family.id}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenFamilies((current) =>
                      current.includes(family.id)
                        ? current.filter((id) => id !== family.id)
                        : [...current, family.id]
                    )
                  }
                  className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
                  {family.label}
                  <span className="ml-auto normal-case tracking-normal text-slate-400">
                    {picked ? `${picked} sélectionné(s)` : `${types.length}`}
                  </span>
                </button>

                {open ? (
                  <div className="grid grid-cols-2 gap-1.5 pb-1 pt-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {types.map((type) => {
                      const count = selected[type.id];
                      const isRecommended = recommended.includes(type.id);
                      return (
                        <div
                          key={type.id}
                          className={cn(
                            "rounded-lg p-1.5 ring-1 transition-colors",
                            count
                              ? "bg-emerald-50/60 ring-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-500/40"
                              : "bg-slate-50 ring-transparent hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggle(type)}
                            title={`${type.name} — ${type.description}`}
                            className="w-full text-left"
                          >
                            <PreviewCard preview={type.preview} />

                            <div className="flex items-center gap-1">
                              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold leading-tight">
                                {type.name}
                              </span>
                              {isRecommended ? (
                                <span
                                  title="Recommandé pour cette catégorie"
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                                />
                              ) : null}
                            </div>
                          </button>

                          {count ? (
                            <div className="mt-1 flex items-center gap-1">
                              <span className="text-[9px] text-slate-500">×</span>
                              <input
                                type="number"
                                min={1}
                                max={50}
                                value={count}
                                onChange={(event) => setCount(type.id, Number(event.target.value))}
                                className="w-full rounded bg-white px-1 py-0.5 text-[10px] font-semibold outline-none dark:bg-slate-900"
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* 3 — le reste, replié par défaut */}
      <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          className="flex w-full items-center gap-1.5 text-[12px] font-semibold"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !advanced && "-rotate-90")} />
          Réglages avancés
          <span className="ml-auto text-[10px] font-normal text-slate-400">
            {angles.length || elements.length
              ? `${angles.length} angle(s) · ${elements.length} élément(s)`
              : "le système décide"}
          </span>
        </button>

        {advanced ? (
          <div className="mt-2 space-y-3">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Angle marketing — optionnel
              </p>
              <div className="flex flex-wrap gap-1">
                {MARKETING_ANGLES.map((angle) => (
                  <button
                    key={angle.id}
                    type="button"
                    onClick={() =>
                      setAngles((current) =>
                        current.includes(angle.id)
                          ? current.filter((id) => id !== angle.id)
                          : [...current, angle.id]
                      )
                    }
                    className={cn(chip, angles.includes(angle.id) && chipOn)}
                  >
                    {angle.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Éléments visuels — vide = choisis par type
              </p>
              <div className="flex flex-wrap gap-1">
                {VISUAL_ELEMENTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setElements((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id]
                      )
                    }
                    className={cn(chip, elements.includes(item.id) && chipOn)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* 4 — le récapitulatif, puis le lancement */}
      <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        {/* Le format se décide ici : en mode lot, le panneau prompt libre qui
            le portait est masqué. */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Format
          </span>
          {RATIOS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onRatio(item.id)}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] font-medium",
                ratio === item.id
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              )}
            >
              {item.id}
              <span className="ml-1 text-[10px] opacity-60">{item.hint}</span>
            </button>
          ))}
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Définition
          </span>
          {(["1K", "2K"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onResolution(item)}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] font-medium",
                resolution === item
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              )}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>
            Produit <strong className="text-slate-900 dark:text-slate-100">{subject || "—"}</strong>
          </span>
          <span>
            Types <strong className="text-slate-900 dark:text-slate-100">{ids.length}</strong>
          </span>
          <span>
            Format <strong className="text-slate-900 dark:text-slate-100">{ratio}</strong>
          </span>
          <span>
            Total <strong className="text-slate-900 dark:text-slate-100">{total}</strong> créa(s)
          </span>
          {autoMix ? <span className="text-emerald-600 dark:text-emerald-400">Auto Mix</span> : null}
          {randomElements ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              Aléatoire · graine {seed.toString(36)}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={launch}
          disabled={busy || !total || !subject}
          className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[13px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {busy ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Wand2 className="h-4 w-4" />}
          {total ? `Générer ${total} créative${total > 1 ? "s" : ""}` : "Sélectionne des types"}
        </button>

        {!subject ? (
          <p className="mt-1 text-center text-[10px] text-amber-600 dark:text-amber-400">
            Renseigne le nom du produit — c&apos;est lui qui part dans chaque prompt.
          </p>
        ) : null}
      </section>
    </div>
  );
}

const quick =
  "rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300";

const chip =
  "rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300";

const chipOn = "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";

/**
 * Maquette miniature d'un type de créative.
 *
 * Le bloc gris est le produit, le reste est ce qui l'entoure. On choisit ici
 * sur l'allure d'une mise en page, pas sur une description à lire — c'est tout
 * l'intérêt d'avoir des cards plutôt qu'une liste.
 */
function PreviewCard({ preview }: { preview: Preview }) {
  const accents = (where: PreviewAccent["at"][]) =>
    preview.accents
      .filter((accent) => where.includes(accent.at))
      .map((accent, index) => <Accent key={index} accent={accent} />);

  const body = (() => {
    switch (preview.layout) {
      case "full":
        return <div className="h-full w-full rounded-sm bg-slate-300 dark:bg-slate-600" />;
      case "split-v":
        return (
          <div className="flex h-full w-full gap-1">
            <div className="flex-1 rounded-sm bg-slate-200 dark:bg-slate-700" />
            <div className="flex-1 rounded-sm bg-slate-300 dark:bg-slate-600" />
          </div>
        );
      case "split-h":
        return (
          <div className="flex h-full w-full flex-col gap-1">
            <div className="flex-1 rounded-sm bg-slate-200 dark:bg-slate-700" />
            <div className="flex-1 rounded-sm bg-slate-300 dark:bg-slate-600" />
          </div>
        );
      case "grid":
        return (
          <div className="grid h-full w-full grid-cols-3 gap-1">
            <div className="rounded-sm bg-slate-200 dark:bg-slate-700" />
            <div className="rounded-sm bg-slate-200 dark:bg-slate-700" />
            <div className="rounded-sm bg-slate-300 dark:bg-slate-600" />
          </div>
        );
      case "sidebar":
        return (
          <div className="flex h-full w-full gap-1">
            <div className="w-1/2 rounded-sm bg-slate-300 dark:bg-slate-600" />
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
              <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
              <div className="h-1 w-2/3 rounded-full bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        );
      case "product-top":
        return <div className="h-2/3 w-2/3 rounded-sm bg-slate-300 dark:bg-slate-600" />;
      case "product-bottom":
        return <div className="mt-auto h-1/2 w-2/3 rounded-sm bg-slate-300 dark:bg-slate-600" />;
      default:
        return <div className="h-3/5 w-1/2 rounded-sm bg-slate-300 dark:bg-slate-600" />;
    }
  })();

  return (
    <div className="relative mb-1 flex h-[46px] w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md bg-white p-1 dark:bg-slate-900">
      <div className="flex w-full flex-col items-center gap-0.5">{accents(["over"])}</div>
      <div className="flex w-full flex-1 items-center justify-center gap-1">
        {accents(["left"])}
        {body}
        {accents(["right"])}
      </div>
      <div className="flex w-full flex-col items-center gap-0.5">{accents(["under"])}</div>

      {preview.accents
        .filter((accent) => ["tl", "tr", "bl", "br"].includes(accent.at))
        .map((accent, index) => (
          <span
            key={index}
            className={cn(
              "absolute rounded-sm bg-slate-900 px-1 text-[7px] font-bold leading-[10px] text-white dark:bg-white dark:text-slate-900",
              accent.at === "tl" && "left-1 top-1",
              accent.at === "tr" && "right-1 top-1",
              accent.at === "bl" && "bottom-1 left-1",
              accent.at === "br" && "bottom-1 right-1"
            )}
          >
            {accent.text || "•"}
          </span>
        ))}
    </div>
  );
}

function Accent({ accent }: { accent: PreviewAccent }) {
  if (accent.kind === "stars") {
    return <span className="text-[8px] leading-none text-amber-500">★★★★★</span>;
  }
  if (accent.kind === "arrow") {
    return <span className="text-[10px] leading-none text-slate-400">→</span>;
  }
  if (accent.kind === "tick") {
    return <span className="text-[9px] leading-none text-emerald-500">✓</span>;
  }
  if (accent.kind === "cross") {
    return <span className="text-[9px] leading-none text-rose-500">✕</span>;
  }
  if (accent.kind === "price") {
    return (
      <span className="text-[10px] font-bold leading-none text-slate-900 dark:text-slate-100">
        {accent.text}
      </span>
    );
  }
  if (accent.kind === "strike") {
    return (
      <span className="text-[8px] leading-none text-slate-400 line-through">{accent.text}</span>
    );
  }
  if (accent.kind === "pill") {
    return (
      <span className="rounded-full bg-slate-900 px-1.5 text-[7px] font-bold leading-[11px] text-white dark:bg-white dark:text-slate-900">
        {accent.text}
      </span>
    );
  }
  return accent.text ? (
    <span className="truncate text-[8px] leading-none text-slate-500">{accent.text}</span>
  ) : (
    <span className="h-0.5 w-6 rounded-full bg-slate-200 dark:bg-slate-700" />
  );
}
