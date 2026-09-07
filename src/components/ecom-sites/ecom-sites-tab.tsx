"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, FileText, ImagePlus, Loader2, Plus, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import type { CheckItem, CheckStatus } from "@/lib/ecom-sites/checklist";
import type { ReferenceProduct as RefProduct } from "@/lib/ecom-sites/reference";
import type { ReferenceSite } from "@/lib/ecom-sites/reference-store";
import { ECOM_THEMES, PRICE_POINTS, ecomTheme, type EcomSite, type EcomThemeId } from "@/lib/ecom-sites/types";
import { cn } from "@/lib/utils";

/** Enregistrements Vercel — ceux que pointent déjà les sites existants. */
const APEX_IP = "216.198.79.1";
const WWW_CNAME = "cname.vercel-dns.com";

type Score = { total: number; ok: number; warns: number; fails: number; ready: boolean };

const field =
  "h-8 w-full rounded-lg bg-slate-50 px-2.5 text-[12px] text-slate-900 outline-none focus:ring-1 focus:ring-emerald-400 dark:bg-slate-800 dark:text-slate-100";
const area =
  "w-full rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] text-slate-900 outline-none focus:ring-1 focus:ring-emerald-400 dark:bg-slate-800 dark:text-slate-100";
const label = "text-[10px] font-semibold uppercase tracking-wide text-slate-400";

function Labelled({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className={label}>{text}</span>
      {children}
    </label>
  );
}

const STATUS_STYLE: Record<CheckStatus, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-rose-600 dark:text-rose-400",
};

