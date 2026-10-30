"use client";

import { ProfitCalculator } from "@/components/phoenix/profit-calculator";

/**
 * Le profit de l'accès Associé : Straight sale du périmètre seul, dépense Meta
 * associée et COGS réels des articles vendus. Les chiffres viennent de
 * /api/associate/profit, le seul calcul de profit que le serveur lui sert.
 */
export default function AssociateProfitPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">PROFIT STRAIGHT SALE</h1>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          Ventes directes, dépense Meta Ads associée et coût de revient réel des articles vendus.
        </p>
      </div>
      <ProfitCalculator endpoint="/api/associate/profit" alerts={false} storageKey="msgate.profit-calculator.associate" />
    </div>
  );
}
