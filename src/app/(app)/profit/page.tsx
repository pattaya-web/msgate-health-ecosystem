"use client";

import { ProfitCalculator } from "@/components/phoenix/profit-calculator";

export default function ProfitPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Profit calculator
        </h1>
        <p className="text-[12px] text-slate-500">
          CA, refunds et spend publicitaire sur la période, alertes Ethoca / CDRN / RDR comptées
          depuis Disputifier. Seuls les taux et coûts restent à saisir.
        </p>
      </div>

      <ProfitCalculator />
    </div>
  );
}
