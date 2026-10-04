"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Palette, RefreshCw, Search, Store, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import { cn } from "@/lib/utils";

type Collection = { handle: string; title: string; products_count: number };

type ProductSummary = {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  variants: number;
  images: number;
  minPrice: number;
  maxPrice: number;
  image: string | null;
};

type ScrapeResult = {
  shop: string;
  products: ProductSummary[];
  totals: { products: number; variants: number; scanned: number };
  truncated: boolean;
  /** « json » : /products.json ; « sitemap » : vitrine headless, lue page par page. */
  source?: "json" | "sitemap";
  note?: string | null;
};

type RebrandItem = {
  handle: string;
  src: string;
  /** « product-only » : le produit seul, sans sa boîte, dérivé du rendu rebrandé. */
  kind?: "rebrand" | "product-only";
  taskId: string | null;
  state: "pending" | "done" | "fail";
  /** Adresse publique (CSV). */
  url: string | null;
  /** Même rendu servi depuis le disque de l'outil : c'est lui qu'on affiche. */
  localUrl?: string | null;
  error: string | null;
};

type RebrandState = {
  host: string;
  brand: { logoUrl: string; accent: string; background: string; brandName: string; resolution: "1K" | "2K"; model?: "nano-banana-pro" | "gpt-image-2" } | null;
  items: RebrandItem[];
  /** Faux quand un rendu n'est servi que par cette machine : le CSV ne sera pas importable ailleurs. */
  publicUrls: boolean;
  /** Vrai quand des rendus sont hébergés chez Kie faute de Supabase : URL publiques mais valables quelques jours. */
  temporaryUrls?: boolean;
};

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

/** Crédits Kie par image, relevés sur les rendus de test du 4 oct. 2026 (≈ 0,005 $ le crédit). */
const CREDITS_PER_IMAGE: Record<"nano-banana-pro" | "gpt-image-2", Record<"1K" | "2K", number>> = {
  "nano-banana-pro": { "1K": 18, "2K": 36 },
  "gpt-image-2": { "1K": 6, "2K": 12 },
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Fichier illisible"));
    reader.readAsDataURL(file);
  });
}

