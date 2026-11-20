import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Lien d'aperçu d'une boutique en brouillon.
 *
 * Un brouillon n'est visible que d'un compte connecté ; ce lien l'ouvre à
 * quelqu'un sans compte (relecture, validation d'un prestataire) sans la
 * publier : elle reste en brouillon, non indexée. Le jeton est une signature
 * du slug avec le secret des sessions — il ne se devine pas, et changer le
 * secret les révoque tous.
 *
 * `/s/<slug>?apercu=<jeton>` : le proxy vérifie le jeton, le pose dans un
 * cookie limité à `/s/<slug>` (pour que la navigation dans la boutique suive)
 * et redirige vers l'adresse propre. La mise en page relit ce cookie.
 */
export const PREVIEW_PARAM = "apercu";
const COOKIE_PREFIX = "msgate_apercu_";

export function previewCookieName(slug: string) {
  return `${COOKIE_PREFIX}${slug.replace(/[^a-z0-9-]/gi, "")}`;
}

export function previewToken(slug: string, secret: string) {
  return createHmac("sha256", secret).update(`store-preview:${slug}`).digest("base64url").slice(0, 32);
}

export function verifyPreviewToken(slug: string, token: string | null | undefined, secret: string | null) {
  if (!token || !secret) return false;
  const expected = Buffer.from(previewToken(slug, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function previewUrl(base: string, slug: string, secret: string) {
  return `${base.replace(/\/$/, "")}/s/${slug}?${PREVIEW_PARAM}=${previewToken(slug, secret)}`;
}
