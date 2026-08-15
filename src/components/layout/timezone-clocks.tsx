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

export function TimezoneClocks() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  void tick;
  const ny = formatCity("America/New_York");
  const paris = formatCity("Europe/Paris");

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <div className="glass-chip flex items-center gap-2 px-2.5 py-1.5 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
        <Clock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        <span className="font-medium text-slate-800 dark:text-slate-100">NY</span>
        <span>{ny.time}</span>
        <span className="text-slate-400 dark:text-slate-500">{ny.day}</span>
      </div>
      <div className="glass-chip flex items-center gap-2 px-2.5 py-1.5 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
        <span className="font-medium text-slate-800 dark:text-slate-100">Paris</span>
        <span>{paris.time}</span>
        <span className="text-slate-400 dark:text-slate-500">{paris.day}</span>
      </div>
    </div>
  );
}
