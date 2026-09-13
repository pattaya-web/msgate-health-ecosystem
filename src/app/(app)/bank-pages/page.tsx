"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { BankPageView } from "@/components/bank-pages/bank-page-view";
import { EcomSitesTab } from "@/components/ecom-sites/ecom-sites-tab";
import { BANK_THEMES, bankPageText, defaultBankPage, withTextEdit, type BankPage, type BankPageDraft, type BankThemeId } from "@/lib/bank-pages/types";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "bank", label: "Bank pages" },
  { id: "ecom", label: "Sites e-commerce" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function BankPagesAdminPage() {
  const [tab, setTab] = useState<TabId>("bank");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Bank pages</h1>
        <p className="text-[12px] text-slate-500">
          Pages agence pour les dossiers bancaires, et boutiques e-commerce pour les demandes de MID.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition",
              tab === item.id
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "bank" ? <BankPagesTab /> : <EcomSitesTab />}
    </div>
  );
}

const empty = defaultBankPage();

/**
 * L'aperçu en grand, taille réelle, où chaque texte se clique et se corrige
 * sur place. Entrée valide, Échap annule la frappe en cours ; le presse-papiers
 * fonctionne comme dans n'importe quel texte, et « Copier tout » emporte la
 * page entière en texte brut.
 */
