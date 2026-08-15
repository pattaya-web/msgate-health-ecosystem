import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

export function formatRelativeTime(date: string | Date) {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Less than 1 hour";
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""}`;
}

/** Meta created_time → `15/08/2026` (calendrier FR). */
export function formatCreatedFr(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const slice = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(slice)) {
      const [y, m, day] = slice.split("-");
      return `${day}/${m}/${y}`;
    }
    return slice;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * Compact label for long Meta ad names: keep the last meaningful segment,
 * then hard-ellipsis if still too long.
 */
export function shortenCreativeName(name: string, max = 34): string {
  const original = name.trim().replace(/\s+/g, " ");
  if (!original) return "—";

  let candidate = original;

  // Prefer the last chunk after | · – — (account / hook prefixes sit in front).
  for (const sep of ["|", "·", "–", "—"]) {
    if (candidate.includes(sep)) {
      const parts = candidate
        .split(sep)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (last.length >= 4) candidate = last;
      }
    }
  }

  const dash = candidate.match(/^(.{1,18}?)\s+[-–—]\s+(.+)$/);
  if (dash && dash[2].length >= 6) candidate = dash[2];

  candidate =
    candidate.replace(/^(POST[\s_-]?ID|SALES|BROAD|US|UK|CA)\s*[-–—:]?\s*/i, "").trim() ||
    candidate;

  // Stripping must not leave a useless stub ("2", "—", "US").
  if (candidate.length < 3 || /^\d+$/.test(candidate)) {
    candidate = original;
  }

  if (candidate.length <= max) return candidate;

  if (max <= 12) return `${candidate.slice(0, max - 1)}…`;

  const head = Math.max(4, Math.ceil((max - 1) * 0.6));
  const tail = Math.max(3, max - 1 - head);
  return `${candidate.slice(0, head)}…${candidate.slice(-tail)}`;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = val == null ? "" : String(val);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
