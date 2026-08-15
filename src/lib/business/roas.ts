/** ROAS decision thresholds — decisions are always based on the 7-day window. */
export const ROAS_THRESHOLDS = {
  /** Below this: losing even with rebill — death floor */
  death: 1.0,
  /** Comfort target */
  comfort: 1.3,
  /** Direct pays ads alone — rebill = pure profit */
  ideal: 1.8,
} as const;

/** @deprecated use ROAS_THRESHOLDS */
export const ROAS_TARGETS = {
  otp: ROAS_THRESHOLDS.ideal,
  combined: ROAS_THRESHOLDS.comfort,
} as const;

export type RoasLevel = "death" | "struggle" | "comfort" | "ideal";

export function getRoasLevel(value: number): RoasLevel {
  if (value < ROAS_THRESHOLDS.death) return "death";
  if (value < ROAS_THRESHOLDS.comfort) return "struggle";
  if (value < ROAS_THRESHOLDS.ideal) return "comfort";
  return "ideal";
}

export function computeCombinedRoas(otp: number, rebill: number) {
  // Combined is nothing more than OTP + Rebill (same spend base, 7d or daily).
  return Number((otp + rebill).toFixed(2));
}

export function roasLevelMeta(level: RoasLevel) {
  switch (level) {
    case "death":
      return {
        label: "Death zone",
        short: "< 1.0",
        description: "Sous 1,0 : perte même avec le rebill. Seuil de mort.",
        badge: "destructive" as const,
        cardClass: "border-rose-200 bg-rose-50/70",
        valueClass: "text-rose-700",
        labelClass: "text-rose-600",
        barClass: "bg-rose-500",
        chartStroke: "#e11d48",
      };
    case "struggle":
      return {
        label: "Below comfort",
        short: "1.0 – 1.3",
        description: "Au-dessus du seuil de mort, sous la cible confort 1,3.",
        badge: "warning" as const,
        cardClass: "border-amber-200 bg-amber-50/70",
        valueClass: "text-amber-700",
        labelClass: "text-amber-700",
        barClass: "bg-amber-500",
        chartStroke: "#d97706",
      };
    case "comfort":
      return {
        label: "Comfort",
        short: "1.3 – 1.8",
        description: "1,3 : confort. C’est la cible opérationnelle.",
        badge: "default" as const,
        cardClass: "border-sky-200 bg-sky-50/70",
        valueClass: "text-sky-800",
        labelClass: "text-sky-700",
        barClass: "bg-sky-500",
        chartStroke: "#0284c7",
      };
    case "ideal":
      return {
        label: "Ideal",
        short: "≥ 1.8",
        description: "1,8 : le direct paie tout seul, le rebill = profit pur.",
        badge: "success" as const,
        cardClass: "border-emerald-200 bg-emerald-50/70",
        valueClass: "text-emerald-700",
        labelClass: "text-emerald-700",
        barClass: "bg-emerald-500",
        chartStroke: "#059669",
      };
  }
}

/** Progress 0–100 mapped across death → ideal for visual gauges. */
export function roasProgress(value: number) {
  const capped = Math.max(0, Math.min(value, 2.4));
  return Math.round((capped / 2.4) * 100);
}

export function roasVsTarget(
  value: number,
  _target?: number
): "above" | "near" | "below" {
  const level = getRoasLevel(value);
  if (level === "ideal") return "above";
  if (level === "comfort") return "near";
  return "below";
}

export function roasStatusLabel(status: "above" | "near" | "below" | RoasLevel) {
  if (status === "death") return "Death zone";
  if (status === "struggle") return "Below comfort";
  if (status === "comfort") return "Comfort";
  if (status === "ideal") return "Ideal";
  if (status === "above") return "Ideal";
  if (status === "near") return "Comfort";
  return "Below target";
}
