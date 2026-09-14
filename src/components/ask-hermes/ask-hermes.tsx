"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Copy, ImagePlus, Loader2, Paperclip, RefreshCw, Send, Square, Trash2, X } from "lucide-react";
import { EnvBadge } from "@/components/layout/env-badge";
import { cn } from "@/lib/utils";
import { extractPrompts, type ExtractedPrompt } from "@/lib/ask-hermes/prompts";
import { QUICK_ACTIONS, type PageContext, type QuickAction } from "@/lib/ask-hermes/types";
import { GenerateDialog, GenerationStatus, type GenerationState, type LaunchedBatch } from "./generate-dialog";
import { imageFilesFrom, loadImageFile, thumbFromUrl } from "./images";
import { CopyText, Markdown } from "./markdown";
import { useHermesPageContext } from "./page-context";
import { useHermesChat, type Attachment, type ChatMessage, type CrmAttachment } from "./use-hermes-chat";

/**
 * « Ask Hermes » : bouton flottant + panneau latéral, sur toutes les pages
 * connectées. Une seule instance, montée dans AppShell, qui survit aux
 * navigations ; le contexte de page arrive par HermesPageContextProvider.
 */

const EXAMPLES = [
  "Analyze this product",
  "Give me the original prompt for this creative",
  "Reverse this ad",
  "Why is this creative working?",
  "Show me the weakest part of this creative",
];

const ACTION_MESSAGE: Record<QuickAction, string> = {
  analyze: "Analyze this creative.",
  original: "Give me the original prompt for this creative.",
  reverse: "Reverse Prompt: reconstruct a generation-ready prompt for this creative (the prompt is the main output, no analysis).",
  angle: "Find the advertising angle of this creative.",
  variations: "Suggest 5 variations of this creative (text briefs only).",
};

/**
 * Taille du panneau : « petit » et « moyen » sont des fenêtres flottantes en bas
 * à droite (le CRM reste visible et utilisable autour), « plein écran » prend
 * tout. Mémorisée par navigateur. Sur téléphone, toujours plein écran.
 */
type PanelSize = "small" | "medium" | "full";
const SIZE_KEY = "msgate.ask-hermes.size";
const SIZES: Array<{ id: PanelSize; label: string; title: string }> = [
  { id: "small", label: "S", title: "Petite fenêtre en bas à droite" },
  { id: "medium", label: "M", title: "Fenêtre moyenne en bas à droite" },
  { id: "full", label: "Plein", title: "Plein écran" },
];
const SIZE_CLASS: Record<PanelSize, string> = {
  small: "sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[540px] sm:max-h-[calc(100vh-40px)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-2xl sm:dark:border-slate-700",
  medium: "sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(760px,calc(100vh-40px))] sm:w-[520px] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-2xl sm:dark:border-slate-700",
  full: "sm:inset-0",
};
function loadSize(): PanelSize {
  if (typeof window === "undefined") return "medium";
  try {
    const stored = localStorage.getItem(SIZE_KEY);
    return stored === "small" || stored === "full" ? stored : "medium";
  } catch {
    return "medium";
  }
}

type ChipKey = "store" | "product" | "batch" | "creative" | "campaign" | "adset" | "ad";
type Chip = { key: ChipKey; label: string };

const CHIP_FIELDS: Record<ChipKey, Array<keyof PageContext>> = {
  store: ["storeId", "storeName"],
  product: ["productId", "productName", "productUrl"],
  batch: ["batchId", "batchNumber"],
  creative: ["creativeId", "creativeName", "creativeImageUrl"],
  campaign: ["campaignId", "campaignName"],
  adset: ["adsetId", "adsetName"],
  ad: ["adId", "adName"],
};

function pad(number: number) {
  return `#${String(number).padStart(3, "0")}`;
}

function shortCreative(name: string) {
  const parts = name.split("_");
  return parts.length > 3 ? parts.slice(-3).join("_") : name;
}

