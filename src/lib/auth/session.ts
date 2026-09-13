import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppUser, UserRole } from "@/types";

/**
 * La session côté serveur.
 *
 * Le login vérifie les identifiants ici et pose un cookie signé ; chaque appel
 * à l'API est ensuite accepté ou refusé sur ce cookie, dans le proxy. Le cookie
 * ne contient que l'e-mail, le rôle et les dates : rien qu'un navigateur ne
 * puisse déjà voir, et rien qui permette de se connecter ailleurs sans la
 * signature.
 *
 * Les comptes viennent de AUTH_USERS, un tableau JSON d'entrées
 * { email, role, hash } — le hash est un scrypt (voir password.ts). Aucun mot
 * de passe en clair, nulle part. Hors production, sans AUTH_USERS, les comptes
 * de démonstration du code restent utilisables pour développer.
 */

export const SESSION_COOKIE = "msgate_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;
const ROLES: UserRole[] = ["admin", "operator", "viewer"];

export type SessionUser = { email: string; role: UserRole };

export type AuthUserEntry = {
  email: string;
  role: UserRole;
  /** Hash scrypt ; null pour un compte de démonstration (développement seulement). */
  hash: string | null;
  /** Mot de passe de démonstration, jamais présent en production. */
  demoPassword?: string;
};

export type AuthUsers = { users: AuthUserEntry[]; source: "env" | "demo" | "none"; error?: string };

/** Le secret de signature, ou null s'il manque ou s'il est trop court. */
export function getAuthSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** Les comptes autorisés. Un AUTH_USERS illisible ne donne aucun compte : pas de repli silencieux. */
export function loadAuthUsers(): AuthUsers {
  const raw = process.env.AUTH_USERS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { users: [], source: "none", error: "AUTH_USERS n'est pas un JSON valide" };
    }
    if (!Array.isArray(parsed)) return { users: [], source: "none", error: "AUTH_USERS doit être un tableau JSON" };
    const users: AuthUserEntry[] = [];
    for (const entry of parsed) {
      const email = typeof (entry as { email?: unknown })?.email === "string" ? (entry as { email: string }).email.trim().toLowerCase() : "";
      const role = (entry as { role?: unknown })?.role;
      const hash = typeof (entry as { hash?: unknown })?.hash === "string" ? (entry as { hash: string }).hash.trim() : "";
      if (!email.includes("@") || !ROLES.includes(role as UserRole) || !hash.startsWith("$scrypt$")) {
        return { users: [], source: "none", error: "Une entrée de AUTH_USERS est incomplète (email, role, hash scrypt attendus)" };
      }
      users.push({ email, role: role as UserRole, hash });
    }
    if (!users.length) return { users: [], source: "none", error: "AUTH_USERS est vide" };
    return { users, source: "env" };
  }
  if (isProduction()) return { users: [], source: "none", error: "AUTH_USERS manquant en production" };
  // Développement local sans comptes configurés : les comptes de démonstration du code.
  return {
    users: [
      { email: "admin@msgate.internal", role: "admin", hash: null, demoPassword: "demo1234" },
      { email: "operator@msgate.internal", role: "operator", hash: null, demoPassword: "demo1234" },
      { email: "viewer@msgate.internal", role: "viewer", hash: null, demoPassword: "demo1234" },
    ],
    source: "demo",
  };
}

/** L'utilisateur tel que l'interface l'affiche : construit depuis la session, jamais depuis le client. */
export function appUserFor(session: SessionUser): AppUser {
  const local = session.email.split("@")[0] ?? session.email;
  const full_name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return { id: `user-${session.role}`, email: session.email, full_name: full_name || session.email, role: session.role };
}

function b64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(user: SessionUser, secret: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ sub: user.email, role: user.role, iat, exp: iat + SESSION_TTL_SECONDS }));
  return `${payload}.${sign(payload, secret)}`;
}

/** L'utilisateur porté par un cookie, ou null : signature fausse, expiré, ou malformé. */
export function verifySession(value: string | null | undefined, secret: string | null, now = Date.now()): SessionUser | null {
  if (!value || !secret) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = sign(payload, secret);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown; role?: unknown; exp?: unknown };
    if (typeof data.sub !== "string" || !ROLES.includes(data.role as UserRole) || typeof data.exp !== "number") return null;
    if (data.exp * 1000 <= now) return null;
    return { email: data.sub, role: data.role as UserRole };
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, maxAge = SESSION_TTL_SECONDS) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    path: "/",
    maxAge,
  };
}
