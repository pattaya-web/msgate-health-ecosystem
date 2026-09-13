import { NextResponse, type NextRequest } from "next/server";
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
  // Les liens internes de la boutique sont déjà en `/s/<slug>/…` : on les laisse passer.
  if (pathname.startsWith("/s/") || pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return NextResponse.next();

  const site = await getEcomSiteByDomain(host);
  if (!site) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/s/${site.slug}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.rewrite(url);
}

export const config = {
  // Ni les fichiers statiques ni les images optimisées : rien à réécrire là.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|woff2?)$).*)"],
};