export default function ShopifyScraperPage() {
  const [shop, setShop] = useState("");

  /* Arrivée depuis SpyShop : /shopify-scraper?shop=marque.com. */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("shop");
    if (!wanted) return;
    const timer = setTimeout(() => setShop(wanted), 0);
    return () => clearTimeout(timer);
  }, []);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState(false);

  /* Rebranding du packaging : logo + couleurs, un rendu par image produit. */
  const [rebrand, setRebrand] = useState<RebrandState | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [accent, setAccent] = useState("#1f2937");
  const [background, setBackground] = useState("#f5f5f4");
  const [brandName, setBrandName] = useState("");
  const [scope, setScope] = useState<"first" | "all">("first");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [model, setModel] = useState<"nano-banana-pro" | "gpt-image-2">("nano-banana-pro");
  const [starting, setStarting] = useState(false);
  const [startingProductOnly, setStartingProductOnly] = useState(false);
  /* Refaire aussi les images déjà prêtes : nécessaire après un changement de logo ou de couleurs. */
  const [force, setForce] = useState(false);
  const polling = useRef(false);
  /* Produits cochés : l'export et le rebranding ne portent que sur eux (aucune coche = tous). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /* Aperçu plein écran d'une image : la photo d'origine, et le rendu en face quand il existe. */
  const [preview, setPreview] = useState<{ title: string; original: string | null; rebranded: string | null } | null>(null);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  /**
   * Le champ accepte un titre (« Nouveautés été »), un handle, ou un nom qui
   * n'est pas encore dans la liste chargée. On résout d'abord contre les
   * collections connues, sinon on transmet la saisie en handle — une boutique
   * peut avoir une collection non listée dans `/collections.json`.
   */
  const resolvedCollection = useMemo(() => {
    const typed = collection.trim();
    if (!typed) return "";

    const norm = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
    const target = norm(typed);

    const hit =
      collections.find((item) => norm(item.handle) === target) ??
      collections.find((item) => norm(item.title) === target) ??
      collections.find((item) => norm(item.title).startsWith(target));

    return hit ? hit.handle : typed.replace(/\s+/g, "-").toLowerCase();
  }, [collection, collections]);

  const params = useMemo(() => {
    const search = new URLSearchParams({ shop });
    if (resolvedCollection) search.set("collection", resolvedCollection);
    if (min.trim()) search.set("min", min.trim());
    if (max.trim()) search.set("max", max.trim());
    return search;
  }, [shop, resolvedCollection, min, max]);

  const loadCollections = useCallback(async () => {
    if (!shop.trim()) {
      toast.error("Renseigne l'URL de la boutique");
      return;
    }
    setLoadingCollections(true);
    try {
      const res = await fetch(`/api/shopify-scraper?shop=${encodeURIComponent(shop)}&action=collections`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setCollections(body.collections);
      toast.success(`${body.collections.length} collections trouvées`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Collections illisibles");
    } finally {
      setLoadingCollections(false);
    }
  }, [shop]);

  const loadRebrand = useCallback(async (target: string) => {
    try {
      const res = await fetch(`/api/shopify-scraper/rebrand?shop=${encodeURIComponent(target)}`, { cache: "no-store" });
      const body = (await res.json()) as RebrandState & { error?: string };
      if (!res.ok) throw new Error(body.error);
      setRebrand(body);
    } catch {
      setRebrand(null);
    }
  }, []);

  const scrape = useCallback(async () => {
    if (!shop.trim()) {
      toast.error("Renseigne l'URL de la boutique");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/shopify-scraper?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setResult(body as ScrapeResult);
      setSelected(new Set());
      if (!body.products.length) toast.error("Aucun produit sur ces critères");
      // Les rendus déjà faits pour cette boutique reviennent avec elle.
      void loadRebrand(shop);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Boutique injoignable");
    } finally {
      setLoading(false);
    }
  }, [shop, params, loadRebrand]);

  const pendingCount = rebrand?.items.filter((item) => item.state === "pending").length ?? 0;
  const doneCount = rebrand?.items.filter((item) => item.state === "done" && item.kind !== "product-only").length ?? 0;
  const productOnlyDone = rebrand?.items.filter((item) => item.state === "done" && item.kind === "product-only").length ?? 0;

  /* Tant que des rendus sont en cours, on sonde toutes les quatre secondes. */
  useEffect(() => {
    if (!pendingCount || !shop.trim()) return;
    const timer = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const res = await fetch("/api/shopify-scraper/rebrand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "refresh", shop }),
        });
        const body = (await res.json()) as RebrandState & { error?: string };
        if (res.ok) setRebrand(body);
      } catch {
        // réseau : le prochain tour réessaiera
      } finally {
        polling.current = false;
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pendingCount, shop]);

  const pickLogo = useCallback(async (file: File | null) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      setLogoPreview(dataUrl);
      const res = await fetch("/api/shopify-scraper/rebrand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logo", logoDataUrl: dataUrl }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error || "Envoi du logo impossible");
      setLogoUrl(body.url);
    } catch (error) {
      setLogoPreview(null);
      toast.error(error instanceof Error ? error.message : "Logo illisible");
    } finally {
      setUploadingLogo(false);
    }
  }, []);

  const selectedHandles = useMemo(() => [...selected].filter((handle) => result?.products.some((product) => product.handle === handle)), [selected, result]);
  const exportParams = useMemo(() => {
    const search = new URLSearchParams(params);
    if (selectedHandles.length) search.set("handles", selectedHandles.join(","));
    return search;
  }, [params, selectedHandles]);

  const rebrandBody = useCallback(
    (extra: Record<string, unknown>) => ({
      shop,
      collection: resolvedCollection || undefined,
      min: min.trim() ? Number(min) : null,
      max: max.trim() ? Number(max) : null,
      logoUrl: logoUrl ?? undefined,
      accent,
      background,
      brandName,
      resolution,
      model,
      ...extra,
    }),
    [shop, resolvedCollection, min, max, logoUrl, accent, background, brandName, resolution, model]
  );

  const startRebrand = useCallback(async () => {
    if (!logoUrl && !rebrand?.brand) {
      toast.error("Charge ton logo d'abord");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/shopify-scraper/rebrand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rebrandBody({ action: "start", scope, force, handles: selectedHandles.length ? selectedHandles : undefined })),
      });
      const body = (await res.json()) as RebrandState & { error?: string };
      if (!res.ok) throw new Error(body.error);
      setRebrand(body);
      const pending = body.items.filter((item) => item.state === "pending").length;
      if (pending) toast.success(`${pending} rendu(s) en cours`);
      else toast.message("Toutes ces images sont déjà prêtes", { description: "Coche « Refaire les images déjà prêtes » pour les regénérer avec le logo et les couleurs actuels." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rebranding impossible");
    } finally {
      setStarting(false);
    }
  }, [logoUrl, rebrand, rebrandBody, scope, force, selectedHandles]);

  /** Seconde image par produit : le produit seul, sans sa boîte, dérivé du rendu rebrandé. */
  const startProductOnly = useCallback(async () => {
    setStartingProductOnly(true);
    try {
      const res = await fetch("/api/shopify-scraper/rebrand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rebrandBody({ action: "product-only", force, handles: selectedHandles.length ? selectedHandles : undefined })),
      });
      const body = (await res.json()) as RebrandState & { error?: string; missing?: string[] };
      if (!res.ok) throw new Error(body.error);
      setRebrand(body);
      const pending = body.items.filter((item) => item.state === "pending" && item.kind === "product-only").length;
      if (pending) toast.success(`${pending} photo(s) produit seul en cours`);
      else toast.message("Toutes ces photos sont déjà prêtes", { description: "Coche « Refaire les images déjà prêtes » pour les regénérer." });
      if (body.missing?.length) toast.warning(`${body.missing.length} produit(s) sans rendu rebrandé prêt : lance d'abord « Rebrander » pour eux.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setStartingProductOnly(false);
    }
  }, [rebrandBody, force, selectedHandles]);

  const retryImage = useCallback(
    async (src: string, kind?: "rebrand" | "product-only") => {
      try {
        const res = await fetch("/api/shopify-scraper/rebrand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rebrandBody({ action: "retry", src, kind })),
        });
        const body = (await res.json()) as RebrandState & { error?: string };
        if (!res.ok) throw new Error(body.error);
        setRebrand(body);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Relance impossible");
      }
    },
    [rebrandBody]
  );

  const targetProducts = result ? (selectedHandles.length ? result.products.filter((product) => selected.has(product.handle)) : result.products) : [];
  const imageCount = targetProducts.reduce((sum, product) => sum + (scope === "all" ? product.images : Math.min(1, product.images)), 0);
  const allSelected = Boolean(result?.products.length) && selectedHandles.length === result?.products.length;
  const toggleAll = () => setSelected(allSelected || !result ? new Set() : new Set(result.products.map((product) => product.handle)));
  const toggleOne = (handle: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  const estimatedCredits = imageCount * CREDITS_PER_IMAGE[model][resolution];
  const itemsByHandle = useMemo(() => {
    const map = new Map<string, RebrandItem[]>();
    for (const item of rebrand?.items ?? []) map.set(item.handle, [...(map.get(item.handle) ?? []), item]);
    return map;
  }, [rebrand]);

  return (
    <div>
      <PageHeader
        title="Shopify scraper"
        description="Catalogue public d'une boutique Shopify, filtré par collection et par prix, exporté au format d'import Shopify."
        actions={
          result?.products.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={doneCount ? "outline" : "default"} asChild>
                <a href={`/api/shopify-scraper/csv?${exportParams}`}>
                  <Download className="h-3.5 w-3.5" />
                  {selectedHandles.length ? `CSV (${selectedHandles.length} produit${selectedHandles.length > 1 ? "s" : ""} cochés)` : `CSV (${result.totals.variants} variantes)`}
                </a>
              </Button>
              {doneCount ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/shopify-scraper/rebrand/zip?${exportParams}`} title="Toutes les images rebrandées, nommées par produit">
                    <Download className="h-3.5 w-3.5" />
                    Images (zip)
                  </a>
                </Button>
              ) : null}
              {doneCount ? (
                <Button size="sm" asChild>
                  <a href={`/api/shopify-scraper/csv?${exportParams}&rebrand=1`}>
                    <Palette className="h-3.5 w-3.5" />
                    CSV rebrandé ({doneCount} image{doneCount > 1 ? "s" : ""})
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <div className="mb-4 space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Store className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              className={cn(inputClass, "w-full pl-8")}
              placeholder="aecojoy.store"
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void scrape();
              }}
            />
          </div>

          <Button variant="outline" size="sm" onClick={loadCollections} disabled={loadingCollections}>
            {loadingCollections ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Collections
          </Button>

          <div className="min-w-[240px]">
            <input
              list="shopify-collections"
              className={cn(inputClass, "w-full")}
              placeholder="Toute la boutique — ou tape une collection"
              value={collection}
              onChange={(event) => setCollection(event.target.value)}
            />
            <datalist id="shopify-collections">
              {collections.map((item) => (
                <option key={item.handle} value={item.title}>
                  {item.products_count} produits
                </option>
              ))}
            </datalist>
            {collection.trim() ? (
              <p className="mt-1 text-[10px] text-slate-500">
                Collection ciblée : <code>{resolvedCollection}</code>
              </p>
            ) : null}
          </div>

          <input
            type="number"
            className={cn(inputClass, "w-[92px]")}
            placeholder="Prix min"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
          <input
            type="number"
            className={cn(inputClass, "w-[92px]")}
            placeholder="Prix max"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />

          <Button size="sm" onClick={scrape} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Récupérer
          </Button>
        </div>

        {collections.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            Charge les collections pour pouvoir filtrer, ou lance directement sur toute la boutique.
          </p>
        ) : null}
      </div>

      {result ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-slate-600 dark:text-slate-300">
            <span>
              <strong className="text-slate-900 dark:text-slate-100">{result.totals.products}</strong>{" "}
              produits
            </span>
            <span>
              <strong className="text-slate-900 dark:text-slate-100">{result.totals.variants}</strong>{" "}
              variantes
            </span>
            {result.totals.scanned !== result.totals.products ? (
              <span className="text-slate-500">
                sur {result.totals.scanned} scannés avant filtre prix
              </span>
            ) : null}
            {result.truncated ? (
              <span className="text-amber-600">{result.source === "sitemap" ? "catalogue plafonné à 300 produits (lecture page par page)" : "catalogue plafonné à 5 000 produits"}</span>
            ) : null}
            {result.note ? <span className="text-amber-600">{result.note}</span> : null}
          </div>

          {result.products.length ? (
            <div className="mb-4 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]" data-rebrand-panel>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Packaging rebrandé</div>
                  <p className="text-[11px] text-slate-500">
                    Même produit, même étiquette, mêmes inscriptions : seuls le logo et les couleurs changent. Les rendus remplacent les photos dans « CSV rebrandé ».
                  </p>
                </div>
                <div className="text-[11px] text-slate-500">
                  {doneCount ? <span className="text-emerald-700 dark:text-emerald-300">{doneCount} prête{doneCount > 1 ? "s" : ""}</span> : null}
                  {doneCount && pendingCount ? " · " : null}
                  {pendingCount ? <span>{pendingCount} en cours</span> : null}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex items-center gap-2">
                  <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                    {logoPreview || rebrand?.brand?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoPreview ?? (rebrand?.brand?.logoUrl as string)} alt="" className="h-full w-full object-contain" />
                    ) : uploadingLogo ? (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    ) : (
                      <Palette className="h-4 w-4 text-slate-400" />
                    )}
                  </span>
                  <span className="text-[11.5px]">
                    <span className="block font-medium text-slate-800 dark:text-slate-200">Mon logo</span>
                    <input type="file" accept="image/*" className="block max-w-[180px] text-[11px]" onChange={(event) => void pickLogo(event.target.files?.[0] ?? null)} data-rebrand-logo />
                  </span>
                </label>

                <label className="text-[11.5px]">
                  <span className="mb-1 block font-medium text-slate-800 dark:text-slate-200">Couleur principale</span>
                  <span className="flex items-center gap-1">
                    <input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} className="h-8 w-9 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700" />
                    <input className={cn(inputClass, "w-[88px] font-mono")} value={accent} onChange={(event) => setAccent(event.target.value)} />
                  </span>
                </label>

                <label className="text-[11.5px]">
                  <span className="mb-1 block font-medium text-slate-800 dark:text-slate-200">Couleur de fond</span>
                  <span className="flex items-center gap-1">
                    <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} className="h-8 w-9 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700" />
                    <input className={cn(inputClass, "w-[88px] font-mono")} value={background} onChange={(event) => setBackground(event.target.value)} />
                  </span>
                </label>

                <label className="text-[11.5px]">
                  <span className="mb-1 block font-medium text-slate-800 dark:text-slate-200">Nom de marque (jamais écrit, le logo le porte)</span>
                  <input className={cn(inputClass, "w-[180px]")} placeholder="Ma marque" value={brandName} onChange={(event) => setBrandName(event.target.value)} />
                </label>

                <label className="text-[11.5px]">
                  <span className="mb-1 block font-medium text-slate-800 dark:text-slate-200">Images</span>
                  <select className={cn(inputClass)} value={scope} onChange={(event) => setScope(event.target.value as "first" | "all")}>
                    <option value="first">Première image de chaque produit</option>
                    <option value="all">Toutes les images</option>
                  </select>
                </label>

                <label className="text-[11.5px]">
                  <span className="mb-1 block font-medium text-slate-800 dark:text-slate-200">Modèle</span>
                  <select className={cn(inputClass)} value={model} onChange={(event) => setModel(event.target.value as "nano-banana-pro" | "gpt-image-2")}>
                    <option value="nano-banana-pro">Nano Banana Pro (fidèle aux inscriptions)</option>
                    <option value="gpt-image-2">GPT Image 2</option>
                  </select>
                </label>

                <label className="text-[11.5px]">
                  <span className="mb-1 block font-medium text-slate-800 dark:text-slate-200">Définition</span>
                  <select className={cn(inputClass)} value={resolution} onChange={(event) => setResolution(event.target.value as "1K" | "2K")}>
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                  </select>
                </label>

                <Button size="sm" onClick={startRebrand} disabled={starting || uploadingLogo || (!logoUrl && !rebrand?.brand)} data-rebrand-start>
                  {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
                  {starting ? "Lancement…" : `Rebrander ${imageCount} image${imageCount > 1 ? "s" : ""}${selectedHandles.length ? " cochée" + (imageCount > 1 ? "s" : "") : ""}`}
                </Button>
                <span className="text-[11px] text-slate-500">
                  {starting
                    ? `Création des rendus chez Kie, environ ${Math.max(5, Math.round(imageCount * 1.2))} s…`
                    : `≈ ${estimatedCredits} crédits · ${money(estimatedCredits * 0.005)}.`}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <label className="flex items-center gap-1.5 text-[11.5px] text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} className="h-3.5 w-3.5 accent-emerald-600" data-rebrand-force />
                  Refaire les images déjà prêtes
                </label>
                <Button size="sm" variant="outline" onClick={startProductOnly} disabled={startingProductOnly || !doneCount} data-product-only-start title="Une seconde photo par produit : le produit seul, sans sa boîte, à partir du rendu rebrandé">
                  {startingProductOnly ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
                  Photo produit seule ({selectedHandles.length || targetProducts.length})
                </Button>
                <span className="text-[11px] text-slate-500">
                  Seconde image par produit, sans la boîte, ajoutée au CSV rebrandé.{productOnlyDone ? ` ${productOnlyDone} prête${productOnlyDone > 1 ? "s" : ""}.` : ""}
                </span>
              </div>

              {rebrand && doneCount && !rebrand.publicUrls ? (
                <p className="mt-2 text-[11px] text-amber-600">
                  Certains rendus ne sont servis que depuis cette machine (Supabase injoignable et hébergement Kie refusé) : le CSV rebrandé ne sera pas importable ailleurs.
                </p>
              ) : rebrand && doneCount && rebrand.temporaryUrls ? (
                <p className="mt-2 text-[11px] text-amber-600">
                  Supabase est injoignable : les rendus sont hébergés chez Kie, avec des URL valables quelques jours. Importe le CSV rebrandé sans attendre.
                </p>
              ) : null}
            </div>
          ) : null}

          {result.products.length === 0 ? (
            <EmptyState
              title="Aucun produit"
              description="Élargis la fourchette de prix ou change de collection."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-900/[0.06] thin-scroll dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
              <table className="w-full min-w-[820px] text-[12px]">
                <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Tout cocher / décocher" className="h-3.5 w-3.5 cursor-pointer accent-emerald-600" data-select-all />
                    </th>
                    <th className="px-3 py-2 font-semibold">Produit</th>
                    <th className="px-3 py-2 font-semibold">Packaging rebrandé</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 text-right font-semibold">Variantes</th>
                    <th className="px-3 py-2 text-right font-semibold">Images</th>
                    <th className="px-3 py-2 text-right font-semibold">Prix</th>
                  </tr>
                </thead>
                <tbody>
                  {result.products.map((product) => {
                    const items = itemsByHandle.get(product.handle) ?? [];
                    const firstDone = items.find((item) => item.state === "done" && item.kind !== "product-only" && (item.localUrl || item.url)) ?? null;
                    const checked = selected.has(product.handle);
                    return (
                      <tr
                        key={product.handle}
                        className={cn("border-b border-slate-50 last:border-0 dark:border-slate-800/60", checked && "bg-emerald-50/60 dark:bg-emerald-950/20")}
                      >
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(product.handle)} className="h-3.5 w-3.5 cursor-pointer accent-emerald-600" data-select-product={product.handle} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {product.image ? (
                              <button type="button" onClick={() => setPreview({ title: product.title, original: product.image, rebranded: firstDone?.localUrl ?? firstDone?.url ?? null })} title="Aperçu" className="shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={product.image}
                                  alt=""
                                  className="h-8 w-8 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                                />
                              </button>
                            ) : (
                              <div className="h-8 w-8 shrink-0 rounded-md bg-slate-100 dark:bg-slate-800" />
                            )}
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                                {product.title}
                              </div>
                              <div className="truncate text-[11px] text-slate-500">{product.handle}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {items.length ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {items.map((item) =>
                                item.state === "done" && (item.localUrl || item.url) ? (
                                  <button key={`${item.src}#${item.kind ?? "rebrand"}`} type="button" onClick={() => setPreview({ title: `${product.title}${item.kind === "product-only" ? " — produit seul" : ""}`, original: item.kind === "product-only" ? (firstDone?.localUrl ?? firstDone?.url ?? item.src) : item.src, rebranded: item.localUrl ?? item.url })} title={item.kind === "product-only" ? "Produit seul — aperçu" : "Aperçu avant / après"} className="relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={item.localUrl ? `${item.localUrl}&w=96` : (item.url as string)} alt="" loading="lazy" className={cn("h-8 w-8 rounded-md object-cover ring-1", item.kind === "product-only" ? "ring-sky-300 dark:ring-sky-700" : "ring-emerald-300 dark:ring-emerald-700")} />
                                    {item.kind === "product-only" ? <span className="absolute -bottom-1 -right-1 rounded bg-sky-600 px-1 text-[8px] font-semibold leading-3 text-white">2</span> : null}
                                  </button>
                                ) : item.state === "pending" ? (
                                  <span key={`${item.src}#${item.kind ?? "rebrand"}`} className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                                  </span>
                                ) : (
                                  <button
                                    key={`${item.src}#${item.kind ?? "rebrand"}`}
                                    type="button"
                                    onClick={() => void retryImage(item.src, item.kind)}
                                    title={item.error ?? "Échec"}
                                    className="inline-flex h-8 items-center gap-1 rounded-md bg-red-50 px-2 text-[11px] text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
                                  >
                                    <RefreshCw className="h-3 w-3" /> Relancer
                                  </button>
                                )
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2 text-slate-500">
                          {product.type || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {product.variants}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {product.images}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                          {product.minPrice === product.maxPrice
                            ? money(product.minPrice)
                            : `${money(product.minPrice)} – ${money(product.maxPrice)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="Aucune boutique chargée"
          description="Colle l'URL d'une boutique Shopify puis lance la récupération."
        />
      )}

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
          data-preview
        >
          <div className="w-full max-w-5xl rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{preview.title}</div>
              <button type="button" onClick={() => setPreview(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" aria-label="Fermer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={cn("grid gap-3", preview.rebranded ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1")}>
              {preview.original ? (
                <figure className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.original} alt="" className="max-h-[70vh] w-full rounded-xl object-contain bg-slate-50 dark:bg-slate-950" />
                  <figcaption className="mt-1 text-center text-[11px] text-slate-500">Original</figcaption>
                </figure>
              ) : null}
              {preview.rebranded ? (
                <figure className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.rebranded} alt="" className="max-h-[70vh] w-full rounded-xl object-contain bg-slate-50 dark:bg-slate-950" />
                  <figcaption className="mt-1 text-center text-[11px] text-emerald-700 dark:text-emerald-300">
                    Rebrandé ·{" "}
                    <a href={preview.rebranded} target="_blank" rel="noreferrer" className="underline">
                      ouvrir en grand
                    </a>
                  </figcaption>
                </figure>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
