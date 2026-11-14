import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { ProductView, Storefront } from "@/components/ecom-sites/storefront";
import { getEcomSiteByDomain, getEcomSiteBySlug } from "@/lib/ecom-sites/store";
import { findProduct } from "@/lib/ecom-sites/product-facts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; handle: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
  const { slug, handle } = await params;
  const site = await getEcomSiteBySlug(slug);
  const product = site ? findProduct(site.products, handle)?.product : undefined;
  if (!site || !product) return { title: "Product" };
  return { title: `${product.name} | ${site.brandName}`, description: product.description };
}

export default async function EcomProductPage({ params }: Ctx) {
  const { slug, handle } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) notFound();
  const found = findProduct(site.products, handle);
  if (!found) notFound();

  /*
   * Une ancienne adresse (produit renommé) redirige en permanent vers la
   * nouvelle : les liens partagés et les pubs déjà en ligne restent valides.
   * Sur le domaine de la boutique, les adresses n'ont pas le préfixe /s/<slug>.
   */
  if (found.moved) {
    const host = (await headers()).get("host") ?? "";
    const onOwnDomain = Boolean(site.domain) && (await getEcomSiteByDomain(host))?.id === site.id;
    permanentRedirect(`${onOwnDomain ? "" : `/s/${site.slug}`}/product/${found.product.handle}`);
  }

  return (
    <Storefront site={site}>
      <ProductView site={site} product={found.product} />
    </Storefront>
  );
}
