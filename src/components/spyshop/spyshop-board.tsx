"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Eye, FolderPlus, Loader2, Pencil, Plus, RefreshCw, Search, ShoppingBag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import type { SpyProject, SpyShop } from "@/lib/spyshop/store";
import { Inspirations, folderFor } from "@/components/spyshop/inspirations";
import { DiscoverPanel, MetaAdsBlock } from "@/components/spyshop/brandsearch";
import type { BsBrand } from "@/lib/brandsearch/client";
import { cn } from "@/lib/utils";

/**
 * SpyShop : les boutiques qu'on surveille, projet par projet.
 *
 * On colle un lien, la carte se remplit avec le catalogue public : nombre de
 * produits, dernières sorties, et au passage suivant, ce qui est nouveau.
 * Une note libre par boutique dit pourquoi on la suit.
 */

const panel = "rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";
const chip = (on: boolean) =>
  cn(
    "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
    on ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
  );

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/spyshop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Opération impossible");
  return data;
}

function when(iso: string | null) {
  if (!iso) return "jamais";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function SpyShopBoard() {
  const [projects, setProjects] = useState<SpyProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/spyshop", { cache: "no-store" });
      const body = (await res.json()) as { projects?: SpyProject[] };
      const list = body.projects ?? [];
      setProjects(list);
      setProjectId((current) => {
        if (current && list.some((project) => project.id === current)) return current;
        try {
          const remembered = window.localStorage.getItem("msgate.spyshop.project");
          if (remembered && list.some((project) => project.id === remembered)) return remembered;
        } catch {
          // sans importance
        }
        return list[0]?.id ?? null;
      });
    } catch {
      toast.error("SpyShop illisible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!projectId) return;
    try {
      window.localStorage.setItem("msgate.spyshop.project", projectId);
    } catch {
      // sans importance
    }
  }, [projectId]);

  const project = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId]);

  const shops = useMemo(() => {
    const list = project?.shops ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((shop) => `${shop.name} ${shop.url} ${shop.note}`.toLowerCase().includes(needle));
  }, [project, query]);

  function patchShop(next: SpyShop) {
    setProjects((current) =>
      current.map((item) => (item.id === projectId ? { ...item, shops: item.shops.map((shop) => (shop.id === next.id ? next : shop)) } : item))
    );
  }

  async function addShop() {
    if (!project) return;
    if (!url.trim()) return toast.error("Colle le lien de la boutique");
    setAdding(true);
    try {
      const body = await post<{ shop: SpyShop }>({ action: "shop-add", projectId: project.id, url, note });
      setUrl("");
      setNote("");
      await load();
      toast.success(body.shop.error ? `${body.shop.name} ajoutée — catalogue illisible pour l'instant` : `${body.shop.name} ajoutée · ${body.shop.productCount ?? 0} produits`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ajout impossible");
    } finally {
      setAdding(false);
    }
  }

  async function check(shop: SpyShop) {
    if (!project) return;
    setChecking(shop.id);
    try {
      const body = await post<{ shop: SpyShop }>({ action: "shop-check", projectId: project.id, shopId: shop.id });
      patchShop(body.shop);
      toast.success(
        body.shop.error
          ? `${body.shop.name} : ${body.shop.error}`
          : body.shop.newProducts.length
            ? `${body.shop.name} : ${body.shop.newProducts.length} nouveau(x) produit(s)`
            : `${body.shop.name} : rien de nouveau`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analyse impossible");
    } finally {
      setChecking(null);
    }
  }

  async function checkAll() {
    if (!project?.shops.length) return;
    setChecking("all");
    try {
      const body = await post<{ projects: SpyProject[] }>({ action: "project-check", projectId: project.id });
      setProjects(body.projects);
      const fresh = body.projects.find((item) => item.id === project.id)?.shops.reduce((total, shop) => total + shop.newProducts.length, 0) ?? 0;
      toast.success(fresh ? `${fresh} nouveau(x) produit(s) sur le projet` : "Rien de nouveau sur le projet");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analyse impossible");
    } finally {
      setChecking(null);
    }
  }

  async function remove(shop: SpyShop) {
    if (!project) return;
    if (!window.confirm(`Retirer ${shop.name} du suivi ?`)) return;
    try {
      await post({ action: "shop-delete", projectId: project.id, shopId: shop.id });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  async function editNote(shop: SpyShop) {
    if (!project) return;
    const next = window.prompt("Note sur cette boutique", shop.note);
    if (next === null) return;
    try {
      const body = await post<{ shop: SpyShop }>({ action: "shop-update", projectId: project.id, shopId: shop.id, note: next });
      patchShop(body.shop);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Note impossible");
    }
  }

  async function rename(shop: SpyShop) {
    if (!project) return;
    const next = window.prompt("Nom affiché", shop.name);
    if (!next?.trim()) return;
    try {
      const body = await post<{ shop: SpyShop }>({ action: "shop-update", projectId: project.id, shopId: shop.id, name: next });
      patchShop(body.shop);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Renommage impossible");
    }
  }

  /** Depuis la découverte Brandsearch : la marque entre dans le projet courant. */
  async function followBrand(brand: BsBrand) {
    if (!project) {
      toast.error("Choisis un projet");
      return;
    }
    try {
      const note = [brand.niche, brand.monthly_visits ? `${brand.monthly_visits.toLocaleString("fr-FR")} visites/mois` : "", brand.last_meta_active_count ? `${brand.last_meta_active_count} pubs Meta actives` : ""]
        .filter(Boolean)
        .join(" · ");
      await post({ action: "shop-add", projectId: project.id, url: brand.id, note });
      await load();
      toast.success(`${brand.name?.replace(/^www\./, "") || brand.id} suivie dans « ${project.name} »`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ajout impossible");
    }
  }

  const followed = useMemo(() => new Set((project?.shops ?? []).map((shop) => new URL(shop.url).hostname.replace(/^www\./, ""))), [project]);

  async function newProject() {
    const name = window.prompt("Nom du projet (la marque sur laquelle tu bosses)");
    if (!name?.trim()) return;
    try {
      const body = await post<{ project: SpyProject }>({ action: "project-add", name });
      await load();
      setProjectId(body.project.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Projet impossible");
    }
  }

  async function deleteProject() {
    if (!project) return;
    if (!window.confirm(`Supprimer le projet « ${project.name} » et ses ${project.shops.length} boutique(s) ?`)) return;
    try {
      await post({ action: "project-delete", projectId: project.id });
      setProjectId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  const totalNew = project?.shops.reduce((total, shop) => total + shop.newProducts.length, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="SpyShop"
        description="Les boutiques que tu analyses, rangées par projet. Colle un lien : le catalogue est lu, et à chaque relance les nouveautés ressortent."
        actions={
          project?.shops.length ? (
            <Button size="sm" variant="outline" onClick={() => void checkAll()} disabled={checking !== null}>
              {checking === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Tout ré-analyser
            </Button>
          ) : null
        }
      />

      <div className={cn(panel, "mb-4 flex flex-wrap items-center gap-2")}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Projet</span>
        {projects.map((item) => (
          <button key={item.id} type="button" onClick={() => setProjectId(item.id)} className={chip(item.id === projectId)}>
            {item.name}
            <span className="ml-1 opacity-60">{item.shops.length}</span>
          </button>
        ))}
        <button type="button" onClick={() => void newProject()} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <FolderPlus className="h-3.5 w-3.5" />
          Nouveau projet
        </button>
        {project && projects.length > 1 ? (
          <button type="button" onClick={() => void deleteProject()} className="ml-auto text-[11px] text-slate-400 hover:text-rose-600" title="Supprimer ce projet">
            Supprimer le projet
          </button>
        ) : null}
      </div>

      <div className={cn(panel, "mb-4")}>
        <div className="flex flex-wrap gap-2">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addShop();
            }}
            placeholder="Lien de la boutique à suivre — ex. marque.com ou https://marque.com/products/…"
            className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addShop();
            }}
            placeholder="Note (facultatif) : pourquoi tu la suis"
            className="min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950"
          />
          <Button size="sm" onClick={() => void addShop()} disabled={adding || !project}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Ajouter au projet{project ? ` « ${project.name} »` : ""}
          </Button>
        </div>
        {project?.shops.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span>
              {project.shops.length} boutique(s) suivie(s){totalNew ? ` · ${totalNew} nouveau(x) produit(s) au dernier passage` : ""}
            </span>
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filtrer par nom, lien ou note"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-[12px] dark:border-slate-700 dark:bg-slate-950"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Effacer">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <DiscoverPanel onFollow={followBrand} followed={followed} />

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : !shops.length ? (
        <EmptyState
          title={query ? "Aucune boutique ne correspond" : "Aucune boutique suivie"}
          description={query ? "Essaie un autre mot." : "Colle le lien d'une boutique concurrente ou de référence ci-dessus. Son catalogue est lu tout de suite."}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shops.map((shop) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              busy={checking === shop.id || checking === "all"}
              onCheck={() => void check(shop)}
              onNote={() => void editNote(shop)}
              onRename={() => void rename(shop)}
              onRemove={() => void remove(shop)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShopCard({
  shop,
  busy,
  onCheck,
  onNote,
  onRename,
  onRemove,
}: {
  shop: SpyShop;
  busy: boolean;
  onCheck: () => void;
  onNote: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const host = new URL(shop.url).hostname.replace(/^www\./, "");
  const showcase = shop.newProducts.length ? shop.newProducts : shop.latest;
  return (
    <div className={cn(panel, "flex flex-col gap-2.5")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <button type="button" onClick={onRename} title="Renommer" className="truncate text-left text-[13px] font-semibold text-slate-900 hover:underline dark:text-slate-100">
              {shop.name}
            </button>
            {shop.newProducts.length ? (
              <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">+{shop.newProducts.length} nouveau(x)</span>
            ) : null}
          </div>
          <a href={shop.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:underline">
            {host}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onCheck} disabled={busy} title="Ré-analyser le catalogue" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={onNote} title="Note" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onRemove} title="Retirer du suivi" className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {shop.note ? <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] leading-snug text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{shop.note}</p> : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>
          <strong className="text-slate-900 dark:text-slate-100">{shop.productCount ?? "—"}</strong> produits
        </span>
        <span>analysée {when(shop.lastCheck)}</span>
        {shop.error ? <span className="text-rose-600">{shop.error}</span> : null}
      </div>

      {showcase.length ? (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {shop.newProducts.length ? "Nouveau depuis le dernier passage" : "Dernières sorties"}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {showcase.map((product) => (
              <a key={product.id} href={product.url} target="_blank" rel="noreferrer" title={product.title} className="w-[76px] shrink-0">
                <div className="aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                  {product.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                      <Eye className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-slate-700 dark:text-slate-200">{product.title}</div>
                <div className="text-[10px] text-slate-400">{product.price}</div>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <MetaAdsBlock shopUrl={shop.url} folder={folderFor(shop.name)} />

      <Inspirations shopName={shop.name} />

      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        <Link
          href={`/shopify-scraper?shop=${encodeURIComponent(host)}`}
          className="inline-flex h-7 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
        >
          <ShoppingBag className="h-3 w-3" />
          Scraper le catalogue
        </Link>
        <a
          href={shop.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
        >
          <ExternalLink className="h-3 w-3" />
          Ouvrir la boutique
        </a>
      </div>
    </div>
  );
}
