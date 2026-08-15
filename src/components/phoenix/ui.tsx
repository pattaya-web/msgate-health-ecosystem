"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TzBadge, type TzSource } from "@/components/phoenix/source-clocks";

/**
 * Shared surface language for the STATS screens: soft rings instead of hard
 * borders, generous radii, one accent per data source, and a hover lift that
 * makes the whole page feel alive rather than printed.
 */

export type Accent = "slate" | "indigo" | "sky" | "emerald" | "violet" | "amber" | "rose";

export const ACCENTS: Record<
  Accent,
  { tint: string; ring: string; text: string; soft: string; dot: string; bar: string }
> = {
  slate: {
    tint: "from-slate-50 to-white dark:from-slate-800/40 dark:to-slate-900/60",
    ring: "ring-slate-900/[0.06] dark:ring-white/[0.06]",
    text: "text-slate-900 dark:text-slate-50",
    soft: "text-slate-500 dark:text-slate-400",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
  },
  indigo: {
    tint: "from-indigo-50/80 to-white dark:from-indigo-500/10 dark:to-slate-900/60",
    ring: "ring-indigo-500/15 dark:ring-indigo-400/20",
    text: "text-indigo-950 dark:text-indigo-50",
    soft: "text-indigo-700/70 dark:text-indigo-300/80",
    dot: "bg-indigo-500",
    bar: "bg-indigo-500",
  },
  sky: {
    tint: "from-sky-50/80 to-white dark:from-sky-500/10 dark:to-slate-900/60",
    ring: "ring-sky-500/15 dark:ring-sky-400/20",
    text: "text-sky-950 dark:text-sky-50",
    soft: "text-sky-700/70 dark:text-sky-300/80",
    dot: "bg-sky-500",
    bar: "bg-sky-500",
  },
  emerald: {
    tint: "from-emerald-50/80 to-white dark:from-emerald-500/10 dark:to-slate-900/60",
    ring: "ring-emerald-500/15 dark:ring-emerald-400/20",
    text: "text-emerald-950 dark:text-emerald-50",
    soft: "text-emerald-700/70 dark:text-emerald-300/80",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
  },
  violet: {
    tint: "from-violet-50/80 to-white dark:from-violet-500/10 dark:to-slate-900/60",
    ring: "ring-violet-500/15 dark:ring-violet-400/20",
    text: "text-violet-950 dark:text-violet-50",
    soft: "text-violet-700/70 dark:text-violet-300/80",
    dot: "bg-violet-500",
    bar: "bg-violet-500",
  },
  amber: {
    tint: "from-amber-50 to-white dark:from-amber-500/10 dark:to-slate-900/60",
    ring: "ring-amber-500/20 dark:ring-amber-400/25",
    text: "text-amber-950 dark:text-amber-50",
    soft: "text-amber-800/70 dark:text-amber-300/80",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
  },
  rose: {
    tint: "from-rose-50/80 to-white dark:from-rose-500/10 dark:to-slate-900/60",
    ring: "ring-rose-500/15 dark:ring-rose-400/20",
    text: "text-rose-950 dark:text-rose-50",
    soft: "text-rose-700/70 dark:text-rose-300/80",
    dot: "bg-rose-500",
    bar: "bg-rose-500",
  },
};

const SHADOW = "shadow-[0_1px_2px_rgba(16,24,40,0.05),0_1px_3px_rgba(16,24,40,0.04)]";
const SHADOW_HOVER = "hover:shadow-[0_4px_12px_rgba(16,24,40,0.07)]";

/** Base card. Everything on the page sits on one of these. */
export function Surface({
  accent = "slate",
  plain,
  interactive = true,
  className,
  children,
}: {
  accent?: Accent;
  /** Flat white instead of the accent wash. */
  plain?: boolean;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const tone = ACCENTS[accent];
  return (
    <div
      className={cn(
        "rounded-2xl ring-1 transition-all duration-200",
        SHADOW,
        interactive && SHADOW_HOVER,
        tone.ring,
        plain
          ? "bg-white dark:bg-slate-900/70"
          : cn("bg-gradient-to-b", tone.tint),
        className
      )}
    >
      {children}
    </div>
  );
}

/** Small uppercase eyebrow with a colour cue and optional timezone badge. */
export function PanelTitle({
  children,
  accent = "slate",
  source,
  right,
  className,
}: {
  children: ReactNode;
  accent?: Accent;
  source?: TzSource;
  right?: ReactNode;
  className?: string;
}) {
  const tone = ACCENTS[accent];
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
      <p
        className={cn(
          "min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.06em]",
          tone.soft
        )}
      >
        {children}
      </p>
      {source ? <TzBadge source={source} className="shrink-0" /> : null}
      {right ? <div className="ml-auto shrink-0">{right}</div> : null}
    </div>
  );
}

