"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Calculator,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FolderOpen,
  HardDrive,
  ImagePlus,
  Landmark,
  Library,
  LogOut,
  type LucideIcon,
  Mail,
  Megaphone,
  Network,
  PanelLeftClose,
  ReceiptText,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Upload,
  Video,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { BrandLogo } from "@/components/layout/brand-logo";
import { KieCredit } from "@/components/layout/kie-credit";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavSection = { id: string; label: string; items: NavItem[] };

/**
 * La barre est rangée par moment de la journée, pas par ordre d'arrivée des
 * outils : on regarde les chiffres, on fabrique la créa, on la pousse en ads,
 * on tient les boutiques, on traite les clients, et le reste ne se visite que
 * de temps en temps. Un écran appartient à une seule section — s'il en mérite
 * deux, c'est la section qui est mal découpée.
 */
export const SECTIONS: NavSection[] = [
  {
    id: "pilotage",
    label: "Pilotage",
    items: [
      { href: "/phoenix", label: "Stats", icon: BarChart3 },
      { href: "/profit", label: "Profit calculator", icon: Calculator },
      { href: "/invoices", label: "Facturation", icon: ReceiptText },
    ],
  },
  {
    id: "creation",
    label: "Création",
    items: [
      { href: "/reproduce", label: "Reproduire", icon: Copy },
      { href: "/studio", label: "Creatives", icon: Sparkles },
      { href: "/studio/library", label: "Toutes les créas", icon: FolderOpen },
      { href: "/ugc", label: "UGC Creative", icon: Video },
      { href: "/library", label: "Bibliothèque styles", icon: Library },
      { href: "/product-images", label: "Image Product", icon: ImagePlus },
      { href: "/download-tiktok", label: "Download Tiktok", icon: Download },
    ],
  },
  {
    id: "shop",
    label: "Shop",
    items: [
      { href: "/drive", label: "Drive", icon: HardDrive },
      { href: "/spyshop", label: "SpyShop", icon: Eye },
    ],
  },
  {
    id: "acquisition",
    label: "Acquisition",
    items: [
      { href: "/ads", label: "Ads · meta spend", icon: Megaphone },
      { href: "/ads-uploader", label: "Ads uploader", icon: Upload },
    ],
  },
  {
    id: "boutiques",
    label: "Boutiques & MID",
    items: [
      { href: "/shopify-scraper", label: "Shopify scraper", icon: ShoppingBag },
      { href: "/bank-pages", label: "Bank pages", icon: Landmark },
    ],
  },
  {
    id: "clients",
    label: "Clients & risque",
    items: [
      { href: "/sav", label: "SAV", icon: Mail },
      { href: "/alerts-rdr", label: "Alertes RDR · Ethoca", icon: ShieldAlert },
    ],
  },
  {
    id: "organisation",
    label: "Organisation",
    items: [
      { href: "/process", label: "Process", icon: Workflow },
      { href: "/ecosystem", label: "Ecosystem", icon: Network },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const SECTIONS_KEY = "msgate-nav-sections";

/** Seule route dont l'URL ne préfixe pas ses pages : les SOP vivent sous Process. */
export function isActive(href: string, pathname: string) {
  if (href === "/process") {
    return (
      pathname === "/process" ||
      pathname.startsWith("/process/") ||
      pathname === "/sop" ||
      pathname.startsWith("/sop/")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function activeSection(pathname: string) {
  return SECTIONS.find((section) => section.items.some((item) => isActive(item.href, pathname)));
}

/**
 * Page courante pour le fil d'Ariane du header. « /studio/library » préfixe
 * aussi « /studio » : on garde le href le plus long qui matche.
 */
export function currentPage(pathname: string): { section: string; label: string } | null {
  let best: { section: string; label: string; href: string } | null = null;
  for (const section of SECTIONS) {
    for (const item of section.items) {
      if (!isActive(item.href, pathname)) continue;
      if (!best || item.href.length > best.href.length) {
        best = { section: section.label, label: item.label, href: item.href };
      }
    }
  }
  return best ? { section: best.section, label: best.label } : null;
}

/**
 * Sections dépliées au premier rendu : celles gardées ouvertes la dernière
 * fois, plus celle de la page courante — atterrir sur une page dont la section
 * est repliée ne dirait plus où on se trouve.
 *
 * La barre n'est montée qu'une fois l'utilisateur chargé, lui-même relu depuis
 * localStorage : elle ne passe donc jamais par le rendu serveur, et lire le
 * stockage dès l'initialisation ne peut pas décaler l'hydratation.
 */
function initialOpen(pathname: string): string[] {
  let stored: string[] | null = null;
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (raw) stored = JSON.parse(raw) as string[];
  } catch {
    // Un stockage illisible n'est pas une panne : on repart tout ouvert.
  }

  const base = Array.isArray(stored) ? stored : SECTIONS.map((section) => section.id);
  const current = activeSection(pathname)?.id;
  return current && !base.includes(current) ? [...base, current] : base;
}

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
  const [open, setOpen] = useState<string[]>(() => initialOpen(pathname));

  function toggle(id: string) {
    const next = open.includes(id) ? open.filter((item) => item !== id) : [...open, id];
    setOpen(next);
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
    } catch {
      // Le pli reste valable pour cette session, même sans pouvoir l'écrire.
    }
  }

  return (
    <aside className="side-nav flex h-full w-[248px] max-w-[84vw] flex-col overflow-y-auto lg:w-[232px]">
      <div className="px-4 pb-3 pt-5">
        <div className="flex items-center gap-2.5">
          <BrandLogo size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] leading-none text-slate-900 dark:text-slate-50">
              MSGate
            </div>
            <div className="eyebrow mt-1">Health cockpit</div>
          </div>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="hidden shrink-0 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-900/5 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200 lg:inline-flex"
              aria-label="Fermer le menu"
              title="Fermer le menu"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 space-y-2 px-3 py-2">
        {SECTIONS.map((section) => {
          const expanded = open.includes(section.id);
          const holdsActive = section.items.some((item) => isActive(item.href, pathname));

          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => toggle(section.id)}
                aria-expanded={expanded}
                title={expanded ? `Replier ${section.label}` : `Déplier ${section.label}`}
                className="group flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/5"
              >
                <span className="eyebrow min-w-0 flex-1 truncate text-left transition-colors group-hover:text-slate-600 dark:group-hover:text-slate-300">
                  {section.label}
                </span>
                {/* Repliée sur la page courante : sans ce point, plus rien ne dit où on est. */}
                {!expanded && holdsActive ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-900 dark:bg-slate-100" />
                ) : null}
                <ChevronDown
                  className={cn(
                    "h-3 w-3 shrink-0 text-slate-400 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    expanded ? "" : "-rotate-90"
                  )}
                />
              </button>

              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="mt-0.5 space-y-0.5 pb-1">
                    {section.items.map((item) => {
                      const active = isActive(item.href, pathname);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onNavigate}
                          tabIndex={expanded ? 0 : -1}
                          data-active={active ? "true" : "false"}
                          className="side-link"
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">
        <KieCredit />

        <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
              {(user?.full_name ?? "G")
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join("")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-slate-900 dark:text-slate-100">
                {user?.full_name ?? "Guest"}
              </div>
              <div className="truncate text-[11px] text-slate-500">{user?.email}</div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="eyebrow">{user?.role ?? "viewer"}</span>
            <button
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
