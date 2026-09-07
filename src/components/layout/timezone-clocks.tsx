"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

function formatCity(timeZone: string) {
  const now = new Date();
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
  }).format(now);
  return { time, day };
}

/**
 * Windows n'a aucun glyphe pour les emoji drapeaux : 🇺🇸 s'y affiche en deux
 * carrés « US ». Les drapeaux sont donc dessinés en SVG inline, ce qui rend à
 * l'identique partout et reste net à toute taille.
 */
type Country = "us" | "fr" | "ae";

const FLAGS: Record<Country, { label: string; shapes: React.ReactNode }> = {
  us: {
    label: "États-Unis",
    shapes: (
      <>
        <rect width="24" height="16" fill="#fff" />
        {[0, 2, 4, 6, 8, 10, 12].map((band) => (
          <rect key={band} y={(band * 16) / 13} width="24" height={16 / 13} fill="#b22234" />
        ))}
        <rect width="10" height={(16 / 13) * 7} fill="#3c3b6e" />
      </>
    ),
  },
  fr: {
    label: "France",
    shapes: (
      <>
        <rect width="8" height="16" fill="#002395" />
        <rect x="8" width="8" height="16" fill="#fff" />
        <rect x="16" width="8" height="16" fill="#ed2939" />
      </>
    ),
  },
  ae: {
    label: "Émirats arabes unis",
    shapes: (
      <>
        <rect width="24" height="5.34" fill="#00732f" />
        <rect y="5.34" width="24" height="5.33" fill="#fff" />
        <rect y="10.67" width="24" height="5.33" fill="#000" />
        <rect width="7" height="16" fill="#ff0000" />
      </>
    ),
  },
};

function Flag({ country }: { country: Country }) {
  const flag = FLAGS[country];
  return (
    <svg
      viewBox="0 0 24 16"
      role="img"
      aria-label={flag.label}
      className="h-3 w-[18px] shrink-0 rounded-[2px] ring-1 ring-inset ring-black/15"
    >
      {flag.shapes}
    </svg>
  );
}

const CITIES = [
  { country: "us" as const, label: "NY", timeZone: "America/New_York" },
  { country: "fr" as const, label: "Paris", timeZone: "Europe/Paris" },
  { country: "ae" as const, label: "Dubai", timeZone: "Asia/Dubai" },
];

export function TimezoneClocks() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  void tick;

  return (
    <div className="hidden items-center gap-2 sm:flex">
      {CITIES.map((city, index) => {
        const { time, day } = formatCity(city.timeZone);
        return (
          <div
            key={city.label}
            title={city.timeZone}
            className="glass-chip flex items-center gap-2 px-2.5 py-1.5 text-[11px] tabular-nums text-slate-600 dark:text-slate-300"
          >
            {/* L'icône horloge n'apparaît que sur la première puce, en repère. */}
            {index === 0 ? <Clock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : null}
            <Flag country={city.country} />
            <span className="font-medium text-slate-800 dark:text-slate-100">{city.label}</span>
            <span>{time}</span>
            <span className="text-slate-400 dark:text-slate-500">{day}</span>
          </div>
        );
      })}
    </div>
  );
}
