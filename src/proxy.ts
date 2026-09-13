import { NextResponse, type NextRequest } from "next/server";
import { getBankPageByDomain } from "@/lib/bank-pages/store";
import { getEcomSiteByDomain } from "@/lib/ecom-sites/store";

/**
 * Un nom de domaine devant une boutique.
 *
 * Toutes les boutiques vivent sous `/s/<slug>/…` sur l'outil. Quand un
 * domaine pointe sur le même déploiement — `sagerenew.com` → Vercel — la
 * requête arrive avec ce nom d'hôte : on la réécrit vers la boutique dont le
 * champ « Domaine » correspond, sans changer l'adresse vue par le visiteur.
 *
 * L'hôte de l'outil lui-même (localhost, *.vercel.app, ou le domaine déclaré
 * dans APP_HOSTS) n'est pas touché. Un domaine inconnu non plus : l'outil
 * répond comme d'habitude, ce qui rend le diagnostic lisible.
 */

const APP_HOSTS = (process.env.APP_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

function isAppHost(host: string) {
  if (!host || host === "localhost" || host.startsWith("127.") || host.startsWith("192.168.")) return true;
  if (host.endsWith(".vercel.app") || host.endsWith(".localhost")) return true;
  return APP_HOSTS.includes(host);
}

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (isAppHost(host)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const site = await getEcomSiteByDomain(host);
  if (!site) {
    /* Pas une boutique : peut-être une page agence (bank page). Elle tient
       sur une seule adresse ; le reste du domaine n'existe pas. */
    const bankPage = await getBankPageByDomain(host);
    if (!bankPage) return NextResponse.next();
    if (pathname.startsWith("/_next/")) return NextResponse.next();
    if (pathname === "/" || pathname === `/p/${bankPage.slug}`) {
      const url = request.nextUrl.clone();
      url.pathname = `/p/${bankPage.slug}`;
      return NextResponse.rewrite(url);
    }
    return new NextResponse("Not found", { status: 404 });
  }

  /*
   * Sur le domaine d'une boutique, seules ses propres routes existent.
   *
   * L'outil et ses API vivent sur le même déploiement : sans ce tri, un visiteur
   * de sage-renew.com pourrait lire /api/ecom-sites — toutes les boutiques, tous
   * les réglages. Ne passent que le formulaire de contact, la commande, et les
   * fichiers internes de Next.
   */
  if (pathname.startsWith("/_next/")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    const allowed = ["/api/ecom-sites/messages", "/api/ecom-sites/orders"];
    if (allowed.some((route) => pathname === route || pathname.startsWith(`${route}/`)) && request.method === "POST") return NextResponse.next();
    return new NextResponse("Not found", { status: 404 });
  }
  // Les liens internes de la boutique sont déjà en `/s/<slug>/…` : on les laisse passer, pour cette boutique seulement.
  if (pathname.startsWith("/s/")) {
    return pathname === `/s/${site.slug}` || pathname.startsWith(`/s/${site.slug}/`) ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/s/${site.slug}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.rewrite(url);
}

export const config = {
  // Ni les fichiers statiques ni les images optimisées : rien à réécrire là.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|woff2?)$).*)"],
};
