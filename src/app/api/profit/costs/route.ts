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
    // Un coût par nom de produit : c'est le seul repère commun aux commandes Reign et Shopify,
    // et deux fiches au même nom (« Snakelace - Venom » à 29,99 et 39,99 $) sont le même article.
    const byTitle = new Map<string, CatalogProduct>();
    for (const store of stores) {
      for (const product of await listStoreProducts(store.id)) {
        if (product.isSubscriptionProduct || product.status === "draft") continue;
        const prices = product.variants.map((variant) => moneyToNumber(variant.price)).filter((price) => price > 0);
        const domain = store.domain || store.name || store.id;
        const key = `${domain}|${product.title}`;
        const known = byTitle.get(key);
        const price = prices.length ? Math.min(...prices) : null;
        byTitle.set(key, {
          id: product.title,
          title: product.title,
          store: domain,
          price: known?.price != null && price != null ? Math.min(known.price, price) : (known?.price ?? price),
          imageUrl: known?.imageUrl ?? product.imageUrl,
        });
      }
    }
    const products = [...byTitle.values()];
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
