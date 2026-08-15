"use client";

/* eslint-disable @next/next/no-img-element -- fbcdn URLs are signed and short-lived, the optimizer cannot cache them. */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Pencil } from "lucide-react";
import { cn, shortenCreativeName } from "@/lib/utils";
import { proxyMediaUrl } from "@/lib/meta/download";
import type { CreativeDetail, EntityStatus } from "@/lib/meta/types";
import { copyText } from "@/components/ads/creative-panel";

/** Meta spend ladder — dollars (user listed € amounts, applied as $). */
export const BUDGET_STEPS = [50, 75, 120, 150, 210, 270, 330, 390, 450, 550] as const;

/** Short display name — click copies the full créa name. */
export function CreativeName({
  name,
  max = 22,
  className,
}: {
  name: string;
  max?: number;
  className?: string;
}) {
  const short = shortenCreativeName(name, max);
  return (
    <button
      type="button"
      title={`${name} — clic pour copier`}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(name, "Nom créa copié");
      }}
      className={cn(
        "min-w-0 truncate text-left text-[12px] text-slate-700 transition-colors hover:text-emerald-700 dark:text-slate-200 dark:hover:text-emerald-300",
        className
      )}
    >
      {short}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Creative cache
 *
 * The tree only carries a 64px thumbnail. The full-resolution asset comes from
 * the creatives endpoint, which is fetched once per ad and shared by the hover
 * preview and the detail panel.
 * ------------------------------------------------------------------ */

const creativeCache = new Map<string, Promise<CreativeDetail | null>>();
/** Bust client cache when server prefers sharper asset URLs. */
const CREATIVE_CACHE_GEN = 3;

