import type { Ibo } from "@/types";

export type BankActionLevel = "critical" | "warning" | "ok";

export type BankAction = {
  id: string;
  iboId: string;
  iboName: string;
  llcLabel: string;
  banks: number;
  level: BankActionLevel;
  title: string;
  detail: string;
};

/** Actions pilotage banques — pour l’instant focus banks only */
export function computeBankActions(ibos: Ibo[]): BankAction[] {
  const actions: BankAction[] = [];

  for (const ibo of ibos) {
    if (ibo.status === "closed" || ibo.status === "declined") continue;
    const banks = Number(ibo.active_banks_count) || 0;
    const name = ibo.display_name || ibo.reference_code;
    const llc = ibo.linked_llcs_label?.trim() || "—";

    if (banks <= 0) {
      actions.push({
        id: `bank-0-${ibo.id}`,
        iboId: ibo.id,
        iboName: name,
        llcLabel: llc,
        banks,
        level: "critical",
        title: "Aucune bank",
        detail: "Ouvrir au moins 1 compte bank, puis un 2e backup.",
      });
    } else if (banks === 1) {
      actions.push({
        id: `bank-1-${ibo.id}`,
        iboId: ibo.id,
        iboName: name,
        llcLabel: llc,
        banks,
        level: "warning",
        title: "2e bank backup manquante",
        detail: "1 compte seulement → ajouter un compte backup (objectif 2 min).",
      });
    }
  }

  // Critical first, then warning; stable by name
  const rank = { critical: 0, warning: 1, ok: 2 } as const;
  return actions.sort((a, b) => {
    const d = rank[a.level] - rank[b.level];
    if (d !== 0) return d;
    return a.iboName.localeCompare(b.iboName, "fr");
  });
}
