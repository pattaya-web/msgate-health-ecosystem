"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import Link from "next/link";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { TimezoneClocks } from "@/components/layout/timezone-clocks";
import { useAuth } from "@/lib/auth/auth-context";
import { MSGATE_ADMIN_URL } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { mockProvider } from "@/lib/providers/mock-provider";
import { LoadingState } from "@/components/shared/page-states";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "msgate-sidebar-open";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const wideContent = pathname === "/ads" || pathname?.startsWith("/ads/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ type: string; id: string; title: string; href: string }>
  >([]);

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

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      const data = await mockProvider.search(query);
      setResults(data);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

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

            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search IBO, MID, alerts..."
                className="h-8 pl-8 text-xs sm:text-sm"
              />
              {results.length > 0 ? (
                <div className="absolute left-0 right-0 top-9 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {results.map((r) => (
                    <Link
                      key={`${r.type}-${r.id}`}
                      href={r.href}
                      onClick={() => {
                        setQuery("");
                        setResults([]);
                        setMobileOpen(false);
                      }}
                      className="flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="truncate text-slate-800 dark:text-slate-100">{r.title}</span>
                      <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
                        {r.type}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="hidden md:block">
              <TimezoneClocks />
            </div>

            <ThemeToggle />

            <Button
              asChild
              size="sm"
              className="h-8 shrink-0 gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-700 text-xs text-white shadow-sm hover:from-emerald-600 hover:to-emerald-800"
            >
              <a href={MSGATE_ADMIN_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">MSGate Admin</span>
                <span className="sm:hidden">Admin</span>
              </a>
            </Button>
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
