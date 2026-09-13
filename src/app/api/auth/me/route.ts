import { NextResponse } from "next/server";
import { appUserFor, getAuthSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** L'utilisateur de la session en cours, ou 401 : c'est ce que l'interface vérifie au chargement. */
export async function GET(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : null;
  const session = verifySession(value, getAuthSecret());
  if (!session) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  return NextResponse.json({ user: appUserFor(session) });
}