function PageEditor({ page, title, status, saved = false, onEdit, onClose }: { page: BankPageDraft; title: string; status: string; saved?: boolean; onEdit: (path: string, value: string) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function copyAll() {
    if (!root.current) return;
    try {
      await navigator.clipboard.writeText(bankPageText(root.current));
      toast.success("Texte de la page copié");
    } catch {
      toast.error("Copie impossible");
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950/80 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex flex-wrap items-center gap-2 bg-slate-950 px-3 py-2 text-white shadow-md">
        <Pencil className="h-4 w-4 text-emerald-400" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{title}</p>
          <p className="text-[11px] text-slate-400">Clique un texte pour le modifier · Entrée valide · Échap annule · Ctrl+C / Ctrl+V comme d&apos;habitude</p>
        </div>
        <span className={cn("ml-auto inline-flex items-center gap-1 text-[11px]", saved ? "text-emerald-400" : "text-slate-400")}>
          {saved ? <Check className="h-3.5 w-3.5" /> : null}
          {status}
        </span>
        <button type="button" onClick={() => void copyAll()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[12px] font-semibold hover:bg-white/20">
          <Copy className="h-3.5 w-3.5" />
          Copier tout le texte
        </button>
        <button type="button" onClick={onClose} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-slate-900 hover:bg-slate-200">
          <X className="h-3.5 w-3.5" />
          Fermer
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <div ref={root} className="mx-auto min-w-[360px] max-w-[1280px] overflow-hidden rounded-xl shadow-2xl">
          <BankPageView page={page} editable onEdit={onEdit} />
        </div>
      </div>
    </div>
  );
}

function BankPagesTab() {
  const [pages, setPages] = useState<BankPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BankPageDraft>(empty);
  /* L'aperçu plein écran : la page en création, ou une page enregistrée. */
  const [editingDraft, setEditingDraft] = useState(false);
  const [editing, setEditing] = useState<BankPage | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<BankPage | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  /** Une correction sur une page enregistrée part au serveur toute seule, après une courte pause. */
  const persistEdit = useCallback(async (page: BankPage) => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/bank-pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(page),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Enregistrement impossible");
      setPages((current) => current.map((item) => (item.id === page.id ? { ...item, ...page } : item)));
      setSaveState("saved");
    } catch (error) {
      setSaveState("idle");
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    }
  }, []);

  function editSaved(path: string, value: string) {
    setEditing((current) => {
      if (!current) return current;
      const next = withTextEdit(current, path, value);
      pendingSave.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (pendingSave.current) void persistEdit(pendingSave.current);
        pendingSave.current = null;
      }, 700);
      return next;
    });
  }

  function closeSaved() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pendingSave.current) {
      void persistEdit(pendingSave.current);
      pendingSave.current = null;
    }
    setEditing(null);
    setSaveState("idle");
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/bank-pages");
    const body = await res.json();
    setPages(body.pages || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!form.brandName.trim()) {
      toast.error("Nom de marque requis");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/bank-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast.success("Bank page créée");
      setForm(defaultBankPage());
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Supprimer cette bank page ?")) return;
    await fetch(`/api/bank-pages/${id}`, { method: "DELETE" });
    await load();
  }

  function onLogo(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, logoDataUrl: String(reader.result || "") }));
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-500">
        Clones illimités de blumelmrkt.com — logo, couleurs, copy. URL publique /p/…
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={form.brandName}
              onChange={(e) => setForm({ ...form, brandName: e.target.value })}
              placeholder="Nom de marque"
              className="h-8 rounded-lg bg-slate-50 px-2.5 text-[12px] outline-none dark:bg-slate-800"
            />
            <input
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              placeholder="LLC / raison sociale"
              className="h-8 rounded-lg bg-slate-50 px-2.5 text-[12px] outline-none dark:bg-slate-800"
            />
            <input
              value={form.tagline}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              placeholder="Tagline (US performance)"
              className="h-8 rounded-lg bg-slate-50 px-2.5 text-[12px] outline-none sm:col-span-2 dark:bg-slate-800"
            />
            <input
              value={form.heroTitle}
              onChange={(e) => setForm({ ...form, heroTitle: e.target.value })}
              placeholder="Titre hero"
              className="h-8 rounded-lg bg-slate-50 px-2.5 text-[12px] outline-none sm:col-span-2 dark:bg-slate-800"
            />
            <textarea
              value={form.heroSubtitle}
              onChange={(e) => setForm({ ...form, heroSubtitle: e.target.value })}
              placeholder="Sous-titre"
              rows={2}
              className="rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] outline-none sm:col-span-2 dark:bg-slate-800"
            />
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="h-8 rounded-lg bg-slate-50 px-2.5 text-[12px] outline-none dark:bg-slate-800"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Téléphone"
              className="h-8 rounded-lg bg-slate-50 px-2.5 text-[12px] outline-none dark:bg-slate-800"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {BANK_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => setForm({ ...form, themeId: theme.id as BankThemeId })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
                  form.themeId === theme.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800"
                )}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: theme.blue }} />
                {theme.label}
              </button>
            ))}
            <label className="ml-auto cursor-pointer rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800">
              Logo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
            </label>
            <button
              type="button"
              onClick={() => void create()}
              disabled={saving}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-3 text-[12px] font-medium text-white dark:bg-white dark:text-slate-900"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Créer
            </button>
          </div>
          <div className="overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/[0.04]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Aperçu · clique un texte pour le modifier</p>
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (previewRef.current) void navigator.clipboard.writeText(bankPageText(previewRef.current)).then(() => toast.success("Texte de la page copié"));
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-900/[0.06] hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Copy className="h-3 w-3" />
                  Copier tout le texte
                </button>
                <button type="button" onClick={() => setEditingDraft(true)} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-900/[0.06] hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200">
                  <Pencil className="h-3 w-3" />
                  Agrandir
                </button>
              </span>
            </div>
            {/* L'aperçu est la page elle-même, éditable sur place, réduite pour tenir dans la colonne. */}
            <div ref={previewRef} className="h-[560px] overflow-auto bg-white" style={{ zoom: 0.7 }}>
              <BankPageView page={form} editable onEdit={(path, value) => setForm((current) => withTextEdit(current, path, value))} />
            </div>
          </div>
        </div>

        {editingDraft ? (
          <PageEditor page={form} title="Nouvelle bank page" status="Les corrections restent dans le formulaire jusqu'à « Créer »" onEdit={(path, value) => setForm((current) => withTextEdit(current, path, value))} onClose={() => setEditingDraft(false)} />
        ) : null}
        {editing ? (
          <PageEditor
            page={editing}
            title={editing.brandName}
            status={saveState === "saving" ? "Enregistrement…" : saveState === "saved" ? "Enregistré" : "Chaque correction s'enregistre toute seule"}
            saved={saveState === "saved"}
            onEdit={editSaved}
            onClose={closeSaved}
          />
        ) : null}

        <div className="space-y-2">
          {loading ? <p className="text-[12px] text-slate-400">Chargement…</p> : null}
          {pages.map((page) => (
            <div key={page.id} className="rounded-xl bg-white p-2.5 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
              <p className="truncate text-[13px] font-semibold">{page.brandName}</p>
              <p className="text-[11px] text-slate-400">/p/{page.slug}</p>
              <div className="mt-2 flex gap-1.5">
                <a
                  href={`/p/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ouvrir
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setSaveState("idle");
                    setEditing(page);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800"
                >
                  <Pencil className="h-3 w-3" />
                  Modifier
                </button>
                <button type="button" onClick={() => void remove(page.id)} className="rounded-md px-2 py-1 text-[11px] text-rose-600">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
