"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssociateOverview } from "@/lib/associate/scope";
import type { DateRange } from "@/components/phoenix/date-range-picker";
import { reportToday } from "@/lib/report-tz";

const RANGE_KEY = "msgate-associate-range";
const LAST_KEY = "msgate-associate-last";

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

/** Les derniers chiffres vus pour cette période, gardés dans le navigateur : affichés aussitôt à l'ouverture. */
function readLast(range: DateRange): { overview: AssociateOverview; at: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY) || "null") as { key: string; at: number; overview: AssociateOverview } | null;
    return saved && saved.key === `${range.start}:${range.end}` ? { overview: saved.overview, at: saved.at } : null;
  } catch {
    return null;
  }
}

function writeLast(range: DateRange, overview: AssociateOverview) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ key: `${range.start}:${range.end}`, at: Date.now(), overview }));
  } catch {
    // stockage plein ou refusé : sans importance
  }
}

/**
 * Les chiffres de la vue Associé, partagés par ses onglets.
 *
 * Rapide d'abord : les derniers chiffres vus s'affichent tout de suite, puis
 * se mettent à jour. La plage de dates est gardée dans le navigateur. Tant que
 * la période contient aujourd'hui, les chiffres se relisent toutes les 15 s
 * (le serveur relit Shopify toutes les 30 s et Meta chaque minute). Le bouton
 * Synchroniser — celui de la page comme celui de l'en-tête — force une
 * relecture immédiate de Shopify et Meta.
 */
export function useAssociateOverview() {
  const [range, setRangeState] = useState<DateRange>(() => loadRange());
  const [overview, setOverview] = useState<AssociateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const setRange = useCallback((next: DateRange) => {
    setRangeState(next);
    setLoading(true);
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(next));
    } catch {
      // sans importance
    }
  }, []);

  const load = useCallback(async (current: DateRange, force = false) => {
    if (force) setSyncing(true);
    try {
      const res = await fetch(`/api/associate/overview?start=${current.start}&end=${current.end}${force ? "&force=1" : ""}`, { cache: "no-store" });
      const body = (await res.json()) as { overview?: AssociateOverview; error?: string };
      if (!res.ok || !body.overview) throw new Error(body.error || `HTTP ${res.status}`);
      setOverview(body.overview);
      setError(null);
      setLoadedAt(Date.now());
      writeLast(current, body.overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tableau de bord indisponible");
    } finally {
      setLoading(false);
      if (force) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const last = readLast(range);
      if (last) {
        setOverview(last.overview);
        setLoadedAt(last.at);
        setLoading(false);
      }
      void load(range);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [range, load]);

  // Le bouton Actualiser de l'en-tête : sur ces pages, il resynchronise au lieu de recharger la page.
  useEffect(() => {
    const onRefresh = (event: Event) => {
      event.preventDefault();
      void load(range, true);
    };
    window.addEventListener("msgate:refresh", onRefresh);
    return () => window.removeEventListener("msgate:refresh", onRefresh);
  }, [range, load]);

  const building = Boolean(overview?.phoenix.building || overview?.phoenix.progress?.running);
  useEffect(() => {
    const today = reportToday();
    const live = range.start <= today && range.end >= today;
    if (!live && !building) return;
    const timer = window.setInterval(() => void load(range), 15_000);
    return () => window.clearInterval(timer);
  }, [range, load, building]);

  return { range, setRange, overview, loading: loading || syncing, error, loadedAt, building, syncing, refresh: () => void load(range, true) };
}
