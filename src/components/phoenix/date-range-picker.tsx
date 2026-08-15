"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact replacement for the pair of native date inputs, which are wide,
 * differently styled on every browser and unreadable on Windows.
 *
 * Everything is handled as YYYY-MM-DD in UTC, like the rest of the cockpit, so
 * no local-timezone drift can shift a day boundary.
 */

export type DateRange = { start: string; end: string };

const DAY_MS = 86_400_000;
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

const toKey = (date: Date) => date.toISOString().slice(0, 10);
const fromKey = (key: string) => new Date(`${key}T00:00:00.000Z`);

const monthLabel = (date: Date) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);

function shortLabel(key: string, withYear: boolean) {
  if (!key) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  })
    .format(fromKey(key))
    .replace(".", "");
}

function addDays(key: string, days: number) {
  return toKey(new Date(fromKey(key).getTime() + days * DAY_MS));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Last N complete days, today excluded, matching the calculators' presets. */
function lastDays(days: number): DateRange {
  const end = addDays(todayKey(), -1);
  return { start: addDays(end, -(days - 1)), end };
}

function monthRange(offset: number): DateRange {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { start: toKey(start), end: toKey(end) };
}

const PRESETS: Array<{ label: string; build: () => DateRange }> = [
  { label: "Aujourd'hui", build: () => ({ start: todayKey(), end: todayKey() }) },
  { label: "Hier", build: () => lastDays(1) },
  { label: "7 j", build: () => lastDays(7) },
  { label: "14 j", build: () => lastDays(14) },
  { label: "30 j", build: () => lastDays(30) },
  { label: "Ce mois", build: () => monthRange(0) },
  { label: "Mois dernier", build: () => monthRange(-1) },
];

/** Six weeks of cells so the grid never changes height between months. */
function monthMatrix(cursor: Date) {
  const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const origin = first.getTime() - offset * DAY_MS;

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(origin + index * DAY_MS);
    return {
      key: toKey(date),
      day: date.getUTCDate(),
      outside: date.getUTCMonth() !== cursor.getUTCMonth(),
    };
  });
}

export function DateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => fromKey(value.start || todayKey()));
  /** Set while picking, before the second click closes the range. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const cells = useMemo(() => monthMatrix(cursor), [cursor]);

  // While picking, preview the range the next click would produce.
  const preview: DateRange = anchor
    ? {
        start: hovered && hovered < anchor ? hovered : anchor,
        end: hovered && hovered < anchor ? anchor : hovered || anchor,
      }
    : value;

  const sameYear = value.start.slice(0, 4) === value.end.slice(0, 4);
  const currentYear = String(new Date().getUTCFullYear());

  const pick = (key: string) => {
    if (!anchor) {
      setAnchor(key);
      return;
    }
    const next = key < anchor ? { start: key, end: anchor } : { start: anchor, end: key };
    setAnchor(null);
    setHovered(null);
    onChange(next);
    setOpen(false);
  };

  const applyPreset = (range: DateRange) => {
    setAnchor(null);
    setHovered(null);
    setCursor(fromKey(range.start));
    onChange(range);
    setOpen(false);
  };

  const shiftMonth = (delta: number) =>
    setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + delta, 1)));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setAnchor(null);
          setHovered(null);
        } else {
          setCursor(fromKey(value.start || todayKey()));
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-700 ring-1 ring-slate-900/[0.08] transition-all duration-200 hover:bg-slate-50 data-[state=open]:ring-slate-900/25 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/[0.08] dark:hover:bg-slate-800",
            className
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="tabular-nums">
            {shortLabel(value.start, !sameYear)} – {shortLabel(value.end, value.end.slice(0, 4) !== currentYear)}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[268px] rounded-2xl bg-white p-2.5 shadow-[0_12px_32px_rgba(16,24,40,0.14)] ring-1 ring-slate-900/[0.08] focus:outline-none dark:bg-slate-900 dark:ring-white/[0.08]"
        >
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.build())}
                className="rounded-lg bg-slate-100/80 px-2 py-1 text-[10px] font-medium text-slate-600 transition-colors hover:bg-slate-900 hover:text-white dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-100 dark:hover:text-slate-900"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-2.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Mois précédent"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-semibold capitalize text-slate-800 dark:text-slate-100">
              {monthLabel(cursor)}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Mois suivant"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-1.5 grid grid-cols-7">
            {WEEKDAYS.map((day, index) => (
              <span
                key={`${day}-${index}`}
                className="pb-1 text-center text-[9px] font-medium uppercase text-slate-400"
              >
                {day}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHovered(null)}>
            {cells.map((cell) => {
              const inRange = cell.key >= preview.start && cell.key <= preview.end;
              const isStart = cell.key === preview.start;
              const isEnd = cell.key === preview.end;
              const isToday = cell.key === todayKey();
              const edge = isStart || isEnd;

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => pick(cell.key)}
                  onMouseEnter={() => anchor && setHovered(cell.key)}
                  className={cn(
                    "relative h-7 text-[11px] tabular-nums transition-colors",
                    inRange && !edge && "bg-slate-100 dark:bg-slate-800",
                    isStart && "rounded-l-lg",
                    isEnd && "rounded-r-lg",
                    edge
                      ? "z-10 rounded-lg bg-slate-900 font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
                      : cell.outside
                        ? "text-slate-300 hover:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-800"
                        : "text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-700",
                    !edge && isToday && "font-semibold text-slate-900 dark:text-slate-50"
                  )}
                >
                  {cell.day}
                  {isToday && !edge ? (
                    <span className="absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-slate-900 dark:bg-slate-100" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <p className="mt-2 border-t border-slate-900/[0.06] pt-2 text-[10px] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
            {anchor
              ? `Début ${shortLabel(anchor, false)} — choisis la fin`
              : `${shortLabel(value.start, false)} au ${shortLabel(value.end, false)}`}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
