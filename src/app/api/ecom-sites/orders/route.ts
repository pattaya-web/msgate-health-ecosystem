import { NextResponse } from "next/server";
import { createOrder, listOrders } from "@/lib/ecom-sites/orders";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";

export const dynamic = "force-dynamic";

type Line = { handle?: string; qty?: number };

type Body = {
  slug?: string;
  email?: string;
  phone?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lines?: Line[];
};

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") || undefined;
  return NextResponse.json({ orders: await listOrders(slug) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.slug) return NextResponse.json({ error: "slug requis" }, { status: 400 });

    const site = await getEcomSiteBySlug(body.slug);
    if (!site) return NextResponse.json({ error: "Boutique introuvable" }, { status: 404 });

    /*
     * Les prix sont relus dans le catalogue, jamais repris du navigateur.
     *
     * Le panier vit dans le localStorage du visiteur : ce qu'il envoie est une
     * intention, pas un montant. Un total calculé sur des prix venus du client
     * est un total qu'on peut choisir soi-même depuis la console.
     */
    const byHandle = new Map(site.products.map((product) => [product.handle, product]));
    const lines = (body.lines || [])
      .map((line) => {
        const product = line.handle ? byHandle.get(line.handle) : undefined;
        if (!product) return null;
        const qty = Math.min(Math.max(Math.round(Number(line.qty) || 1), 1), 20);
        return { handle: product.handle, name: product.name, price: product.price, qty };
      })
      .filter((line): line is NonNullable<typeof line> => Boolean(line));

    if (!lines.length) return NextResponse.json({ error: "Panier vide" }, { status: 400 });

    const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    const shipping =
      site.freeShippingThreshold > 0 && subtotal >= site.freeShippingThreshold ? 0 : 4.95;

    const order = await createOrder({
      siteId: site.id,
      slug: site.slug,
      email: (body.email || "").trim(),
      phone: (body.phone || "").trim(),
      name: (body.name || "").trim(),
      address: (body.address || "").trim(),
      city: (body.city || "").trim(),
      state: (body.state || "").trim(),
      zip: (body.zip || "").trim(),
      lines,
      subtotal: Number(subtotal.toFixed(2)),
      shipping,
      total: Number((subtotal + shipping).toFixed(2)),
      currency: site.currency,
    });

    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Commande impossible" },
      { status: 502 }
    );
  }
}
