"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Eraser, FolderOpen, Image as ImageIcon, Mic, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/studio/static", label: "Static", icon: ImageIcon },
  { href: "/studio/basic", label: "Basic", icon: Mic },
  { href: "/studio/library", label: "Toutes les créas", icon: FolderOpen },
  { href: "/studio/remove", label: "Remove Magic", icon: Eraser },
  { href: "/studio/video", label: "Vidéo", icon: Video },
];

export function StudioTabs() {
  const pathname = usePathname() || "";
  return (
    <div className="inline-flex gap-0.5 rounded-xl bg-slate-100/80 p-0.5 dark:bg-slate-800/70">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const selected = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium",
              selected
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
