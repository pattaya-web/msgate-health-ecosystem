"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Eraser, Image as ImageIcon, Mic, Package, Video } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La bibliothèque n'est plus ici : elle a rejoint la barre de gauche, dans
 * « Création ». On y va pour retrouver une créa, pas pour en fabriquer une —
 * ce n'est donc pas une étape du studio mais une destination à part.
 *
 * « Mass test » n'est plus un onglet : la production en masse passe par le
 * prompt libre et son Auto-brief (produit, référence, inspiration, brief).
 * La route /studio/mass-test et ses lots restent en place, atteignables par
 * les liens « Détails du lot », en attendant d'en faire une matrice de tests.
 */
const TABS = [
  { href: "/studio/product", label: "Produit", icon: Package },
  { href: "/studio/static", label: "Static", icon: ImageIcon },
  { href: "/studio/ai-video", label: "Vidéo IA", icon: Clapperboard },
  { href: "/studio/basic", label: "Voix Off ElevenLabs", icon: Mic },
  { href: "/studio/remove", label: "Remove Magic", icon: Eraser },
  { href: "/studio/video", label: "Texte / montage", icon: Video },
];

export function StudioTabs() {
  const pathname = usePathname() || "";
  return (
    <div className="inline-flex gap-0.5 rounded-full bg-slate-100 p-1 dark:bg-slate-800/70">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const selected = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-150",
              selected
                ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(35,49,55,0.08),0_4px_12px_-6px_rgba(35,49,55,0.25)] dark:bg-slate-950 dark:text-slate-50"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
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
