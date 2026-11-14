"use client";

/**
 * Le contrôle des fiches et de la publication, dans l'éditeur de boutique.
 *
 * - `ProductFactsPanel` : la fiche de référence d'un produit (référence, colis,
 *   caractéristiques, variantes, mode d'image), ce qui manque, et sa validation.
 * - `OperationsPanel` : le fonctionnement réel (retours, expédition, suivi).
 * - `ClaimsPanel` : les promesses relevées sur la boutique et leur justificatif.
 * - `PublishPanel` : brouillon / en ligne, et la publication qui exige de
 *   résoudre ou d'accepter un par un les points bloquants.
 *
 * Rien n'est complété automatiquement : ces panneaux montrent ce qui manque et
 * enregistrent ce que l'opérateur saisit.
 */

import { useState } from "react";
import { Check, ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { CheckItem } from "@/lib/ecom-sites/checklist";
import {
  alignHandle,
  handleForName,
  imageIssue,
  missingFacts,
  renameProduct,
  reviewState,
  unprovenClaims,
  validateProduct,
} from "@/lib/ecom-sites/product-facts";
import type { EcomOperations, EcomProduct, EcomSite } from "@/lib/ecom-sites/types";
import { cn } from "@/lib/utils";

const field =
  "h-8 w-full rounded-lg bg-white px-2.5 text-[12px] text-slate-900 outline-none ring-1 ring-slate-200 focus:ring-emerald-400 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700";
const area =
  "w-full rounded-lg bg-white px-2.5 py-2 text-[12px] text-slate-900 outline-none ring-1 ring-slate-200 focus:ring-emerald-400 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700";
const label = "text-[10px] font-semibold uppercase tracking-wide text-slate-400";

const AI_FIELD_LABELS: Record<string, string> = {
  subtitle: "sous-titre",
  bullets: "arguments",
  usage: "utilisation",
  ingredients: "matières / ingrédients",
  dosage: "caractéristiques",
};

/** Le badge d'état d'une fiche, pour la liste des produits. */
export function ReviewBadge({ product }: { product: EcomProduct }) {
  const state = reviewState(product);
  const issue = imageIssue(product);
  const missing = missingFacts(product).length;
  if (state === "validated" && !issue) {
    return <span className="shrink-0 rounded bg-emerald-100 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">validée</span>;
  }
  return (
    <span
      title={[state === "changed" ? "modifiée depuis la validation" : state === "never" ? "jamais validée" : "", issue?.text ?? "", missing ? `${missing} donnée(s) manquante(s)` : ""].filter(Boolean).join(" · ")}
      className={cn(
        "shrink-0 rounded px-1 text-[9px] font-bold uppercase",
        issue?.level === "fail" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
      )}
    >
      {state === "changed" ? "modifiée" : "à valider"}
    </span>
  );
}

const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

function parseVariants(value: string): EcomProduct["variants"] {
  return lines(value).map((line) => {
    const [name, price] = line.split("|").map((part) => part.trim());
    const amount = Number(price?.replace(/[^0-9.]/g, ""));
    return amount > 0 ? { label: name, price: amount } : { label: name };
  });
}

/** La fiche de référence d'un produit : ce qui s'affiche partout vient d'ici. */
export function ProductFactsPanel({
  product,
  products,
  onChange,
}: {
  product: EcomProduct;
  products: EcomProduct[];
  onChange: (next: EcomProduct) => void;
}) {
  const state = reviewState(product);
  const missing = missingFacts(product);
  const issue = imageIssue(product);
  const others = products.filter((item) => item !== product).map((item) => item.handle);
  const [variantsText, setVariantsText] = useState(
    (product.variants ?? []).map((variant) => (variant.price ? `${variant.label} | ${variant.price}` : variant.label)).join("\n")
  );
  const handleOutOfDate = !product.handle.startsWith(handleForName(product.name));

  return (
    <div className="mt-1 space-y-3 rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
      {/* État de la fiche, en premier : c'est ce qu'on vient chercher. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-semibold",
            state === "validated" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
          )}
        >
          {state === "validated"
            ? `Validée le ${product.review?.at.slice(0, 10)}${product.review?.by ? ` par ${product.review.by}` : ""}`
            : state === "changed"
              ? "Modifiée depuis sa validation : à revalider"
              : "Fiche à valider"}
        </span>
        {product.sourceUrl ? (
          <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 underline">
            Page source <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      {missing.length || issue || product.aiFields?.length ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {missing.map((item) => (
            <li key={item.field}>• Manque : {item.label}</li>
          ))}
          {issue ? <li className={issue.level === "fail" ? "font-semibold text-rose-700 dark:text-rose-300" : ""}>• Photo : {issue.text}</li> : null}
          {product.aiFields?.length && state !== "validated" ? (
            <li>• Rédigé par l&apos;IA, pas repris de la source : {product.aiFields.map((key) => AI_FIELD_LABELS[key] ?? key).join(", ")} — à vérifier avant de valider.</li>
          ) : null}
        </ul>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={label}>Nom</span>
          <input
            defaultValue={product.name}
            onBlur={(event) => onChange(renameProduct(product, event.target.value))}
            className={field}
          />
        </label>
        <label className="space-y-1">
          <span className={label}>Adresse</span>
          <div className="flex gap-1">
            <input value={`/product/${product.handle}`} readOnly className={cn(field, "text-slate-500")} />
            {handleOutOfDate ? (
              <button
                type="button"
                onClick={() => onChange(alignHandle(product, others))}
                title="L'ancienne adresse redirigera vers la nouvelle"
                className="shrink-0 rounded-lg bg-slate-900 px-2 text-[11px] font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                Aligner l&apos;URL
              </button>
            ) : null}
          </div>
          {product.previousHandles?.length ? (
            <span className="text-[10px] text-slate-400">Redirige aussi : {product.previousHandles.map((handle) => `/product/${handle}`).join(", ")}</span>
          ) : null}
        </label>
        <label className="space-y-1">
          <span className={label}>Référence (SKU)</span>
          <input defaultValue={product.sku ?? ""} onBlur={(event) => onChange({ ...product, sku: event.target.value.trim() })} className={field} />
        </label>
        <label className="space-y-1">
          <span className={label}>Caractéristiques vérifiées (taille, capacité…)</span>
          <input defaultValue={product.dosage} onBlur={(event) => onChange({ ...product, dosage: event.target.value.trim() })} className={field} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={label}>Matières / ingrédients vérifiés</span>
          <input
            defaultValue={product.ingredients}
            onBlur={(event) => onChange({ ...product, ingredients: event.target.value.trim() })}
            className={field}
          />
        </label>
        <label className="space-y-1">
          <span className={label}>Contenu du colis (une ligne par élément)</span>
          <textarea
            rows={3}
            defaultValue={(product.includedItems ?? []).join("\n")}
            onBlur={(event) => onChange({ ...product, includedItems: lines(event.target.value) })}
            className={area}
          />
        </label>
        <label className="space-y-1">
          <span className={label}>Variantes (« Taille M | 29.99 »)</span>
          <textarea
            rows={3}
            value={variantsText}
            onChange={(event) => setVariantsText(event.target.value)}
            onBlur={() => onChange({ ...product, variants: parseVariants(variantsText) })}
            className={area}
          />
        </label>
        <label className="space-y-1">
          <span className={label}>Photo du produit</span>
          <select
            value={product.packagingMode ?? "product"}
            onChange={(event) => onChange({ ...product, packagingMode: event.target.value as EcomProduct["packagingMode"] })}
            className={field}
          >
            <option value="product">Produit seul (sans boîte ni logo)</option>
            <option value="documented">Emballage de marque réel (référence requise)</option>
          </select>
        </label>
        {product.packagingMode === "documented" ? (
          <label className="space-y-1">
            <span className={label}>Référence de l&apos;emballage (URL photo ou fichier)</span>
            <input
              defaultValue={product.packagingReferenceUrl ?? ""}
              onBlur={(event) => onChange({ ...product, packagingReferenceUrl: event.target.value.trim() })}
              placeholder="https://… ou /api/media/…"
              className={field}
            />
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
        {state === "validated" ? (
          <button
            type="button"
            onClick={() => onChange({ ...product, review: undefined })}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold dark:bg-slate-800"
          >
            Retirer la validation
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onChange(validateProduct({ ...product, aiFields: [] }))}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            <Check className="h-3.5 w-3.5" />
            J&apos;ai vérifié cette fiche
          </button>
        )}
        <span className="min-w-0 flex-1 text-[10px] text-slate-400">
          Valider, c&apos;est confirmer que le nom, les caractéristiques, le colis, le prix et la photo correspondent au produit réellement expédié. Toute modification ultérieure annule la validation.
        </span>
      </div>
    </div>
  );
}

/** Le fonctionnement réel : ce que les politiques et la réassurance ont le droit de promettre. */
export function OperationsPanel({ site, onPatch }: { site: EcomSite; onPatch: (patch: Partial<EcomSite>) => void }) {
  const ops = site.operations ?? {};
  const set = (patch: Partial<EcomOperations>) =>
    onPatch({ operations: { ...ops, ...patch, confirmedAt: undefined, confirmedBy: undefined } });
  const complete =
    ops.returnShipping && ops.returnShipping !== "unset" && ops.fulfilment && ops.fulfilment !== "unset" && typeof ops.tracking === "boolean";

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Les politiques, la réassurance et la page About n&apos;affirment que ce qui est coché ici. Tant que c&apos;est vide, le texte reste neutre.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={label}>Retours</span>
          <select value={ops.returnShipping ?? "unset"} onChange={(event) => set({ returnShipping: event.target.value as EcomOperations["returnShipping"] })} className={field}>
            <option value="unset">À préciser</option>
            <option value="prepaid-label">Étiquette prépayée fournie</option>
            <option value="customer-paid">Retour à la charge du client</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Expédition</span>
          <select value={ops.fulfilment ?? "unset"} onChange={(event) => set({ fulfilment: event.target.value as EcomOperations["fulfilment"] })} className={field}>
            <option value="unset">À préciser</option>
            <option value="own-stock">Notre propre stock</option>
            <option value="third-party-warehouse">Entrepôt logistique (3PL)</option>
            <option value="supplier-direct">Expédié par le fournisseur</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Suivi</span>
          <select
            value={ops.tracking === true ? "yes" : ops.tracking === false ? "no" : "unset"}
            onChange={(event) => set({ tracking: event.target.value === "yes" ? true : event.target.value === "no" ? false : null })}
            className={field}
          >
            <option value="unset">À préciser</option>
            <option value="yes">Numéro de suivi sur chaque commande</option>
            <option value="no">Pas toujours de suivi</option>
          </select>
        </label>
      </div>
      <label className={cn("flex items-start gap-2 text-[11px]", !complete && "opacity-50")}>
        <input
          type="checkbox"
          disabled={!complete}
          checked={Boolean(ops.confirmedAt)}
          onChange={(event) =>
            onPatch({ operations: { ...ops, confirmedAt: event.target.checked ? new Date().toISOString() : undefined } })
          }
          className="mt-0.5"
        />
        <span>
          Je confirme que les délais ({site.handlingTimeDays} j de préparation, {site.deliveryMinDays}–{site.deliveryMaxDays} j de livraison), les retours (
          {site.returnWindowDays} jours), le lieu d&apos;expédition ({site.shipsFrom}) et le descripteur de facturation (« {site.billingDescriptor || "—"} »)
          correspondent au fonctionnement réel.
        </span>
      </label>
    </div>
  );
}

/** Les promesses relevées sur la boutique, à justifier ou à retirer du texte. */
export function ClaimsPanel({ site, onPatch }: { site: EcomSite; onPatch: (patch: Partial<EcomSite>) => void }) {
  const hits = unprovenClaims(site);
  const byKey = new Map<string, typeof hits>();
  for (const hit of hits) byKey.set(hit.key, [...(byKey.get(hit.key) ?? []), hit]);
  const proven = Object.entries(site.claimProofs ?? {}).filter(([, value]) => value.trim());

  if (!byKey.size && !proven.length) {
    return <p className="text-[12px] text-emerald-700">Aucune promesse sans justificatif relevée.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Corrige le texte dans l&apos;aperçu pour retirer une promesse, ou saisis ce qui la justifie (document, politique, fournisseur). Une fiche produit validée couvre ses propres promesses.
      </p>
      {[...byKey.entries()].map(([key, list]) => (
        <div key={key} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
          <p className={cn("text-[12px] font-semibold", list[0].strong ? "text-rose-700 dark:text-rose-300" : "text-amber-800 dark:text-amber-300")}>
            {list[0].label} · {list.length} occurrence(s)
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
            {list.slice(0, 4).map((hit, index) => (
              <li key={index}>
                {hit.where} : « {hit.excerpt} »
              </li>
            ))}
          </ul>
          <input
            defaultValue={site.claimProofs?.[key] ?? ""}
            onBlur={(event) => onPatch({ claimProofs: { ...(site.claimProofs ?? {}), [key]: event.target.value.trim() } })}
            placeholder="Justificatif (ex. garantie fabricant 12 mois, document reçu le…)"
            className={cn(field, "mt-1.5")}
          />
        </div>
      ))}
      {proven.length ? (
        <p className="text-[11px] text-slate-400">Justifiées : {proven.map(([key, value]) => `${key} (${value})`).join(" · ")}</p>
      ) : null}
    </div>
  );
}

/** Brouillon / en ligne, et la publication contrôlée. */
export function PublishPanel({
  site,
  dirty,
  onResult,
}: {
  site: EcomSite;
  dirty: boolean;
  onResult: (body: { site: EcomSite; checklist: CheckItem[] }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [blocking, setBlocking] = useState<CheckItem[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const draft = site.status === "draft";

  async function send(action: "publish" | "unpublish", overrides: string[] = []) {
    setBusy(true);
    try {
      const res = await fetch(`/api/ecom-sites/${site.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, overrides }),
      });
      const body = await res.json();
      if (res.status === 409) {
        setBlocking(body.blocking ?? []);
        setAccepted([]);
        toast.error(body.error);
        return;
      }
      if (!res.ok) throw new Error(body.error);
      setBlocking([]);
      onResult(body);
      toast.success(action === "publish" ? "Boutique en ligne" : "Boutique repassée en brouillon");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-bold",
            draft ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" : "bg-emerald-100 text-emerald-700"
          )}
        >
          {draft ? "Brouillon : visible seulement une fois connecté" : `En ligne${site.publishedAt ? ` depuis le ${site.publishedAt.slice(0, 10)}` : ""}`}
        </span>
        {draft ? (
          <button
            type="button"
            disabled={busy || dirty}
            onClick={() => void send("publish")}
            title={dirty ? "Enregistre d'abord" : ""}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Publier
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("unpublish")}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 dark:bg-slate-800"
          >
            Repasser en brouillon
          </button>
        )}
      </div>
      {site.publishApproval?.overrides.length ? (
        <p className="text-[11px] text-amber-700">
          Publiée avec {site.publishApproval.overrides.length} point(s) bloquant(s) accepté(s)
          {site.publishApproval.by ? ` par ${site.publishApproval.by}` : ""} : {site.publishApproval.overrides.join(", ")}.
        </p>
      ) : null}

      {blocking.length ? (
        <div className="space-y-1.5 rounded-lg bg-rose-50 p-2 dark:bg-rose-500/10">
          <p className="flex items-center gap-1 text-[12px] font-semibold text-rose-700 dark:text-rose-300">
            <TriangleAlert className="h-3.5 w-3.5" />
            Publication bloquée : résous ces points, ou accepte-les un par un en connaissance de cause.
          </p>
          {blocking.map((item) => (
            <label key={item.id} className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={accepted.includes(item.id)}
                onChange={() =>
                  setAccepted((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))
                }
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">{item.label}</span> — {item.detail}
              </span>
            </label>
          ))}
          <button
            type="button"
            disabled={busy || accepted.length !== blocking.length}
            onClick={() => void send("publish", accepted)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
          >
            Publier malgré ces {blocking.length} point(s)
          </button>
        </div>
      ) : null}
    </div>
  );
}