/** Headline number with its label and a line of context underneath. */
export function KpiCard({
  label,
  value,
  sub,
  accent = "slate",
  source,
  size = "md",
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  accent?: Accent;
  source?: TzSource;
  size?: "sm" | "md" | "lg";
  valueClassName?: string;
}) {
  const tone = ACCENTS[accent];
  return (
    <Surface accent={accent} className="min-w-0 p-3">
      <PanelTitle accent={accent} source={source}>
        {label}
      </PanelTitle>
      <p
        className={cn(
          "mt-1.5 truncate font-semibold leading-none tracking-tight tabular-nums",
          size === "lg" ? "text-[26px]" : size === "sm" ? "text-lg" : "text-[22px]",
          valueClassName || tone.text
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-1.5 truncate text-[11px] leading-tight text-slate-500 dark:text-slate-400">
          {sub}
        </p>
      ) : null}
    </Surface>
  );
}

/** Compact metric for dense grids, without the card wash. */
export function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Surface plain className="min-w-0 px-2.5 py-2">
      <p className="truncate text-[10px] leading-tight text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate text-[15px] font-semibold leading-none tabular-nums",
          tone || "text-slate-900 dark:text-slate-50"
        )}
      >
        {value}
      </p>
    </Surface>
  );
}

/** Pill switcher used for tabs, presets and scopes. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  accent = "emerald",
  size = "md",
  className,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  accent?: Accent;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex gap-0.5 rounded-xl bg-slate-100/80 p-1 dark:bg-slate-800/70",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "whitespace-nowrap rounded-lg font-medium transition-all duration-200",
              size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
              active
                ? cn(
                    "bg-white shadow-sm dark:bg-slate-900",
                    accent === "slate"
                      ? "text-slate-900 dark:text-slate-50"
                      : ACCENTS[accent].soft.replace("/70", "").replace("/80", "")
                  )
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Labelled number input matching the surface language. */
export function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  auto,
  hint,
  width,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  prefix?: string;
  suffix?: string;
  auto?: boolean;
  hint?: ReactNode;
  width?: string;
}) {
  return (
    <label className={cn("min-w-0", width)}>
      <span className="flex items-center gap-1.5 text-[11px] leading-tight text-slate-500 dark:text-slate-400">
        <span className="truncate">{label}</span>
        {auto ? (
          <span className="ml-auto shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-300">
            auto
          </span>
        ) : null}
      </span>
      <span className="mt-1 flex h-9 items-center rounded-xl bg-white px-2.5 ring-1 ring-slate-900/[0.08] transition-all duration-200 focus-within:ring-2 focus-within:ring-emerald-500/40 dark:bg-slate-900 dark:ring-white/[0.08]">
        {prefix ? (
          <span className="shrink-0 pr-1.5 text-xs text-slate-400">{prefix}</span>
        ) : null}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium tabular-nums text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-300 dark:text-slate-50"
        />
        {suffix ? (
          <span className="shrink-0 pl-1.5 text-xs text-slate-400">{suffix}</span>
        ) : null}
      </span>
      {hint ? (
        <span className="mt-1 block text-[10px] leading-tight text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Composition read as one bar plus a legend rather than a table: same detail,
 * roughly half the height, and the share of each slice becomes obvious.
 */
export function SplitBar({
  items,
  total,
  format,
  columns = 2,
}: {
  items: Array<{ label: string; value: number; color: string }>;
  total: number;
  format: (value: number) => string;
  columns?: 1 | 2;
}) {
  const safeTotal = total > 0 ? total : 0;
  const visible = items.filter((item) => item.value > 0);

  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {visible.map((item) => (
          <span
            key={item.label}
            title={`${item.label} — ${format(item.value)}`}
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${safeTotal > 0 ? (item.value / safeTotal) * 100 : 0}%`,
              background: item.color,
            }}
          />
        ))}
      </div>

      <div className={cn("grid gap-x-3 gap-y-1", columns === 2 && "sm:grid-cols-2")}>
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline gap-1.5">
            <span
              className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
              style={{ background: item.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {item.label}
            </span>
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-800 dark:text-slate-100">
              {format(item.value)}
            </span>
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
              {safeTotal > 0 ? `${Math.round((item.value / safeTotal) * 100)} %` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Neutral button that reads as secondary next to the emerald primary. */
export function GhostButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-xl bg-white px-2.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-900/[0.08] transition-all duration-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-white/[0.08] dark:hover:bg-slate-800",
        className
      )}
    >
      {children}
    </button>
  );
}
