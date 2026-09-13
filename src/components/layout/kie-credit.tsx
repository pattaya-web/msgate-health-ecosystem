"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, ExternalLink, Loader2, RefreshCw } from "lucide-react";

type Balance = { credits: number; usd: number | null };

/** Le solde baisse à chaque rendu : on le rafraîchit sans attendre un rechargement. */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Deux lignes plutôt qu'une : la barre latérale fait 232 px, et « 10 503,68 cr
 * · 52,52 $ » sur une seule ligne se faisait couper au milieu du montant — soit
 * exactement l'information qu'on vient regarder.
 */
function credits(balance: Balance) {
  return `${balance.credits.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} crédits`;
}

function dollars(balance: Balance) {
  if (balance.usd === null) return null;
  return balance.usd.toLocaleString("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
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
      className="mb-2 flex w-full items-start gap-2.5 rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:bg-slate-900"
    >
      <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="eyebrow">Crédits Kie AI</span>
          {loading ? <Loader2 className="h-2.5 w-2.5 animate-spin text-slate-400" /> : null}
        </div>

        {error ? (
          <div className="mt-0.5 text-[12px] font-semibold text-rose-600 dark:text-rose-400">
            Indisponible
          </div>
        ) : balance ? (
          <>
            {dollars(balance) ? (
              <div className="mt-0.5 font-display text-[20px] leading-none text-slate-900 tabular-nums dark:text-slate-100">
                {dollars(balance)}
              </div>
            ) : null}
            <div className="mt-1 text-[11px] leading-tight text-slate-500 tabular-nums">
              {credits(balance)}
            </div>
          </>
        ) : (
          <div className="mt-1 h-5 w-20 rounded-md skeleton" />
        )}

        <div className="mt-1.5 flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-700 dark:text-slate-300">
            <ExternalLink className="h-2.5 w-2.5" />
            Recharger
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              refresh();
            }}
            title="Rafraîchir le solde"
            className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Rafraîchir
          </button>
        </div>
      </div>
    </a>
  );
}
