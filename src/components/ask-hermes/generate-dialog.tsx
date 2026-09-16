"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { enginePost } from "@/components/mass-test/engine-client";
import type { ExtractedPrompt } from "@/lib/ask-hermes/prompts";
import type { TestBatch } from "@/lib/creative-engine/types";
import { RATIOS, type Ratio } from "@/lib/studio/ratios";
import { cn } from "@/lib/utils";
import type { Attachment } from "./use-hermes-chat";

/**
 * La fenêtre de confirmation avant de dépenser des crédits Kie, et le suivi du
 * lot lancé. Hermes ne déclenche jamais rien : seul « Confirm Generation »
 * appelle POST /api/creative-engine/from-prompts, avec `confirm: "generate"`.
 */

export type GenerateProduct = { id?: string; name: string; url?: string; store?: string };

export type LaunchedBatch = {
  id: string;
  number: number;
  productName: string;
  ratio: string;
  resolution: string;
  items: Array<{ id: string; name: string; state: "pending" | "done" | "fail"; error: string | null; model: string }>;
};

export type GenerationState = {
  batch: LaunchedBatch;
  startedAt: number;
  settled: boolean;
};

const TEXT_MODEL = "gpt-image-2-text-to-image";
const IMAGE_MODEL = "gpt-image-2-image-to-image";

