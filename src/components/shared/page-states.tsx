import * as React from "react";
import { cn } from "@/lib/utils";
import { Inbox, AlertTriangle, Loader2 } from "lucide-react";

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
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white border border-slate-200">
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

export function LoadingState({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-[240px] items-center justify-center", className)}>
      <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
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
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 max-w-xl text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
