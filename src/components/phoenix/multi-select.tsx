"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

type MultiSelectProps = {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
};

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Tous",
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-7 w-full items-center gap-1.5 rounded-md border bg-white px-1.5 text-left text-[11px] transition",
          "border-slate-200 hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20",
          "dark:border-slate-700 dark:bg-slate-900"
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          {value.length === 0 ? (
            <span className="text-slate-400">{placeholder}</span>
          ) : (
            <>
              <span className="max-w-[120px] truncate rounded bg-emerald-50 px-1 py-px text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {value[0]}
              </span>
              {value.length > 1 ? (
                <span className="shrink-0 text-[10px] font-medium text-slate-400">
                  +{value.length - 1}
                </span>
              ) : null}
            </>
          )}
        </span>
        {value.length > 0 ? (
          <X
            className="h-3 w-3 shrink-0 text-slate-400 hover:text-slate-700"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
          />
        ) : null}
        <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1.5 max-h-64 w-full min-w-[240px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900">
          {options.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-slate-400">Aucune option</p>
          ) : (
            options.map((option) => {
              const selected = value.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggle(option)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition",
                    selected
                      ? "bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "text-slate-600 hover:bg-slate-50 dark:text-slate-300"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                      selected
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-slate-300 dark:border-slate-600"
                    )}
                  >
                    {selected ? <Check className="h-2.5 w-2.5" /> : null}
                  </span>
                  <span className="truncate">{option}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
