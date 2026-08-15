"use client";

import { cn } from "@/lib/utils";

export function HealthGauge({
  score,
  status,
}: {
  score: number;
  status: "healthy" | "monitor" | "critical";
}) {
  const color =
    status === "healthy" ? "#10B981" : status === "monitor" ? "#F59E0B" : "#F43F5E";
  const radius = 68;
  const circumference = Math.PI * radius;
  const progress = Math.min(100, Math.max(0, score));
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      <svg viewBox="0 0 180 110" className="w-full">
        <path
          d="M 22 100 A 68 68 0 0 1 158 100"
          fill="none"
          stroke="#E2E8F0"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M 22 100 A 68 68 0 0 1 158 100"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
        <div className="text-4xl font-semibold tracking-tight text-slate-900">
          {score}
          <span className="text-lg font-medium text-slate-400"> / 100</span>
        </div>
        <div
          className={cn(
            "mt-1 text-sm font-medium capitalize",
            status === "healthy" && "text-emerald-600",
            status === "monitor" && "text-amber-600",
            status === "critical" && "text-rose-600"
          )}
        >
          {status === "healthy" ? "Healthy" : status === "monitor" ? "Monitor" : "Critical"}
        </div>
      </div>
    </div>
  );
}