function chipsFor(context: PageContext): Chip[] {
  const chips: Chip[] = [];
  if (context.productName) chips.push({ key: "product", label: context.productName });
  if (context.batchNumber !== undefined) chips.push({ key: "batch", label: `Batch ${pad(context.batchNumber)}` });
  else if (context.batchId) chips.push({ key: "batch", label: `Batch ${context.batchId.slice(0, 8)}` });
  if (context.creativeName) chips.push({ key: "creative", label: shortCreative(context.creativeName) });
  else if (context.creativeId) chips.push({ key: "creative", label: context.creativeId.slice(0, 8) });
  if (context.storeName && !context.productName) chips.push({ key: "store", label: context.storeName });
  if (context.campaignName) chips.push({ key: "campaign", label: context.campaignName });
  if (context.adsetName) chips.push({ key: "adset", label: context.adsetName });
  if (context.adName) chips.push({ key: "ad", label: context.adName });
  return chips;
}

function stripChips(context: PageContext, removed: Set<ChipKey>): PageContext {
  const next: PageContext = { ...context };
  for (const key of removed) for (const field of CHIP_FIELDS[key]) delete next[field];
  if (removed.has("batch")) for (const field of CHIP_FIELDS.creative) delete next[field];
  return next;
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AskHermes() {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<PanelSize>(loadSize);
  const chat = useHermesChat();
  const pageContext = useHermesPageContext();
  const [removed, setRemoved] = useState<Set<ChipKey>>(() => new Set());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  /** Prompts en attente de confirmation (fenêtre ouverte) et lot lancé après confirmation. */
  const [pendingPrompts, setPendingPrompts] = useState<ExtractedPrompt[] | null>(null);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);

  // Les puces retirées ne valent que pour la sélection courante.
  const signature = [pageContext.route, pageContext.storeId, pageContext.productId, pageContext.batchId, pageContext.creativeId, pageContext.adId].join("|");
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setRemoved(new Set());
  }, [signature]);

  const effectiveContext = useMemo(() => stripChips(pageContext, removed), [pageContext, removed]);
  const chips = useMemo(() => chipsFor(pageContext).filter((chip) => !removed.has(chip.key)), [pageContext, removed]);
  const crmCandidate = useMemo(
    () =>
      effectiveContext.creativeId && effectiveContext.batchId
        ? { batchId: effectiveContext.batchId, creativeId: effectiveContext.creativeId, name: effectiveContext.creativeName ?? effectiveContext.creativeId, imageUrl: effectiveContext.creativeImageUrl ?? null }
        : null,
    [effectiveContext.batchId, effectiveContext.creativeId, effectiveContext.creativeImageUrl, effectiveContext.creativeName]
  );
  const crmAttached = attachments.some((entry) => entry.kind === "crm");
  const externalCount = attachments.filter((entry) => entry.kind === "external").length;
  const showQuickActions = attachments.length > 0 || Boolean(crmCandidate);

  useEffect(() => {
    if (!open) return;
    void chat.refreshStatus();
    const timer = setInterval(() => void chat.refreshStatus(), 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, size);
    } catch {
      // stockage indisponible : la taille ne survit pas au rechargement
    }
  }, [size]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [chat.messages, open]);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), 3200);
    return () => clearTimeout(timer);
  }, [hint]);

  const resize = useCallback(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(area.scrollHeight, 168)}px`;
  }, []);
  useEffect(resize, [draft, resize]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = 4 - externalCount;
      if (room <= 0) {
        setHint("4 images maximum per message.");
        return;
      }
      for (const file of files.slice(0, room)) {
        try {
          const image = await loadImageFile(file);
          setAttachments((current) => [...current, { kind: "external", id: image.id, name: image.name, dataUrl: image.dataUrl, thumb: image.thumb }]);
        } catch {
          setHint(`Could not read ${file.name}.`);
        }
      }
    },
    [externalCount]
  );

  const attachCurrentCreative = useCallback(async (): Promise<CrmAttachment | null> => {
    if (!crmCandidate) return null;
    const existing = attachments.find((entry): entry is CrmAttachment => entry.kind === "crm");
    if (existing) return existing;
    const thumb = crmCandidate.imageUrl ? await thumbFromUrl(crmCandidate.imageUrl) : null;
    const attachment: CrmAttachment = { kind: "crm", batchId: crmCandidate.batchId, creativeId: crmCandidate.creativeId, name: crmCandidate.name, previewUrl: crmCandidate.imageUrl, thumb };
    setAttachments((current) => (current.some((entry) => entry.kind === "crm") ? current : [attachment, ...current]));
    return attachment;
  }, [attachments, crmCandidate]);

  const submit = useCallback(
    async (message: string, action?: QuickAction, extra?: Attachment[]) => {
      if (chat.busy) return;
      const all = extra ? [...extra, ...attachments.filter((entry) => !extra.some((added) => added.kind === entry.kind && (entry.kind !== "external" || added.kind !== "external" || added.id === entry.id)))] : attachments;
      if (!message.trim() && !all.length) return;
      stickToBottom.current = true;
      setDraft("");
      setAttachments([]);
      await chat.send({ message, context: effectiveContext, attachments: all, action });
    },
    [attachments, chat, effectiveContext]
  );

  const runAction = useCallback(
    async (action: QuickAction) => {
      if (chat.busy) return;
      let all = attachments;
      if (!all.length && crmCandidate) {
        const attached = await attachCurrentCreative();
        if (attached) all = [attached];
      }
      if (!all.length) {
        setHint("Attach an image or open a creative first.");
        return;
      }
      const crm = all.find((entry): entry is CrmAttachment => entry.kind === "crm");
      if (action === "original" && crm) {
        // Le prompt exact vient du CRM, sans modèle entre les deux.
        const record = await chat.fetchCreative(crm.batchId, crm.creativeId);
        if (record) {
          chat.pushCard({
            title: `Original prompt · ${record.name}`,
            subtitle: `Batch ${pad(record.batchNumber)} · ${record.family.label} · ${record.angle.name} · ${record.ratio} · ${record.status}`,
            code: record.prompt,
            note: record.instructions.trim() ? `Stored by the Creative Engine at generation time (exact). Operator instructions for the batch: "${record.instructions.trim()}".` : "Stored by the Creative Engine at generation time (exact).",
          });
          stickToBottom.current = true;
          return;
        }
      }
      await submit(draft.trim() || ACTION_MESSAGE[action], action, all);
    },
    [attachCurrentCreative, attachments, chat, crmCandidate, draft, submit]
  );

  const retry = useCallback(
    async (message: ChatMessage) => {
      if (!message.retry || chat.busy) return;
      const crm = message.retry.creative ? [{ kind: "crm", batchId: message.retry.creative.batchId, creativeId: message.retry.creative.creativeId, name: effectiveContext.creativeName ?? "creative", previewUrl: null, thumb: null } satisfies CrmAttachment] : [];
      stickToBottom.current = true;
      await chat.send({ message: message.retry.message, context: effectiveContext, attachments: crm, action: message.retry.action });
    },
    [chat, effectiveContext]
  );

  const onLaunched = useCallback(
    (batch: LaunchedBatch) => {
      setPendingPrompts(null);
      setGeneration({ batch, startedAt: Date.now(), settled: batch.items.every((item) => item.state !== "pending") });
      chat.pushCard({
        title: `Batch #${String(batch.number).padStart(3, "0")} launched · ${batch.items.length} image${batch.items.length > 1 ? "s" : ""}`,
        subtitle: `${batch.productName} · ${batch.ratio} · ${batch.resolution} · ${batch.items[0]?.model ?? ""}`,
        note: "Generated by the Creative Engine from the prompts you confirmed. Follow it above the composer or open the batch in Mass test.",
      });
      stickToBottom.current = true;
    },
    [chat]
  );

  const copyMessage = useCallback((message: ChatMessage) => {
    void navigator.clipboard.writeText(message.text).then(() => {
      setCopiedId(message.id);
      setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1200);
    });
  }, []);

  const status = chat.status;
  const connected = Boolean(status?.configured && status.reachable);
  const statusLabel = !status ? "checking" : connected ? "connected" : status.configured ? "unavailable" : "not configured";
  const statusTitle = !status ? "Checking the Hermes API server…" : connected ? "Hermes API server reachable" : status.configured ? "Hermes API server not reachable from the CRM" : "HERMES_API_URL / HERMES_API_SERVER_KEY not set on this server";

  // z-[60] : l'aperçu d'une créa (Mass test) et le tiroir mobile sont des overlays z-50, et le panneau
  // doit rester ouvrable pendant qu'une créa est affichée : c'est son cas d'usage principal.
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-[4.75rem] right-4 z-[60] flex items-center gap-2 rounded-full bg-slate-900 py-2.5 pl-3 pr-4 text-[13px] font-medium text-white shadow-[0_10px_30px_-10px_rgba(15,23,42,0.6)] transition-[transform,opacity] duration-200 hover:-translate-y-0.5 dark:bg-slate-100 dark:text-slate-900 lg:bottom-5 lg:right-5",
          open && "pointer-events-none translate-y-2 opacity-0"
        )}
        aria-label="Ask Hermes"
      >
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white/10 dark:bg-slate-900/10">
          <Bot className="h-3.5 w-3.5" />
          {chat.busy ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> : null}
        </span>
        Ask Hermes
      </button>

      <aside
        aria-label="Ask Hermes"
        aria-hidden={!open}
        data-size={size}
        className={cn(
          "fixed inset-0 z-[60] flex flex-col overflow-hidden bg-white transition-[transform,opacity,width,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] dark:bg-slate-900",
          SIZE_CLASS[size],
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        )}
        onDragOver={(event) => {
          if (imageFilesFrom(event.dataTransfer).length || event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(imageFilesFrom(event.dataTransfer));
        }}
      >
        {/* En-tête */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold tracking-[0.08em] text-slate-900 dark:text-slate-100">HERMES</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-slate-500" title={statusTitle}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", !status ? "bg-amber-400" : connected ? "bg-emerald-500" : "bg-rose-500")} />
                {statusLabel}
              </span>
            </div>
            <div className="truncate text-[11px] text-slate-500">MGATE Operator</div>
          </div>
          <EnvBadge className={cn("scale-90", size === "small" && "hidden")} />
          <div className="hidden items-center rounded-md bg-slate-100 p-0.5 sm:flex dark:bg-slate-800" role="group" aria-label="Taille du panneau">
            {SIZES.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.title}
                aria-pressed={size === option.id}
                onClick={() => setSize(option.id)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  size === option.id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" title="Clear conversation" onClick={() => chat.clear()}>
            <Trash2 className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" title="Collapse" onClick={() => setOpen(false)}>
            <ChevronDown className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" title="Close" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Messages */}
        <div
          ref={listRef}
          className="relative flex-1 overflow-y-auto px-4 py-4"
          onScroll={(event) => {
            const list = event.currentTarget;
            stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          }}
        >
          <div className={cn(size === "full" && "mx-auto w-full max-w-3xl")}>
          {!chat.ready ? null : chat.messages.length === 0 ? (
            <EmptyState
              onPick={(example) => {
                setDraft(example);
                textareaRef.current?.focus();
              }}
              configured={status?.configured ?? true}
            />
          ) : (
            <div className="space-y-3">
              {chat.messages.map((message) => (
                <MessageRow key={message.id} message={message} copied={copiedId === message.id} onCopy={() => copyMessage(message)} onRetry={() => void retry(message)} busy={chat.busy} onGenerate={(selected) => setPendingPrompts(selected)} />
              ))}
            </div>
          )}
          </div>
          {dragging ? (
            <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-slate-400 bg-white/80 text-[13px] font-medium text-slate-600 dark:bg-slate-900/80 dark:text-slate-300">
              Drop the image to attach it
            </div>
          ) : null}
        </div>

        {/* Pied : contexte, pièces jointes, actions, composer */}
        <div className={cn("shrink-0 border-t border-slate-200 px-3 pb-3 pt-2 dark:border-slate-800", size === "full" && "[&>*]:mx-auto [&>*]:max-w-3xl")}>
          {generation ? <GenerationStatus generation={generation} onUpdate={setGeneration} onDismiss={() => setGeneration(null)} /> : null}

          {chips.length || crmCandidate ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <span key={chip.key} className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-slate-100 py-0.5 pl-2 pr-1 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200" title={`${chip.key}: ${chip.label}`}>
                  <span className="truncate">{chip.label}</span>
                  <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100" aria-label={`Remove ${chip.label} from context`} onClick={() => setRemoved((current) => new Set(current).add(chip.key))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {crmCandidate && !crmAttached ? (
                <button type="button" className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100" onClick={() => void attachCurrentCreative()}>
                  <ImagePlus className="h-3 w-3" />
                  Attach current creative
                </button>
              ) : null}
            </div>
          ) : null}

          {attachments.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => {
                const key = attachment.kind === "crm" ? `crm-${attachment.creativeId}` : attachment.id;
                const src = attachment.kind === "crm" ? attachment.previewUrl ?? attachment.thumb : attachment.thumb;
                return (
                  <div key={key} className="group/att relative h-14 w-14 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" title={attachment.name}>
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={attachment.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-500">creative</div>
                    )}
                    {attachment.kind === "crm" ? <span className="absolute bottom-0 left-0 rounded-tr bg-slate-900/80 px-1 text-[8px] font-semibold uppercase tracking-wide text-white">CRM</span> : null}
                    <button
                      type="button"
                      className="absolute right-0.5 top-0.5 rounded-full bg-slate-900/80 p-0.5 text-white opacity-0 transition-opacity group-hover/att:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => setAttachments((current) => current.filter((entry) => entry !== attachment))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {showQuickActions ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={chat.busy}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => void runAction(action.id)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          {hint ? <div className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">{hint}</div> : null}

          <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-1.5 focus-within:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:focus-within:border-slate-500">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void addFiles(files);
              }}
            />
            <button type="button" className="mb-0.5 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" title="Attach an image" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              rows={1}
              placeholder={connected ? "Ask Hermes… (Enter to send, Shift+Enter for a new line)" : "Hermes is unavailable — messages will fail until the API server is reachable"}
              className="max-h-[168px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[13px] leading-5 text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit(draft);
                }
              }}
              onPaste={(event) => {
                const files = imageFilesFrom(event.clipboardData);
                if (files.length) {
                  event.preventDefault();
                  void addFiles(files);
                }
              }}
            />
            {chat.busy ? (
              <button type="button" className="mb-0.5 rounded-lg bg-slate-900 p-2 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900" title="Stop" onClick={() => chat.stop()}>
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                className="mb-0.5 rounded-lg bg-slate-900 p-2 text-white transition-opacity hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                title="Send"
                disabled={!draft.trim() && !attachments.length}
                onClick={() => void submit(draft)}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {pendingPrompts ? (
        <GenerateDialog
          prompts={pendingPrompts}
          product={effectiveContext.productName ? { id: effectiveContext.productId, name: effectiveContext.productName, url: effectiveContext.productUrl, store: effectiveContext.storeName } : null}
          attachments={attachments}
          sessionId={chat.conversationId}
          onClose={() => setPendingPrompts(null)}
          onLaunched={onLaunched}
        />
      ) : null}
    </>
  );
}

