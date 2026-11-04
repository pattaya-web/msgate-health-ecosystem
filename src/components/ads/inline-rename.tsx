"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Renommer une pub sur place, sans fenêtre : crayon (ou double-clic sur le nom)
 * → le nom devient un champ. Entrée enregistre, Échap annule, Tab enregistre
 * et passe à la pub suivante affichée (Maj+Tab : la précédente), pour en
 * renommer dix à la suite au clavier. L'enregistrement part chez Meta en
 * arrière-plan : le nouveau nom s'affiche tout de suite, l'ancien revient si
 * Meta refuse.
 */

/** La ligne en cours d'édition : une clé par affichage (la même pub peut être rendue deux fois, ex. vue mobile cachée). */
let editing: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function startInlineRename(key: string | null) {
  editing = key;
  emit();
}

/** La pub voisine visible à l'écran (ordre de la page), pour enchaîner au clavier. */
function neighbour(key: string, step: 1 | -1) {
  const keys = [...document.querySelectorAll<HTMLElement>("[data-inline-rename]")]
    .filter((node) => node.dataset.inlineRename === key || node.offsetParent !== null)
    .map((node) => node.dataset.inlineRename ?? "");
  const index = keys.indexOf(key);
  return index < 0 ? null : (keys[index + step] ?? null);
}

export function InlineRename({
  id,
  name,
  onSave,
  children,
}: {
  id: string;
  name: string;
  /** Renomme chez Meta ; lève une erreur si Meta refuse. */
  onSave: (next: string) => Promise<void>;
  /** L'affichage normal du nom (hors édition). */
  children: React.ReactNode;
}) {
  const key = `${id}:${useId()}`;
  const current = useSyncExternalStore(subscribe, () => editing, () => null);
  const [pending, setPending] = useState<string | null>(null);
  const isEditing = current === key;

  const commit = (value: string) => {
    const next = value.trim().replace(/\s+/g, " ");
    if (!next || next === name) return;
    setPending(next);
    onSave(next)
      .then(() => toast.success("Renommé sur Meta", { description: next }))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Renommage impossible", { description: name }))
      .finally(() => setPending(null));
  };

  if (isEditing) {
    return (
      <input
        data-inline-rename={key}
        autoFocus
        defaultValue={pending ?? name}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            startInlineRename(null);
          } else if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
            startInlineRename(null);
          } else if (event.key === "Tab") {
            event.preventDefault();
            commit(event.currentTarget.value);
            startInlineRename(neighbour(key, event.shiftKey ? -1 : 1));
          }
        }}
        onBlur={(event) => {
          // Un Tab ou une Entrée a déjà enregistré et changé de ligne : le blur qui suit ne refait rien.
          if (editing !== key) return;
          commit(event.currentTarget.value);
          startInlineRename(null);
        }}
        spellCheck={false}
        className="h-6 min-w-0 flex-1 rounded-md border border-emerald-500/60 bg-white px-1.5 font-mono text-[16px] text-slate-900 outline-none ring-2 ring-emerald-500/15 sm:text-[11.5px] dark:bg-slate-900 dark:text-slate-50"
        title="Entrée : enregistrer · Tab : enregistrer et pub suivante · Échap : annuler"
      />
    );
  }

  return (
    <span
      data-inline-rename={key}
      className="group/rename flex min-w-0 flex-1 items-center gap-1"
      onDoubleClick={(event) => {
        event.stopPropagation();
        startInlineRename(key);
      }}
    >
      {pending ? (
        <span className="flex min-w-0 items-center gap-1 truncate text-[12px] text-slate-500 dark:text-slate-400" title={pending}>
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          <span className="truncate">{pending}</span>
        </span>
      ) : (
        children
      )}
      <button
        type="button"
        title="Renommer ici (ou double-clic sur le nom) · Tab passe à la pub suivante"
        onClick={(event) => {
          event.stopPropagation();
          startInlineRename(key);
        }}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-emerald-50 hover:text-emerald-700",
          "dark:text-slate-600 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-300"
        )}
      >
        <Pencil className="h-3 w-3" />
      </button>
    </span>
  );
}
