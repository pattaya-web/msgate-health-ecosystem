"use client";

import { useEffect, useState } from "react";

/**
 * Each source reports in its own timezone: Phoenix bills on US time while Meta
 * and Shopify are configured on Paris time. Showing both avoids reading a day
 * boundary from the wrong clock.
 */
const SOURCES = [
  { name: "Phoenix", country: "us", timeZone: "America/New_York", city: "New York" },
  { name: "Meta", country: "fr", timeZone: "Europe/Paris", city: "Paris" },
  { name: "Shopify", country: "fr", timeZone: "Europe/Paris", city: "Paris" },
] as const;

/**
 * Windows has no glyphs for regional-indicator flag emoji, so countries are
 * shown as coloured dots instead: red for the US, blue for France.
 */
type Country = "us" | "fr";

const DOT_COLORS: Record<Country, string> = {
  us: "bg-red-500",
  fr: "bg-blue-600",
};

function Dot({ country }: { country: Country }) {
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10 ${DOT_COLORS[country]}`}
    />
  );
}

function clock(timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export type TzSource = "phoenix" | "meta" | "shopify" | "mixed";

const BADGES: Record<TzSource, { countries: Country[]; code: string; title: string }> = {
  phoenix: { countries: ["us"], code: "US", title: "Phoenix — heure de New York" },
  meta: { countries: ["fr"], code: "FR", title: "Meta — heure de Paris" },
  shopify: { countries: ["fr"], code: "FR", title: "Shopify — heure de Paris" },
  mixed: {
    countries: ["us", "fr"],
    code: "US + FR",
    title: "Phoenix en heure de New York, Meta et Shopify en heure de Paris",
  },
};

/** Marks which clock a section is read on, so day boundaries are never guessed. */
export function TzBadge({ source, className }: { source: TzSource; className?: string }) {
  const badge = BADGES[source];
  return (
    <span
      title={badge.title}
      className={`inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1 py-px text-[9px] font-semibold leading-none text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 ${className || ""}`}
    >
      {badge.countries.map((country) => (
        <Dot key={country} country={country} />
      ))}
      {badge.code}
    </span>
  );
}

export function SourceClocks() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SOURCES.map((source) => (
        <span
          key={source.name}
          title={`${source.name} — fuseau ${source.city} (${source.timeZone})`}
          className="flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-white px-1.5 py-1 text-[10px] dark:border-slate-800 dark:bg-slate-900/60"
        >
          <Dot country={source.country} />
          <span className="font-semibold text-slate-700 dark:text-slate-200">{source.name}</span>
          <span className="tabular-nums text-slate-500 dark:text-slate-400">
            {clock(source.timeZone)}
          </span>
          <span className="text-slate-400">{source.city}</span>
        </span>
      ))}
    </div>
  );
}
