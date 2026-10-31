"use client";

import { MailX } from "lucide-react";
import { SavBoard } from "@/components/sav/sav-board";
import { useAuth } from "@/lib/auth/auth-context";

/** L'associée n'a pas encore de boîte mail branchée : pas la boîte SAV de Mady, un écran vide en attendant. */
export default function SavPage() {
  const { isAssociate } = useAuth();
  if (!isAssociate) return <SavBoard />;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
        SAV
      </h1>
      <div className="r-card flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="r-icon h-12 w-12 rounded-full">
          <MailX className="h-5 w-5" />
        </span>
        <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
          Aucune boîte mail connectée
        </p>
        <p className="r-sub max-w-sm">Les mails clients de Venom apparaîtront ici une fois la boîte mail branchée.</p>
      </div>
    </div>
  );
}
