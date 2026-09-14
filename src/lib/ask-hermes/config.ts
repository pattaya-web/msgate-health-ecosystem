/**
 * Où joindre l'API Server de l'instance Hermes (gateway.api_server, port 8642
 * par défaut). Les deux variables restent côté serveur ; rien n'en sort.
 *
 * - HERMES_API_URL         ex. http://100.64.0.12:8642 ou https://hermes.mondomaine.tld
 * - HERMES_API_SERVER_KEY  la valeur d'API_SERVER_KEY dans ~/.hermes/.env de l'agent
 *
 * À ne pas confondre avec HERMES_API_KEY, qui est la clé que Hermes présente au
 * CRM pour lire ses outils (sens inverse).
 */
export type HermesChatConfig = { baseUrl: string; key: string };

export function hermesChatConfig(): HermesChatConfig | null {
  const baseUrl = (process.env.HERMES_API_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.HERMES_API_SERVER_KEY ?? "").trim();
  if (!baseUrl || !key) return null;
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) return null;
  return { baseUrl, key };
}
