"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { TimezoneClocks } from "@/components/layout/timezone-clocks";
import { useAuth } from "@/lib/auth/auth-context";
import { LoadingState } from "@/components/shared/page-states";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "msgate-sidebar-open";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const wideContent =
    pathname === "/ads" ||
    pathname?.startsWith("/ads/") ||
    pathname === "/ads-uploader" ||
    pathname?.startsWith("/ads-uploader/") ||
    pathname === "/download-tiktok" ||
    pathname?.startsWith("/download-tiktok/") ||
    pathname === "/studio" ||
    pathname?.startsWith("/studio/") ||
    pathname === "/bank-pages" ||
    pathname?.startsWith("/bank-pages/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw === "0") setDesktopOpen(false);
      if (raw === "1") setDesktopOpen(true);
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SIDEBAR_KEY, desktopOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [desktopOpen, hydrated]);


  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background">
        <LoadingState className="min-h-screen" />
      </div>
    );
  }

  return (
    <div className="app-aurora flex min-h-screen">
      <div
        className={cn(
          "hidden shrink-0 transition-[width] duration-200 ease-out lg:block",
          desktopOpen ? "w-[220px]" : "w-0"
        )}
      >
        <div
          className={cn(
            "sticky top-0 h-screen overflow-hidden transition-opacity duration-200",
            desktopOpen ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          <Sidebar onCollapse={() => setDesktopOpen(false)} />
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="animate-fade-in absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="animate-drawer-in absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-emerald-100/70 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/75">
          <div className={cn("mx-auto flex w-full items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4", wideContent ? "max-w-[100rem]" : "max-w-7xl")}>
            <button
              type="button"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            <button
              type="button"
              className="hidden rounded-lg border border-slate-200 p-1.5 text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900 lg:inline-flex"
              onClick={() => setDesktopOpen((v) => !v)}
              aria-label={desktopOpen ? "Fermer le menu" : "Ouvrir le menu"}
              title={desktopOpen ? "Fermer le menu gauche" : "Ouvrir le menu gauche"}
            >
              {desktopOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>

            {/* La recherche a été retirée : les horloges occupent la barre. */}
            <div className="min-w-0 flex-1" />

            <div className="hidden md:block">
              <TimezoneClocks />
            </div>

            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-3 pb-24 pt-4 sm:px-4 sm:py-5 lg:pb-8">
          <div className={cn("mx-auto w-full", wideContent ? "max-w-[100rem]" : "max-w-7xl")}>{children}</div>
        </main>
      </div>

      <MobileNav onOpenMenu={() => setMobileOpen(true)} />
    </div>
  );
}
