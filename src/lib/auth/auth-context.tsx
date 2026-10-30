"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AppUser } from "@/types";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  canWrite: boolean;
  isAdmin: boolean;
  /** Accès Associé : ne voit que la page Straight Sale (vrai associé, ou admin en « Vue Alison »). */
  isAssociate: boolean;
  /** L'admin regarde l'application comme l'associé la voit. */
  previewAssociate: boolean;
  setPreviewAssociate: (on: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "msgate_auth_user";
const PREVIEW_KEY = "msgate-preview-associate";

/**
 * L'état de connexion côté interface.
 *
 * La vérité est le cookie de session posé par /api/auth/login ; le
 * localStorage ne sert qu'à afficher l'utilisateur sans attendre. Au chargement
 * on demande /api/auth/me : si la session n'est plus valable, on efface la
 * copie locale et l'utilisateur repasse par le login au lieu de voir des
 * écrans qui échouent en 401.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  // L'interface n'est rendue qu'une fois la session relue côté client : lire le stockage ici ne décale pas l'hydratation.
  const [preview, setPreview] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(PREVIEW_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let alive = true;
    let cached: AppUser | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) cached = JSON.parse(raw) as AppUser;
    } catch {
      cached = null;
    }
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (res.ok) {
          const body = (await res.json()) as { user: AppUser };
          setUser(body.user);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(body.user));
          } catch {
            // stockage indisponible : sans importance
          }
        } else {
          setUser(null);
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            // sans importance
          }
        }
      })
      .catch(() => {
        // Serveur injoignable : on garde la copie locale pour ne pas éjecter à tort.
        if (alive) setUser(cached);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      canWrite: user?.role === "admin" || user?.role === "operator",
      isAdmin: user?.role === "admin",
      isAssociate: user?.role === "associate" || (user?.role === "admin" && preview),
      previewAssociate: user?.role === "admin" && preview,
      setPreviewAssociate(on) {
        setPreview(on);
        try {
          if (on) localStorage.setItem(PREVIEW_KEY, "1");
          else localStorage.removeItem(PREVIEW_KEY);
        } catch {
          // la vue tient pour la session
        }
      },
      async login(email, password) {
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const body = (await res.json()) as { user?: AppUser; error?: string };
          if (!res.ok || !body.user) return { ok: false, error: body.error || "Connexion refusée" };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(body.user));
          } catch {
            // sans importance
          }
          setUser(body.user);
          return { ok: true };
        } catch {
          return { ok: false, error: "Serveur injoignable" };
        }
      },
      logout() {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // sans importance
        }
        setUser(null);
        void fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      },
    }),
    [user, loading, preview]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
