"use client";

import { useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Calculator,
  ChevronDown,
  Download,
  Eye,
  FolderOpen,
  GripVertical,
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
 * de temps en temps. C'est l'ordre par défaut : l'opérateur peut ensuite
 * glisser les sections et les pages comme il veut, l'ordre est gardé dans le
 * navigateur et retrouvé à chaque ouverture.
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
export const ORDER_KEY = "msgate-nav-order";

/** L'ordre choisi : sections dans l'ordre, et pour chaque section les pages (par href) qu'elle contient. */
export type NavOrder = { sections: string[]; items: Record<string, string[]> };

const ALL_ITEMS = new Map(SECTIONS.flatMap((section) => section.items.map((item) => [item.href, item] as const)));

/**
 * Applique un ordre enregistré à la barre par défaut sans rien perdre : une
 * section ou une page ajoutée depuis se place à son endroit par défaut, une
 * page supprimée du code disparaît de l'ordre, et chaque page n'apparaît
 * qu'une fois même si le stockage la mentionne deux fois.
 */
export function applyOrder(order: NavOrder | null): NavSection[] {
  if (!order) return SECTIONS;
  const known = new Map(SECTIONS.map((section) => [section.id, section]));
  const sectionIds = [...order.sections.filter((id) => known.has(id)), ...SECTIONS.map((section) => section.id).filter((id) => !order.sections.includes(id))];
  const placed = new Set<string>();
  const result = sectionIds.map((id) => {
    const section = known.get(id)!;
    const items: NavItem[] = [];
    for (const href of order.items[id] ?? section.items.map((item) => item.href)) {
      const item = ALL_ITEMS.get(href);
      if (item && !placed.has(href)) {
        placed.add(href);
        items.push(item);
      }
    }
    return { ...section, items };
  });
  // Les pages que l'ordre enregistré ne connaît pas retournent dans leur section d'origine.
  for (const section of SECTIONS) {
    for (const item of section.items) {
      if (placed.has(item.href)) continue;
      placed.add(item.href);
      result.find((entry) => entry.id === section.id)?.items.push(item);
    }
  }
  return result;
}

export function loadOrder(): NavOrder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NavOrder>;
    if (!Array.isArray(parsed.sections) || typeof parsed.items !== "object" || !parsed.items) return null;
    return { sections: parsed.sections.filter((id) => typeof id === "string"), items: parsed.items };
  } catch {
    return null;
  }
}

function toOrder(sections: NavSection[]): NavOrder {
  return { sections: sections.map((section) => section.id), items: Object.fromEntries(sections.map((section) => [section.id, section.items.map((item) => item.href)])) };
}

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

function activeSection(sections: NavSection[], pathname: string) {
  return sections.find((section) => section.items.some((item) => isActive(item.href, pathname)));
}

/**
 * Page courante pour le fil d'Ariane du header, dans la section où
 * l'opérateur l'a rangée. « /studio/library » préfixe aussi « /studio » : on
 * garde le href le plus long qui matche.
 */
export function currentPage(pathname: string): { section: string; label: string } | null {
  let best: { section: string; label: string; href: string } | null = null;
  for (const section of applyOrder(loadOrder())) {
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
function initialOpen(sections: NavSection[], pathname: string): string[] {
  let stored: string[] | null = null;
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (raw) stored = JSON.parse(raw) as string[];
  } catch {
    // Un stockage illisible n'est pas une panne : on repart tout ouvert.
  }

  const base = Array.isArray(stored) ? stored : sections.map((section) => section.id);
  const current = activeSection(sections, pathname)?.id;
  return current && !base.includes(current) ? [...base, current] : base;
}

export type NavDrag = { kind: "section"; id: string } | { kind: "item"; href: string };
export type NavTarget = { kind: "section"; id: string } | { kind: "item"; href: string } | { kind: "into"; id: string };

function sameTarget(a: NavTarget | null, b: NavTarget) {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === "item" && b.kind === "item" ? a.href === b.href : a.kind !== "item" && b.kind !== "item" ? a.id === b.id : false;
}

function moveInList<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, entry);
  return next;
}

/** Nouvel agencement après un dépôt : une section devant (ou après) une autre, une page devant une autre (même ou autre section) ou en fin de section. */
export function reorder(sections: NavSection[], drag: NavDrag, target: NavTarget): NavSection[] {
  if (drag.kind === "section") {
    if (target.kind === "item") return sections;
    const from = sections.findIndex((section) => section.id === drag.id);
    const to = sections.findIndex((section) => section.id === target.id);
    if (from < 0 || to < 0 || from === to) return sections;
    return moveInList(sections, from, target.kind === "into" ? to + 1 : to);
  }
  const item = ALL_ITEMS.get(drag.href);
  if (!item || (target.kind === "item" && target.href === drag.href)) return sections;
  const without = sections.map((section) => ({ ...section, items: section.items.filter((entry) => entry.href !== drag.href) }));
  return without.map((section) => {
    if (target.kind === "item") {
      const index = section.items.findIndex((entry) => entry.href === target.href);
      if (index < 0) return section;
      return { ...section, items: [...section.items.slice(0, index), item, ...section.items.slice(index)] };
    }
    return section.id === target.id ? { ...section, items: [...section.items, item] } : section;
  });
}

