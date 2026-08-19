"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Megaphone, Menu, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/phoenix", label: "Stats", icon: BarChart3 },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/process", label: "Process", icon: Workflow },
];

export function MobileNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-emerald-100/80 bg-white/90 backdrop-blur-xl lg:hidden dark:border-emerald-900/40 dark:bg-slate-950/90">
      <div className="flex items-stretch">
        {items.map((item) => {
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
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                active
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-slate-500 dark:text-slate-400"
              )}
            >
              {active ? (
                <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" />
              ) : null}
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-slate-500 transition-colors active:text-emerald-700 dark:text-slate-400"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-[18px] w-[18px]" />
          Menu
        </button>
      </div>
    </nav>
  );
}
