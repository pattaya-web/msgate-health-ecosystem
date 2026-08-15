import type { AccountNode, CampaignNode } from "@/lib/meta/types";

/**
 * Operator board for ad accounts. Kill anything Meta has already blocked;
 * everything else is staged by lifetime spend so a new account is warmed
 * before it is handed to scaling.
 *
 *   Live          →  above $50
 *   Ready to go   →  $25–$50, no restriction
 *   Warming       →  $10 < lifetime < $25
 *   Need warming  →  lifetime ≤ $10
 *   Kill          →  payment error / disabled / blocked

/** Left-rail order: fresh deliveries first, then healthy → kill. */
export const FLOW_LANES = ["new", "live", "ready", "warming", "need", "kill"] as const;
export type FlowLane = (typeof FLOW_LANES)[number];

export const FLOW_LABELS: Record<FlowLane, string> = {
  new: "Nouveaux",
  live: "Live",
  ready: "Ready to go",
  warming: "Warming",
  need: "Need warming",
  kill: "Kill / Désactiver",
};

export const FLOW_HINTS: Record<FlowLane, string> = {
  new: "Ad account ou BM fraîchement livré par l'agence — pas encore vu.",
  live: "Plus de 50 $ dépensés, compte propre — déjà en prod.",
  ready: "25–50 $ et aucune restriction — prêt à scaler.",
  warming: "Spend à vie entre 10 $ et 25 $ — laisser tourner petit.",
  need: "Spend à vie ≤ 10 $ — le compte n'a pas encore chauffé.",
  kill: "Payment error, compte disabled, ou campagne bloquée — à couper.",
};

const ACCOUNT_STATUS: Record<number, string> = {
  1: "Actif",
  2: "Disabled",
  3: "Payment error",
  7: "Risk review",
  8: "Pending settlement",
  9: "Grace period",
  100: "Pending closure",
  101: "Fermé",
};

const DISABLE_REASON: Record<number, string> = {
  1: "Ads integrity policy",
  2: "IP review",
  3: "Risk payment",
  4: "Gray account shut down",
  5: "AFC review",
  6: "Business integrity",
  7: "Fermeture permanente",
  8: "Unused reseller",
  9: "Unused account",
  11: "BM integrity policy",
  12: "Misrepresented account",
};

const PAYMENT_STATUSES = new Set(["PENDING_BILLING_INFO"]);
const PAYMENT_WORDS = /billing|payment|unpaid|credit.?card|funding|spend limit|account spend|paiement|impay/i;

export type FlowAccount = {
  account: AccountNode;
  lane: FlowLane;
  reasons: string[];
  paymentCampaigns: CampaignNode[];
  activeCampaigns: number;
};

export function accountStatusLabel(code: number) {
  return ACCOUNT_STATUS[code] || `Statut ${code}`;
}

export function isAccountRestricted(account: AccountNode) {
  return account.accountStatus !== 1;
}

/** Account can actually deliver ads (not disabled). */
export function isAccountOperable(account: AccountNode) {
  return account.accountStatus === 1 && !account.disableReason;
}

/**
 * Same gate as the Kill volet: disabled, payment error, or billing-blocked
 * campaigns. Those accounts must not appear in Hyper/Scaling/Testing tabs.
 */
export function isAccountKilled(account: AccountNode) {
  if (!isAccountOperable(account)) return true;
  return paymentCampaignsOf(account).length > 0;
}

/**
 * Campaign is really on — Meta often keeps status=ACTIVE while
 * effective_status is ACCOUNT_DISABLED, PAUSED, WITH_ISSUES, etc.
 */
export function isCampaignLive(campaign: CampaignNode) {
  return campaign.status === "ACTIVE" && campaign.effectiveStatus === "ACTIVE";
}

export function paymentCampaignsOf(account: AccountNode) {
  return account.campaigns.filter((campaign) => {
    if (PAYMENT_STATUSES.has(campaign.effectiveStatus)) return true;
    const blob = [
      campaign.effectiveStatus,
      ...(campaign.issues || []).map((issue) => `${issue.type} ${issue.summary} ${issue.message}`),
    ].join(" ");
    return PAYMENT_WORDS.test(blob);
  });
}

export function classifyAccount(account: AccountNode): FlowAccount {
  const paymentCampaigns = paymentCampaignsOf(account);
  const reasons: string[] = [];
  const activeCampaigns = account.campaigns.filter((campaign) => campaign.status === "ACTIVE").length;

  if (account.accountStatus !== 1) {
    reasons.push(accountStatusLabel(account.accountStatus));
  }
  if (account.disableReason) {
    reasons.push(DISABLE_REASON[account.disableReason] || `Restriction ${account.disableReason}`);
  }
  if (paymentCampaigns.length) {
    reasons.push(
      paymentCampaigns.length === 1
        ? `Campagne payment error : ${paymentCampaigns[0].name}`
        : `${paymentCampaigns.length} campagnes en payment error`
    );
  }

  if (reasons.length) {
    return { account, lane: "kill", reasons, paymentCampaigns, activeCampaigns };
  }

  if (account.isNew) {
    reasons.push("Nouveau compte détecté automatiquement");
    return { account, lane: "new", reasons, paymentCampaigns, activeCampaigns };
  }

  const spent = account.lifetimeSpend;
  const lane: FlowLane = spent <= 10 ? "need" : spent < 25 ? "warming" : spent <= 50 ? "ready" : "live";

  if (lane === "need") reasons.push("Spend à vie trop bas pour chauffer");
  if (lane === "warming") reasons.push("Encore sous les 25 $");
  if (lane === "ready") reasons.push("Compte propre, 25–50 $");
  if (lane === "live") reasons.push("Déjà au-dessus de 50 $");

  return { account, lane, reasons, paymentCampaigns, activeCampaigns };
}

export function classifyAccounts(accounts: AccountNode[]): Record<FlowLane, FlowAccount[]> {
  const board: Record<FlowLane, FlowAccount[]> = {
    new: [],
    kill: [],
    need: [],
    warming: [],
    ready: [],
    live: [],
  };

  for (const account of accounts) {
    const row = classifyAccount(account);
    board[row.lane].push(row);
  }

  for (const lane of FLOW_LANES) {
    board[lane].sort((a, b) => a.account.lifetimeSpend - b.account.lifetimeSpend);
    if (lane === "kill" || lane === "live") {
      board[lane].sort((a, b) => b.account.lifetimeSpend - a.account.lifetimeSpend);
    }
  }

  return board;
}