export function loadCreative(adId: string) {
  const key = `${CREATIVE_CACHE_GEN}:${adId}`;
  const cached = creativeCache.get(key);
  if (cached) return cached;

  const request = fetch(`/api/meta/creatives?ids=${adId}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => (body?.creatives?.[0] as CreativeDetail | undefined) || null)
    .catch(() => null);

  creativeCache.set(key, request);
  return request;
}

/* ------------------------------------------------------------------ *
 * Hover preview — full-res creative, click opens the ad panel
 * ------------------------------------------------------------------ */

/** Comfortable on PC — readable, not full-screen. */
const CARD_W = 400;
const CARD_H = 520;

export function HoverPreview({
  adId,
  thumbnail: _thumbnail,
  onOpen,
  children,
  className,
}: {
  adId: string;
  thumbnail: string | null;
  onOpen?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [point, setPoint] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [full, setFull] = useState<CreativeDetail | null>(null);
  const [srcIndex, setSrcIndex] = useState(0);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overCard = useRef(false);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    []
  );

  const place = (event: React.MouseEvent) => {
    const w = Math.min(CARD_W, window.innerWidth - 24);
    const h = Math.min(CARD_H, window.innerHeight - 24);
    const x = event.clientX + w + 24 < window.innerWidth ? event.clientX + 18 : event.clientX - w - 18;
    const y = Math.min(Math.max(event.clientY - h / 2, 12), window.innerHeight - h - 12);
    setPoint({ x, y, w, h });
  };

  const closeSoon = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      if (!overCard.current) setPoint(null);
    }, 80);
  };

  const asset = full?.assets[0];
  const videoSrc = asset?.kind === "video" && asset.url ? proxyMediaUrl(asset.url, { kind: "video", name: "preview" }) : null;

  const imageSources = useMemo(() => {
    const list: string[] = [];
    const push = (raw: string | null | undefined) => {
      if (!raw || list.includes(raw) || list.some((item) => item.includes(encodeURIComponent(raw)))) return;
      list.push(proxyMediaUrl(raw, { name: "preview", kind: "image" }));
    };
    if (asset?.kind === "image") {
      push(asset.url);
      push(asset.thumbnail);
    } else if (asset) {
      push(asset.thumbnail);
    }
    // Tree thumb is ~64px — never use it as the large preview (looks blurry).
    return list;
  }, [asset]);

  useEffect(() => {
    setSrcIndex(0);
  }, [adId, imageSources]);

  const image = imageSources[srcIndex] || null;
  const loading = Boolean(point) && !videoSrc && !image && !full;

  return (
    <span
      className={className}
      onMouseEnter={(event) => {
        if (leaveTimer.current) clearTimeout(leaveTimer.current);
        setSrcIndex(0);
        setFull(null);
        place(event);
        void loadCreative(adId).then(setFull);
      }}
      onMouseMove={place}
      onMouseLeave={closeSoon}
    >
      {children}

      {point && typeof document !== "undefined"
        ? createPortal(
            <button
              type="button"
              title="Ouvrir la publicité"
              onMouseEnter={() => {
                overCard.current = true;
                if (leaveTimer.current) clearTimeout(leaveTimer.current);
              }}
              onMouseLeave={() => {
                overCard.current = false;
                closeSoon();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPoint(null);
                onOpen?.();
              }}
              className="fixed z-[70] cursor-pointer overflow-hidden rounded-2xl bg-white text-left shadow-[0_20px_60px_rgba(16,24,40,0.28)] ring-1 ring-slate-900/10 transition-shadow hover:ring-emerald-500/40 dark:bg-slate-900 dark:ring-white/10"
              style={{ left: point.x, top: point.y, width: point.w }}
            >
              {videoSrc ? (
                <video
                  src={videoSrc}
                  poster={image || undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="block w-full bg-slate-900 object-contain"
                  style={{ maxHeight: point.h - 28 }}
                />
              ) : image ? (
                <img
                  src={image}
                  alt=""
                  decoding="async"
                  onError={() => {
                    setSrcIndex((current) =>
                      current + 1 < imageSources.length ? current + 1 : current
                    );
                  }}
                  className="block w-full bg-slate-100 object-contain dark:bg-slate-800"
                  style={{ maxHeight: point.h - 28 }}
                />
              ) : (
                <div className="flex h-48 items-center justify-center text-[11px] text-slate-400">
                  {loading || !full ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    "Aperçu indisponible"
                  )}
                </div>
              )}
              <p className="flex items-center justify-between gap-2 truncate px-2.5 py-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                <span className="min-w-0 truncate">
                  {asset?.kind === "video" && !videoSrc
                    ? "Poster — source vidéo non fournie par Meta"
                    : asset?.width
                      ? `${asset.width} × ${asset.height} px`
                      : full?.adName || "Chargement…"}
                </span>
                <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">
                  Ouvrir →
                </span>
              </p>
            </button>,
            document.body
          )
        : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Row controls
 * ------------------------------------------------------------------ */

export function StatusToggle({
  status,
  disabled,
  onToggle,
  size = "sm",
}: {
  status: EntityStatus;
  disabled?: boolean;
  onToggle: (next: "ACTIVE" | "PAUSED") => void;
  size?: "sm" | "lg";
}) {
  const active = status === "ACTIVE";
  const writable = status === "ACTIVE" || status === "PAUSED";
  const large = size === "lg";

  return (
    <button
      type="button"
      disabled={disabled || !writable}
      title={active ? "Mettre en pause" : "Activer"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(active ? "PAUSED" : "ACTIVE");
      }}
      className={cn(
        "relative shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        large ? "h-5 w-9" : "h-3.5 w-7",
        active ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
      )}
    >
      <span
        className={cn(
          "absolute rounded-full bg-white transition-all duration-200",
          large ? "top-0.5 h-4 w-4" : "top-0.5 h-2.5 w-2.5",
          active ? (large ? "left-[18px]" : "left-[15px]") : "left-0.5"
        )}
      />
    </button>
  );
}

/** Budget chip — click opens the $50 → $550 spend ladder. */
export function BudgetCell({
  value,
  currency,
  editable,
  onSave,
  className,
  tone = "solid",
}: {
  value: number;
  currency: string;
  editable: boolean;
  onSave: (next: number) => Promise<void>;
  className?: string;
  /** `solid` = ad set (light green outline). `quiet` = campaign (discreet). */
  tone?: "solid" | "quiet";
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const symbol = currency === "EUR" ? "€" : "$";
  const label = value > 0 ? `${symbol}${Math.round(value)}` : "—";
  const quiet = tone === "quiet";

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target)) return;
      const pop = document.getElementById("budget-ladder-pop");
      if (pop?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = 220;
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - w - 8);
    const below = rect.bottom + 6;
    const y = below + 280 < window.innerHeight ? below : Math.max(8, rect.top - 286);
    setMenu({ x, y, w });
  };

  const pick = async (next: number) => {
    if (next === value) {
      setOpen(false);
      return;
    }
    setSaving(true);
    await onSave(next);
    setSaving(false);
    setOpen(false);
  };

  if (!editable) {
    return (
      <span
        className={cn(
          "shrink-0 tabular-nums",
          quiet
            ? "text-[10px] text-slate-400"
            : "inline-flex h-6 items-center rounded-md px-1.5 text-[11px] font-medium text-emerald-700/50 ring-1 ring-emerald-400/25 dark:text-emerald-400/40 dark:ring-emerald-400/20",
          className
        )}
        title="Budget géré au niveau campagne (CBO)"
      >
        {label}
      </span>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={saving}
        title="Ajuster le budget / jour"
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          place();
          setOpen(true);
        }}
        className={cn(
          "inline-flex shrink-0 items-center tabular-nums transition disabled:opacity-50",
          quiet
            ? "h-5 gap-0.5 rounded px-1 text-[10px] font-medium text-emerald-700/90 hover:bg-emerald-50 dark:text-emerald-400/90 dark:hover:bg-emerald-500/10"
            : "h-6 gap-1 rounded-md bg-[#ecfdf5] px-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-400/70 hover:bg-emerald-100 hover:ring-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/50 dark:hover:bg-emerald-500/20",
          className
        )}
      >
        {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
        <span>{label}</span>
        {!saving && quiet ? <ChevronDown className="h-2.5 w-2.5 opacity-70" /> : null}
        {!saving && !quiet ? <Pencil className="h-2.5 w-2.5 opacity-80" /> : null}
      </button>

      {open && menu && typeof document !== "undefined"
        ? createPortal(
            <div
              id="budget-ladder-pop"
              role="listbox"
              aria-label="Paliers budget journalier"
              className="fixed z-[80] overflow-hidden rounded-xl bg-white shadow-[0_16px_40px_rgba(16,24,40,0.22)] ring-1 ring-emerald-500/20 dark:bg-slate-900 dark:ring-emerald-400/20"
              style={{ left: menu.x, top: menu.y, width: menu.w }}
              onClick={(event) => event.stopPropagation()}
            >
              <p className="border-b border-slate-900/[0.06] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-white/[0.06] dark:text-emerald-300">
                Budget / jour · $
              </p>
              <div className="grid grid-cols-2 gap-1 p-1.5">
                {BUDGET_STEPS.map((step) => {
                  const active = Math.round(value) === step;
                  return (
                    <button
                      key={step}
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={saving}
                      onClick={() => void pick(step)}
                      className={cn(
                        "rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold tabular-nums transition-colors",
                        active
                          ? "bg-emerald-600 text-white"
                          : "text-emerald-800 hover:bg-emerald-50 dark:text-emerald-200 dark:hover:bg-emerald-500/15"
                      )}
                    >
                      ${step}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
