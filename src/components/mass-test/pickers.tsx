"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CREATIVE_CATEGORIES, CREATIVE_TYPES, type CreativeType } from "@/lib/studio/creative-types";
import type { Angle } from "@/lib/creative-engine/types";
import { cn } from "@/lib/utils";

/**
 * Les deux sélecteurs du Mass test, en fenêtre : on ne voit la liste complète
 * que quand on veut la changer. La page principale ne montre que ce qui est
 * choisi.
 */

function Modal({ title, hint, onClose, children }: { title: string; hint: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</div>
            <div className="text-[12px] text-slate-500">{hint}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <Button onClick={onClose}>Terminé</Button>
        </div>
      </div>
    </div>
  );
}

function Option({ on, title, hint, onClick }: { on: boolean; title: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        on ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-50 text-slate-800 hover:bg-slate-100 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-800"
      )}
    >
      <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? "border-white/60 bg-white/20 dark:border-slate-900/40 dark:bg-slate-900/10" : "border-slate-300 dark:border-slate-600")}>
        {on ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        {hint ? <span className={cn("block text-[11px] leading-snug", on ? "opacity-80" : "text-slate-500")}>{hint}</span> : null}
      </span>
    </button>
  );
}

export function AnglePicker({
  suggested,
  custom,
  selected,
  onToggle,
  onAddCustom,
  onRemoveCustom,
  onClose,
}: {
  suggested: Angle[];
  custom: Angle[];
  selected: string[];
  onToggle: (id: string) => void;
  onAddCustom: (name: string) => Promise<void>;
  onRemoveCustom: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const recommended = suggested.slice(0, 5);
  const others = suggested.slice(5);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await onAddCustom(draft.trim());
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  const group = (label: string, list: Angle[], removable = false) =>
    list.length ? (
      <div className="mb-4">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {list.map((angle) => (
            <div key={angle.id} className="relative">
              <Option on={selected.includes(angle.id)} title={angle.name} hint={angle.hooks[0] ? `« ${angle.hooks[0]} »` : angle.why} onClick={() => onToggle(angle.id)} />
              {removable ? (
                <button type="button" onClick={() => void onRemoveCustom(angle.id)} className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:text-rose-600" aria-label="Retirer cet angle">
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <Modal title="Angles à tester" hint="Un angle, c'est la raison pour laquelle le client s'y intéresse. Choisis-en autant que tu veux." onClose={onClose}>
      {group("Recommandés pour ce produit", recommended)}
      {group("Autres angles proposés", others)}
      {group("Tes angles", custom, true)}
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
          placeholder="Ajouter un angle : Cadeau de Noël, Mâchoire, Occasion mariage…"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950"
        />
        <Button variant="outline" onClick={() => void add()} disabled={busy || !draft.trim()}>
          <Plus className="h-3.5 w-3.5" />
          Ajouter
        </Button>
      </div>
    </Modal>
  );
}

export function StylePicker({ selected, onToggle, onClose }: { selected: string[]; onToggle: (id: string) => void; onClose: () => void }) {
  const enabled = CREATIVE_TYPES.filter((type) => type.enabled);
  return (
    <Modal title="Styles de créa" hint="Le style, c'est la forme que prend la pub. Les styles choisis tournent sur les variantes de chaque angle." onClose={onClose}>
      {CREATIVE_CATEGORIES.map((category) => {
        const list: CreativeType[] = enabled.filter((type) => type.category === category.id);
        if (!list.length) return null;
        return (
          <div key={category.id} className="mb-4">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{category.label}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {list.map((type) => (
                <Option key={type.id} on={selected.includes(type.id)} title={type.name} hint={type.description} onClick={() => onToggle(type.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
