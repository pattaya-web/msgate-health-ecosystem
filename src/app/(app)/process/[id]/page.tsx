"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addCard,
  deleteCard,
  getProcessBoard,
  resetMasterWhiteboard,
  updateCard,
} from "@/lib/process/store";
import {
  CARD_TONE_CLASS,
  type ProcessBoard,
  type ProcessCardTone,
} from "@/lib/process/types";
import { useAuth } from "@/lib/auth/auth-context";
import { LoadingState } from "@/components/shared/page-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TONES: { value: ProcessCardTone; label: string }[] = [
  { value: "yellow", label: "Jaune" },
  { value: "green", label: "Vert" },
  { value: "red", label: "Rouge" },
  { value: "orange", label: "Orange" },
  { value: "amber", label: "Ambre" },
  { value: "purple", label: "Violet" },
  { value: "blue", label: "Bleu" },
  { value: "tan", label: "Beige" },
  { value: "neutral", label: "Blanc" },
];

export default function ProcessBoardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { canWrite } = useAuth();
  const [board, setBoard] = useState<ProcessBoard | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    let b = getProcessBoard(id);
    if (!b && id === "process-ecosystem-master") {
      b = resetMasterWhiteboard();
    }
    setBoard(b);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) return <LoadingState className="min-h-[420px]" />;
  if (!board) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">Process introuvable</div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Process IBO · MID · BANK · SHOP
          </h1>
          <p className="text-[11px] text-slate-500">
            Whiteboard — clique une case pour éditer. Sauvegarde auto.
          </p>
        </div>
        {canWrite && id === "process-ecosystem-master" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!confirm("Réinitialiser le board d’origine (tes edits seront écrasés) ?")) {
                return;
              }
              setBoard(resetMasterWhiteboard());
              toast.success("Board réinitialisé");
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset board
          </Button>
        ) : null}
      </div>

      {/* Miro-like canvas */}
      <div
        className="overflow-x-auto rounded-xl border border-slate-300/80 dark:border-slate-700"
        style={{
          backgroundColor: "#e8eef5",
          backgroundImage:
            "radial-gradient(circle, #c5d0dc 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="flex min-w-max items-stretch gap-4 p-4 md:p-5">
          {board.columns.map((col) => (
            <section key={col.id} className="flex w-[280px] shrink-0 flex-col gap-2.5 sm:w-[300px]">
              {/* Yellow header banner like the whiteboard */}
              <div className="rounded-md border-2 border-amber-400 bg-[#FFE566] px-3 py-2.5 text-center shadow-[3px_3px_0_rgba(180,140,0,0.35)]">
                <div className="text-base font-black uppercase tracking-wide text-amber-950">
                  {col.title}
                </div>
                {col.subtitle ? (
                  <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-900/70">
                    {col.subtitle}
                  </div>
                ) : null}
              </div>

              {/* Cases / sticky notes */}
              <div className="flex flex-1 flex-col gap-2.5">
                {col.cards.map((card) => (
                  <article
                    key={card.id}
                    className={cn(
                      "rounded-md px-2.5 py-2",
                      CARD_TONE_CLASS[card.tone] || CARD_TONE_CLASS.yellow
                    )}
                  >
                    <div className="mb-1 flex items-start gap-1">
                      <Input
                        disabled={!canWrite}
                        className="h-7 flex-1 border-0 bg-transparent px-0 text-[11px] font-black uppercase tracking-wide shadow-none focus-visible:ring-1 focus-visible:ring-black/20"
                        defaultValue={card.title}
                        key={`t-${card.id}-${board.updated_at}`}
                        onBlur={(e) => {
                          if (!canWrite) return;
                          const next = e.target.value.trim();
                          if (!next || next === card.title) return;
                          const updated = updateCard(board.id, col.id, card.id, {
                            title: next,
                          });
                          if (updated) setBoard(updated);
                        }}
                      />
                      {canWrite ? (
                        <>
                          <Select
                            value={card.tone}
                            onValueChange={(v) => {
                              const updated = updateCard(board.id, col.id, card.id, {
                                tone: v as ProcessCardTone,
                              });
                              if (updated) setBoard(updated);
                            }}
                          >
                            <SelectTrigger className="h-6 w-[64px] shrink-0 border-black/15 bg-white/60 px-1 text-[9px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TONES.map((t) => (
                                <SelectItem key={t.value} value={t.value} className="text-xs">
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            type="button"
                            className="rounded p-0.5 opacity-50 hover:bg-black/10 hover:opacity-100"
                            title="Supprimer case"
                            onClick={() => {
                              if (!confirm("Supprimer cette case ?")) return;
                              const updated = deleteCard(board.id, col.id, card.id);
                              if (updated) setBoard(updated);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      ) : null}
                    </div>
                    <Textarea
                      disabled={!canWrite}
                      className="min-h-[88px] resize-y border-0 bg-transparent px-0 text-[11px] leading-snug shadow-none focus-visible:ring-1 focus-visible:ring-black/15"
                      defaultValue={card.body}
                      key={`b-${card.id}-${board.updated_at}`}
                      onBlur={(e) => {
                        if (!canWrite) return;
                        if (e.target.value === card.body) return;
                        const updated = updateCard(board.id, col.id, card.id, {
                          body: e.target.value,
                        });
                        if (updated) setBoard(updated);
                      }}
                    />
                  </article>
                ))}

                {canWrite ? (
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-400/50 bg-white/50 py-2 text-[11px] font-semibold text-slate-600 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800"
                    onClick={() => {
                      const updated = addCard(board.id, col.id, "yellow");
                      if (updated) setBoard(updated);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Case
                  </button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
