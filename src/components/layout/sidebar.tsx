"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Download,
  Landmark,
  LogOut,
  Mail,
  Megaphone,
  Network,
  PanelLeftClose,
  Settings,
  Sparkles,
  Upload,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { BrandLogo } from "@/components/layout/brand-logo";

const nav = [
  { href: "/phoenix", label: "Stats", icon: BarChart3 },
  { href: "/ads", label: "Ads · meta spend", icon: Megaphone },
  { href: "/ads-uploader", label: "Ads uploader", icon: Upload },
  { href: "/download-tiktok", label: "Download Tiktok", icon: Download },
  { href: "/studio", label: "Creatives", icon: Sparkles },
  { href: "/bank-pages", label: "Bank pages", icon: Landmark },
  { href: "/sav", label: "SAV", icon: Mail },
  { href: "/process", label: "Process", icon: Workflow },
  { href: "/ecosystem", label: "Ecosystem", icon: Network },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  onNavigate,
  onCollapse,
}: {
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <aside className="flex h-full w-[240px] max-w-[82vw] flex-col overflow-y-auto border-r border-emerald-100/70 bg-white/90 backdrop-blur-xl lg:w-[220px] dark:border-slate-800 dark:bg-slate-950/80">
      <div className="border-b border-slate-100 px-3 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <BrandLogo size="md" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold tracking-tight text-emerald-900 dark:text-emerald-100">
              MSGate
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-700/80 dark:text-emerald-400/90">
              Health cockpit
            </div>
          </div>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="hidden shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 lg:inline-flex"
              aria-label="Fermer le menu"
              title="Fermer le menu"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {nav.map((item) => {
          const active =
            item.href === "/process"
              ? pathname === "/process" ||
                pathname.startsWith("/process/") ||
                pathname === "/sop" ||
                pathname.startsWith("/sop/")
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium leading-snug transition-colors",
                active
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  active ? "text-emerald-600 dark:text-emerald-300" : "text-emerald-500/70"
                )}
              />
              <span className="min-w-0">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-3 dark:border-slate-800">
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="truncate text-[13px] font-medium text-slate-900 dark:text-slate-100">
            {user?.full_name ?? "Guest"}
          </div>
          <div className="truncate text-[11px] text-slate-500">{user?.email}</div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge variant="secondary" className="capitalize text-[10px]">
              {user?.role ?? "viewer"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Health
            </Badge>
          </div>
          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
