"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  {
    href: "/process",
    label: "Whiteboard",
    hint: "IBO · MID · BANK · SHOP",
    icon: Workflow,
    active: (path: string) => path === "/process" || path.startsWith("/process/"),
  },
  {
    href: "/sop",
    label: "SOP",
    hint: "Procédures",
    icon: BookOpen,
    active: (path: string) => path === "/sop" || path.startsWith("/sop/"),
  },
] as const;

export function ProcessTabs() {
  const pathname = usePathname() || "";

  return (
    <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-slate-100/80 p-0.5 [scrollbar-width:none] dark:bg-slate-800/70 [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const selected = tab.active(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors",
              selected
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
            <span className="hidden text-[10px] font-normal text-slate-400 sm:inline">
              {tab.hint}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
