import { verifySession, type SessionUser } from "@/lib/auth/session";

/**
 * La décision prise devant chaque appel à /api.
 *
 * Fonction pure : elle reçoit la méthode, le chemin, les en-têtes et le cookie,
 * et répond « passe » ou « refuse » avec le statut. Le proxy ne fait que
 * l'appliquer, et elle se teste sans serveur.
 *
 * Trois exceptions, nommées ici et nulle part ailleurs :
 *   - /api/auth/*         : se connecter, se déconnecter, se reconnaître ;
 *   - /api/sav/digest     : le cron Vercel, qui porte son propre secret ;
 *   - POST messages/orders : le formulaire de contact et la commande des
 *                            boutiques publiques.
 * Tout le reste exige une session. Un « viewer » lit seulement. Un « associate »
 * ne lit que son tableau de bord et son profit (/api/associate/*) : le périmètre
 * Straight Sale est tenu côté serveur, aucune autre route ne lui répond. Une
 * mutation venue d'une autre origine est refusée, en plus du cookie SameSite.
 */

export type GuardDecision = { kind: "pass"; user: SessionUser | null } | { kind: "deny"; status: 401 | 403 | 503; message: string };

export type GuardInput = {
  method: string;
  pathname: string;
  headers: Headers;
  cookieValue: string | null;
  secret: string | null;
  /** Le schéma vu par Next quand aucun en-tête x-forwarded-proto n'est posé (« http » ou « https »). */
  fallbackProtocol: string;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_POSTS = new Set(["/api/ecom-sites/messages", "/api/ecom-sites/orders"]);

export function isPublicApi(method: string, pathname: string) {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/sav/digest") return true;
  // Hermes n'a pas de session : ses routes (API et MCP) vérifient elles-mêmes HERMES_API_KEY (src/hermes/auth.ts).
  if (pathname === "/api/hermes" || pathname.startsWith("/api/hermes/") || pathname === "/api/mcp") return true;
  return method === "POST" && PUBLIC_POSTS.has(pathname);
}

/**
 * Ce qu'un associé peut appeler : son tableau de bord et son profit en
 * lecture, et le Meta Ads Manager de ses comptes (lecture, édition, upload).
 * Chaque route Meta filtre et vérifie elle-même le périmètre de l'associé
 * (src/lib/associate/meta-access.ts) ; le jeton Meta et les autres BM restent
 * hors d'atteinte (/api/meta/registry n'est pas dans la liste).
 */
const ASSOCIATE_READ = new Set([
  "/api/associate/overview",
  "/api/associate/profit",
  "/api/meta/tree",
  "/api/meta/accounts",
  "/api/meta/creatives",
  "/api/meta/asset",
  "/api/meta/upload",
  "/api/shopify/daily",
]);
const ASSOCIATE_WRITE = new Set([
  "/api/meta/entity",
  "/api/meta/creatives",
  "/api/meta/creatives/zip",
  "/api/meta/upload",
  "/api/meta/upload/media",
  "/api/meta/upload/copy",
]);

export function isAssociateApi(method: string, pathname: string) {
  const verb = method.toUpperCase();
  if (SAFE_METHODS.has(verb)) return ASSOCIATE_READ.has(pathname);
  return verb === "POST" && ASSOCIATE_WRITE.has(pathname);
}

/** L'origine que doit annoncer une requête légitime : schéma, hôte et port tels que le navigateur les voit. */
export function expectedOrigin(headers: Headers, fallbackProtocol: string) {
  const proto = (headers.get("x-forwarded-proto") ?? fallbackProtocol).split(",")[0].trim().toLowerCase().replace(/:$/, "") || "https";
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return host ? `${proto}://${host}` : null;
}

export function apiGuard(input: GuardInput): GuardDecision {
  const method = input.method.toUpperCase();
  if (isPublicApi(method, input.pathname)) return { kind: "pass", user: null };

  if (!input.secret) return { kind: "deny", status: 503, message: "Authentification non configurée (AUTH_SECRET)" };

  const user = verifySession(input.cookieValue, input.secret);
  if (!user) return { kind: "deny", status: 401, message: "Connexion requise" };

  if (user.role === "associate" && !isAssociateApi(method, input.pathname)) {
    return { kind: "deny", status: 403, message: "Accès limité à la partie Straight Sale" };
  }

  if (!SAFE_METHODS.has(method)) {
    if (user.role === "viewer") return { kind: "deny", status: 403, message: "Lecture seule pour ce compte" };
    const origin = input.headers.get("origin");
    if (origin) {
      const expected = expectedOrigin(input.headers, input.fallbackProtocol);
      if (!expected || origin.trim().toLowerCase() !== expected) {
        return { kind: "deny", status: 403, message: "Origine de la requête refusée" };
      }
    }
  }
  return { kind: "pass", user };
}
