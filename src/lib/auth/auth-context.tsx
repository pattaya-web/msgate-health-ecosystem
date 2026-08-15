"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DEMO_CREDENTIALS, DEMO_USER } from "@/lib/mock/data";
import type { AppUser, UserRole } from "@/types";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  canWrite: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "msgate_auth_user";

function userFromEmail(email: string): AppUser {
  const normalized = email.toLowerCase();
  let role: UserRole = "viewer";
  let full_name = "Viewer User";
  if (normalized === DEMO_CREDENTIALS.email) {
    role = "admin";
    full_name = DEMO_USER.full_name;
  } else if (normalized === DEMO_CREDENTIALS.operatorEmail) {
    role = "operator";
    full_name = "Sam Operator";
  }
  return {
    id: `user-${role}`,
    email: normalized,
    full_name,
    role,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw) as AppUser);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      canWrite: user?.role === "admin" || user?.role === "operator",
      isAdmin: user?.role === "admin",
      async login(email, password) {
        const valid =
          (email === DEMO_CREDENTIALS.email && password === DEMO_CREDENTIALS.password) ||
          (email === DEMO_CREDENTIALS.operatorEmail &&
            password === DEMO_CREDENTIALS.operatorPassword) ||
          (email === DEMO_CREDENTIALS.viewerEmail && password === DEMO_CREDENTIALS.viewerPassword);

        // Also allow Supabase-style future login path: if NEXT_PUBLIC_SUPABASE_URL is set,
        // demo credentials still work offline for local development.
        if (!valid) {
          return { ok: false, error: "Invalid email or password" };
        }
        const nextUser = userFromEmail(email);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
        setUser(nextUser);
        return { ok: true };
      },
      logout() {
        localStorage.removeItem(STORAGE_KEY);
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
