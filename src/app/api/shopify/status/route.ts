import { NextResponse } from "next/server";
import { getGrantedScopes, getShopInfo, getShopifyConfig } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

const REQUIRED_SCOPES = ["read_orders", "read_reports"];

/** Shopify folds read access into the matching write scope. */
function hasScope(granted: string[], required: string) {
  return granted.includes(required) || granted.includes(required.replace(/^read_/, "write_"));
}

export async function GET() {
  const config = getShopifyConfig();
  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Shopify not configured — set SHOPIFY_SHOP_DOMAIN plus SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local",
      },
      { status: 503 }
    );
  }

  try {
    const scopes = await getGrantedScopes();
    const shop = await getShopInfo();
    const missing = REQUIRED_SCOPES.filter((scope) => !hasScope(scopes, scope));
    const writeScopes = scopes.filter((scope) => scope.includes("write_"));

    return NextResponse.json({
      ok: missing.length === 0,
      shop: shop.name,
      domain: shop.myshopifyDomain,
      currency: shop.currencyCode,
      apiVersion: config.apiVersion,
      auth: config.staticToken ? "static-token" : "client-credentials",
      scopes,
      missingScopes: missing,
      writeScopes,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Shopify status failed" },
      { status: 502 }
    );
  }
}
