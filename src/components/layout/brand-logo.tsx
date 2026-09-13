"use client";

import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

/** Carré d'encre, icône blanche, pas de halo : la marque se tait. */
export function BrandLogo({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box =
    size === "lg" ? "h-12 w-12 rounded-2xl" : size === "sm" ? "h-8 w-8 rounded-[0.6rem]" : "h-9 w-9 rounded-xl";
  const icon = size === "lg" ? "h-5 w-5" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className={cn("brand-logo relative shrink-0", box, className)}>
      <div
        className={cn(
          "brand-logo-glass relative flex h-full w-full items-center justify-center",
          box
        )}
      >
        <Activity className={cn(icon, "brand-logo-icon")} strokeWidth={2.25} />
      </div>
    </div>
  );
}
