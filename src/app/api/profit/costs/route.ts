import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { getProductCosts, saveProductCosts } from "@/lib/metrics/product-costs";
import { getReignConfig, listStoreProducts, listStores, moneyToNumber } from "@/lib/reign/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CatalogProduct = { id: string; title: string; store: string; price: number | null; imageUrl: string | null };

const catalogCache = ((globalThis as typeof globalThis & { __msgateCogsCatalog?: { at: number; products: CatalogProduct[] } | null }).__msgateCogsCatalog ??= null);
let catalog = catalogCache;

/** Les produits physiques vendus par les boutiques Reign (pas les gabarits d'abonnement). Gardé 10 minutes. */
async function loadCatalog(): Promise<{ products: CatalogProduct[]; error: string | null }> {
  if (!getReignConfig()) return { products: [], error: "Reign n'est pas configuré" };
  if (catalog && Date.now() - catalog.at < 10 * 60 * 1000) return { products: catalog.products, error: null };
  try {
    const stores = await listStores();
    const products: CatalogProduct[] = [];
    for (const store of stores) {
      for (const product of await listStoreProducts(store.id)) {
        if (product.isSubscriptionProduct || product.status === "draft") continue;
        const prices = product.variants.map((variant) => moneyToNumber(variant.price)).filter((price) => price > 0);
        products.push({
          id: product.id,
          title: product.title,
          store: store.domain || store.name || store.id,
          price: prices.length ? Math.min(...prices) : null,
          imageUrl: product.imageUrl,
        });
      }
    }
    catalog = { at: Date.now(), products };
    (globalThis as typeof globalThis & { __msgateCogsCatalog?: typeof catalog }).__msgateCogsCatalog = catalog;
    return { products, error: null };
  } catch (error) {
    return { products: catalog?.products ?? [], error: error instanceof Error ? error.message : "Catalogue indisponible" };
  }
}

/** Les coûts de revient de base et le catalogue Reign : réservé à l'admin. */
export async function GET(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
  const [costs, { products, error }] = await Promise.all([getProductCosts(), loadCatalog()]);
  return NextResponse.json({ costs, products, error });
}

export async function PUT(request: Request) {
  if (sessionFromRequest(request)?.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
  let body: { defaultUnitCost?: unknown; products?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  const products = body.products && typeof body.products === "object" ? body.products : undefined;
  return NextResponse.json({ costs: await saveProductCosts({ defaultUnitCost: body.defaultUnitCost, products }) });
}
