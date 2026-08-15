import { cn } from "@/lib/utils";
import type { AlertLevel } from "@/types";

const statusMap = {
  healthy: { label: "Healthy", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  monitor: { label: "Monitor", className: "bg-orange-50 text-orange-700 border-orange-200" },
  critical: { label: "Critical", className: "bg-rose-50 text-rose-700 border-rose-200" },
  active: { label: "Active", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  opening: { label: "Pending", className: "bg-orange-100 text-orange-800 border-orange-300" },
  backup: { label: "Backup", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  restricted: { label: "Restricted", className: "bg-orange-50 text-orange-700 border-orange-200" },
  closed: { label: "Closed", className: "bg-rose-100 text-rose-800 border-rose-300" },
  underwriting: { label: "Pending", className: "bg-orange-100 text-orange-800 border-orange-300" },
  declined: { label: "Rejected", className: "bg-rose-100 text-rose-800 border-rose-300" },
  inactive: { label: "Inactive", className: "bg-slate-50 text-slate-600 border-slate-200" },
  open: { label: "Open", className: "bg-sky-50 text-sky-700 border-sky-200" },
  in_progress: { label: "In progress", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  waiting_on_ibo: { label: "Waiting on IBO", className: "bg-orange-50 text-orange-700 border-orange-200" },
  waiting_on_bank: { label: "Waiting on bank", className: "bg-orange-50 text-orange-700 border-orange-200" },
  funds_recovered: { label: "Funds recovered", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  resolved: { label: "Resolved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost_funds: { label: "Lost funds", className: "bg-rose-50 text-rose-700 border-rose-200" },
  high: { label: "High", className: "bg-orange-50 text-orange-700 border-orange-200" },
  medium: { label: "Medium", className: "bg-slate-50 text-slate-600 border-slate-200" },
  low: { label: "Low", className: "bg-slate-50 text-slate-600 border-slate-200" },
  info: { label: "Info", className: "bg-sky-50 text-sky-700 border-sky-200" },
  warning: { label: "Warning", className: "bg-orange-50 text-orange-700 border-orange-200" },
  acknowledged: { label: "Acknowledged", className: "bg-slate-50 text-slate-600 border-slate-200" },
} as const;

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const conf = statusMap[status as keyof typeof statusMap] ?? {
    label: status,
    className: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        conf.className,
        className
      )}
    >
      {conf.label}
    </span>
  );
}

export function alertLevelVariant(level: AlertLevel) {
  if (level === "critical") return "destructive" as const;
  if (level === "warning") return "warning" as const;
  return "default" as const;
}
