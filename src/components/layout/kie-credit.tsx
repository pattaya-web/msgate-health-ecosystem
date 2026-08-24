"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Balance = { credits: number; usd: number | null };

/** Le solde baisse à chaque rendu : on le rafraîchit sans attendre un rechargement. */
const REFRESH_MS = 5 * 60 * 1000;

function format(balance: Balance) {
  const credits = balance.credits.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  if (balance.usd === null) return `${credits} cr`;
  return `${credits} cr · ${balance.usd.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $`;
}

export function KieCredit() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // `loading` part déjà à true : le passer ici en ferait un setState synchrone
  // dans l'effet de montage, que React déconseille. Les relances le remettent.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kie-credit", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setBalance({ credits: body.credits, usd: body.usd ?? null });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Solde indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    // Premier appel décalé d'un tick : déclencher le fetch dans le corps de
    // l'effet ferait un setState synchrone, et donc un rendu en cascade.
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  return (
    <a
      href="https://kie.ai/billing"
      target="_blank"
      rel="noreferrer"
      title={error || "Solde Kie AI — clique pour recharger sur kie.ai"}
      className="mb-2 flex w-full items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-2.5 py-2 text-left transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-900"
    >
      <Coins className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Crédits Kie AI
        </div>
        <div
          className={cn(
            "truncate text-[12px] font-semibold",
            error ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"
          )}
        >
          {error ? "Indisponible" : balance ? format(balance) : "…"}
        </div>
      </div>
      {loading ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-400" />
      ) : (
        <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600" />
      )}
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          refresh();
        }}
        title="Rafraîchir le solde"
        className="shrink-0 rounded p-0.5 text-slate-300 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300"
      >
        <RefreshCw className="h-3 w-3" />
      </button>
    </a>
  );
}
