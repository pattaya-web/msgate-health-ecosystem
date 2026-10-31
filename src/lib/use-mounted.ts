"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * Vrai une fois le composant monté côté navigateur, faux au rendu serveur et
 * à l'hydratation. Sert aux portails (document.body n'existe pas côté
 * serveur), sans setState dans un effet.
 */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
