"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { useMounted } from "@/lib/use-mounted";

/**
 * La fenêtre « Renommer » de l'Ads Manager.
 *
 * Avant, c'était window.prompt : Safari en appli (écran d'accueil) et certains
 * Chrome la bloquent sans rien dire, et le renommage semblait ne pas marcher.
 * `askName()` ouvre cette fenêtre et rend le nouveau nom (ou null si annulé) ;
 * <RenameDialogHost /> est posé une fois dans la page.
 */

type Request = { title: string; current: string; resolve: (value: string | null) => void };

let pending: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function askName(title: string, current: string): Promise<string | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { title, current, resolve };
    emit();
  });
}

function close(value: string | null) {
  const request = pending;
  pending = null;
  emit();
  request?.resolve(value);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function RenameDialogHost() {
  const request = useSyncExternalStore(subscribe, () => pending, () => null);
  const mounted = useMounted();
  if (!mounted || !request) return null;
  return createPortal(<RenameDialog key={`${request.title}:${request.current}`} request={request} />, document.body);
}

function RenameDialog({ request }: { request: Request }) {
  const [value, setValue] = useState(request.current);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const submit = () => {
    const next = value.trim();
    close(next && next !== request.current ? next : null);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-950/40 p-3 backdrop-blur-[2px] sm:items-center" onClick={() => close(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <Pencil className="h-4 w-4 text-slate-400" />
          <p className="flex-1 text-[14px] font-semibold text-slate-900 dark:text-slate-50">{request.title}</p>
          <button type="button" aria-label="Fermer" onClick={() => close(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            ref={input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={400}
            className="h-11 w-full rounded-xl border border-slate-200 bg-transparent px-3 text-[16px] text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/15 sm:text-[14px] dark:border-slate-700 dark:text-slate-50"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => close(null)} className="h-10 rounded-xl px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Annuler
            </button>
            <button
              type="submit"
              disabled={!value.trim() || value.trim() === request.current}
              className="h-10 rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
            >
              Renommer sur Meta
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
