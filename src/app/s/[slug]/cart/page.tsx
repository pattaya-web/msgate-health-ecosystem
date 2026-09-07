import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CartView } from "@/components/ecom-sites/cart";
import { Storefront } from "@/components/ecom-sites/storefront";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  return { title: site ? `Cart | ${site.brandName}` : "Cart" };
}

export default async function EcomCartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) notFound();
  return (
    <Storefront site={site}>
      <CartView site={site} />
    </Storefront>
  );
}
