"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker, type DateRange } from "@/components/phoenix/date-range-picker";

export const usd = (value: number, digits = 2) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

export const usdShort = (value: number) => (Math.abs(value) >= 10_000 ? usd(value, 0) : usd(value));

export const pct = (value: number, digits = 1) => `${value.toFixed(digits).replace(".", ",")} %`;

export const ratio = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(2).replace(".", ",")}×`);

/** « il y a 3 min », à partir d'une date locale de Paris (« YYYY-MM-DDTHH:mm:ss ») ou ISO. */
export function ago(value: string | number | null, now: number) {
  if (value == null) return "—";
  const at = typeof value === "number" ? value : parisLocalToMs(value);
  if (!Number.isFinite(at)) return "—";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

const PARIS_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Une heure locale de Paris sans fuseau (« 2026-10-31T00:16:34 »), convertie en
 * instant : on lit l'heure comme si c'était de l'UTC, on mesure le décalage de
 * Paris à ce moment-là (1 ou 2 h selon la saison), puis on le retire.
 */
function parisLocalToMs(value: string) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return Date.parse(value);
  const asUtc = Date.parse(`${value}Z`);
  if (!Number.isFinite(asUtc)) return NaN;
  const parts = Object.fromEntries(PARIS_PARTS.formatToParts(new Date(asUtc)).map((part) => [part.type, Number(part.value)]));
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - (wallAsUtc - asUtc);
}

/** L'heure qui passe, pour les « il y a… », sans re-render inutile : toutes les 30 s. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function AssociateHeader({
  title,
  subtitle,
  shop,
  range,
  onRange,
  loading,
  onRefresh,
  liveAt,
  now,
}: {
  title: string;
  subtitle: string;
  shop: string | null;
  range: DateRange;
  onRange: (next: DateRange) => void;
  loading: boolean;
  onRefresh: () => void;
  liveAt: string | number | null;
  now: number;
}) {
  return (
    <div className="r-rise flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {shop ? (
            <span className="r-chip">
              <Store className="h-3.5 w-3.5" />
              {shop}
            </span>
          ) : null}
          <span className="r-chip" title="Ventes Shopify, Reign et dépense Meta relues toutes les 2 minutes">
            <span className="r-live-dot" />
            Temps réel · {ago(liveAt, now)}
          </span>
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
          {title}
        </h1>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          {subtitle}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="r-icon h-10 w-10 rounded-full transition-transform hover:scale-105 active:scale-95"
          aria-label="Actualiser"
          title="Actualiser"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
        <DateRangePicker value={range} onChange={onRange} />
      </div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  icon,
  tone,
  delay = 0,
  children,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  icon: ReactNode;
  tone?: "good" | "warn" | "bad";
  delay?: number;
  children?: ReactNode;
}) {
  const color = tone === "good" ? "var(--r-good)" : tone === "warn" ? "var(--r-warn)" : tone === "bad" ? "var(--r-bad)" : "var(--ink)";
  return (
    <div className="r-card r-rise p-4" data-hover="lift" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="r-label">{label}</span>
        <span className="r-icon">{icon}</span>
      </div>
      <p className="r-value mt-3" style={{ color }}>
        {value}
      </p>
      {sub ? <p className="r-sub mt-1.5">{sub}</p> : null}
      {children}
    </div>
  );
}
