import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductView, Storefront } from "@/components/ecom-sites/storefront";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; handle: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
  const { slug, handle } = await params;
  const site = await getEcomSiteBySlug(slug);
  const product = site?.products.find((item) => item.handle === handle);
  if (!site || !product) return { title: "Product" };
  return { title: `${product.name} | ${site.brandName}`, description: product.description };
}

export default async function EcomProductPage({ params }: Ctx) {
  const { slug, handle } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) notFound();
  const product = site.products.find((item) => item.handle === handle);
  if (!product) notFound();

  return (
    <Storefront site={site}>
      <ProductView site={site} product={product} />
    </Storefront>
  );
}
