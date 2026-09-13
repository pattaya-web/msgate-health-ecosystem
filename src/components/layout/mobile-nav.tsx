"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Mail, Megaphone, Menu, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/phoenix", label: "Stats", icon: BarChart3 },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/sav", label: "SAV", icon: Mail },
  { href: "/process", label: "Process", icon: Workflow },
];

export function MobileNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="safe-bottom fixed inset-x-3 bottom-3 z-40 lg:hidden">
      <div className="float-header flex items-stretch px-1 py-1">
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
                "flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium transition-colors",
                active
                  ? "bg-white/12 text-[var(--pill-foreground)]"
                  : "text-[var(--pill-muted)]"
              )}
            >
              <Icon className="h-[17px] w-[17px]" />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium text-[var(--pill-muted)] transition-colors active:text-[var(--pill-foreground)]"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-[17px] w-[17px]" />
          Menu
        </button>
      </div>
    </nav>
  );
}
