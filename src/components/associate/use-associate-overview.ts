"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssociateOverview } from "@/lib/associate/scope";
import type { DateRange } from "@/components/phoenix/date-range-picker";
import { reportToday } from "@/lib/report-tz";

const RANGE_KEY = "msgate-associate-range";

function monthRange(): DateRange {
  const today = reportToday();
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

function loadRange(): DateRange {
  if (typeof window === "undefined") return monthRange();
  try {
    const parsed = JSON.parse(localStorage.getItem(RANGE_KEY) || "null") as DateRange | null;
    if (parsed?.start && parsed?.end && /^\d{4}-\d{2}-\d{2}$/.test(parsed.start) && /^\d{4}-\d{2}-\d{2}$/.test(parsed.end)) return parsed;
  } catch {
    // première visite
  }
  return monthRange();
}

/**
 * Les chiffres de la vue Associé, partagés par ses deux onglets.
 *
 * La plage de dates est gardée dans le navigateur : passer de « Ventes » à
 * « Profit » garde la même période. Tant que la période contient aujourd'hui,
 * les chiffres se relisent toutes les minutes (le serveur resynchronise Reign,
 * Shopify et Meta toutes les 2) ; pendant une synchro, toutes les 15 s.
 */
export function useAssociateOverview() {
  const [range, setRangeState] = useState<DateRange>(() => loadRange());
  const [overview, setOverview] = useState<AssociateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const setRange = useCallback((next: DateRange) => {
    setRangeState(next);
    setLoading(true);
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(next));
    } catch {
      // sans importance
    }
  }, []);

  const load = useCallback(async (current: DateRange) => {
    try {
      const res = await fetch(`/api/associate/overview?start=${current.start}&end=${current.end}`, { cache: "no-store" });
      const body = (await res.json()) as { overview?: AssociateOverview; error?: string };
      if (!res.ok || !body.overview) throw new Error(body.error || `HTTP ${res.status}`);
      setOverview(body.overview);
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tableau de bord indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(range), 0);
    return () => window.clearTimeout(timer);
  }, [range, load]);

  const building = Boolean(overview?.phoenix.building || overview?.phoenix.progress?.running);
  useEffect(() => {
    const today = reportToday();
    const live = range.start <= today && range.end >= today;
    if (!live && !building) return;
    const timer = window.setInterval(() => void load(range), building ? 15_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [range, load, building]);

  return { range, setRange, overview, loading, error, loadedAt, building, refresh: () => void load(range) };
}
