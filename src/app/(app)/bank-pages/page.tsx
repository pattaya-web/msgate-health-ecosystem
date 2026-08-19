"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BankPageView } from "@/components/bank-pages/bank-page-view";
import { BANK_THEMES, defaultBankPage, type BankPage, type BankThemeId } from "@/lib/bank-pages/types";
import { cn } from "@/lib/utils";

const empty = defaultBankPage();

export default function BankPagesAdminPage() {
  const [pages, setPages] = useState<BankPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(empty);

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
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Bank pages</h1>
        <p className="text-[12px] text-slate-500">
          Clones illimités de blumelmrkt.com — logo, couleurs, copy. URL publique /p/…
        </p>
      </div>

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
            <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">Preview live</p>
            <div className="h-[340px] overflow-hidden bg-white">
              <div className="origin-top-left scale-[0.34]" style={{ width: 1120 }}>
                <BankPageView
                  page={{
                    ...form,
                    id: "preview",
                    slug: "preview",
                    createdAt: "",
                    updatedAt: "",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

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
