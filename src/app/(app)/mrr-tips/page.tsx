"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import { TIP_CATEGORIES, TIPS, type Tip, type TipCategory } from "@/lib/mrr-tips/content";
import { cn } from "@/lib/utils";

/** Sans accents ni casse : « reponse » trouve « Réponse ». */
function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function searchable(tip: Tip) {
  return normalize([tip.title, tip.summary, ...tip.body, ...(tip.bullets ?? []), ...(tip.steps ?? []), tip.example?.text ?? ""].join(" "));
}

export default function MrrTipsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TipCategory | "all">("all");
  const [open, setOpen] = useState<string[]>([]);
  const [copied, setCopied] = useState("");

  const visible = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return TIPS.map((tip, index) => ({ tip, number: index + 1 })).filter(
      ({ tip }) => (category === "all" || tip.category === category) && words.every((word) => searchable(tip).includes(word))
    );
  }, [query, category]);

  const counts = useMemo(() => {
    const map = new Map<TipCategory, number>();
    for (const tip of TIPS) map.set(tip.category, (map.get(tip.category) ?? 0) + 1);
    return map;
  }, []);

  const allOpen = visible.length > 0 && visible.every(({ tip }) => open.includes(tip.id));

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      toast.success("Copié");
      setTimeout(() => setCopied(""), 1500);
    } catch {
      toast.error("Copie impossible");
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 pb-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">MRR Tips &amp; Tricks</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Les notes de @mr_mrr4, traduites et classées : support client, abonnement, chargebacks, MID, chiffres. {`${TIPS.length} fiches`},
          dans l&apos;ordre du document.
        </p>
      </div>

      {/* Recherche et catégories */}
      <div className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Chercher : chargeback, SMS, annulation, MID…"
              className="h-9 w-full rounded-lg bg-slate-50 pl-8 pr-3 text-[13px] outline-none ring-1 ring-transparent focus:bg-white focus:ring-slate-900/10 dark:bg-slate-800"
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen(allOpen ? [] : visible.map(({ tip }) => tip.id))}
            className="h-9 shrink-0 rounded-lg bg-slate-100 px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
          >
            {allOpen ? "Tout fermer" : "Tout ouvrir"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...TIP_CATEGORIES] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                category === item
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              )}
            >
              {item === "all" ? `Tout (${TIPS.length})` : `${item} (${counts.get(item) ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      {/* Les fiches */}
      <div className="space-y-2">
        {visible.map(({ tip, number }) => {
          const isOpen = open.includes(tip.id);
          return (
            <div key={tip.id} className="rounded-2xl bg-white ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
              <button
                type="button"
                onClick={() => setOpen((current) => (isOpen ? current.filter((id) => id !== tip.id) : [...current, tip.id]))}
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
              >
                <span className="mt-0.5 w-6 shrink-0 text-[12px] font-semibold tabular-nums text-slate-400">{String(number).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-slate-900 dark:text-slate-50">{tip.title}</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {tip.category}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{tip.summary}</span>
                </span>
                <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")} />
              </button>

              {isOpen ? (
                <div className="space-y-3 border-t border-slate-900/[0.05] px-4 py-3 sm:pl-[52px] text-[13.5px] leading-relaxed text-slate-700 dark:border-white/[0.05] dark:text-slate-300">
                  {tip.body.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {tip.bullets?.length ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {tip.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                  {tip.steps?.length ? (
                    <ol className="list-decimal space-y-1 pl-5">
                      {tip.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  ) : null}
                  {tip.example ? (
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{tip.example.label}</span>
                        <button
                          type="button"
                          onClick={() => void copy(tip.id, tip.example!.text)}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-white dark:hover:bg-slate-900"
                        >
                          {copied === tip.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          Copier
                        </button>
                      </div>
                      <p className="whitespace-pre-line font-mono text-[12px] text-slate-700 dark:text-slate-300">{tip.example.text}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {!visible.length ? <p className="py-10 text-center text-[13px] text-slate-400">Aucune fiche ne correspond.</p> : null}
      </div>
    </div>
  );
}
