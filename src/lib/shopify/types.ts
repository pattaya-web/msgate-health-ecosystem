/** Refunds land on the day Shopify processed them, or on the original order's day. */
export type RefundAttribution = "processed" | "order";

export type ShopifyDailyPoint = {
  date: string;
  /** Before discounts and returns. */
  grossSales: number;
  /** gross − discounts − returns. The basis used for ROAS. */
  netSales: number;
  /** net + shipping + taxes + duties + fees, i.e. what the customer paid. */
  totalSales: number;
  /** Positive amount removed by refunds, returns, cancellations and edits. */
  returns: number;
  orders: number;
};

export type ShopifyDailyTotals = Omit<ShopifyDailyPoint, "date">;

export type ShopifyDaily = {
  shop: string;
  currency: string;
  range: { start: string; end: string };
  attribution: RefundAttribution;
  /** ShopifyQL mirrors the native reports; the orders scan is the fallback. */
  source: "shopifyql" | "orders";
  series: ShopifyDailyPoint[];
  totals: ShopifyDailyTotals;
  warnings: string[];
};

export type ShopifyQlResponse = {
  data?: {
    shopifyqlQuery?: {
      tableData?: {
        columns?: Array<{ name: string; dataType: string; displayName?: string }>;
        /** Rows are keyed by column name, not positional arrays. */
        rows?: Array<Record<string, string | number | null>>;
      } | null;
      parseErrors?: string[] | null;
    } | null;
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      throttleStatus?: { currentlyAvailable: number; maximumAvailable: number; restoreRate: number };
    };
  };
};

export type ShopifyOrderNode = {
  id: string;
  createdAt: string;
  test: boolean;
  cancelledAt: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  subtotalPriceSet: { shopMoney: { amount: string } } | null;
  totalDiscountsSet: { shopMoney: { amount: string } } | null;
  totalShippingPriceSet: { shopMoney: { amount: string } } | null;
  totalTaxSet: { shopMoney: { amount: string } } | null;
  totalPriceSet: { shopMoney: { amount: string } };
  refunds: Array<{
    id: string;
    createdAt: string;
    totalRefundedSet: { shopMoney: { amount: string } };
  }>;
};

export type ShopifyOrdersResponse = {
  data?: {
    orders?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ShopifyOrderNode[];
    };
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      throttleStatus?: { currentlyAvailable: number; maximumAvailable: number; restoreRate: number };
    };
  };
};
