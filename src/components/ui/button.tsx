import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/**
 * Le bouton principal est un aplat d'encre (#233137) sur fond clair, comme les
 * CTA de Qoves ; en sombre il s'inverse en blanc cassé. Léger enfoncement au
 * clic, transitions courtes : le bouton répond sans jamais rebondir.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium tracking-[-0.006em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/15 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-white/20",
  {
    variants: {
      variant: {
        default:
          "bg-slate-900 text-white shadow-[0_1px_2px_rgba(35,49,55,0.2),0_8px_20px_-12px_rgba(35,49,55,0.6)] hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:shadow-none dark:hover:bg-white",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
        outline:
          "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900",
        ghost:
          "text-slate-700 hover:bg-slate-900/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.06]",
        destructive: "bg-rose-600 text-white hover:bg-rose-700",
        success:
          "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-xl px-5",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";
