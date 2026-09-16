"use client";

import { Loader2 } from "lucide-react";
import type { GenerationState, LaunchedBatch } from "@/components/ask-hermes/generate-dialog";
import { panel } from "@/components/mass-test/engine-client";
import type { ProductContext } from "@/lib/creative-engine/types";
import { cn } from "@/lib/utils";

/**
 * L'aperçu avant génération, commun à l'espace produit et au prompt libre :
 * le produit, la référence produit (vérité visuelle), la créa d'inspiration
 * (style seulement), le modèle, puis chaque prompt final. Rien ne part avant
 * le clic de confirmation.
 */

export type Draft = { index: number; userPrompt: string; angle?: string; hook?: string; label?: string; final: string };

export function BatchPreview({
  product,
  primaryUrl,
  inspiration,
  inspirationSent,
  drafts,
  exact,
  ratio,
  resolution,
  model,
  launching,
  onCancel,
  onConfirm,
}: {
  product: ProductContext;
  /** Référence produit envoyée au modèle, ou null. */
  primaryUrl: string | null;
  /** Créa d'inspiration (data URL), ou null. */
  inspiration: string | null;
  /** Vrai si l'image d'inspiration part aussi au modèle (seulement sans référence produit). */
  inspirationSent: boolean;
  drafts: Draft[];
  exact: boolean;
  ratio: string;
  resolution: string;
  model: string;
  launching: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const imageMode = Boolean(primaryUrl) || inspirationSent;
  return (
    <section className={cn(panel, "ring-2 ring-slate-900/20 dark:ring-slate-100/20")} data-preview>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Aperçu avant génération · aucun crédit dépensé avant confirmation</div>
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-slate-500">Product</dt>
        <dd className="font-medium text-slate-900 dark:text-slate-100" data-preview-product>{product.name} <span className="text-[10.5px] font-normal text-slate-400">· {product.store} · CRM {product.id}</span></dd>
        <dt className="text-slate-500">Primary reference</dt>
        <dd data-preview-reference={primaryUrl ?? "none"}>
          {primaryUrl ? (
            <span className="inline-flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={primaryUrl} alt="" className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-900/10" />
              <span className="max-w-[260px] truncate text-[10.5px] text-slate-500">le vrai produit, envoyé au modèle · {primaryUrl}</span>
            </span>
          ) : (
            <span className="text-slate-500">aucune</span>
          )}
        </dd>
        <dt className="text-slate-500">Creative inspiration</dt>
        <dd data-preview-creative-reference={inspiration ? "yes" : "no"} data-preview-inspiration-sent={inspirationSent ? "yes" : "no"}>
          {inspiration ? (
            <span className="inline-flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={inspiration} alt="" className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-900/10" />
              <span className="text-[10.5px] text-slate-500">{inspirationSent ? "structure et style suivis ; jointe au modèle faute de référence produit" : "structure et style suivis via les prompts ; non envoyée au modèle, la référence produit reste la seule image"}</span>
            </span>
          ) : (
            <span className="text-slate-500">aucune</span>
          )}
        </dd>
        <dt className="text-slate-500">Images</dt>
        <dd data-preview-count={drafts.length}>{drafts.length} image{drafts.length > 1 ? "s" : ""} · {ratio} · {resolution}</dd>
        <dt className="text-slate-500">Model</dt>
        <dd className="font-mono text-[11px]" data-preview-model={model}>{model}</dd>
        <dt className="text-slate-500">Reference mode</dt>
        <dd data-preview-reference-mode={imageMode ? "image" : "text"}>{imageMode ? "Image reference enabled" : "Image reference disabled (text-to-image)"}</dd>
      </dl>
      <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {drafts.map((draft, position) => (
          <div key={draft.index} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800" data-preview-draft={draft.index}>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">{exact ? "User prompt" : `Creative ${String(position + 1).padStart(2, "0")}${draft.angle ? ` · ${draft.angle}` : ""}`}</div>
            <div className="mt-0.5 whitespace-pre-wrap text-[11.5px] text-slate-800 dark:text-slate-200" data-preview-user-prompt>{draft.userPrompt}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Final generation prompt</div>
            <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-white p-2 font-mono text-[10.5px] leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-300" data-preview-final-prompt>{draft.final}</pre>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={launching} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          Annuler
        </button>
        <button type="button" onClick={onConfirm} disabled={launching} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900">
          {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Confirmer la génération ({drafts.length})
        </button>
      </div>
    </section>
  );
}

/** Un lot lancé, dans l'état que suit GenerationStatus. */
export function launchedState(batch: LaunchedBatch): GenerationState {
  return { batch, startedAt: Date.now(), settled: batch.items.every((item) => item.state !== "pending") };
}

/**
 * La génération confirmée, par le pipeline existant (Creative Engine → Kie) :
 * la référence produit est la seule image envoyée quand elle existe ;
 * l'inspiration ne part qu'à défaut, et jamais en plus du vrai produit.
 */
export async function launchFromPrompts(input: {
  product: ProductContext;
  drafts: Draft[];
  /** Le brief d'origine (mode auto), ou null en prompt exact. */
  brief: string | null;
  ratio: string;
  resolution: string;
  primaryUrl: string | null;
  inspiration: string | null;
}): Promise<LaunchedBatch> {
  const response = await fetch("/api/creative-engine/from-prompts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      confirm: "generate",
      source: "product-workspace",
      prompts: input.drafts.map((draft) => ({ prompt: draft.final, userPrompt: input.brief?.trim() || draft.userPrompt, angle: draft.angle, hook: draft.hook, label: draft.label })),
      productId: input.product.id,
      productName: input.product.name,
      productUrl: input.product.url,
      store: input.product.store,
      ratio: input.ratio,
      resolution: input.resolution,
      referenceUrls: input.primaryUrl ? [input.primaryUrl] : [],
      referenceDataUrls: !input.primaryUrl && input.inspiration ? [input.inspiration] : [],
      primaryReferenceUrl: input.primaryUrl,
      useProductImages: false,
    }),
  });
  const payload = (await response.json()) as { batch?: LaunchedBatch; error?: string };
  if (!response.ok || !payload.batch) throw new Error(payload.error || `Erreur ${response.status}`);
  return payload.batch;
}
