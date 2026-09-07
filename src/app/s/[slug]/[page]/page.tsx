import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AboutView, ContactView, PolicyView, Storefront } from "@/components/ecom-sites/storefront";
import { buildPolicy, POLICY_LABELS, POLICY_SLUGS, type PolicySlug } from "@/lib/ecom-sites/policies";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; page: string }> };

/** Les pages statiques `shop` et `product` sont résolues avant ce segment. */
function isPolicy(value: string): value is PolicySlug {
  return (POLICY_SLUGS as readonly string[]).includes(value);
}

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
  const { slug, page } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) return { title: "Page" };
  if (isPolicy(page)) return { title: `${POLICY_LABELS[page]} | ${site.brandName}` };
  if (page === "about") return { title: `About | ${site.brandName}` };
  if (page === "contact") return { title: `Contact | ${site.brandName}` };
  return { title: site.brandName };
}

export default async function EcomStaticPage({ params }: Ctx) {
  const { slug, page } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (!site) notFound();

  if (isPolicy(page)) {
    return (
      <Storefront site={site}>
        <PolicyView site={site} doc={buildPolicy(site, page)} />
      </Storefront>
    );
  }

  if (page === "about") {
    return (
      <Storefront site={site}>
        <AboutView site={site} />
      </Storefront>
    );
  }

  if (page === "contact") {
    return (
      <Storefront site={site}>
        <ContactView site={site} />
      </Storefront>
    );
  }

  notFound();
}