export function EcomSitesTab() {
  const [sites, setSites] = useState<EcomSite[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EcomSite | null>(null);
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState("");
  const [cloneOf, setCloneOf] = useState("");
  const [niche, setNiche] = useState("");
  const [productCount, setProductCount] = useState(6);
  const pollRef = useRef<number | null>(null);

  /* Modèles : les boutiques déjà en ligne servent de gabarit de catalogue. */
  const [references, setReferences] = useState<ReferenceSite[]>([]);
  const [newReference, setNewReference] = useState("");
  const [copyBrand, setCopyBrand] = useState("");
  const [copyTheme, setCopyTheme] = useState<EcomThemeId>("glow");
  const [preview, setPreview] = useState<{ domain: string; products: RefProduct[] } | null>(null);

  /* Dépôt des statuts de la LLC : pré-remplissage, jamais de valeur devinée. */
  const [dropping, setDropping] = useState(false);
  const [llcNote, setLlcNote] = useState("");
  const [llcFiles, setLlcFiles] = useState<
    Array<{ fileName: string; chars: number; reason: string; hint?: string }>
  >([]);

  async function readLlcDocument(files: FileList | File[] | null | undefined) {
    const list = files ? [...files] : [];
    if (!list.length || !draft) return;
    setBusy("llc");
    setLlcNote("");
    setLlcFiles([]);
    try {
      // Tout le dossier part en une requête : les champs se cumulent entre
      // pièces, aucune ne les porte toutes.
      const docs = await Promise.all(
        list.map(async (file) => {
          const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
          if (!isPdf) return { fileName: file.name, text: await file.text() };
          const pdfBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
            reader.readAsDataURL(file);
          });
          return { fileName: file.name, pdfBase64 };
        })
      );

      const res = await fetch("/api/ecom-sites/llc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docs }),
      });
      const body = await res.json();
      // Même en échec, le détail par fichier dit lequel a coincé et pourquoi.
      if (body.files) setLlcFiles(body.files);
      if (!res.ok) throw new Error(body.error);

      const entity = body.entity as Record<string, string> & { missing: string[] };
      // Seuls les champs réellement trouvés écrasent la saisie en cours.
      const patch: Partial<EcomSite> = {};
      for (const key of [
        "legalName",
        "stateOfIncorporation",
        "addressLine",
        "city",
        "region",
        "postalCode",
        "country",
        "supportEmail",
        "supportPhone",
      ] as const) {
        if (entity[key]) patch[key] = entity[key];
      }
      patchDraft(patch);

      const filled = Object.keys(patch).length;
      toast.success(`${filled} champ(s) remplis depuis ${list.length} document(s)`);
      if (entity.missing?.length) {
        setLlcNote(`Non trouvé dans le document, à saisir à la main : ${entity.missing.join(", ")}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Document illisible");
    } finally {
      setBusy(null);
    }
  }

  const loadReferences = useCallback(async () => {
    const res = await fetch("/api/ecom-sites/reference");
    const body = await res.json();
    setReferences(body.references || []);
  }, []);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/ecom-sites");
    const body = await res.json();
    setSites(body.sites || []);
    setScores(body.scores || {});
    setLoading(false);
  }, []);

  const loadSite = useCallback(async (id: string) => {
    const res = await fetch(`/api/ecom-sites/${id}`);
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error || "Site introuvable");
      return;
    }
    setDraft(body.site);
    setChecklist(body.checklist || []);
    setSelectedId(id);
  }, []);

  useEffect(() => {
    void loadList();
    void loadReferences();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadList, loadReferences]);

  async function addReference() {
    if (!newReference.trim()) return;
    try {
      const res = await fetch("/api/ecom-sites/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", domain: newReference }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNewReference("");
      await loadReferences();
      toast.success(`${body.reference.domain} ajouté aux modèles`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ajout impossible");
    }
  }

  async function removeReference(domain: string) {
    await fetch(`/api/ecom-sites/reference?domain=${encodeURIComponent(domain)}`, { method: "DELETE" });
    if (preview?.domain === domain) setPreview(null);
    await loadReferences();
  }

  /** Aperçu du catalogue source avant de lancer une copie. */
  async function readReference(domain: string) {
    setBusy(`read:${domain}`);
    try {
      const res = await fetch("/api/ecom-sites/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", domain }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setPreview({ domain, products: body.products || [] });
      await loadReferences();
      if (body.warnings?.length) toast.warning(body.warnings.join(" "));
      toast.success(`${body.products.length} produits lus sur ${domain}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lecture impossible");
    } finally {
      setBusy(null);
    }
  }

  /** Copie rebrandée : même lineup, mêmes prix, tout le texte réécrit. */
  async function copyReference(domain: string) {
    if (!copyBrand.trim()) {
      toast.error("Donne un nom de marque à la copie");
      return;
    }
    setBusy(`copy:${domain}`);
    try {
      const res = await fetch("/api/ecom-sites/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, brandName: copyBrand, themeId: copyTheme }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setCopyBrand("");
      await loadList();
      await loadSite(body.site.id);
      toast.success(
        `${body.site.brandName} créé depuis ${body.copiedFrom} — ${body.site.products.length} produits rebrandés`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Copie impossible");
    } finally {
      setBusy(null);
    }
  }

  function patchDraft(patch: Partial<EcomSite>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    try {
      const res = await fetch(`/api/ecom-sites/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setDraft(body.site);
      setChecklist(body.checklist || []);
      await loadList();
      toast.success("Site enregistré");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!newBrand.trim()) {
      toast.error("Nom de marque requis");
      return;
    }
    setBusy("create");
    try {
      const res = await fetch("/api/ecom-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName: newBrand, cloneOf: cloneOf || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNewBrand("");
      setCloneOf("");
      await loadList();
      await loadSite(body.site.id);
      toast.success(cloneOf ? "Site dupliqué" : "Site créé");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Supprimer ce site ?")) return;
    await fetch(`/api/ecom-sites/${id}`, { method: "DELETE" });
    if (selectedId === id) {
      setSelectedId(null);
      setDraft(null);
      setChecklist([]);
    }
    await loadList();
  }

  function onLogo(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patchDraft({ logoDataUrl: String(reader.result || "") });
    reader.readAsDataURL(file);
  }

  /** Copy de marque + fiches produit, écrites par Claude via Kie. */
  async function generateCopy() {
    if (!draft) return;
    setBusy("copy");
    try {
      const res = await fetch("/api/ecom-sites/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: draft.brandName,
          niche,
          productCount,
          pricePoints: [...PRICE_POINTS],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      // Les packagings déjà générés sont conservés par handle.
      const existing = new Map(draft.products.map((product) => [product.handle, product]));
      patchDraft({
        tagline: body.tagline,
        heroTitle: body.heroTitle,
        heroSubtitle: body.heroSubtitle,
        promise: body.promise,
        productDisclaimer: body.productDisclaimer,
        pillars: body.pillars,
        categories: body.categories,
        products: body.products.map((product: EcomSite["products"][number]) => ({
          ...product,
          imageUrl: existing.get(product.handle)?.imageUrl || "",
          packagingTaskId: existing.get(product.handle)?.packagingTaskId || null,
        })),
      });
      toast.success(`${body.products.length} produits écrits — pense à enregistrer`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  /** Packagings brandés : Kie gpt-image-2, le logo du site en référence. */
  async function generatePackaging() {
    if (!draft) return;
    if (!draft.logoDataUrl) {
      toast.error("Charge le logo avant de générer les packagings");
      return;
    }
    setBusy("packaging");
    try {
      // Le site doit être à jour côté serveur : la route lit les produits stockés.
      await fetch(`/api/ecom-sites/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      const res = await fetch("/api/ecom-sites/packaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", siteId: draft.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      const jobs: Array<{ handle: string; taskId: string | null; error: string | null }> = body.jobs || [];
      const failed = jobs.filter((job) => job.error);
      if (failed.length) toast.error(`${failed.length} produit(s) non lancés`);
      toast.success(`${jobs.filter((job) => job.taskId).length} packagings en génération`);
      startPolling(draft.id, jobs.filter((job) => job.taskId) as Array<{ handle: string; taskId: string }>);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  function startPolling(siteId: string, jobs: Array<{ handle: string; taskId: string }>) {
    if (!jobs.length) return;
    if (pollRef.current) window.clearInterval(pollRef.current);
    const pending = new Map(jobs.map((job) => [job.taskId, job.handle]));

    pollRef.current = window.setInterval(async () => {
      if (!pending.size) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        return;
      }
      const res = await fetch("/api/ecom-sites/packaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", taskIds: [...pending.keys()] }),
      });
      const body = await res.json();
      const done: Array<{ handle: string; url: string }> = [];

      for (const result of body.results || []) {
        const handle = pending.get(result.taskId);
        if (!handle) continue;
        if (result.urls?.length) {
          done.push({ handle, url: result.urls[0] });
          pending.delete(result.taskId);
        } else if (result.state === "fail") {
          pending.delete(result.taskId);
          toast.error(`${handle} : ${result.failMsg || "échec"}`);
        }
      }

      if (done.length) {
        setDraft((current) => {
          if (!current || current.id !== siteId) return current;
          const byHandle = new Map(done.map((item) => [item.handle, item.url]));
          return {
            ...current,
            products: current.products.map((product) =>
              byHandle.has(product.handle)
                ? { ...product, imageUrl: byHandle.get(product.handle)!, packagingTaskId: null }
                : product
            ),
          };
        });
        toast.success(`${done.length} packaging(s) prêt(s)`);
      }

      if (!pending.size && pollRef.current) window.clearInterval(pollRef.current);
    }, 4000);
  }

  const score = selectedId ? scores[selectedId] : null;

  return (
    <div className="space-y-4">
      {/* ---------------- Modèles ---------------- */}
      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <h3 className="text-[12px] font-semibold">Modèles</h3>
          <span className="text-[11px] text-slate-400">
            Même lineup, mêmes prix, tout le texte réécrit sous ta marque.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={newReference}
              onChange={(e) => setNewReference(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addReference();
              }}
              placeholder="ajouter un site modèle.com"
              className={cn(field, "w-52")}
            />
            <button
              type="button"
              onClick={() => void addReference()}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-semibold dark:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </button>
          </div>
        </div>

        {/* Marque + thème appliqués à la copie qu'on lance juste après. */}
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
          <Labelled text="Marque de la copie">
            <input
              value={copyBrand}
              onChange={(e) => setCopyBrand(e.target.value)}
              placeholder="GlowProof"
              className={cn(field, "w-44")}
            />
          </Labelled>
          <Labelled text="Couleurs">
            <select
              value={copyTheme}
              onChange={(e) => setCopyTheme(e.target.value as EcomThemeId)}
              className={cn(field, "w-44")}
            >
              {ECOM_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.label}</option>
              ))}
            </select>
          </Labelled>
          <span className="pb-1.5 text-[11px] text-slate-400">
            Les visuels ne sont jamais repris : les packagings se regénèrent avec ton logo.
          </span>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {references.map((reference) => (
            <div key={reference.domain} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold">{reference.label}</p>
                  <p className="truncate text-[11px] text-slate-400">{reference.domain}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeReference(reference.domain)}
                  className="text-slate-300 hover:text-rose-600"
                  aria-label={`Retirer ${reference.domain}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {reference.productCount === null ? "jamais lu" : `${reference.productCount} produits`}
              </p>
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  onClick={() => void readReference(reference.domain)}
                  disabled={busy === `read:${reference.domain}`}
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-white text-[11px] font-semibold disabled:opacity-50 dark:bg-slate-900"
                >
                  {busy === `read:${reference.domain}` ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Lire
                </button>
                <button
                  type="button"
                  onClick={() => void copyReference(reference.domain)}
                  disabled={busy === `copy:${reference.domain}`}
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 text-[11px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
                >
                  {busy === `copy:${reference.domain}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Copier
                </button>
              </div>
            </div>
          ))}
        </div>

        {preview ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <p className="mb-1.5 text-[11px] font-semibold">
              Catalogue source · {preview.domain} · {preview.products.length} produits
            </p>
            <div className="space-y-1">
              {preview.products.map((product) => (
                <div key={product.handle} className="flex items-baseline gap-2 text-[11px]">
                  <span className="w-14 shrink-0 font-bold">${product.price}</span>
                  <span className="w-40 shrink-0 truncate text-slate-400">{product.dosage}</span>
                  <span className="min-w-0 flex-1 truncate">{product.name}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* ---------------- Colonne gauche : liste + création ---------------- */}
      <div className="space-y-3">
        <div className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <p className={label}>Nouveau site</p>
          <input
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            placeholder="Nom de marque"
            className={field}
          />
          <select value={cloneOf} onChange={(e) => setCloneOf(e.target.value)} className={field}>
            <option value="">Partir de zéro</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                Dupliquer · {site.brandName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy === "create"}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Créer
          </button>
        </div>

        <div className="space-y-1.5">
          {loading ? (
            <p className="px-1 text-[12px] text-slate-400">Chargement…</p>
          ) : sites.length === 0 ? (
            <p className="px-1 text-[12px] text-slate-400">Aucun site pour l&apos;instant.</p>
          ) : (
            sites.map((site) => {
              const siteScore = scores[site.id];
              return (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => void loadSite(site.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ring-1 transition",
                    selectedId === site.id
                      ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900"
                      : "bg-white ring-slate-900/[0.06] hover:bg-slate-50 dark:bg-slate-900/70 dark:hover:bg-slate-800"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold">{site.brandName}</span>
                    <span className="block truncate text-[11px] opacity-60">{site.domain || "domaine non défini"}</span>
                  </span>
                  {siteScore ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                        siteScore.ready ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      )}
                    >
                      {siteScore.ready ? "prêt" : `${siteScore.fails}`}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ---------------- Colonne droite : éditeur ---------------- */}
      {!draft ? (
        <div className="grid place-items-center rounded-2xl bg-white p-10 text-[12px] text-slate-400 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          Sélectionne un site, ou crée-en un.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
            <span className="text-[13px] font-semibold">{draft.brandName}</span>
            <a
              href={`/s/${draft.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800"
            >
              <ExternalLink className="h-3 w-3" />
              Voir le site
            </a>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy === "save"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Enregistrer
              </button>
              <button type="button" onClick={() => void remove(draft.id)} className="rounded-md px-2 py-1 text-[11px] text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Identité */}
          <Section title="Identité">
            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled text="Marque">
                <input value={draft.brandName} onChange={(e) => patchDraft({ brandName: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Domaine">
                <input value={draft.domain} onChange={(e) => patchDraft({ domain: e.target.value })} placeholder="brand.com" className={field} />
              </Labelled>
              <Labelled text="Tagline">
                <input value={draft.tagline} onChange={(e) => patchDraft({ tagline: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Thème de base">
                <select value={draft.themeId} onChange={(e) => patchDraft({ themeId: e.target.value as EcomThemeId })} className={field}>
                  {ECOM_THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>{theme.label}</option>
                  ))}
                </select>
              </Labelled>

              {/* Deux couleurs de marque : elles priment sur le thème. */}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                <span className={label}>Couleurs de marque</span>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  Principale
                  <input
                    type="color"
                    value={draft.brandColors?.primary || ecomTheme(draft.themeId).accent}
                    onChange={(e) =>
                      patchDraft({
                        brandColors: {
                          primary: e.target.value,
                          secondary: draft.brandColors?.secondary || ecomTheme(draft.themeId).wash,
                        },
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  Fond
                  <input
                    type="color"
                    value={draft.brandColors?.secondary || ecomTheme(draft.themeId).wash}
                    onChange={(e) =>
                      patchDraft({
                        brandColors: {
                          primary: draft.brandColors?.primary || ecomTheme(draft.themeId).accent,
                          secondary: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                {draft.brandColors ? (
                  <button
                    type="button"
                    onClick={() => patchDraft({ brandColors: null })}
                    className="text-[11px] text-slate-400 underline"
                  >
                    Revenir au thème
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400">Non définies — le thème s&apos;applique.</span>
                )}
              </div>
              <Labelled text="Titre hero">
                <input value={draft.heroTitle} onChange={(e) => patchDraft({ heroTitle: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Barre promo">
                <input value={draft.promoBar} onChange={(e) => patchDraft({ promoBar: e.target.value })} className={field} />
              </Labelled>
              <div className="sm:col-span-2">
                <Labelled text="Sous-titre hero">
                  <textarea rows={2} value={draft.heroSubtitle} onChange={(e) => patchDraft({ heroSubtitle: e.target.value })} className={area} />
                </Labelled>
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                {draft.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.logoDataUrl} alt="logo" className="h-9 max-w-[140px] rounded bg-slate-50 object-contain p-1 dark:bg-slate-800" />
                ) : null}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold dark:bg-slate-800">
                  <ImagePlus className="h-3.5 w-3.5" />
                  {draft.logoDataUrl ? "Remplacer le logo" : "Charger le logo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
                </label>
                {draft.logoDataUrl ? (
                  <button type="button" onClick={() => patchDraft({ logoDataUrl: "" })} className="text-[11px] text-slate-400">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </Section>

          {/* Entité légale */}
          <Section title="Entité légale — reprise telle quelle dans le footer et les politiques">
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDropping(false);
                void readLlcDocument(event.dataTransfer.files);
              }}
              className={cn(
                "mb-2.5 flex h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-[11px] transition",
                dropping
                  ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30"
                  : "border-slate-300 text-slate-500 dark:border-slate-700"
              )}
            >
              {busy === "llc" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {busy === "llc"
                ? "Lecture du document…"
                : "Glisse tous les documents de la LLC d'un coup (PDF ou .txt)"}
              <input
                type="file"
                accept=".pdf,.txt,text/plain,application/pdf"
                className="hidden"
                multiple
                onChange={(event) => void readLlcDocument(event.target.files)}
              />
            </label>
            {llcFiles.length ? (
              <div className="mb-2 space-y-1">
                {llcFiles.map((entry) => (
                  <div
                    key={entry.fileName}
                    className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60"
                  >
                    <span className={cn("mt-0.5 shrink-0", entry.reason === "ok" ? "text-emerald-600" : "text-amber-600")}>
                      {entry.reason === "ok" ? <Check className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.fileName}</span>
                      <span className="block text-slate-400">
                        {entry.reason === "ok"
                          ? `${entry.chars.toLocaleString("fr-FR")} caractères lus`
                          : entry.hint || entry.reason}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {llcNote ? <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">{llcNote}</p> : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled text="Raison sociale (LLC)">
                <input value={draft.legalName} onChange={(e) => patchDraft({ legalName: e.target.value })} placeholder="BLASTUP GLOW LLC" className={field} />
              </Labelled>
              <Labelled text="État d'immatriculation">
                <input value={draft.stateOfIncorporation} onChange={(e) => patchDraft({ stateOfIncorporation: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Adresse">
                <input value={draft.addressLine} onChange={(e) => patchDraft({ addressLine: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Ville">
                <input value={draft.city} onChange={(e) => patchDraft({ city: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="État">
                <input value={draft.region} onChange={(e) => patchDraft({ region: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Code postal">
                <input value={draft.postalCode} onChange={(e) => patchDraft({ postalCode: e.target.value })} className={field} />
              </Labelled>
            </div>
          </Section>

          {/* Support + paiement */}
          <Section title="Support & paiement">
            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled text="E-mail de support">
                <input value={draft.supportEmail} onChange={(e) => patchDraft({ supportEmail: e.target.value })} placeholder="support@brand.com" className={field} />
              </Labelled>
              <Labelled text="Téléphone US">
                <input value={draft.supportPhone} onChange={(e) => patchDraft({ supportPhone: e.target.value })} placeholder="+1 (941) 396-6088" className={field} />
              </Labelled>
              <Labelled text="Horaires">
                <input value={draft.supportHours} onChange={(e) => patchDraft({ supportHours: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Descripteur de facturation">
                <input value={draft.billingDescriptor} onChange={(e) => patchDraft({ billingDescriptor: e.target.value.toUpperCase() })} placeholder="COLLAGENBLAST" className={field} />
              </Labelled>
            </div>
          </Section>

          {/* Livraison / retours */}
          <Section title="Livraison & retours">
            <div className="grid gap-2 sm:grid-cols-3">
              <Labelled text="Préparation (j. ouvrés)">
                <input type="number" min={0} value={draft.handlingTimeDays} onChange={(e) => patchDraft({ handlingTimeDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Livraison min">
                <input type="number" min={1} value={draft.deliveryMinDays} onChange={(e) => patchDraft({ deliveryMinDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Livraison max">
                <input type="number" min={1} value={draft.deliveryMaxDays} onChange={(e) => patchDraft({ deliveryMaxDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Expédié depuis">
                <input value={draft.shipsFrom} onChange={(e) => patchDraft({ shipsFrom: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Retours (jours)">
                <input type="number" min={0} value={draft.returnWindowDays} onChange={(e) => patchDraft({ returnWindowDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Franco de port ($)">
                <input type="number" min={0} value={draft.freeShippingThreshold} onChange={(e) => patchDraft({ freeShippingThreshold: Number(e.target.value) })} className={field} />
              </Labelled>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Ces délais s&apos;affichent dans la Shipping Policy et sur chaque fiche produit. Mets ce que tu tiens
              réellement : un écart entre le délai affiché et le délai réel revient en chargebacks « item not received »,
              et c&apos;est ce motif qui fait perdre le MID après l&apos;avoir obtenu.
            </p>
          </Section>

          {/* Catalogue */}
          <Section title="Catalogue">
            <div className="flex flex-wrap items-end gap-2">
              <Labelled text="Niche / catégorie">
                <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="collagen beauty supplements" className={cn(field, "w-56")} />
              </Labelled>
              <Labelled text="Produits">
                <input type="number" min={1} max={12} value={productCount} onChange={(e) => setProductCount(Number(e.target.value))} className={cn(field, "w-20")} />
              </Labelled>
              <button
                type="button"
                onClick={() => void generateCopy()}
                disabled={busy === "copy"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
              >
                {busy === "copy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Générer la copy
              </button>
              <button
                type="button"
                onClick={() => void generatePackaging()}
                disabled={busy === "packaging" || !draft.products.length}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                {busy === "packaging" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                Générer les packagings
              </button>
            </div>

            {draft.products.length ? (
              <div className="mt-3 space-y-1.5">
                {draft.products.map((product, index) => (
                  <div key={product.handle} className="flex items-center gap-2.5 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                    ) : (
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded bg-slate-200 text-[9px] text-slate-500 dark:bg-slate-700">
                        {product.packagingTaskId ? "…" : "—"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold">{product.name}</p>
                      <p className="truncate text-[11px] text-slate-400">{product.subtitle}</p>
                    </div>
                    <select
                      value={product.price}
                      onChange={(e) => {
                        const price = Number(e.target.value);
                        patchDraft({
                          products: draft.products.map((item, i) => (i === index ? { ...item, price } : item)),
                        });
                      }}
                      className="h-7 rounded-md bg-white px-1.5 text-[11px] dark:bg-slate-900"
                    >
                      {PRICE_POINTS.map((price) => (
                        <option key={price} value={price}>${price}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => patchDraft({ products: draft.products.filter((_, i) => i !== index) })}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-slate-400">Aucun produit. Génère la copy pour remplir le catalogue.</p>
            )}
          </Section>

          {/* Mise en ligne */}
          <Section title="Mise en ligne">
            <div className="space-y-2">
              <DnsRow label="A" host="@" value={APEX_IP} />
              <DnsRow label="CNAME" host="www" value={WWW_CNAME} />
              <p className="text-[11px] leading-relaxed text-slate-400">
                Ajoute le domaine sur le projet Vercel, pose ces deux enregistrements chez le registrar, puis envoie
                l&apos;URL au processeur une fois la checklist au vert.
              </p>
            </div>
          </Section>

          {/* Checklist */}
          <Section
            title="Checklist underwriting"
            right={
              score ? (
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", score.ready ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                  {score.ok}/{score.total} · {score.fails} bloquant(s) · {score.warns} avertissement(s)
                </span>
              ) : null
            }
          >
            <p className="mb-2 text-[11px] text-slate-400">
              Enregistre pour rafraîchir. « OK » veut dire présent et cohérent, pas vérifié : l&apos;underwriter
              appelle le numéro et écrit à l&apos;adresse.
            </p>
            <div className="space-y-1">
              {checklist.map((item) => (
                <div key={item.id} className="flex gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                  <span className={cn("mt-0.5 shrink-0", STATUS_STYLE[item.status])}>
                    {item.status === "ok" ? <Check className="h-3.5 w-3.5" /> : item.status === "warn" ? <TriangleAlert className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium">{item.label}</p>
                    <p className="text-[11px] text-slate-400">{item.detail}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-slate-300">{item.group}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function DnsRow({ label: kind, host, value }: { label: string; host: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60">
      <span className="w-14 font-bold">{kind}</span>
      <span className="w-10 text-slate-400">{host}</span>
      <code className="flex-1 font-mono">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copié");
        }}
        className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
