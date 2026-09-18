"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ImagePlus, Link2, Loader2, Package, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { engineGet, enginePost, fileToDataUrl, panel } from "@/components/mass-test/engine-client";
import { PageHeader } from "@/components/shared/page-states";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProductImageCandidate } from "@/lib/creative-engine/product-images";
import { primaryReference, productKeyPoints, productPriceLabel, type ProductContext } from "@/lib/creative-engine/types";
import { imageSrc, studioPost } from "@/lib/studio/client";
import { cn } from "@/lib/utils";

/**
 * Le catalogue des produits du Creative Engine, dans « Création » : la fiche
 * de chaque produit (nom, description, prix, images de référence, points
 * clés) se saisit ici, à la main ou depuis une page produit lue. Static pioche
 * dedans ; il ne crée rien.
 */

const CURRENCIES = [
  { id: "EUR", label: "Euro (€ · EUR)" },
  { id: "USD", label: "Dollar ($ · USD)" },
  { id: "GBP", label: "Livre (£ · GBP)" },
  { id: "CHF", label: "Franc suisse (CHF)" },
  { id: "CAD", label: "Dollar canadien (CAD)" },
];

const MAX_IMAGES = 8;

export function ProductCatalog() {
  const [products, setProducts] = useState<ProductContext[] | null>(null);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [editing, setEditing] = useState<ProductContext | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProductContext | null>(null);

  async function reload() {
    try {
      setProducts((await engineGet()).products);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Produits illisibles");
      setProducts([]);
    }
  }

  useEffect(() => {
    // Hors du corps de l'effet : la liste arrive du réseau, pas d'un rendu en cascade.
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (products ?? []).filter((product) => !needle || `${product.name} ${product.store}`.toLowerCase().includes(needle));
  }, [products, query]);

  /** Une page produit lue par le moteur : nom, photos et analyse arrivent d'un coup ; la fiche se complète ensuite. */
  async function analyze() {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return toast.error("Colle le lien complet de la page produit");
    setAnalyzing(true);
    try {
      const data = await enginePost<{ product: ProductContext; fallbackReason?: string }>({ action: "analyze", url: clean });
      setUrl("");
      await reload();
      setEditing(data.product);
      toast.success(data.fallbackReason ? `${data.product.name} chargé · ${data.fallbackReason}` : `${data.product.name} chargé et analysé`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Page produit illisible");
    } finally {
      setAnalyzing(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await enginePost({ action: "product-delete", productId: deleting.id });
      setProducts((current) => current?.filter((product) => product.id !== deleting.id) ?? current);
      toast.success(`${deleting.name} supprimé`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Produits"
        description="La fiche de chaque produit : nom, description, prix, photos de référence et points clés. Static pioche ici."
        actions={
          <button type="button" onClick={() => setEditing("new")} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900" data-product-new>
            <Plus className="h-3.5 w-3.5" /> Ajouter un produit
          </button>
        }
      />

      <div className={cn(panel, "mb-3 flex flex-wrap items-center gap-2")}>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un produit…" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950" data-product-search />
        </div>
        <div className="relative min-w-[280px] flex-[2]">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void analyze();
            }}
            placeholder="…ou colle une URL de page produit : la fiche est lue et analysée"
            className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[12px] dark:border-slate-700 dark:bg-slate-950"
            data-product-url
          />
        </div>
        <button type="button" onClick={() => void analyze()} disabled={analyzing} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
          {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Lire la page
        </button>
      </div>

      {products === null ? (
        <div className="flex items-center gap-1.5 py-10 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des produits…</div>
      ) : !visible.length ? (
        <div className={cn(panel, "py-10 text-center text-[12px] text-slate-500")}>{products.length ? "Aucun produit ne correspond." : "Aucun produit : ajoute-en un ou colle une page produit."}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-product-grid>
          {visible.map((product) => {
            const primary = primaryReference(product);
            const thumb = primary?.url ?? product.imageUrls[0] ?? null;
            const price = productPriceLabel(product);
            const points = productKeyPoints(product);
            return (
              <article key={product.id} className={cn(panel, "flex flex-col gap-2")} data-product-card={product.id}>
                <button type="button" onClick={() => setEditing(product)} className="flex items-start gap-3 text-left">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/10 dark:bg-slate-800">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageSrc(thumb)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400"><Package className="h-5 w-5" /></div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{product.name}</div>
                    <div className="truncate text-[11.5px] text-slate-500">{product.store}</div>
                    <div className="mt-0.5 text-[12px] font-medium text-slate-700 dark:text-slate-200">{price || <span className="text-slate-400">Prix non renseigné</span>}</div>
                  </div>
                </button>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-slate-500">
                  <span className={primary ? "text-emerald-600" : "text-amber-600"}>{primary ? "✓ référence principale" : "○ pas de référence"}</span>
                  <span>· {product.imageUrls.length} photo{product.imageUrls.length > 1 ? "s" : ""}</span>
                  <span>· {points.length} point{points.length > 1 ? "s" : ""} clé{points.length > 1 ? "s" : ""}</span>
                  {product.analysis ? <span>· analysé</span> : null}
                </div>
                <div className="mt-auto flex items-center gap-2">
                  <button type="button" onClick={() => setEditing(product)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200" data-product-edit>
                    <Pencil className="h-3 w-3" /> Modifier
                  </button>
                  <Link href="/studio/static" onClick={() => rememberForStatic(product.id)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                    <Sparkles className="h-3 w-3" /> Créer
                  </Link>
                  <button type="button" onClick={() => setDeleting(product)} className="ml-auto inline-flex h-8 items-center rounded-lg px-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40" aria-label={`Supprimer ${product.name}`} data-product-delete>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing ? (
        <ProductSheetDialog
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setProducts((current) => {
              const list = current ?? [];
              return list.some((product) => product.id === saved.id) ? list.map((product) => (product.id === saved.id ? saved : product)) : [saved, ...list];
            });
            setEditing(null);
          }}
        />
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="dark:text-slate-100">Supprimer ce produit ?</DialogTitle>
            <DialogDescription>« {deleting?.name} » disparaît du catalogue. Les créas déjà générées restent en bibliothèque.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="h-9 rounded-xl px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Annuler</button>
            <button type="button" onClick={() => void confirmDelete()} className="h-9 rounded-xl bg-rose-600 px-3 text-[12px] font-semibold text-white hover:bg-rose-500" data-product-delete-confirm>Supprimer</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Static retrouve le produit choisi ici : même clé locale que son sélecteur. */
export const STATIC_PRODUCT_KEY = "msgate.free-prompt.product";

function rememberForStatic(id: string) {
  try {
    localStorage.setItem(STATIC_PRODUCT_KEY, id);
  } catch {
    // stockage indisponible : Static proposera la liste
  }
}

type SheetImage = { url: string; primary: boolean };

/** La fiche d'un produit, à créer ou à modifier : ce qui est enregistré est exactement ce qui est affiché. */
export function ProductSheetDialog({ product, onClose, onSaved }: { product: ProductContext | null; onClose: () => void; onSaved: (product: ProductContext) => void }) {
  const [name, setName] = useState(product?.name ?? "");
  const [store, setStore] = useState(product?.store ?? "");
  const [description, setDescription] = useState(product?.description ?? product?.analysis?.transformation ?? "");
  const [price, setPrice] = useState(product?.price ?? product?.analysis?.price ?? "");
  const [comparePrice, setComparePrice] = useState(product?.comparePrice ?? product?.analysis?.comparePrice ?? "");
  const [currency, setCurrency] = useState(product?.currency ?? "EUR");
  const [keyPoints, setKeyPoints] = useState<string[]>(() => (product ? productKeyPoints(product) : []));
  const [images, setImages] = useState<SheetImage[]>(() => {
    const primary = product ? primaryReference(product)?.url ?? null : null;
    return (product?.imageUrls ?? []).map((url) => ({ url, primary: url === primary }));
  });
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function addFiles(files: FileList | File[]) {
    const room = MAX_IMAGES - images.length;
    const list = [...files].filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!list.length) return toast.error(`${MAX_IMAGES} photos maximum`);
    setUploading(true);
    try {
      const uploaded: SheetImage[] = [];
      for (const file of list) {
        const dataUrl = await fileToDataUrl(file);
        const { url } = await studioPost<{ url: string }>({ action: "upload", imageDataUrl: dataUrl, fileName: file.name.replace(/[^\w.-]+/g, "-") || `photo-${Date.now()}.png` });
        if (url) uploaded.push({ url, primary: false });
      }
      setImages((current) => {
        const next = [...current, ...uploaded].slice(0, MAX_IMAGES);
        // La première photo devient la référence s'il n'y en avait pas.
        return next.some((image) => image.primary) ? next : next.map((image, index) => ({ ...image, primary: index === 0 }));
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Envoi impossible");
    } finally {
      setUploading(false);
    }
  }

  /** Les photos de la page produit, quand il y en a une : ajoutées à la fiche, sans les logos ni pictos. */
  async function readPage() {
    if (!product?.url) return;
    setReading(true);
    try {
      const data = await enginePost<{ images: ProductImageCandidate[] }>({ action: "product-images", productId: product.id });
      const fresh = data.images.filter((image) => !image.junk).map((image) => image.url);
      setImages((current) => {
        const known = new Set(current.map((image) => image.url));
        const added = fresh.filter((url) => !known.has(url)).slice(0, Math.max(0, MAX_IMAGES - current.length));
        if (!added.length) toast.info("Aucune nouvelle photo sur la page");
        else toast.success(`${added.length} photo${added.length > 1 ? "s" : ""} ajoutée${added.length > 1 ? "s" : ""} depuis la page`);
        const next = [...current, ...added.map((url) => ({ url, primary: false }))];
        return next.some((image) => image.primary) ? next : next.map((image, index) => ({ ...image, primary: index === 0 }));
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Page illisible");
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!name.trim()) return toast.error("Le nom du produit est obligatoire");
    setSaving(true);
    try {
      const sheet = { name: name.trim(), store: store.trim(), description, price, comparePrice, currency, keyPoints: keyPoints.map((point) => point.trim()).filter(Boolean), imageUrls: images.map((image) => image.url) };
      let saved = product
        ? (await enginePost<{ product: ProductContext }>({ action: "product-update", productId: product.id, ...sheet })).product
        : (await enginePost<{ product: ProductContext }>({ action: "product-create", ...sheet })).product;
      const primary = images.find((image) => image.primary)?.url ?? null;
      const before = primaryReference(saved)?.url ?? null;
      if (primary && primary !== before) saved = (await enginePost<{ product: ProductContext }>({ action: "product-reference", productId: saved.id, referenceType: "primary", referenceUrl: primary })).product;
      else if (!primary && before) saved = (await enginePost<{ product: ProductContext }>({ action: "product-reference-clear", productId: saved.id, referenceType: "primary" })).product;
      toast.success(product ? "Produit enregistré" : `${saved.name} ajouté`);
      onSaved(saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
  const label = "mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-200";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-5 dark:border-slate-800 dark:bg-slate-900" data-product-sheet>
        <DialogHeader>
          <DialogTitle className="dark:text-slate-100">{product ? "Modifier le produit" : "Nouveau produit"}</DialogTitle>
          <DialogDescription className="sr-only">Fiche du produit</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label className={label} htmlFor="product-name">Nom</label>
              <input id="product-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Patch Slim" className={field} data-product-name />
            </div>
            <div>
              <label className={label} htmlFor="product-store">Marque / boutique</label>
              <input id="product-store" value={store} onChange={(event) => setStore(event.target.value)} placeholder="Catalogue" className={field} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="product-description">Description</label>
            <textarea id="product-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Ce que fait le produit, pour qui, en quelques phrases." className={cn(field, "resize-y leading-relaxed")} data-product-description />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="product-price">Prix</label>
              <input id="product-price" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="29,99" className={field} data-product-price />
            </div>
            <div>
              <label className={label} htmlFor="product-compare">Compare at</label>
              <input id="product-compare" value={comparePrice} onChange={(event) => setComparePrice(event.target.value)} placeholder="129" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="product-currency">Devise</label>
              <select id="product-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className={field}>
                {CURRENCIES.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className={cn(label, "mb-0")}>Images de référence <span className="font-normal text-slate-400">({images.length}/{MAX_IMAGES}) · clic : référence principale</span></span>
              <div className="flex items-center gap-1.5">
                {product?.url ? (
                  <button type="button" onClick={() => void readPage()} disabled={reading || images.length >= MAX_IMAGES} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                    {reading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Photos de la page
                  </button>
                ) : null}
                <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800", (uploading || images.length >= MAX_IMAGES) && "pointer-events-none opacity-50")}>
                  {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />} Ajouter des images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files?.length) void addFiles(event.target.files);
                      event.target.value = "";
                    }}
                    data-product-images-input
                  />
                </label>
              </div>
            </div>
            {images.length ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" data-product-images>
                {images.map((image) => (
                  <div key={image.url} className={cn("group relative aspect-square overflow-hidden rounded-xl bg-slate-100 ring-2 dark:bg-slate-800", image.primary ? "ring-emerald-500" : "ring-transparent")} data-image-primary={image.primary ? "true" : "false"}>
                    <button type="button" onClick={() => setImages((current) => current.map((entry) => ({ ...entry, primary: entry.url === image.url })))} className="h-full w-full" title={image.primary ? "Référence principale" : "Définir comme référence principale"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageSrc(image.url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                    {image.primary ? <span className="pointer-events-none absolute left-1 top-1 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[9.5px] font-semibold text-white shadow">Primary</span> : null}
                    <button
                      type="button"
                      onClick={() =>
                        setImages((current) => {
                          const next = current.filter((entry) => entry.url !== image.url);
                          return next.some((entry) => entry.primary) || !next.length ? next : next.map((entry, index) => ({ ...entry, primary: index === 0 }));
                        })
                      }
                      className="absolute right-1 top-1 rounded-md bg-slate-950/70 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="Retirer cette image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[11.5px] text-slate-500 dark:border-slate-700">Aucune image. La première ajoutée devient la référence principale : la vraie photo du produit, envoyée au modèle.</p>
            )}
          </div>

          <div>
            <span className={label}>Points clés</span>
            <div className="space-y-1.5" data-product-keypoints>
              {keyPoints.map((point, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    value={point}
                    onChange={(event) => setKeyPoints((current) => current.map((entry, i) => (i === index ? event.target.value : entry)))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setKeyPoints((current) => [...current.slice(0, index + 1), "", ...current.slice(index + 1)]);
                      }
                    }}
                    placeholder="Un bénéfice, une preuve, un fait"
                    className={field}
                  />
                  <button type="button" onClick={() => setKeyPoints((current) => current.filter((_, i) => i !== index))} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Retirer ce point">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setKeyPoints((current) => [...current, ""])} disabled={keyPoints.length >= 12} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" data-product-keypoint-add>
                <Plus className="h-3 w-3" /> Ajouter un point clé
              </button>
            </div>
          </div>

          {product?.url ? (
            <p className="truncate text-[11px] text-slate-400">
              Page : <a href={product.url} target="_blank" rel="noreferrer" className="hover:underline">{product.url}</a>
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Annuler</button>
          <button type="button" onClick={() => void save()} disabled={saving || uploading} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-[12px] font-semibold text-white hover:bg-sky-500 disabled:opacity-60" data-product-save>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {product ? "Enregistrer" : "Ajouter le produit"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
