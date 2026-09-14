"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { PageContext, PageType } from "@/lib/ask-hermes/types";

/**
 * Ce que le panneau Hermes sait de la page ouverte.
 *
 * Les écrans du CRM gardent leur sélection en état local (produit du Mass
 * test, créa ouverte, pub ouverte…). Plutôt que de remonter cet état, chaque
 * écran publie ici les ids et noms qu'il connaît, sous une clé qui lui est
 * propre ; il les retire en se démontant. Le contexte est la fusion de ces
 * publications plus la route. Rien n'est deviné : un champ absent est absent.
 */

type Sources = Record<string, Partial<PageContext>>;

type ContextValue = {
  context: PageContext;
  publish: (key: string, value: Partial<PageContext> | null) => void;
};

const Ctx = createContext<ContextValue | null>(null);

export function pageTypeFor(pathname: string): PageType {
  const path = pathname || "/";
  if (path === "/") return "dashboard";
  if (path.startsWith("/ads-uploader")) return "ads-uploader";
  if (path.startsWith("/ads")) return "ads";
  if (path.startsWith("/studio/mass-test")) return "mass-test";
  if (path.startsWith("/studio/library")) return "studio-library";
  if (path.startsWith("/studio")) return "studio";
  if (path.startsWith("/ugc")) return "ugc";
  if (path.startsWith("/drive")) return "drive";
  if (path.startsWith("/bank-pages")) return "bank-pages";
  if (path.startsWith("/spyshop")) return "spyshop";
  if (path.startsWith("/phoenix")) return "phoenix";
  if (path.startsWith("/profit")) return "profit";
  if (path.startsWith("/sav")) return "sav";
  if (path.startsWith("/ecosystem")) return "ecosystem";
  if (path.startsWith("/shopify-scraper")) return "shopify";
  if (path.startsWith("/product-images")) return "product-images";
  return "other";
}

export function HermesPageContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [sources, setSources] = useState<Sources>({});

  const publish = useCallback((key: string, value: Partial<PageContext> | null) => {
    setSources((current) => {
      if (value === null) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: value };
    });
  }, []);

  const context = useMemo<PageContext>(() => {
    const merged: PageContext = { route: pathname, pageType: pageTypeFor(pathname) };
    for (const source of Object.values(sources)) {
      for (const [field, raw] of Object.entries(source)) {
        if (raw === undefined || raw === null || raw === "") continue;
        (merged as unknown as Record<string, unknown>)[field] = raw;
      }
    }
    return merged;
  }, [pathname, sources]);

  const value = useMemo(() => ({ context, publish }), [context, publish]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const EMPTY: PageContext = { route: "", pageType: "other" };

export function useHermesPageContext(): PageContext {
  return useContext(Ctx)?.context ?? EMPTY;
}

/**
 * Publie ce qu'un écran sait, tant qu'il est monté. `value` null retire la
 * publication. Comparé sérialisé : republier le même objet ne relance rien.
 */
export function usePublishHermesContext(key: string, value: Partial<PageContext> | null) {
  const publish = useContext(Ctx)?.publish;
  const serialized = JSON.stringify(value ?? null);
  useEffect(() => {
    if (!publish) return;
    publish(key, serialized === "null" ? null : (JSON.parse(serialized) as Partial<PageContext>));
    return () => publish(key, null);
  }, [publish, key, serialized]);
}
