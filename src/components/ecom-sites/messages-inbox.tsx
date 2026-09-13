"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { EcomMessage } from "@/lib/ecom-sites/messages";

/**
 * Les messages reçus par le formulaire de contact d'une boutique.
 *
 * Ils n'arrivent nulle part ailleurs : c'est ici qu'on les lit, et qu'on
 * vérifie que le formulaire testé par un souscripteur a bien abouti.
 */
export function MessagesInbox({ slug }: { slug: string }) {
  const [messages, setMessages] = useState<EcomMessage[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ecom-sites/messages?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const body = (await res.json()) as { messages?: EcomMessage[] };
      setMessages(body.messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setBusy(false);
    }
  }, [slug]);

  useEffect(() => {
    // Un tour de boucle plus tard : pas d'état posé pendant l'effet lui-même.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function remove(id: string) {
    await fetch(`/api/ecom-sites/messages?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setMessages((current) => (current ? current.filter((message) => message.id !== id) : current));
  }

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Messages reçus{messages ? ` · ${messages.length}` : ""}
        </span>
        <button type="button" onClick={() => void load()} title="Rafraîchir" className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-slate-900">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>
      {messages === null ? null : messages.length === 0 ? (
        <p className="mt-1 text-[11px] text-slate-400">Aucun message pour l&apos;instant. Les essais faits depuis l&apos;aperçu ne comptent pas.</p>
      ) : (
        <ul className="mt-1.5 max-h-64 space-y-1.5 overflow-y-auto">
          {messages.slice(0, 50).map((message) => (
            <li key={message.id} className="rounded-lg bg-white p-2 text-[12px] ring-1 ring-slate-900/[0.05] dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {message.name} · <span className="font-normal text-slate-500">{message.email}</span>
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">{new Date(message.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <button type="button" onClick={() => void remove(message.id)} title="Supprimer" className="shrink-0 rounded-md p-0.5 text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {message.subject ? <p className="mt-0.5 text-[11px] font-medium">{message.subject}</p> : null}
              <p className="mt-0.5 whitespace-pre-line text-[11px] text-slate-600 dark:text-slate-300">{message.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
