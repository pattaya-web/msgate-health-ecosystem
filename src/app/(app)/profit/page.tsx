"use client";

import { useState } from "react";
import { ProfitCalculator } from "@/components/phoenix/profit-calculator";
import { CogsEditor } from "@/components/phoenix/cogs-editor";
import { useAuth } from "@/lib/auth/auth-context";

export default function ProfitPage() {
  const { isAdmin } = useAuth();
  // Enregistrer les COGS recharge le calculateur, pour voir la marge bouger tout de suite.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Profit calculator
        </h1>
        <p className="text-[12px] text-slate-500">
          Straight sale, abonnements (VIP Initial, Recurring, Salvage), upsells, refunds et spend Meta
          sur la période ; COGS calculés sur les unités vendues. Seuls les taux restent à saisir.
        </p>
      </div>

      <ProfitCalculator refreshKey={refreshKey} />

      {isAdmin ? <CogsEditor onSaved={() => setRefreshKey((key) => key + 1)} /> : null}
    </div>
  );
}
