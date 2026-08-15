"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * next-themes injects an inline <script> to avoid theme flash.
 * React 19 / Next 16 logs a false-positive console error for that pattern.
 * Filter only that known message in development.
 */
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      first.includes("Encountered a script tag while rendering React component")
    ) {
      return;
    }
    original.apply(console, args);
  };
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
