"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/associate", label: "Ventes & Meta Ads" },
  { href: "/associate/profit", label: "Profit" },
];

/** Les deux pages de l'accès Associé, accessibles l'une depuis l'autre (et depuis la « Vue Associé » de l'admin). */
export default function AssociateLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <nav className="flex gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex-1 rounded-xl px-3 py-1.5 text-center text-[12px] font-medium transition-colors",
              pathname === tab.href
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
