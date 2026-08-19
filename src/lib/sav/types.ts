/**
 * SAV — boîte support@ lue directement en IMAP.
 *
 * L'agent SAV travaille dans le webmail Namecheap, donc ses réponses
 * n'existent que dans le dossier Sent du serveur : c'est la seule source
 * qui permette de mesurer son activité réelle.
 */

export type SavDirection = "in" | "out";

export type SavMessage = {
  id: string;
  direction: SavDirection;
  /** Adresse du client (l'interlocuteur externe), jamais la boîte support. */
  client: string;
  clientName: string;
  subject: string;
  date: string;
  preview: string;
  /** Corps complet — seulement chargé à l'ouverture d'un fil. */
  body?: string;
};

export type SavThread = {
  id: string;
  client: string;
  clientName: string;
  subject: string;
  messages: SavMessage[];
  firstInboundAt: string;
  lastMessageAt: string;
  lastDirection: SavDirection;
  inboundCount: number;
  outboundCount: number;
  /** Minutes entre le premier mail client et la première réponse. */
  firstReplyMinutes: number | null;
  /** Aucun message sortant après le dernier message entrant. */
  awaitingReply: boolean;
  /** Heures d'attente si le fil est en attente de réponse. */
  waitingHours: number | null;
  refundHint: boolean;
};

export type SavDayStat = {
  date: string;
  received: number;
  sent: number;
};

export type SavMetrics = {
  range: { start: string; end: string };
  totalReceived: number;
  totalSent: number;
  threads: number;
  awaiting: number;
  /** Médiane des délais de première réponse, en minutes. */
  medianFirstReplyMinutes: number | null;
  slowestFirstReplyMinutes: number | null;
  activeDays: number;
  avgSentPerActiveDay: number;
  byDay: SavDayStat[];
};

export type SavInboxPayload = {
  range: { start: string; end: string };
  threads: SavThread[];
  metrics: SavMetrics;
  fetchedAt: string;
  warnings: string[];
};

/** Verdict porté sur une réponse du SAV au regard du mail client qui la précède. */
export type SavVerdict = "ok" | "partial" | "off";

export type SavExchangeReview = {
  /** Message entrant jugé. */
  clientMessageId: string;
  /** Réponse du SAV rattachée à ce message. */
  replyMessageId: string;
  verdict: SavVerdict;
  /** Une phrase : ce qui a été ignoré, ou pourquoi la réponse tombe à côté. */
  reason: string;
};

export type SavThreadReview = {
  threadId: string;
  client: string;
  clientName: string;
  subject: string;
  /** Horodatage du dernier message au moment de l'analyse : sert de clé de fraîcheur. */
  lastMessageAt: string;
  reviewedAt: string;
  exchanges: SavExchangeReview[];
  /** Le plus mauvais verdict du fil, `null` si aucun échange analysable. */
  worst: SavVerdict | null;
};
