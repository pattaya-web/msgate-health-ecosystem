export type PhoenixStore = {
  Title: string;
  DomainUrl: string;
  ShopifyId?: string;
  StoreCode: number;
  IsDeleted?: boolean;
  Type?: string;
};

export type PhoenixStoresResponse = {
  Result: PhoenixStore[];
  TotalCount: number;
  Page: number;
  Limit: number;
};

export type PhoenixCustomer = {
  CustomerId: number;
  Email?: string;
  FirstName?: string;
  LastName?: string;
  City?: string;
  State?: string;
  Country?: string;
  EnrollmentDate?: string;
  SuccessOrderId?: number;
  NextBillingDate?: string;
  CancelledReason?: string | null;
  CancelledSubscriptionDate?: string | null;
  BillingFrequency?: string | null;
  SubscriptionPrice?: number | null;
  SubscriptionStatus?: PhoenixSubscriptionStatus | string;
  OriginalTransactionDate?: string;
  VaultEnabled?: boolean;
};

/** Values accepted by the SubscriptionStatus filter on /phxcrm/customers */
export type PhoenixSubscriptionStatus =
  | "Active"
  | "Canceled"
  | "Never Approved"
  | "Never Enrolled";

export type PhoenixCustomersResponse = {
  Result: PhoenixCustomer[];
  TotalCount: number;
  Page: number;
  Limit: number;
};

export type PhoenixTransaction = {
  Date: string;
  Amount: string;
  Domain?: string;
  OrderId?: number;
  TimeEnd?: string;
  VipOrder?: number;
  TimeStart?: string;
  MerchTxnRef?: number;
  ResponseCode?: string;
  MerchantAccount?: string;
  ResponseMessage?: string;
  TransactionType?: string;
  ShopifyOrderNumber?: string;
  RecurringOrderCount?: number;
  CounterPaymentTryCount?: number;
  ReferenceId?: string | null;
  ProcessorId?: string;
  GatewayCode?: string;
  AcquiringBank?: string;
  MCC?: string;
  TransactionNo?: string;
  TransactionSource?: string;
  TimeTaken?: string;
  Type?: string;
  ProcessorRouting?: string;
};

export type PhoenixTransactionHistoryResponse = {
  Result: PhoenixTransaction[];
};

export type PhoenixRefundAction = "fullRefund" | "partial_refund" | "item_refund";

export type PhoenixRefundLineItem = {
  variantId: number;
  lineItemId: number;
  refundedAmount: number;
  refundedQuantity: number;
  location?: string;
  restockType?: string;
};

export type PhoenixRefundRequest = {
  refundAmount: number | string;
  comment: string;
  orderId: number;
  actionType: PhoenixRefundAction;
  customerId: number;
  cancelSubscription: boolean;
  lineItems?: PhoenixRefundLineItem[];
};

export type PhoenixRefundResponse = {
  data?: { Msg?: string; StatusCode?: number };
  success?: boolean;
};

export type DayBucket = {
  date: string; // YYYY-MM-DD
  revenue: number;
  voids: number;
  salesCount: number;
  voidCount: number;
};

export type TxAggregates = {
  revenue: number;
  voids: number;
  salesCount: number;
  voidCount: number;
  byDay: DayBucket[];
};

/* ---------------------------------------------------------------- *
 * Dashboard model — mirrors the Phoenix "Overview" tab
 * ---------------------------------------------------------------- */

/** Order Summary buckets, derived from the transaction `Type` field. */
export type OrderCategory = "direct" | "initial" | "recurring" | "salvage" | "upsell";

/** A billing attempt is a Pre-Auth or a Direct Sale; Capture is only the settlement leg. */
export type CategoryStats = {
  attempts: number;
  approved: number;
  approvalRate: number;
  revenue: number;
};

export type SnapshotMeta = {
  builtAt: string | null;
  customers: number;
  transactions: number;
  durationMs: number;
  stale: boolean;
  /** Share of subscribers whose transaction history is in the cache (0-1). */
  coverage: number;
  complete: boolean;
};

export type SnapshotProgress = {
  running: boolean;
  phase: "idle" | "customers" | "transactions" | "done" | "error";
  done: number;
  total: number;
  /** Requests actually sent to Phoenix (the rest were served from cache). */
  fetched: number;
  cached: number;
  etaMs: number | null;
  error?: string;
  startedAt?: string;
};

export type RevenuePoint = {
  date: string;
  total: number;
  direct: number;
  initial: number;
  recurring: number;
  salvage: number;
  upsell: number;
};

export type SubscriptionPoint = {
  date: string;
  created: number;
  cancelled: number;
  net: number;
  cumulative: number;
};

export type ProcessorRow = {
  name: string;
  processorId: string;
  attempts: number;
  approved: number;
  approvalRate: number;
  revenue: number;
  refunds: number;
  refundAmount: number;
};

export type DeclineRow = {
  reason: string;
  code: string;
  count: number;
  share: number;
};

export type PhoenixOverview = {
  range: { start: string; end: string; label: string };
  client: string;
  filters: { stores: string[]; processors: string[] };
  orderSummary: Record<OrderCategory, CategoryStats>;
  targetCac: number | null;
  subscriptionsToMid: number;
  period: {
    totalTransactions: number;
    refunds: { count: number; amount: number; rate: number };
    chargebacks: { count: number; amount: number; rate: number };
    voids: { count: number; amount: number };
    approved: number;
    approvalRate: number;
  };
  /** Calendar-month tile, matching how Phoenix reports it alongside the range. */
  month: {
    label: string;
    start: string;
    end: string;
    totalTransactions: number;
    attempts: number;
    refunds: { count: number; amount: number; rate: number };
    chargebacks: { count: number; amount: number; rate: number };
  };
  lifetime: {
    activeSubscriptions: number;
    pausedSubscriptions: number | null;
    subscribersInSalvage: number;
    cancelledSubscriptions: number;
    neverApproved: number;
    totalCustomers: number;
  };
  revenue: {
    total: number;
    direct: number;
    initial: number;
    recurring: number;
    salvage: number;
    upsell: number;
    series: RevenuePoint[];
  };
  subscriptions: {
    created: number;
    cancelled: number;
    net: number;
    series: SubscriptionPoint[];
  };
  checkout: {
    processors: ProcessorRow[];
    stores: ProcessorRow[];
    declines: DeclineRow[];
  };
  options: { stores: string[]; processors: string[] };
  meta: SnapshotMeta;
};
