import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ShopView, Storefront } from "@/components/ecom-sites/storefront";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  return { title: site ? `Shop | ${site.brandName}` : "Shop" };
}

export default async function EcomShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) notFound();

  const raw = (await searchParams).cat;
  const cat = Array.isArray(raw) ? raw[0] : raw;

  return (
    <Storefront site={site}>
      <ShopView site={site} category={cat} />
    </Storefront>
  );
}
