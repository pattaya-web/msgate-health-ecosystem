"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import type { SupplierGrid, SupplierGridConfig } from "@/lib/metrics/supplier-grid";

/**
 * Comptabilité › Grille fournisseur (admin) : le coût d'un colis selon le
 * nombre de colliers de la commande, et la commande ou la date à partir de
 * laquelle chaque grille s'applique. Le coût des articles de la page Profit,
 * de MoneyTalk et de la Trésorerie en découle.
 */

const inputClass = "h-10 w-full rounded-xl border bg-transparent px-3 text-[13px] outline-none transition-shadow focus:ring-2";
const inputStyle = { borderColor: "var(--line)", color: "var(--ink)" } as const;

const usd = (amount: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }).format(amount);
const fullDay = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Draft = { id?: string; label: string; fromOrder: string; fromDate: string; prices: [string, string, string, string]; extraPerUnit: string };

const emptyDraft = (): Draft => ({ label: "", fromOrder: "", fromDate: "", prices: ["", "", "", ""], extraPerUnit: "" });
const draftOf = (grid: SupplierGrid): Draft => ({
  id: grid.id,
  label: grid.label,
  fromOrder: grid.fromOrder !== null ? String(grid.fromOrder) : "",
  fromDate: grid.fromDate ?? "",
  prices: grid.prices.map((price) => String(price)) as Draft["prices"],
  extraPerUnit: String(grid.extraPerUnit),
});

function startLabel(grid: SupplierGrid) {
  const parts = [grid.fromOrder !== null ? `commande #V${grid.fromOrder}` : null, grid.fromDate ? fullDay(grid.fromDate) : null].filter(Boolean);
  return parts.length ? `À partir de ${parts.join(" et du ")}` : "Toutes les commandes avant les grilles suivantes";
}

export default function SupplierGridPage() {
  const [config, setConfig] = useState<SupplierGridConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/accounting/supplier-grid");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Grille illisible");
    setConfig(body as SupplierGridConfig);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch((error) => toast.error(error instanceof Error ? error.message : "Grille illisible"));
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function post(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/supplier-grid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setConfig(body as SupplierGridConfig);
      setDraft(null);
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  const save = () => {
    if (!draft) return;
    void post(
      {
        id: draft.id,
        label: draft.label,
        fromOrder: draft.fromOrder.trim() || null,
        fromDate: draft.fromDate || null,
        prices: draft.prices,
        extraPerUnit: draft.extraPerUnit,
      },
      draft.id ? "Grille mise à jour" : "Grille ajoutée"
    );
  };

  // Les grilles dans l'ordre où elles s'appliquent : la grille de départ, puis par n° de commande / date.
  const grids = [...(config?.grids ?? [])].sort((a, b) => {
    const open = (grid: SupplierGrid) => grid.fromOrder === null && !grid.fromDate;
    if (open(a) !== open(b)) return open(a) ? -1 : 1;
    return (a.fromOrder ?? 0) - (b.fromOrder ?? 0) || (a.fromDate ?? "").localeCompare(b.fromDate ?? "");
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="r-chip">
            <Package className="h-3.5 w-3.5" />
            Comptabilité
          </span>
          {config ? <span className="r-chip">{config.stores.join(", ") || "Aucune boutique"}</span> : null}
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
          Grille fournisseur
        </h1>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          Le coût d&apos;un colis selon le nombre de colliers de la commande, en USD. Chaque commande prend la grille la plus récente dont le départ est
          atteint ; une commande remboursée en entier coûte 0. La page Profit, MoneyTalk et la Trésorerie s&apos;en servent.
        </p>
      </div>

      {!config ? (
        <div className="r-card flex items-center justify-center gap-2 p-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : (
        grids.map((grid) => (
          <div key={grid.id} className="r-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                  {grid.label}
                </p>
                <p className="r-sub">{startLabel(grid)}</p>
              </div>
              <div className="flex gap-1.5">
                <button type="button" className="r-chip" onClick={() => setDraft(draftOf(grid))}>
                  <Pencil className="h-3 w-3" /> Modifier
                </button>
                {grids.length > 1 ? (
                  <button
                    type="button"
                    className="r-chip"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Supprimer « ${grid.label} » ? Les commandes concernées reprendront la grille précédente.`)) void post({ action: "delete", id: grid.id }, "Grille supprimée");
                    }}
                  >
                    <Trash2 className="h-3 w-3" /> Supprimer
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {grid.prices.map((price, index) => (
                <div key={index} className="rounded-xl px-3 py-2" style={{ background: "var(--r-soft, rgba(15,23,42,0.04))" }}>
                  <p className="r-label">
                    {index + 1} collier{index ? "s" : ""}
                  </p>
                  <p className="mt-0.5 text-[16px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                    {usd(price)}
                  </p>
                </div>
              ))}
              <div className="rounded-xl px-3 py-2" style={{ background: "var(--r-soft, rgba(15,23,42,0.04))" }}>
                <p className="r-label">5 et plus</p>
                <p className="mt-0.5 text-[13px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                  {usd(grid.prices[3])} + {usd(grid.extraPerUnit)}
                </p>
                <p className="text-[10.5px]" style={{ color: "var(--ink-3)" }}>
                  par collier en plus
                </p>
              </div>
            </div>
          </div>
        ))
      )}

      {draft ? (
        <div className="r-card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {draft.id ? "Modifier la grille" : "Nouvelle grille"}
            </p>
            <button type="button" onClick={() => setDraft(null)} className="r-icon h-8 w-8 rounded-lg" title="Annuler">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="r-label block">
              Nom
              <input className={`${inputClass} mt-1`} style={inputStyle} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Grille #V1500" />
            </label>
            <label className="r-label block">
              À partir de la commande
              <input
                className={`${inputClass} mt-1`}
                style={inputStyle}
                value={draft.fromOrder}
                onChange={(e) => setDraft({ ...draft, fromOrder: e.target.value })}
                placeholder="#V1500 (vide = pas de n°)"
              />
            </label>
            <label className="r-label block">
              Ou à partir du
              <input type="date" className={`${inputClass} mt-1`} style={inputStyle} value={draft.fromDate} onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {draft.prices.map((price, index) => (
              <label key={index} className="r-label block">
                {index + 1} collier{index ? "s" : ""} ($)
                <input
                  inputMode="decimal"
                  className={`${inputClass} mt-1`}
                  style={inputStyle}
                  value={price}
                  onChange={(e) => {
                    const prices = [...draft.prices] as Draft["prices"];
                    prices[index] = e.target.value;
                    setDraft({ ...draft, prices });
                  }}
                />
              </label>
            ))}
            <label className="r-label block">
              + par collier dès 5 ($)
              <input inputMode="decimal" className={`${inputClass} mt-1`} style={inputStyle} value={draft.extraPerUnit} onChange={(e) => setDraft({ ...draft, extraPerUnit: e.target.value })} />
            </label>
          </div>
          <p className="r-sub">
            Une grille avec un n° de commande s&apos;applique dès cette commande ; sans n°, dès la date. Avec les deux, il faut que les deux soient atteints.
          </p>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--r-accent, #233137)" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enregistrer
          </button>
        </div>
      ) : config ? (
        <button
          type="button"
          onClick={() => setDraft(emptyDraft())}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold text-white"
          style={{ background: "var(--r-accent, #233137)" }}
        >
          <Plus className="h-4 w-4" /> Ajouter une grille
        </button>
      ) : null}
    </div>
  );
}
