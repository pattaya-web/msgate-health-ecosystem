import type { HermesChatConfig } from "./config";

/**
 * Client serveur → Hermes API Server (OpenAI-compatible), tel que documenté
 * dans hermes-agent (gateway/platforms/api_server_openai_routes.py) :
 *
 * - POST /v1/chat/completions, bearer API_SERVER_KEY, `stream: true`.
 * - `X-Hermes-Session-Id` : Hermes recharge l'historique de CETTE session depuis
 *   sa propre base et ne lit que le dernier message utilisateur du corps. Le CRM
 *   n'a donc pas à rejouer la conversation : un message system (posé par-dessus
 *   celui de Hermes) et un tour utilisateur suffisent.
 * - `X-Hermes-Session-Key` : portée stable de la mémoire long terme, par
 *   opérateur, indépendante des conversations.
 * - Flux SSE : `data: {chat.completion.chunk}`, `event: hermes.tool.progress`
 *   pour l'activité des outils, `data: [DONE]` à la fin ; couper la connexion
 *   interrompt l'agent côté Hermes.
 */

export type UpstreamMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } }> };

export type UpstreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "tool"; name: string; label: string; status: string; emoji?: string; id?: string }
  | { kind: "finish"; reason: string; error?: string }
  | { kind: "done" };

export class HermesUpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function openHermesStream(input: {
  config: HermesChatConfig;
  messages: UpstreamMessage[];
  sessionId: string;
  sessionKey: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { config } = input;
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "X-Hermes-Session-Id": input.sessionId,
        "X-Hermes-Session-Key": input.sessionKey,
      },
      body: JSON.stringify({ model: "hermes-agent", stream: true, messages: input.messages }),
      signal: input.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new HermesUpstreamError(0, "Hermes est injoignable (connexion refusée ou expirée).");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } | string };
      detail = typeof body?.error === "string" ? body.error : body?.error?.message ?? "";
    } catch {
      // corps non JSON : on garde le statut seul
    }
    const friendly =
      response.status === 401 || response.status === 403
        ? "Hermes a refusé la clé (HERMES_API_SERVER_KEY)."
        : response.status === 429
          ? "Hermes est saturé (trop de conversations en cours). Réessaie dans un instant."
          : `Hermes a répondu ${response.status}.`;
    throw new HermesUpstreamError(response.status, detail ? `${friendly} ${detail.slice(0, 200)}` : friendly);
  }
  if (!response.body) throw new HermesUpstreamError(502, "Hermes n'a renvoyé aucun flux.");
  return response;
}

type Chunk = {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  error?: { message?: string };
};

/** Hermes envoie un « : keepalive » toutes les 30 s ; au-delà de ce silence, la connexion est considérée morte. */
const IDLE_TIMEOUT_MS = 120_000;

/** Lit un corps SSE et en fait une suite d'événements typés. */
export async function* parseHermesSse(body: ReadableStream<Uint8Array>, idleTimeoutMs = IDLE_TIMEOUT_MS): AsyncGenerator<UpstreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const readWithTimeout = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Hermes n'a rien envoyé depuis ${Math.round(idleTimeoutMs / 1000)} s ; flux abandonné.`)), idleTimeoutMs);
    });
    return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
  };
  try {
    while (true) {
      const { value, done } = await readWithTimeout();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = parseFrame(frame);
        if (event) {
          yield event;
          if (event.kind === "done") return;
        }
      }
    }
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): UpstreamEvent | null {
  let eventName = "";
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return { kind: "done" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (eventName === "hermes.tool.progress") {
    const tool = parsed as { tool?: string; label?: string; status?: string; emoji?: string; toolCallId?: string };
    return { kind: "tool", name: String(tool.tool ?? ""), label: String(tool.label ?? tool.tool ?? ""), status: String(tool.status ?? "running"), emoji: tool.emoji, id: tool.toolCallId };
  }
  const chunk = parsed as Chunk;
  const choice = chunk.choices?.[0];
  const text = choice?.delta?.content;
  if (typeof text === "string" && text.length) return { kind: "delta", text };
  if (choice?.finish_reason) return { kind: "finish", reason: choice.finish_reason, error: chunk.error?.message };
  return null;
}

/** Sonde de vie de l'API Server (GET /health, sans clé). */
export async function hermesReachable(config: HermesChatConfig, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/health`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    return body?.status === "ok" || response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