export function GenerateDialog({
  prompts,
  product,
  attachments,
  sessionId,
  onClose,
  onLaunched,
}: {
  prompts: ExtractedPrompt[];
  product: GenerateProduct | null;
  attachments: Attachment[];
  sessionId: string;
  onClose: () => void;
  onLaunched: (batch: LaunchedBatch) => void;
}) {
  const [ratio, setRatio] = useState<Ratio>("3:4");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [useReference, setUseReference] = useState(attachments.length > 0);
  const [useProductImages, setUseProductImages] = useState(false);
  const [productName, setProductName] = useState(product?.name ?? "");
  const [credits, setCredits] = useState<{ credits: number; usd: number | null } | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/kie-credit", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { credits: number; usd: number | null }) : "error"))
      .then((value) => {
        if (!cancelled) setCredits(value);
      })
      .catch(() => {
        if (!cancelled) setCredits("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const reference = useReference ? attachments[0] : undefined;
  const model = reference || (useProductImages && product?.id) ? IMAGE_MODEL : TEXT_MODEL;
  const count = prompts.length;

  async function confirm() {
    if (!productName.trim()) {
      setError("Indique le produit concerné.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        confirm: "generate" as const,
        prompts: prompts.map((entry) => ({ prompt: entry.prompt, angle: entry.angle, hook: entry.hook, label: entry.label })),
        productId: product?.id ?? null,
        productName: productName.trim(),
        productUrl: product?.url,
        store: product?.store,
        ratio,
        resolution,
        referenceDataUrls: reference && reference.kind === "external" ? [reference.dataUrl] : [],
        referenceCreative: reference && reference.kind === "crm" ? { batchId: reference.batchId, creativeId: reference.creativeId } : null,
        useProductImages: Boolean(useProductImages && product?.id),
        sessionId,
      };
      const response = await fetch("/api/creative-engine/from-prompts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = (await response.json()) as { batch?: LaunchedBatch; error?: string };
      if (!response.ok || !payload.batch) throw new Error(payload.error || `Erreur ${response.status}`);
      onLaunched(payload.batch);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Génération impossible");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label="Confirm generation">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
              Generate {count} image{count > 1 ? "s" : ""}?
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">Kie credits are spent only after you confirm. The exact prompts below are saved with the batch.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[12.5px]">
          <dt className="text-slate-500">Product</dt>
          <dd>
            {product?.name ? (
              <span className="font-medium text-slate-900 dark:text-slate-100">{product.name}</span>
            ) : (
              <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Product name (no product open on this page)" className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[12px] dark:border-slate-700 dark:bg-slate-950" />
            )}
            {product?.id ? <span className="ml-2 text-[10.5px] text-slate-400">CRM {product.id}</span> : null}
          </dd>
          <dt className="text-slate-500">Format</dt>
          <dd className="text-slate-800 dark:text-slate-200">Static · {count} prompt{count > 1 ? "s" : ""} → {count} image{count > 1 ? "s" : ""}</dd>
          <dt className="text-slate-500">Ratio</dt>
          <dd>
            <select value={ratio} onChange={(event) => setRatio(event.target.value as Ratio)} className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] dark:border-slate-700 dark:bg-slate-950">
              {RATIOS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id} · {entry.hint}
                </option>
              ))}
            </select>
          </dd>
          <dt className="text-slate-500">Resolution</dt>
          <dd>
            <select value={resolution} onChange={(event) => setResolution(event.target.value as "1K" | "2K")} className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] dark:border-slate-700 dark:bg-slate-950">
              <option value="1K">1K</option>
              <option value="2K">2K</option>
            </select>
          </dd>
          <dt className="text-slate-500">Model</dt>
          <dd className="font-mono text-[11.5px] text-slate-800 dark:text-slate-200" data-model={model}>
            {model}
          </dd>
          <dt className="text-slate-500">Reference</dt>
          <dd className="space-y-1">
            {attachments.length ? (
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={useReference} onChange={(event) => setUseReference(event.target.checked)} />
                Use the attached image ({attachments[0].kind === "crm" ? `CRM · ${attachments[0].name}` : attachments[0].name}) as image-to-image input
              </label>
            ) : (
              <span className="text-slate-500">none (text-to-image)</span>
            )}
            {product?.id ? (
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={useProductImages} onChange={(event) => setUseProductImages(event.target.checked)} />
                Use the CRM product photos as references
              </label>
            ) : null}
          </dd>
          <dt className="text-slate-500">Kie credits</dt>
          <dd className="text-slate-800 dark:text-slate-200" data-credits>
            {credits === null ? "…" : credits === "error" ? "unavailable" : `${credits.credits.toLocaleString("fr-FR")} credits${credits.usd !== null ? ` · ${credits.usd.toFixed(2)} $US` : ""}`}
          </dd>
        </dl>

        <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
          {prompts.map((entry, index) => (
            <div key={entry.id} className="rounded-lg bg-white px-2.5 py-1.5 text-[11.5px] leading-snug text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <span className="mr-1.5 font-semibold text-slate-900 dark:text-slate-100">{index + 1}.</span>
              {entry.angle ? <span className="mr-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium dark:bg-slate-800">{entry.angle}</span> : null}
              <span className="line-clamp-3">{entry.prompt}</span>
            </div>
          ))}
        </div>

        {error ? <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="button" onClick={() => void confirm()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Confirm Generation
          </button>
        </div>
      </div>
    </div>
  );
}

/** Suivi du lot lancé : n/N, échecs, relance (même mécanique que le Mass test), lien vers le lot. */
export function GenerationStatus({ generation, onUpdate, onDismiss }: { generation: GenerationState; onUpdate: (next: GenerationState) => void; onDismiss: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const { batch } = generation;
  const done = batch.items.filter((item) => item.state === "done").length;
  const failed = batch.items.filter((item) => item.state === "fail");
  const pending = batch.items.length - done - failed.length;

  useEffect(() => {
    if (generation.settled) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { batch: fresh } = await enginePost<{ batch: TestBatch }>({ action: "refresh", batchId: batch.id });
        if (cancelled) return;
        const items = fresh.items.map((item) => ({ id: item.id, name: item.name, state: item.state, error: item.error, model: item.model }));
        const settled = items.every((item) => item.state !== "pending");
        onUpdate({ ...generation, batch: { ...batch, items }, settled });
      } catch {
        // le prochain tour réessaie
      }
    };
    const timer = setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id, generation.settled]);

  async function retry() {
    setRetrying(true);
    try {
      await enginePost({ action: "retry", batchId: batch.id });
      onUpdate({ ...generation, settled: false });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-800/60" data-generation-status>
      <div className="flex items-center gap-2">
        {pending > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" /> : failed.length ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {pending > 0 ? `Generating ${Math.min(done + failed.length + 1, batch.items.length)}/${batch.items.length}…` : `Batch #${String(batch.number).padStart(3, "0")} · ${done}/${batch.items.length} generated`}
        </span>
        <span className="text-slate-500">· {batch.productName} · {batch.ratio} · {batch.resolution}</span>
        <button type="button" onClick={onDismiss} className="ml-auto rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {failed.length ? (
        <ul className="mt-1 space-y-0.5 text-[11px] text-rose-600 dark:text-rose-400">
          {failed.map((item) => (
            <li key={item.id}>
              {item.name}: {item.error ?? "failed"}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <a href={`/studio/mass-test?batch=${batch.id}`} title="Statuts, relance et envoi Drive du lot" className={cn("inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900")}>
          <ExternalLink className="h-3 w-3" />
          Open generated batch
        </a>
        {failed.length && pending === 0 ? (
          <button type="button" onClick={() => void retry()} disabled={retrying} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
            Retry failed ({failed.length})
          </button>
        ) : null}
      </div>
    </div>
  );
}
