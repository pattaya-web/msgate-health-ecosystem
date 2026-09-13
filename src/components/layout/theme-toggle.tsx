"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/**
 * Deux rendus : dans le header flottant (fond encre) il devient un bouton
 * translucide ; ailleurs — page de login — un bouton outline classique.
 */
export function ThemeToggle({ variant = "pill" }: { variant?: "pill" | "outline" }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // Vrai seulement après hydratation : le thème résolu n'existe pas côté serveur.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDark = (resolvedTheme ?? theme) === "dark";

  return (
    <button
      type="button"
      className={cn(
        variant === "pill"
          ? "pill-btn"
          : "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
      )}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      disabled={!mounted}
    >
      {mounted && isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </button>
  );
}
