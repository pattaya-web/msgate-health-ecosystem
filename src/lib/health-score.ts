import type {
  Alert,
  AppSettings,
  Bank,
  EcosystemHealthByCategory,
  Ibo,
  Mid,
  RecoveryCase,
  SystemHealthResult,
  SystemHealthRule,
} from "@/types";

export function getHealthLabel(score: number): SystemHealthResult["status"] {
  if (score >= 85) return "healthy";
  if (score >= 70) return "monitor";
  return "critical";
}

/**
 * Pilot health: starts healthy. Only degrades on real losses
 * (IBO actif sans bank / sans MID, MID perdu sans remplacement, recovery critique).
 * Goal shortfalls do NOT hurt health — they show in Objectifs progression only.
 */
export function calculateSystemHealth(params: {
  ibos: Ibo[];
  banks: Bank[];
  mids: Mid[];
  alerts: Alert[];
  recoveryCases: RecoveryCase[];
  rules: SystemHealthRule[];
  settings: AppSettings;
}): SystemHealthResult {
  const { ibos, banks, mids, alerts, recoveryCases, rules } = params;
  void params.settings;
  const enabled = new Map(rules.filter((r) => r.enabled).map((r) => [r.key, r]));
  const appliedPenalties: SystemHealthResult["appliedPenalties"] = [];

  const add = (key: string, detail: string) => {
    const rule = enabled.get(key);
    if (!rule) return;
    if (appliedPenalties.some((p) => p.rule === rule.label)) return;
    appliedPenalties.push({ rule: rule.label, penalty: rule.penalty, detail });
  };

  const activeIbos = ibos.filter((i) => i.status === "active");

  for (const ibo of activeIbos) {
    const banksCount = Number(ibo.active_banks_count) || 0;
    const midsCount = Number(ibo.active_mids_count) || 0;
    const name = ibo.display_name || ibo.reference_code;

    if (banksCount <= 0) {
      const fromRows = banks.filter(
        (b) => b.ibo_id === ibo.id && (b.status === "active" || b.status === "backup")
      ).length;
      if (fromRows <= 0) {
        add("ibo_no_active_bank", `${name} : plus aucune bank active`);
      }
    } else if (banksCount === 1) {
      add(
        "ibo_less_than_recommended_banks",
        `${name} : 1 bank seulement — ajouter un compte backup (2 min)`
      );
    }

    if (midsCount <= 0) {
      const fromRows = mids.filter(
        (m) => m.ibo_id === ibo.id && (m.status === "active" || m.status === "backup")
      ).length;
      if (fromRows <= 0) {
        add("ibo_no_active_mid", `${name} : plus aucun MID approuvé`);
      }
    }
  }

  const closedMids = mids.filter((m) => m.status === "closed");
  for (const mid of closedMids) {
    const hasReplacement = mids.some(
      (m) =>
        m.id !== mid.id &&
        m.ibo_id === mid.ibo_id &&
        (m.status === "active" || m.status === "backup")
    );
    const ibo = ibos.find((i) => i.id === mid.ibo_id);
    const iboStillHasMids = (Number(ibo?.active_mids_count) || 0) > 0;
    if (!hasReplacement && !iboStillHasMids) {
      add("mid_closed_no_replacement", `${mid.reference_code} fermé sans remplacement`);
    }
  }

  const payoutAlerts = alerts.filter(
    (a) =>
      a.status === "active" &&
      a.level === "critical" &&
      a.category === "Finance" &&
      a.title.toLowerCase().includes("payout")
  );
  if (payoutAlerts.length > 0) {
    add("payout_overdue", `${payoutAlerts.length} payout critique(s) en retard`);
  }

  for (const rc of recoveryCases.filter(
    (c) => !["resolved", "lost_funds", "funds_recovered"].includes(c.status)
  )) {
    const hours = (Date.now() - new Date(rc.created_at).getTime()) / (1000 * 60 * 60);
    if (hours > 48) {
      add("recovery_open_over_48h", `${rc.title} ouvert depuis ${Math.floor(hours)}h`);
    }
  }

  const totalPenalty = appliedPenalties.reduce((sum, p) => sum + p.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));
  const status = getHealthLabel(score);

  let explanation = "Écosystème en bonne santé — rien de critique.";
  if (status === "healthy") {
    explanation =
      appliedPenalties.length === 0
        ? "Bonne santé. Les objectifs se suivent à part (progression)."
        : "Bonne santé globale.";
  } else if (status === "monitor") {
    explanation = "À surveiller : perte partielle (MID / bank) ou dossier ouvert.";
  } else {
    explanation = "Santé dégradée : perte de capacité (MID / bank) — action requise.";
  }

  return { score, status, explanation, appliedPenalties };
}

export function calculateCategoryHealth(params: {
  ibos: Ibo[];
  banks: Bank[];
  mids: Mid[];
  crmsActive: number;
  crmsTotal: number;
  shopsActive: number;
  shopsTotal: number;
}): EcosystemHealthByCategory {
  const { ibos, banks, mids, crmsActive, crmsTotal, shopsActive, shopsTotal } = params;

  const iboHealthy = ibos.filter((i) => (Number(i.active_banks_count) || 0) >= 1).length;
  const ibo = ibos.length ? Math.round((iboHealthy / ibos.length) * 100) : 100;

  const bankingOk = banks.filter((b) => b.status === "active" || b.status === "backup").length;
  const banking = banks.length ? Math.round((bankingOk / banks.length) * 100) : 100;

  const midOk = mids.filter((m) => m.status === "active" || m.status === "backup").length;
  const mid = mids.length ? Math.round((midOk / mids.length) * 100) : 100;

  const crm = crmsTotal ? Math.round((crmsActive / crmsTotal) * 100) : 100;
  const shop = shopsTotal ? Math.round((shopsActive / shopsTotal) * 100) : 100;

  return { ibo, banking, mid, crm, shop };
}
