import { timingSafeEqual } from "node:crypto";

/**
 * L'accès Hermes : une clé dédiée, jamais le cookie de session d'une personne.
 *
 * `Authorization: Bearer <HERMES_API_KEY>`. La clé vit dans l'environnement,
 * se compare en temps constant, et n'apparaît ni dans les réponses ni dans le
 * journal. Une clé absente ou trop courte côté serveur ferme l'accès (503)
 * plutôt que de l'ouvrir.
 */
const MIN_KEY_LENGTH = 24;

export type HermesAuth = { ok: true } | { ok: false; status: 401 | 503; message: string };

export function hermesKeyConfigured() {
  return (process.env.HERMES_API_KEY?.trim().length ?? 0) >= MIN_KEY_LENGTH;
}

export function checkHermesAuth(request: Request): HermesAuth {
  const expected = process.env.HERMES_API_KEY?.trim() ?? "";
  if (expected.length < MIN_KEY_LENGTH) return { ok: false, status: 503, message: "Hermes access is not configured on the server" };
  const header = request.headers.get("authorization") ?? "";
  const given = header.replace(/^Bearer\s+/i, "").trim();
  if (!given) return { ok: false, status: 401, message: "Unauthorized" };
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, message: "Unauthorized" };
  return { ok: true };
}
