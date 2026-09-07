import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { HomeView, Storefront } from "@/components/ecom-sites/storefront";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) return { title: "Store" };
  return {
    title: `${site.brandName}${site.tagline ? ` — ${site.tagline}` : ""}`,
    description: site.heroSubtitle,
  };
}

export default async function EcomHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) notFound();
  return (
    <Storefront site={site}>
      <HomeView site={site} />
    </Storefront>
  );
}
