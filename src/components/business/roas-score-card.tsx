"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  computeCombinedRoas,
  getRoasLevel,
  roasLevelMeta,
  roasProgress,
  type RoasLevel,
} from "@/lib/business/roas";

export function RoasScoreCard({
  title,
  value,
  hint,
  subtitle,
  colorize = true,
  className,
  breakdown,
}: {
  title: string;
  value: number;
  hint?: string;
  subtitle?: string;
  colorize?: boolean;
  className?: string;
  /** Show Combined as OTP + Rebill */
  breakdown?: { otp: number; rebill: number };
}) {
  const displayValue = breakdown
    ? computeCombinedRoas(breakdown.otp, breakdown.rebill)
    : value;
  const level: RoasLevel = getRoasLevel(displayValue);
  const meta = roasLevelMeta(level);
  const progress = roasProgress(displayValue);

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        colorize ? meta.cardClass : "border-slate-200 bg-slate-50/60",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "text-xs font-medium uppercase tracking-wide",
            colorize ? meta.labelClass : "text-slate-500"
          )}
        >
          {title}
        </div>
        {breakdown ? (
          <Badge variant="outline" className="shrink-0 border-slate-300 bg-white/70 text-slate-600">
            OTP + Rebill
          </Badge>
        ) : colorize ? (
          <Badge variant={meta.badge} className="shrink-0">
            {meta.label}
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0">
            Profit layer
          </Badge>
        )}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight",
          colorize ? meta.valueClass : "text-slate-900"
        )}
      >
        {displayValue.toFixed(2)}x
      </div>
      {breakdown ? (
        <p className="mt-1.5 font-mono text-xs text-slate-500">
          {breakdown.otp.toFixed(2)} + {breakdown.rebill.toFixed(2)} ={" "}
          <span className={cn("font-semibold", meta.valueClass)}>
            {displayValue.toFixed(2)}
          </span>
        </p>
      ) : null}
      {colorize ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wide text-slate-400">
            <span>0</span>
            <span>1.0</span>
            <span>1.3</span>
            <span>1.8</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/80">
            <div
              className={cn("h-full rounded-full transition-all", meta.barClass)}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}
      {hint ? (
        <p className={cn("mt-2 text-xs", colorize ? meta.labelClass : "text-slate-500")}>
          {hint}
        </p>
      ) : null}
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

export function RoasLegend() {
  const levels: RoasLevel[] = ["death", "struggle", "comfort", "ideal"];
  return (
    <div className="flex flex-wrap gap-2">
      {levels.map((level) => {
        const meta = roasLevelMeta(level);
        return (
          <div
            key={level}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
              meta.cardClass,
              meta.labelClass
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", meta.barClass)} />
            <span className="font-medium">{meta.label}</span>
            <span className="opacity-70">{meta.short}</span>
          </div>
        );
      })}
    </div>
  );
}
