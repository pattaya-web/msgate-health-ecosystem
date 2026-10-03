"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionName } from "./types";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `Erreur ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

/**
 * Cache memoire partage entre les pages.
 *
 * Sans lui, changer d'onglet retelechargeait chaque collection depuis zero —
 * plusieurs centaines de kilo-octets a chaque navigation. On affiche donc
 * immediatement ce qu'on avait, puis on revalide en fond.
 */
const CACHE = new Map<string, unknown[]>();

/*
 * Copie persistante dans le navigateur.
 *
 * Depuis Dubai, chaque aller-retour vers le serveur (Paris) coute 300 ms :
 * une page qui attend ses collections reste vide une bonne seconde. On garde
 * donc la derniere version de chaque collection dans localStorage : au retour
 * sur le site, l'ecran se remplit instantanement avec elle, puis le serveur
 * la remplace des qu'il repond. Les collections trop lourdes (au-dela de
 * 1,5 Mo) ne sont pas persistees pour rester sous le quota du navigateur.
 */
const PERSIST_PREFIX = "col:";
const PERSIST_MAX = 1_500_000;

function readPersisted(key: string): unknown[] | null {
  try {
    const raw = window.localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persist(key: string, rows: unknown[]) {
  try {
    const raw = JSON.stringify(rows);
    if (raw.length > PERSIST_MAX) {
      window.localStorage.removeItem(PERSIST_PREFIX + key);
      return;
    }
    window.localStorage.setItem(PERSIST_PREFIX + key, raw);
  } catch {
    // Quota atteint ou stockage indisponible : le cache memoire suffit.
  }
}

/** Vide le cache d'une collection, ou tout le cache. */
export function invalidate(name?: CollectionName) {
  if (!name) CACHE.clear();
  else for (const k of [...CACHE.keys()]) if (k.startsWith(name)) CACHE.delete(k);
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith(PERSIST_PREFIX) && (!name || k.startsWith(PERSIST_PREFIX + name))) {
        window.localStorage.removeItem(k);
      }
    }
  } catch {
    // Ignore.
  }
}

/**
 * Accès CRUD à une collection. Optimiste sur les mutations pour que l'UI
 * reste réactive, avec resynchronisation depuis la réponse serveur.
 *
 * `light` demande la version allegee : le serveur retire les champs lourds
 * (transcriptions, plans de tournage) dont les listes n'ont pas besoin.
 */
export function useCollection<T extends { id: string }>(
  name: CollectionName,
  opts: { light?: boolean } = {},
) {
  const light = Boolean(opts.light);
  const key = light ? `${name}:light` : name;

  const [rows, setRows] = useState<T[]>(() => (CACHE.get(key) as T[]) ?? []);
  // Deja en cache : rien a attendre, l'ecran s'affiche tout de suite.
  const [loading, setLoading] = useState(!CACHE.has(key));

  // Copie persistante : affichee des le montage, en attendant le serveur.
  // (Apres l'hydratation, pour que serveur et client rendent la meme chose.)
  useEffect(() => {
    if (CACHE.has(key)) return;
    const saved = readPersisted(key) as T[] | null;
    if (saved && saved.length) {
      CACHE.set(key, saved);
      setRows(saved);
      setLoading(false);
    }
  }, [key]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api<T[]>(`/api/data/${name}${light ? "?light=1" : ""}`);
      CACHE.set(key, data);
      persist(key, data);
      setRows(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [name, key, light]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (row: Partial<T>) => {
      const created = await api<T>(`/api/data/${name}`, { method: "POST", body: JSON.stringify(row) });
      setRows((prev) => {
        const next = [created, ...prev];
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      return created;
    },
    [name, key],
  );

  const patch = useCallback(
    async (id: string, changes: Partial<T>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
      const saved = await api<T>(`/api/data/${name}`, {
        method: "PATCH",
        body: JSON.stringify({ id, ...changes }),
      });
      setRows((prev) => {
        const next = prev.map((r) => (r.id === id ? saved : r));
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      return saved;
    },
    [name, key],
  );

  const destroy = useCallback(
    async (id: string) => {
      setRows((prev) => {
        const next = prev.filter((r) => r.id !== id);
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      await api(`/api/data/${name}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    [name, key],
  );

  /** Suppression d'une selection, en un seul aller-retour. */
  const destroyMany = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const doomed = new Set(ids);
      setRows((prev) => {
        const next = prev.filter((r) => !doomed.has(r.id));
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      await api(`/api/data/${name}?ids=${encodeURIComponent(ids.join(","))}`, { method: "DELETE" });
    },
    [name, key],
  );

  /*
   * Objet memoise : un consommateur qui le met en dependance d'un effet ne
   * doit pas voir cet effet se relancer a chaque rendu. Il ne change que
   * quand les donnees ou l'etat de chargement changent reellement.
   */
  return useMemo(
    () => ({ rows, setRows, loading, error, reload, create, patch, destroy, destroyMany }),
    [rows, loading, error, reload, create, patch, destroy, destroyMany],
  );
}

/** Sauvegarde différée : évite un appel réseau à chaque frappe. */
export function useDebouncedSave<T>(save: (value: T) => void | Promise<void>, delay = 600) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return useCallback(
    (value: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(value), delay);
    },
    [delay],
  );
}

export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Stockage indisponible (navigation privée) : on garde la valeur initiale.
    }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignoré : ce n'est qu'un confort d'affichage.
    }
  }, [key, value, ready]);

  return [value, setValue] as const;
}

/* ------------------------------ Voix du Studio ------------------------------ */

export interface VoicesPayload {
  configured: boolean;
  engine?: "elevenlabs-sts" | "kie-tts" | null;
  voices: import("./studio-ia/types").VoiceInfo[];
  error?: string;
}

let voicesCache: { at: number; data: VoicesPayload } | null = null;
let voicesPending: Promise<VoicesPayload> | null = null;

/**
 * Liste des voix, partagee entre le Swap, la Photo qui parle et le choix de
 * voix d'un rendu : trois composants la demandaient chacun au montage.
 * Gardee cinq minutes ; `fresh` force un rechargement (apres un clonage).
 */
export function loadVoices(fresh = false): Promise<VoicesPayload> {
  if (!fresh && voicesCache && Date.now() - voicesCache.at < 5 * 60_000) return Promise.resolve(voicesCache.data);
  if (!voicesPending) {
    voicesPending = api<VoicesPayload>("/api/studio-ia/voices")
      .then((data) => {
        voicesCache = { at: Date.now(), data };
        return data;
      })
      .finally(() => { voicesPending = null; });
  }
  return voicesPending;
}

/** A appeler quand la liste change cote serveur (voix clonee ou supprimee). */
export function forgetVoices() {
  voicesCache = null;
}
