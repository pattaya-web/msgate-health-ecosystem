"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { AskHermes } from "@/components/ask-hermes/ask-hermes";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavProgress } from "@/components/layout/nav-progress";
import { Sidebar, currentPage } from "@/components/layout/sidebar";
import { EnvBadge } from "@/components/layout/env-badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { TimezoneClocks } from "@/components/layout/timezone-clocks";
import { useAuth } from "@/lib/auth/auth-context";
import { ShellSkeleton } from "@/components/shared/page-states";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "msgate-sidebar-open";

type ViewTransitionProps = {
  children: React.ReactNode;
  name?: string;
  default?: string;
};

/**
 * React expose `ViewTransition` sous ce nom dans le canal canary que Next
 * embarque, et sous `unstable_ViewTransition` sur les builds stables. On
 * prend celui qui existe ; à défaut le contenu s'affiche sans animation.
 */
const ViewTransition: React.ComponentType<ViewTransitionProps> =
  ((React as unknown as Record<string, unknown>).ViewTransition as
    | React.ComponentType<ViewTransitionProps>
    | undefined) ??
  ((React as unknown as Record<string, unknown>).unstable_ViewTransition as
    | React.ComponentType<ViewTransitionProps>
    | undefined) ??
  (({ children }) => <>{children}</>);

function initials(name: string | undefined) {
  if (!name) return "G";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

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
  // Lu paresseusement : la barre n'est rendue qu'une fois la session relue
  // côté client, donc la valeur serveur (true) n'apparaît jamais à l'écran.
  const [desktopOpen, setDesktopOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, desktopOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [desktopOpen]);

  useEffect(() => {
    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled(window.scrollY > 8));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (loading || !user) {
    return <ShellSkeleton />;
  }

  const page = currentPage(pathname ?? "");
  const container = wideContent ? "max-w-[100rem]" : "max-w-7xl";

  return (
    <div className="app-aurora flex min-h-screen">
      <div
        className={cn(
          "hidden shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:block",
          desktopOpen ? "w-[232px]" : "w-0"
        )}
      >
        <div
          className={cn(
            "sticky top-0 h-screen overflow-hidden transition-opacity duration-200",
            desktopOpen ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          style={{ viewTransitionName: "app-sidebar" } as React.CSSProperties}
        >
          <Sidebar onCollapse={() => setDesktopOpen(false)} />
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="animate-fade-in absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="animate-drawer-in absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="sticky top-0 z-40 px-3 pt-2 sm:px-4 sm:pt-3"
          style={{ viewTransitionName: "app-header" } as React.CSSProperties}
        >
          <header
            className={cn("float-header relative mx-auto flex w-full items-center gap-1.5 px-2 py-1.5 sm:gap-2", container)}
            data-scrolled={scrolled ? "true" : "false"}
          >
            <button
              type="button"
              className="pill-btn lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            <button
              type="button"
              className="pill-btn hidden lg:inline-flex"
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

            <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
              {page ? (
                <>
                  <span className="eyebrow hidden truncate !text-[var(--pill-muted)] sm:inline">
                    {page.section}
                  </span>
                  <span className="hidden h-3 w-px bg-white/15 sm:block" />
                  <span className="truncate text-[13px] font-medium text-[var(--pill-foreground)]">
                    {page.label}
                  </span>
                </>
              ) : (
                <span className="truncate text-[13px] font-medium text-[var(--pill-foreground)]">
                  MSGate
                </span>
              )}
            </div>

            <div className="hidden md:block">
              <TimezoneClocks />
            </div>

            <EnvBadge className="mx-0.5" />

            <ThemeToggle />

            <div
              className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-[var(--pill-foreground)] ring-1 ring-inset ring-white/10"
              title={user.email}
            >
              {initials(user.full_name)}
            </div>

            <NavProgress />
          </header>
        </div>

        <main className="flex-1 px-3 pb-24 pt-5 sm:px-4 sm:pt-6 lg:pb-10">
          <ViewTransition default="page-fade">
            <div key={pathname} className={cn("page-enter mx-auto w-full", container)}>
              {children}
            </div>
          </ViewTransition>
        </main>
      </div>

      <MobileNav onOpenMenu={() => setMobileOpen(true)} />
      <AskHermes />
    </div>
  );
}
