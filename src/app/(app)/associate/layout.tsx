"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/associate", label: "Ventes" },
  { href: "/associate/profit", label: "Profit" },
  { href: "/associate/moneytalk", label: "MoneyTalk" },
  { href: "/associate/produits", label: "Produits à lancer" },
];

/** Les pages de l'accès Associé, en onglets doux (et accessibles depuis la « Vue Alison » de l'admin). */
export default function AssociateLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <nav className="r-tabs mx-auto max-w-2xl">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className="r-tab" data-active={pathname === tab.href ? "true" : "false"}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
