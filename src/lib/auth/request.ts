import { getAuthSecret, SESSION_COOKIE, verifySession, type SessionUser } from "@/lib/auth/session";

/**
 * La session derrière une requête d'API, lue dans le cookie signé.
 *
 * Le proxy a déjà refusé les appels sans session ; ici on relit qui appelle
 * quand une route doit en faire plus que « connecté ou pas » — réservée à
 * l'admin, par exemple. Null si le cookie manque ou ne vérifie pas.
 */
export function sessionFromRequest(request: Request): SessionUser | null {
  const header = request.headers.get("cookie") ?? "";
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
  return verifySession(value, getAuthSecret());
}
