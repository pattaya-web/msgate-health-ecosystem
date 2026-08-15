import { NextResponse } from "next/server";
import { getShopifyConfig, getShopifyDaily } from "@/lib/shopify/client";
import type { RefundAttribution } from "@/lib/shopify/types";

export const dynamic = "force-dynamic";

function defaultRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const isDate = (value: string | null): value is string => Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));

export async function GET(request: Request) {
  try {
    if (!getShopifyConfig()) {
      return NextResponse.json(
        { error: "Shopify not configured — set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_TOKEN in .env.local" },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fallback = defaultRange();
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const attribution: RefundAttribution =
      searchParams.get("attribution") === "order" ? "order" : "processed";

    const data = await getShopifyDaily({
      start: isDate(start) ? start : fallback.start,
      end: isDate(end) ? end : fallback.end,
      attribution,
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shopify fetch failed" },
      { status: 502 }
    );
  }
}
