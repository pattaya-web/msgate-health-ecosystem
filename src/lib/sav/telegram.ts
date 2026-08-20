/**
 * Alertes Telegram.
 *
 * Le digest quotidien tourne sans personne devant l'écran : c'est le seul
 * canal qui fasse remonter un fil laissé de côté ou une réponse à côté de la
 * plaque le jour même, sans avoir à ouvrir le board.
 */

const API = "https://api.telegram.org";
/** Limite d'un message Telegram ; on garde de la marge pour le suffixe. */
const MAX_LENGTH = 3800;

export type TelegramConfig = { token: string; chatId: string };

export function getTelegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

export function isTelegramConfigured() {
  return Boolean(getTelegramConfig());
}

/** Le mode HTML de Telegram casse sur un `&`, un `<` ou un `>` non échappé. */
export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegram(html: string) {
  const config = getTelegramConfig();
  if (!config) throw new Error("Telegram non configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");

  const text =
    html.length > MAX_LENGTH ? `${html.slice(0, MAX_LENGTH)}\n\n… (message tronqué)` : html;

  const res = await fetch(`${API}/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    cache: "no-store",
  });

  // Un proxy ou un blocage réseau répond en texte brut : `res.json()` planterait
  // sur une erreur de parsing au lieu de dire ce qui s'est réellement passé.
  const raw = await res.text();
  let body: { ok?: boolean; description?: string } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Réponse Telegram inattendue (HTTP ${res.status}) : ${raw.slice(0, 200)}`);
  }
  if (!res.ok || !body.ok) throw new Error(body.description || "Envoi Telegram refusé");
}
