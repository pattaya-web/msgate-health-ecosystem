import { z } from "zod";
import { TOOLS } from "@/hermes/registry";
import { runTool } from "@/hermes/run";

/**
 * MCP au-dessus du registre Hermes.
 *
 * Le protocole (JSON-RPC 2.0, transport « Streamable HTTP ») est réduit à ce
 * qu'un client a besoin pour découvrir et appeler nos outils : initialize,
 * ping, tools/list, tools/call. Pas de session, pas de flux serveur, pas de
 * ressources ni de prompts : une requête, une réponse. Les outils sont ceux
 * du registre, exécutés par `runTool` — la même validation, le même journal,
 * la même enveloppe que l'API HTTP.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "msgate-crm", version: "1.0.0" };

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: unknown };
type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result: unknown } | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function error(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(value) && typeof value === "object" && (value as JsonRpcRequest).jsonrpc === "2.0" && typeof (value as JsonRpcRequest).method === "string";
}

/** La liste des outils, telle que MCP la présente : nom, description, schéma d'entrée JSON. */
export function mcpTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input),
    annotations: { title: tool.name, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

/** Traite un message JSON-RPC. Rend null pour une notification (rien à répondre). */
export async function handleMcpMessage(message: unknown): Promise<JsonRpcResponse | null> {
  if (!isRequest(message)) return error(null, INVALID_REQUEST, "Invalid JSON-RPC request");
  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  switch (message.method) {
    case "initialize": {
      const requested = (message.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const protocolVersion = typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Read-only access to the MSGate CRM. Tools return the CRM's own calculations as structured JSON; no tool changes anything.",
        },
      };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return null;
    case "ping":
      return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: mcpTools() } };
    case "tools/call": {
      const params = message.params as { name?: unknown; arguments?: unknown } | undefined;
      if (!params || typeof params.name !== "string") return error(id, INVALID_PARAMS, "tools/call needs a tool name");
      const outcome = await runTool(params.name, params.arguments ?? {});
      if (outcome.body.ok) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(outcome.body.data) }],
            structuredContent: outcome.body.data,
            isError: false,
          },
        };
      }
      if (outcome.body.error.code === "UNKNOWN_TOOL") return error(id, INVALID_PARAMS, outcome.body.error.message);
      // Une entrée invalide ou une source amont en panne est un résultat d'outil en erreur, pas une erreur de protocole.
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `${outcome.body.error.code}: ${outcome.body.error.message}` }], isError: true },
      };
    }
    default:
      return isNotification ? null : error(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
  }
}

/** Un corps HTTP (un message ou un lot) → les réponses à renvoyer, ou aucune. */
export async function handleMcpBody(raw: string): Promise<{ status: number; body: JsonRpcResponse | JsonRpcResponse[] | null }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: error(null, PARSE_ERROR, "Parse error") };
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return { status: 400, body: error(null, INVALID_REQUEST, "Empty batch") };
    const responses = (await Promise.all(parsed.map((entry) => handleMcpMessage(entry)))).filter((entry): entry is JsonRpcResponse => entry !== null);
    return responses.length ? { status: 200, body: responses } : { status: 202, body: null };
  }
  const response = await handleMcpMessage(parsed);
  return response ? { status: 200, body: response } : { status: 202, body: null };
}
