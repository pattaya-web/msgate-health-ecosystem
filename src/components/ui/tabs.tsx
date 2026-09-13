"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** Segmented control : rail gris pâle, onglet actif en carte blanche. */
export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-full bg-slate-100 p-1 text-slate-500 dark:bg-slate-800/70",
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 hover:text-slate-800 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-[0_1px_2px_rgba(35,49,55,0.08),0_4px_12px_-6px_rgba(35,49,55,0.25)] dark:hover:text-slate-200 dark:data-[state=active]:bg-slate-950 dark:data-[state=active]:text-slate-50",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("animate-tab-in mt-4 focus-visible:outline-none", className)}
      {...props}
    />
  );
}
