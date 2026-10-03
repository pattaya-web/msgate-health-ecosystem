"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* ------------------------------- Layout ------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="relative z-[1] flex flex-wrap items-end justify-between gap-4 mb-6 sm:mb-8">
      <div className="min-w-0">
        <h1 className="grad-text text-[30px] sm:text-[38px] font-semibold leading-[1.08] pb-0.5" style={{ letterSpacing: "-0.035em" }}>
          {title}
        </h1>
        {subtitle && <p className="muted text-[14px] sm:text-[15px] mt-2 max-w-2xl leading-relaxed">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  padded = true,
}: {
  /** Texte, ou un petit contenu (pastille de couleur + texte). */
  title?: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3.5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            {title && <h2 className="text-[17px] sm:text-[18px] font-semibold">{title}</h2>}
            {subtitle && <p className="muted text-[12.5px] mt-1">{subtitle}</p>}
          </div>
          {/* Sur téléphone, les actions passent sous le titre au lieu de déborder. */}
          {actions && <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full sm:shrink-0">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-4 sm:p-5" : ""}>{children}</div>
    </section>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="dim text-[13px] max-w-md mx-auto leading-relaxed">{children}</p>
      {action && <div className="mt-3.5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 muted text-[13px]">
      <span className="spinner" />
      {label}
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed"
      style={{
        background: "color-mix(in srgb, var(--critical) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--critical) 30%, transparent)",
        color: "var(--critical)",
      }}
    >
      {children}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed"
      style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-2)" }}
    >
      {children}
    </div>
  );
}

/* -------------------------------- Stats ------------------------------- */

export function StatTile({
  label,
  value,
  hint,
  trend,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: number;
  accent?: string;
}) {
  return (
    <div className="card px-4 sm:px-5 py-4">
      <div className="label-xs">{label}</div>
      <div className="flex items-baseline gap-2.5 mt-2.5">
        <span
          className="text-[28px] sm:text-[32px] font-semibold num leading-none"
          style={{ letterSpacing: "-0.035em", ...(accent ? { color: accent } : {}) }}
        >
          {value}
        </span>
        {trend !== undefined && trend !== 0 && (
          <span
            className="mono text-[11px] num"
            style={{ color: trend > 0 ? "var(--good)" : "var(--critical)" }}
          >
            {trend > 0 ? "▲" : "▼"} {Math.abs(trend).toLocaleString("fr-FR")}
          </span>
        )}
      </div>
      {hint && <div className="dim text-[12px] mt-2">{hint}</div>}
    </div>
  );
}

/* -------------------------------- Modal ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  /*
   * Montage differe.
   *
   * Le portail vise `document.body`, qui n'existe pas au rendu serveur : on
   * n'ouvre donc le passage qu'une fois cote navigateur.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  /*
   * Rendu dans <body> plutot qu'a sa place dans l'arbre.
   *
   * Le contenu des pages vit dans un conteneur anime (`.rise`), et une
   * animation sur `transform` cree un bloc conteneur : un `position: fixed`
   * a l'interieur se cale alors sur CE conteneur, pas sur la fenetre. Le voile
   * sombre ne couvrait donc que la zone de contenu, laissant la barre laterale
   * et l'en-tete en clair, et la fenetre n'etait pas centree sur l'ecran.
   *
   * Le portail supprime la dependance a tout ancetre : ou que la modale soit
   * appelee, elle s'affiche par-dessus l'application entiere.
   */
  return createPortal(
    // `studio-ia` : le portail sort de l'arbre de la page, il doit porter lui-même le préfixe des styles du Studio.
    <div
      className="studio-ia fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgb(35 49 55 / 0.4)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/*
        Colonne bornee a la hauteur de l'ecran : l'en-tete et le pied restent
        visibles, seul le corps defile. Sans cette borne, une video verticale
        poussait le pied hors de l'ecran et la fenetre debordait.
      */}
      <div
        className={`card fade-in w-full flex flex-col ${wide ? "max-w-5xl" : "max-w-xl"}`}
        style={{ maxHeight: "92vh", boxShadow: "var(--shadow-lg)", borderRadius: "var(--radius-lg)" }}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 shrink-0"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
            borderTopLeftRadius: "var(--radius-lg)",
            borderTopRightRadius: "var(--radius-lg)",
          }}
        >
          <h2 className="text-[16px] font-medium truncate">{title}</h2>
          <button className="btn btn-ghost btn-sm shrink-0" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 min-h-0">{children}</div>

        {footer && (
          <div
            className="flex flex-wrap justify-end items-center gap-2 px-5 py-3.5 shrink-0"
            style={{
              borderTop: "1px solid var(--border)",
              background: "var(--surface-2)",
              borderBottomLeftRadius: "var(--radius-lg)",
              borderBottomRightRadius: "var(--radius-lg)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------- Champs ------------------------------ */

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label-xs block mb-1.5">{label}</span>
      {children}
      {hint && <span className="dim text-[11.5px] block mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[13px]"
    >
      <span
        className="relative inline-block rounded-full transition-colors"
        style={{
          width: 34,
          height: 19,
          background: checked ? "var(--accent)" : "var(--border-strong)",
        }}
      >
        <span
          className="absolute rounded-full transition-transform"
          style={{
            width: 15,
            height: 15,
            top: 2,
            left: 2,
            background: checked ? "var(--accent-on)" : "#fff",
            transform: checked ? "translateX(15px)" : "none",
          }}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "✓ Copié" : label}
    </button>
  );
}

/* -------------------------------- Toasts ------------------------------ */

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "err";
}

const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, msg, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === "err" ? 7000 : 3200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {items.map((t) => (
          <div
            key={t.id}
            className="card fade-in px-4 py-3 text-[13px] leading-snug"
            style={{
              boxShadow: "var(--shadow-lg)",
              ...(t.kind === "err"
                ? {
                    borderColor: "color-mix(in srgb, var(--critical) 40%, transparent)",
                    color: "var(--critical)",
                  }
                : {}),
            }}
            role="status"
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* --------------------------------- Tabs ------------------------------- */

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div
      className="inline-flex max-w-full gap-1 p-1 rounded-full overflow-x-auto"
      style={{ background: "var(--surface-3)", border: "1px solid var(--border)" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="tab-btn px-3.5 h-[28px] rounded-full text-[12.5px] font-medium whitespace-nowrap"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-2)",
              border: `1px solid ${active ? "var(--border)" : "transparent"}`,
            }}
          >
            {o.label}
            {o.count !== undefined && <span className="dim ml-1.5 num">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
