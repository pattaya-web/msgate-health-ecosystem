import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-slate-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/[0.06] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus-visible:border-slate-500 dark:focus-visible:ring-white/10",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";
