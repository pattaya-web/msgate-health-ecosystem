export const ALERT_TYPES = ["ethoca", "cdrn", "rdr"] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  ethoca: "Ethoca",
  cdrn: "CDRN",
  rdr: "RDR",
};

export type DisputifierMid = {
  mid_id: string;
  mid_name: string;
  status?: string | null;
};

export type DisputifierMerchant = {
  merchantId: string;
  merchantName: string;
  merchantEmail: string | null;
  mids: DisputifierMid[];
  /** Index de la clé ORG-API-KEY qui donne accès à ce marchand (plusieurs organisations). */
  keyIndex: number;
};

/** Alerte normalisée : les trois endpoints Disputifier renvoient des champs différents. */
export type DisputifierAlert = {
  id: string;
  type: AlertType;
  merchantId: string;
  merchantName: string;
  midId: string | null;
  midName: string | null;
  /**
   * `api` : MID renvoyé par Disputifier. `inferred` : MID retrouvé en cherchant le
   * numéro du MID dans le descriptor (les alertes RDR n'en portent jamais).
   */
  midSource: "api" | "inferred" | null;
  /** `MerchantName` de l'alerte : porte souvent le numéro du MID en clair. */
  alertLabel: string | null;
  orderNumber: string | null;
  caseId: string | null;
  /** `YYYY-MM-DD HH:mm:ss` tel que renvoyé par Disputifier. */
  alertAt: string;
  transactionAt: string | null;
  amount: number;
  currency: string;
  cardLast4: string | null;
  issuer: string | null;
  reasonCode: string | null;
  descriptor: string | null;
  refundAction: string | null;
  flagAction: string | null;
};

export type AlertTotals = {
  count: number;
  amount: number;
  byType: Record<AlertType, { count: number; amount: number }>;
};

export type Bucket = { count: number; amount: number };

/** Une ligne du récapitulatif « combien d'alertes et combien d'argent sur ce MID ». */
export type MidSummary = {
  midId: string | null;
  midName: string;
  merchantName: string;
  count: number;
  amount: number;
  inferred: number;
  byType: Record<AlertType, Bucket>;
  /** Remboursements déjà passés : c'est ce qui sort réellement du compte. */
  refunded: Bucket;
  notRefunded: Bucket;
  /** Alertes retombées en chargeback : montant perdu + frais côté acquéreur. */
  chargebacks: Bucket;
};

export type AlertsResponse = {
  alerts: DisputifierAlert[];
  totals: AlertTotals;
  byMid: MidSummary[];
  merchants: DisputifierMerchant[];
  /** Une organisation injoignable ne doit pas masquer les autres. */
  errors: string[];
  truncated: boolean;
};

export function emptyTotals(): AlertTotals {
  return {
    count: 0,
    amount: 0,
    byType: {
      ethoca: { count: 0, amount: 0 },
      cdrn: { count: 0, amount: 0 },
      rdr: { count: 0, amount: 0 },
    },
  };
}

export function sumTotals(alerts: DisputifierAlert[]): AlertTotals {
  const totals = emptyTotals();
  for (const alert of alerts) {
    totals.count += 1;
    totals.amount += alert.amount;
    totals.byType[alert.type].count += 1;
    totals.byType[alert.type].amount += alert.amount;
  }
  return totals;
}

export const NO_MID = "__no_mid__";

/** `Refund_action` vaut « Refunded » / « Not Refunded » selon les endpoints. */
export function isRefunded(alert: DisputifierAlert) {
  return (alert.refundAction ?? "").toLowerCase().startsWith("refunded");
}

/** Une alerte non traitée à temps retombe en chargeback : montant perdu + frais. */
export function isChargeback(alert: DisputifierAlert) {
  return (alert.flagAction ?? "").toLowerCase().includes("chargeback");
}

export function summarizeByMid(alerts: DisputifierAlert[]): MidSummary[] {
  const rows = new Map<string, MidSummary>();

  for (const alert of alerts) {
    const key = alert.midId ?? NO_MID;
    let row = rows.get(key);
    if (!row) {
      row = {
        midId: alert.midId,
        midName: alert.midName ?? "Sans MID",
        merchantName: alert.merchantName,
        count: 0,
        amount: 0,
        inferred: 0,
        byType: {
          ethoca: { count: 0, amount: 0 },
          cdrn: { count: 0, amount: 0 },
          rdr: { count: 0, amount: 0 },
        },
        refunded: { count: 0, amount: 0 },
        notRefunded: { count: 0, amount: 0 },
        chargebacks: { count: 0, amount: 0 },
      };
      rows.set(key, row);
    }

    row.count += 1;
    row.amount += alert.amount;
    if (alert.midSource === "inferred") row.inferred += 1;
    row.byType[alert.type].count += 1;
    row.byType[alert.type].amount += alert.amount;

    const bucket = isRefunded(alert) ? row.refunded : row.notRefunded;
    bucket.count += 1;
    bucket.amount += alert.amount;

    if (isChargeback(alert)) {
      row.chargebacks.count += 1;
      row.chargebacks.amount += alert.amount;
    }
  }

  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}
