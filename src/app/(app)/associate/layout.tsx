"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; short?: string }[] = [
  { href: "/associate", label: "Ventes" },
  { href: "/associate/profit", label: "Profit" },
  { href: "/associate/moneytalk", label: "MoneyTalk" },
  { href: "/associate/produits", label: "Produits à lancer", short: "Produits" },
];

/**
 * Les pages de l'accès Associé, en onglets doux (et accessibles depuis la « Vue Alison » de l'admin).
 * Sur iPhone : une seule ligne, libellés courts, et la rangée glisse sur le côté sans barre si elle manque de place.
 */
export default function AssociateLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <nav className="r-tabs no-scrollbar mx-auto max-w-2xl overflow-x-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="r-tab whitespace-nowrap !px-2.5 sm:!px-3.5"
            data-active={pathname === tab.href ? "true" : "false"}
          >
            {tab.short ? (
              <>
                <span className="sm:hidden">{tab.short}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </>
            ) : (
              tab.label
            )}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
