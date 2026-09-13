import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import { appUserFor, getAuthSecret, loadAuthUsers, sessionCookie, signSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Connexion : e-mail et mot de passe contre AUTH_USERS, puis cookie de session.
 *
 * Un compte inconnu et un mot de passe faux donnent la même réponse, et le hash
 * est toujours calculé pour ne pas révéler par le temps de réponse si l'e-mail
 * existe. Aucune valeur secrète ne sort d'ici ni n'est journalisée.
 */
const DUMMY_HASH = "$scrypt$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "E-mail et mot de passe requis" }, { status: 400 });

  const secret = getAuthSecret();
  const accounts = loadAuthUsers();
  if (!secret || accounts.error) {
    console.error("[auth] connexion impossible :", !secret ? "AUTH_SECRET manquant ou trop court" : accounts.error);
    return NextResponse.json({ error: "Authentification non configurée sur le serveur" }, { status: 503 });
  }

  const account = accounts.users.find((entry) => entry.email === email) ?? null;
  const valid = account
    ? account.hash
      ? await verifyPassword(password, account.hash)
      : password === account.demoPassword
    : await verifyPassword(password, DUMMY_HASH).then(() => false);

  if (!valid || !account) return NextResponse.json({ error: "E-mail ou mot de passe incorrect" }, { status: 401 });

  const session = { email: account.email, role: account.role };
  const response = NextResponse.json({ user: appUserFor(session), source: accounts.source });
  response.cookies.set(sessionCookie(signSession(session, secret)));
  return response;
}
