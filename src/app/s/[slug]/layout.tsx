import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";
import { SESSION_COOKIE, getAuthSecret, verifySession } from "@/lib/auth/session";
import { previewCookieName, verifyPreviewToken } from "@/lib/ecom-sites/preview-link";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap" });

type Props = { children: React.ReactNode; params: Promise<{ slug: string }> };

/** Une boutique en brouillon n'est pas indexée. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  return site?.status === "draft" ? { robots: { index: false, follow: false } } : {};
}

/**
 * Une boutique en brouillon n'est visible que d'un compte connecté.
 *
 * Elle naît en brouillon à la génération et passe en ligne par « Publier »,
 * une fois le contrôle passé. Le public (et le domaine de la boutique, où la
 * session du CRM n'existe pas) voit une page d'attente sobre, sans produit ni
 * texte généré.
 */
export default async function EcomSiteLayout({ children, params }: Props) {
  const { slug } = await params;
  const site = await getEcomSiteBySlug(slug);
  if (site?.status === "draft") {
    const jar = await cookies();
    const session = verifySession(jar.get(SESSION_COOKIE)?.value, getAuthSecret());
    // Ou un lien d'aperçu ouvert dans ce navigateur (voir lib/ecom-sites/preview-link).
    const preview = verifyPreviewToken(site.slug, jar.get(previewCookieName(site.slug))?.value, getAuthSecret());
    if (!session && !preview) {
      return (
        <div className={jakarta.className}>
          <main className="flex min-h-screen items-center justify-center bg-[#f8f8f7] px-6 text-center text-[#141414]">
            <div>
              <p className="text-[22px] font-bold">{site.brandName}</p>
              <p className="mt-2 text-[14px] text-[#6b6b6b]">This store is not open yet.</p>
            </div>
          </main>
        </div>
      );
    }
  }
  return <div className={jakarta.className}>{children}</div>;
}
