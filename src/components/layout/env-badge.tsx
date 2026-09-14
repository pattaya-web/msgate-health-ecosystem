"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Le badge d'environnement : DEV, STABLE LOCAL ou PRODUCTION, avec le commit.
 *
 * Trois instances du CRM peuvent être ouvertes en même temps ; sans repère, on
 * corrige un texte dans le mauvais. La source de vérité est
 * `NEXT_PUBLIC_APP_ENV`, figée au build (dev / stable / production). Sans
 * elle, on déduit : Vercel en production, sinon le port local (3100 = dev,
 * 3000 = stable). Le commit vient de `NEXT_PUBLIC_COMMIT_SHA`, posé par
 * next.config.ts au build.
 */
type AppEnv = "dev" | "stable" | "production" | "unknown";

const LABELS: Record<AppEnv, string> = { dev: "DEV", stable: "STABLE LOCAL", production: "PRODUCTION", unknown: "LOCAL" };

function configuredEnv(): AppEnv | null {
  const value = (process.env.NEXT_PUBLIC_APP_ENV ?? "").trim().toLowerCase();
  if (value === "dev" || value === "development") return "dev";
  if (value === "stable" || value === "local") return "stable";
  if (value === "production" || value === "prod") return "production";
  return null;
}

function detectEnv(): AppEnv {
  const configured = configuredEnv();
  if (configured) return configured;
  if (typeof window === "undefined") return "unknown";
  const { hostname, port } = window.location;
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  if (!local) return "production";
  if (port === "3100") return "dev";
  if (port === "3000") return "stable";
  return "unknown";
}

export function EnvBadge({ className }: { className?: string }) {
  // Lu paresseusement : AppShell ne monte le header qu'une fois la session
  // relue côté client, donc le port du navigateur est connu au premier rendu.
  const [env] = useState<AppEnv>(() => detectEnv());
  const commit = (process.env.NEXT_PUBLIC_COMMIT_SHA ?? "").slice(0, 7);

  return (
    <div
      title={`Environnement : ${LABELS[env]}${commit ? ` · commit ${commit}` : ""}`}
      className={cn("flex select-none flex-col items-center leading-none", className)}
      data-app-env={env}
    >
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em]",
          env === "dev" && "bg-orange-500 text-white shadow-[0_0_0_2px_rgba(249,115,22,0.35)] animate-pulse",
          env === "stable" && "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100",
          env === "production" && "bg-emerald-600/15 text-emerald-700 ring-1 ring-emerald-600/30 dark:text-emerald-300",
          env === "unknown" && "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
        )}
      >
        {LABELS[env]}
      </span>
      {commit ? <span className="mt-0.5 font-mono text-[8px] text-slate-400">{commit}</span> : null}
    </div>
  );
}