/** Les prompts prêts d'une réponse : cases à cocher, « Generate » / « Generate selected » / « Generate all ». Rien ne part d'ici : le bouton ouvre la confirmation. */
function PromptPicker({ text, disabled, onGenerate }: { text: string; disabled: boolean; onGenerate: (prompts: ExtractedPrompt[]) => void }) {
  const prompts = useMemo(() => extractPrompts(text), [text]);
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  if (!prompts.length) return null;
  const selected = prompts.filter((entry) => !unchecked.has(entry.id));
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60" data-prompt-picker>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
        {prompts.length} generation-ready prompt{prompts.length > 1 ? "s" : ""}
      </div>
      {prompts.length > 1 ? (
        <ul className="mb-2 space-y-1">
          {prompts.map((entry, index) => (
            <li key={entry.id}>
              <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-snug text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!unchecked.has(entry.id)}
                  onChange={(event) =>
                    setUnchecked((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{index + 1}.</span> {entry.angle ? <span className="mr-1 rounded bg-white px-1 py-0.5 text-[10px] font-medium dark:bg-slate-900">{entry.angle}</span> : null}
                  <span className="line-clamp-2">{entry.prompt}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {prompts.length === 1 ? (
          <button type="button" disabled={disabled} onClick={() => onGenerate(prompts)} className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
            Generate
          </button>
        ) : (
          <>
            <button type="button" disabled={disabled || !selected.length} onClick={() => onGenerate(selected)} className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
              Generate selected ({selected.length})
            </button>
            <button type="button" disabled={disabled} onClick={() => onGenerate(prompts)} className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-white disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-900">
              Generate all ({prompts.length})
            </button>
          </>
        )}
        <span className="text-[10.5px] text-slate-400">Opens a confirmation before any Kie credit is spent.</span>
      </div>
    </div>
  );
}

function EmptyState({ onPick, configured }: { onPick: (example: string) => void; configured: boolean }) {
  return (
    <div className="flex h-full flex-col justify-end gap-4 pb-2">
      <div>
        <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">Same Hermes as on Telegram, with the page you are on as context.</p>
        <p className="mt-1 text-[12px] text-slate-500">Open a product, batch or creative and Hermes sees it. Attach an image to reverse-prompt it. Read-only: no generation, no ad changes from here.</p>
        {!configured ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Not configured: set HERMES_API_URL and HERMES_API_SERVER_KEY on this server to reach the Hermes API server.</p> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="rounded-full border border-slate-200 px-3 py-1 text-[12px] text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => onPick(example)}>
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message, copied, onCopy, onRetry, busy, onGenerate }: { message: ChatMessage; copied: boolean; onCopy: () => void; onRetry: () => void; busy: boolean; onGenerate: (prompts: ExtractedPrompt[]) => void }) {
  if (message.role === "card" && message.card) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-100">{message.card.title}</div>
            {message.card.subtitle ? <div className="truncate text-[11px] text-slate-500">{message.card.subtitle}</div> : null}
          </div>
          {message.card.code ? <CopyText text={message.card.code} className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700" /> : null}
        </div>
        {message.card.code ? <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2.5 font-mono text-[11.5px] leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200">{message.card.code}</pre> : null}
        {message.card.note ? <div className="mt-2 text-[11px] text-slate-500">{message.card.note}</div> : null}
        <div className="mt-1 text-[10px] text-slate-400">{time(message.at)}</div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2 text-[13px] leading-5 text-white dark:bg-slate-100 dark:text-slate-900">
          {message.images?.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {message.images.map((image, index) =>
                image.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={index} src={image.thumb} alt={image.name} title={image.name} className="h-12 w-12 rounded-md object-cover ring-1 ring-white/20" />
                ) : (
                  <span key={index} className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px]">{image.crm ? "CRM · " : ""}{image.name}</span>
                )
              )}
            </div>
          ) : null}
          {message.text ? <div className="whitespace-pre-wrap break-words">{message.text}</div> : null}
        </div>
        <div className="mt-0.5 text-[10px] text-slate-400">{time(message.at)}</div>
      </div>
    );
  }

  return (
    <div className="group/msg flex flex-col items-start">
      <div className="max-w-[94%] text-[13px] leading-5 text-slate-800 dark:text-slate-200">
        {message.tools?.length ? (
          <div className="mb-1.5 space-y-0.5">
            {message.tools.map((tool) => (
              <div key={tool.id} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                {tool.status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-emerald-500" />}
                <span className="truncate">{tool.emoji ? `${tool.emoji} ` : ""}{tool.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        {message.text ? <Markdown text={message.text} /> : message.streaming ? <div className="flex items-center gap-1.5 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Hermes is thinking…</div> : null}
        {message.error ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <span>{message.error}</span>
            {message.retry ? (
              <button type="button" disabled={busy} className="inline-flex items-center gap-1 rounded border border-rose-300 px-1.5 py-0.5 text-[10.5px] font-medium hover:bg-rose-100 disabled:opacity-50 dark:border-rose-700 dark:hover:bg-rose-900/40" onClick={onRetry}>
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {message.stopped ? <div className="mt-1 text-[11px] italic text-slate-400">Stopped.</div> : null}
        {message.text && !message.streaming ? <PromptPicker text={message.text} disabled={busy} onGenerate={onGenerate} /> : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
        <span>{time(message.at)}</span>
        {message.text && !message.streaming ? (
          <button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover/msg:opacity-100 focus-visible:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200" onClick={onCopy}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
