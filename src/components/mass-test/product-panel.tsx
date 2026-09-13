"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ProductContext } from "@/lib/creative-engine/types";
import { chip, enginePost } from "@/components/mass-test/engine-client";
import { cn } from "@/lib/utils";

/**
 * Étape 1 : le produit. Une ligne pour coller l'URL, puis une carte compacte.
 * L'analyse complète existe, mais repliée : elle nourrit les prompts, elle
 * n'a pas à occuper l'écran.
 */
export function ProductPanel({
  products,
  selectedId,
  onSelect,
  onChanged,
  initialUrl,
}: {
  products: ProductContext[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
  initialUrl?: string;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const started = useRef<string | null>(null);

  const selected = products.find((product) => product.id === selectedId) ?? null;

  /* « Mass test ce produit » depuis une fiche : l'URL arrive dans l'adresse, l'analyse part seule. */
  useEffect(() => {
    if (!initialUrl || started.current === initialUrl) return;
    started.current = initialUrl;
    const timer = setTimeout(() => {
      setUrl(initialUrl);
      void analyze(initialUrl);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  async function analyze(target = url, reanalyse = false) {
    if (!target.trim()) return toast.error("Colle l'URL de la page produit");
    setBusy(true);
    try {
      const body = await enginePost<{ product: ProductContext; fallbackReason?: string }>({ action: "analyze", url: target });
      await onChanged();
      onSelect(body.product.id);
      setChanging(false);
      if (!reanalyse) setUrl("");
      if (body.fallbackReason) toast.warning(`Fiche lue, moteur IA indisponible : angles génériques proposés`);
      else toast.success(`${body.product.name} analysé`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analyse impossible");
    } finally {
      setBusy(false);
    }
  }

  async function removeProduct() {
    if (!selected) return;
    if (!window.confirm(`Retirer « ${selected.name} » ? Ses lots restent dans les tests.`)) return;
    try {
      await enginePost({ action: "product-delete", productId: selected.id });
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  const a = selected?.analysis;
  const showForm = !selected || changing;

  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold text-slate-900 dark:text-slate-100">1. Produit</h2>

      {showForm ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void analyze();
                }}
                placeholder="Colle l'URL de la page produit"
                className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-[13px] dark:border-slate-700 dark:bg-slate-950"
                autoFocus={changing}
              />
            </div>
            <Button className="h-11 px-5" onClick={() => void analyze()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Analyse…" : "Analyser"}
            </Button>
            {changing ? (
              <Button variant="outline" className="h-11" onClick={() => setChanging(false)}>
                Annuler
              </Button>
            ) : null}
          </div>
          {products.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Ou reprends :</span>
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    onSelect(product.id);
                    setChanging(false);
                  }}
                  className={chip(product.id === selectedId)}
                  title={product.url}
                >
                  {product.name}
                  <span className="ml-1 opacity-60">{product.store}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : selected ? (
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          <div className="flex items-center gap-3">
            {selected.imageUrls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.imageUrls[0]} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[10px] text-slate-400 dark:bg-slate-800">sans photo</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-500">{selected.store}</div>
              <div className="truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">{selected.name}</div>
              <div className="text-[12px] text-slate-600 dark:text-slate-300">
                {a?.price || "—"}
                {a?.comparePrice ? <span className="ml-1 text-slate-400 line-through">{a.comparePrice}</span> : null}
              </div>
              <div className={cn("mt-0.5 inline-flex items-center gap-1 text-[11px]", selected.engine === "fallback" ? "text-amber-700 dark:text-amber-300" : "text-emerald-600")}>
                <Check className="h-3 w-3" />
                {selected.engine === "fallback" ? "Produit lu · analyse de repli, sans IA" : "Produit analysé"}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button type="button" onClick={() => setChanging(true)} className="text-[12px] font-medium text-slate-700 hover:underline dark:text-slate-200">
                Changer de produit
              </button>
              <button type="button" onClick={() => setShowAnalysis((value) => !value)} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:underline">
                Voir l&apos;analyse
                <ChevronDown className={cn("h-3 w-3 transition-transform", showAnalysis && "rotate-180")} />
              </button>
            </div>
          </div>

          {showAnalysis ? (
            <div className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-snug text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <div className="mb-2 flex items-center gap-2">
                <a href={selected.url} target="_blank" rel="noreferrer" className="truncate text-slate-400 hover:underline">
                  {selected.url}
                </a>
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" onClick={() => void analyze(selected.url, true)} disabled={busy} title="Relire la page et refaire l'analyse" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
                    <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
                  </button>
                  <button type="button" onClick={() => void removeProduct()} title="Retirer ce produit" className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              {a ? (
                <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {[
                    ["Cible", [a.targetCustomer, a.gender, a.ageRange].filter(Boolean).join(", ")],
                    ["Offre", a.offer],
                    ["Problème", a.mainProblem],
                    ["Bénéfices", a.benefits.join(" · ")],
                    ["Désirs", a.desires.join(" · ")],
                    ["Objections", a.objections.join(" · ")],
                    ["Mécanisme", a.mechanism],
                    ["Transformation", a.transformation],
                    ["Garantie", a.guarantee],
                    ["Ton", a.tone],
                  ]
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
              ) : null}
              {selected.imageUrls.length > 1 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selected.imageUrls.slice(0, 8).map((image) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={image} src={image} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
