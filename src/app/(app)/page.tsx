import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * L'accueil après connexion : l'admin et l'associée arrivent sur Ventes &
 * Meta Ads (/associate), les autres rôles sur les Stats, comme avant.
 */
export default async function Home() {
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value, getAuthSecret());
  redirect(session?.role === "admin" || session?.role === "associate" ? "/associate" : "/phoenix");
}
