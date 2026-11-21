import { NextResponse } from "next/server";
import { getAuthSecret, sessionCookie, signSession } from "@/lib/auth/session";
import { readClosers } from "@/lib/closer/store";

export const dynamic = "force-dynamic";

/**
 * Le lien personnel d'un closer : /api/closer/acces?t=<clé>. Pas de mot de
 * passe : la clé du lien ouvre sa session (rôle « closer », son agenda
 * seulement), puis on l'envoie sur /closer. Une clé régénérée par l'admin
 * rend l'ancien lien inutilisable ; retirer le closer coupe aussi ses sessions.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t")?.trim() ?? "";
  const secret = getAuthSecret();
  const target = new URL("/closer", url);
  const login = new URL("/login", url);
  // Derrière le proxy, l'hôte vu par Next peut être interne : on garde celui du navigateur.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
    for (const u of [target, login]) {
      u.host = host;
      u.protocol = `${proto}:`;
    }
  }
  if (!secret || token.length < 20) return NextResponse.redirect(login);
  const { closers } = await readClosers();
  const closer = closers.find((item) => item.active && item.accessToken === token);
  if (!closer) return NextResponse.redirect(login);
  const response = NextResponse.redirect(target);
  response.cookies.set(sessionCookie(signSession({ email: closer.identifier, role: "closer" }, secret)));
  return response;
}
