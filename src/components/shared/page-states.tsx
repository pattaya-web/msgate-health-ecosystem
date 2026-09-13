import * as React from "react";
import { cn } from "@/lib/utils";
import { Inbox, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white">
        <Inbox className="h-5 w-5 text-slate-400" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/40 px-6 py-12 text-center">
      <AlertTriangle className="mb-3 h-6 w-6 text-rose-500" />
      <h3 className="text-sm font-semibold text-rose-900">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-rose-700/80">{description}</p> : null}
    </div>
  );
}

/**
 * Un point d'encre qui respire plutôt qu'une roue : le chargement se lit sans
 * crier, et l'œil n'est pas attiré vers le milieu de l'écran.
 */
export function LoadingState({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-[240px] items-center justify-center", className)} role="status">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-900/30 dark:bg-white/30" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-slate-900 dark:bg-white" />
      </span>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/** Squelette générique d'une page : titre, rangée de tuiles, grand panneau. */
export function PageSkeleton() {
  return (
    <div className="page-enter space-y-5" aria-busy>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

/** Coquille complète pendant la relecture de la session : barre + header + page. */
export function ShellSkeleton() {
  return (
    <div className="app-aurora flex min-h-screen">
      <div className="side-nav hidden w-[232px] shrink-0 lg:block">
        <div className="space-y-6 px-4 pt-5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-[0.6rem]" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
          {Array.from({ length: 4 }).map((_, s) => (
            <div key={s} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-3 pt-2 sm:px-4 sm:pt-3">
          <div className="float-header mx-auto h-12 w-full max-w-7xl" />
        </div>
        <main className="flex-1 px-3 pt-5 sm:px-4 sm:pt-6">
          <div className="mx-auto w-full max-w-7xl">
            <PageSkeleton />
          </div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-none text-slate-900 dark:text-slate-50 sm:text-[32px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-xl text-[13px] text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
