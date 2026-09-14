"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatRequest, CreativeRecord, HermesStatus, PageContext, QuickAction, StreamEvent } from "@/lib/ask-hermes/types";

/**
 * État de la conversation côté navigateur.
 *
 * La vraie transcription vit chez Hermes (X-Hermes-Session-Id) : ici on garde
 * un court historique d'affichage dans localStorage, sans images pleines
 * (vignettes seulement), et l'identifiant de conversation. « Clear » ouvre une
 * nouvelle session Hermes ; la mémoire long terme de Hermes n'est pas touchée.
 */

export type ToolActivity = { id: string; label: string; status: string; emoji?: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "card";
  text: string;
  at: number;
  images?: Array<{ name: string; thumb?: string | null; crm?: boolean }>;
  tools?: ToolActivity[];
  error?: string | null;
  streaming?: boolean;
  stopped?: boolean;
  card?: { title: string; subtitle?: string; code?: string; note?: string };
  /** Pour « Retry » : la requête telle qu'envoyée (sans les images pleines). */
  retry?: { message: string; action?: QuickAction; creative?: { batchId: string; creativeId: string } | null };
};

export type CrmAttachment = { kind: "crm"; batchId: string; creativeId: string; name: string; previewUrl: string | null; thumb?: string | null };
export type ExternalAttachment = { kind: "external"; id: string; name: string; dataUrl: string; thumb: string };
export type Attachment = CrmAttachment | ExternalAttachment;

type Persisted = { v: 1; conversationId: string; messages: ChatMessage[] };

const STORAGE_KEY = "msgate.ask-hermes.v1";
const MAX_PERSISTED = 60;

function newConversationId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `crm-${random.replace(/[^a-z0-9-]/gi, "").toLowerCase()}`.slice(0, 60);
}

function newId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed?.v === 1 && typeof parsed.conversationId === "string" && Array.isArray(parsed.messages)) {
        return { ...parsed, messages: parsed.messages.map((message) => ({ ...message, streaming: false })) };
      }
    }
  } catch {
    // stockage indisponible : conversation éphémère
  }
  return { v: 1, conversationId: newConversationId(), messages: [] };
}

function save(state: Persisted) {
  try {
    const trimmed: Persisted = {
      ...state,
      messages: state.messages.slice(-MAX_PERSISTED).map((message) => {
        const copy = { ...message };
        delete copy.streaming;
        delete copy.tools;
        return copy;
      }),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // quota ou navigation privée : on continue sans persistance
  }
}

export type SendInput = {
  message: string;
  context: PageContext | null;
  attachments: Attachment[];
  action?: QuickAction;
};

export function useHermesChat() {
  const [ready, setReady] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<Persisted>({ v: 1, conversationId: "", messages: [] });

  useEffect(() => {
    const timer = setTimeout(() => {
      const initial = load();
      stateRef.current = initial;
      setConversationId(initial.conversationId);
      setMessages(initial.messages);
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    stateRef.current = { v: 1, conversationId, messages };
    save(stateRef.current);
  }, [ready, conversationId, messages]);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/ask-hermes/status", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setStatus((await response.json()) as HermesStatus);
    } catch {
      setStatus({ configured: false, reachable: null, checkedAt: new Date().toISOString() });
    }
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage> | ((message: ChatMessage) => ChatMessage)) => {
    setMessages((current) => current.map((message) => (message.id === id ? (typeof patch === "function" ? patch(message) : { ...message, ...patch }) : message)));
  }, []);

  const send = useCallback(
    async (input: SendInput) => {
      if (busy) return;
      const crm = input.attachments.find((entry): entry is CrmAttachment => entry.kind === "crm") ?? null;
      const externals = input.attachments.filter((entry): entry is ExternalAttachment => entry.kind === "external");
      const text = input.message.trim();
      if (!text && !crm && !externals.length) return;

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        text,
        at: Date.now(),
        images: [...(crm ? [{ name: crm.name, thumb: crm.thumb ?? null, crm: true }] : []), ...externals.map((image) => ({ name: image.name, thumb: image.thumb }))],
      };
      const assistantId = newId();
      const assistant: ChatMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        at: Date.now(),
        streaming: true,
        tools: [],
        retry: { message: text, action: input.action, creative: crm ? { batchId: crm.batchId, creativeId: crm.creativeId } : null },
      };
      setMessages((current) => [...current, userMessage, assistant]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      const body: ChatRequest = {
        conversationId,
        message: text,
        context: input.context ?? undefined,
        creative: crm ? { batchId: crm.batchId, creativeId: crm.creativeId } : null,
        images: externals.map((image) => ({ name: image.name, dataUrl: image.dataUrl })),
        action: input.action,
      };
      try {
        const response = await fetch("/api/ask-hermes/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          let error = `Erreur ${response.status}`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload?.error) error = payload.error;
          } catch {
            // pas de corps
          }
          patchMessage(assistantId, { streaming: false, error });
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let gotText = false;
        const handle = (event: StreamEvent) => {
          if (event.t === "delta") {
            gotText = true;
            patchMessage(assistantId, (message) => ({ ...message, text: message.text + event.text }));
          } else if (event.t === "tool") {
            patchMessage(assistantId, (message) => {
              const tools = [...(message.tools ?? [])];
              const id = event.id ?? `${event.name}-${tools.length}`;
              const index = tools.findIndex((tool) => tool.id === id);
              const entry: ToolActivity = { id, label: event.label || event.name, status: event.status, emoji: event.emoji };
              if (index >= 0) tools[index] = entry;
              else tools.push(entry);
              return { ...message, tools };
            });
          } else if (event.t === "done") {
            patchMessage(assistantId, (message) => ({
              ...message,
              streaming: false,
              tools: (message.tools ?? []).map((tool) => ({ ...tool, status: tool.status === "running" ? "completed" : tool.status })),
              error: event.error ? event.error : event.finish !== "stop" && !message.text ? `Hermes s'est arrêté (${event.finish}).` : null,
            }));
          } else if (event.t === "error") {
            patchMessage(assistantId, (message) => ({ ...message, streaming: false, error: event.message }));
          }
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            try {
              handle(JSON.parse(line) as StreamEvent);
            } catch {
              // ligne partielle ou bruit : ignorée
            }
          }
        }
        patchMessage(assistantId, (message) => (message.streaming ? { ...message, streaming: false, error: gotText ? null : "Flux terminé sans réponse." } : message));
      } catch (error) {
        const aborted = controller.signal.aborted;
        patchMessage(assistantId, (message) => ({ ...message, streaming: false, stopped: aborted, error: aborted ? null : error instanceof Error ? error.message : "Erreur réseau" }));
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, conversationId, patchMessage]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(newConversationId());
  }, []);

  /** Carte locale (sans passer par Hermes) : le prompt exact stocké, ou une note. */
  const pushCard = useCallback((card: NonNullable<ChatMessage["card"]>) => {
    setMessages((current) => [...current, { id: newId(), role: "card", text: "", at: Date.now(), card }]);
  }, []);

  const fetchCreative = useCallback(async (batchId: string, creativeId: string): Promise<CreativeRecord | null> => {
    try {
      const response = await fetch(`/api/ask-hermes/creative?${new URLSearchParams({ batch: batchId, item: creativeId })}`, { cache: "no-store" });
      if (!response.ok) return null;
      const payload = (await response.json()) as { record: CreativeRecord };
      return payload.record ?? null;
    } catch {
      return null;
    }
  }, []);

  return { ready, conversationId, messages, busy, status, refreshStatus, send, stop, clear, pushCard, fetchCreative };
}