const DROP_LINE = "shadow-[0_-2px_0_0_theme(colors.slate.900)] dark:shadow-[0_-2px_0_0_theme(colors.slate.100)]";

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
  const [sections, setSections] = useState<NavSection[]>(() => applyOrder(loadOrder()));
  const [custom, setCustom] = useState<boolean>(() => loadOrder() !== null);
  const [open, setOpen] = useState<string[]>(() => initialOpen(sections, pathname));
  const [drag, setDrag] = useState<NavDrag | null>(null);
  // La source du glisser vit aussi dans une ref : dragover/drop peuvent arriver avant que React ait rendu l'état.
  const dragRef = useRef<NavDrag | null>(null);
  const [over, setOver] = useState<NavTarget | null>(null);

  function toggle(id: string) {
    const next = open.includes(id) ? open.filter((item) => item !== id) : [...open, id];
    setOpen(next);
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
    } catch {
      // Le pli reste valable pour cette session, même sans pouvoir l'écrire.
    }
  }

  function commit(next: NavSection[]) {
    setSections(next);
    setCustom(true);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(toOrder(next)));
    } catch {
      // L'ordre tient pour la session même si le navigateur refuse de l'écrire.
    }
  }

  function resetOrder() {
    setSections(SECTIONS);
    setCustom(false);
    try {
      localStorage.removeItem(ORDER_KEY);
    } catch {
      // idem
    }
  }

  function startDrag(event: DragEvent, value: NavDrag) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", value.kind === "section" ? `section:${value.id}` : `item:${value.href}`);
    dragRef.current = value;
    setDrag(value);
  }

  function canDrop(target: NavTarget) {
    const source = dragRef.current;
    if (!source) return false;
    if (source.kind === "section") return target.kind !== "item" && target.id !== source.id;
    return target.kind !== "item" || target.href !== source.href;
  }

  function dragOver(event: DragEvent, target: NavTarget) {
    if (!canDrop(target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (!sameTarget(over, target)) setOver(target);
  }

  function drop(event: DragEvent, target: NavTarget) {
    const source = dragRef.current;
    if (!source || !canDrop(target)) return;
    event.preventDefault();
    event.stopPropagation();
    commit(reorder(sections, source, target));
    dragRef.current = null;
    setDrag(null);
    setOver(null);
  }

  function endDrag() {
    dragRef.current = null;
    setDrag(null);
    setOver(null);
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

      <nav className="flex-1 space-y-2 px-3 py-2" data-nav>
        {sections.map((section) => {
          const expanded = open.includes(section.id);
          const holdsActive = section.items.some((item) => isActive(item.href, pathname));
          const dragging = drag?.kind === "section" && drag.id === section.id;

          return (
            <div
              key={section.id}
              data-section={section.id}
              className={cn("rounded-lg", dragging ? "opacity-40" : "", sameTarget(over, { kind: "section", id: section.id }) ? DROP_LINE : "")}
              onDragOver={(event) => dragOver(event, { kind: "section", id: section.id })}
              onDrop={(event) => drop(event, { kind: "section", id: section.id })}
            >
              <div
                draggable
                onDragStart={(event) => startDrag(event, { kind: "section", id: section.id })}
                onDragEnd={endDrag}
                className="group flex w-full items-center gap-1 rounded-lg px-1 transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/5"
                title="Glisser pour déplacer la section"
                data-section-handle
              >
                <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing dark:text-slate-600" aria-hidden />
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={expanded}
                  title={expanded ? `Replier ${section.label}` : `Déplier ${section.label}`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1.5"
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
              </div>

              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div
                    className={cn("mt-0.5 space-y-0.5 rounded-lg pb-1", sameTarget(over, { kind: "into", id: section.id }) ? "bg-slate-900/[0.04] dark:bg-white/5" : "")}
                    onDragOver={(event) => dragOver(event, { kind: "into", id: section.id })}
                    onDrop={(event) => drop(event, { kind: "into", id: section.id })}
                  >
                    {section.items.map((item) => {
                      const active = isActive(item.href, pathname);
                      const Icon = item.icon;
                      const draggingItem = drag?.kind === "item" && drag.href === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onNavigate}
                          tabIndex={expanded ? 0 : -1}
                          data-active={active ? "true" : "false"}
                          data-nav-item={item.href}
                          draggable
                          onDragStart={(event) => startDrag(event, { kind: "item", href: item.href })}
                          onDragEnd={endDrag}
                          onDragOver={(event) => dragOver(event, { kind: "item", href: item.href })}
                          onDrop={(event) => drop(event, { kind: "item", href: item.href })}
                          className={cn("side-link", draggingItem ? "opacity-40" : "", sameTarget(over, { kind: "item", href: item.href }) ? DROP_LINE : "")}
                          title="Glisser pour déplacer la page"
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                    {!section.items.length ? <div className="px-2.5 py-1 text-[11px] text-slate-400">Déposer une page ici</div> : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {custom ? (
          <button type="button" onClick={resetOrder} className="w-full px-2.5 py-1 text-left text-[10.5px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" data-reset-order>
            Remettre l&apos;ordre par défaut
          </button>
        ) : null}
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
