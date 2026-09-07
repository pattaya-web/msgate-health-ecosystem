import { NextResponse } from "next/server";
import { listShopifyProducts } from "@/lib/shopify/products";
import { getShopifyConfig } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!getShopifyConfig()) {
    return NextResponse.json(
      {
        error:
          "Shopify not configured — set SHOPIFY_SHOP_DOMAIN plus SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local",
      },
      { status: 503 }
    );
  }

  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit"));

  try {
    const catalog = await listShopifyProducts({
      query: params.get("query") || undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
    return NextResponse.json(catalog);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shopify products failed" },
      { status: 502 }
    );
  }
}
