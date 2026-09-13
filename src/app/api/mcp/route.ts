import { NextResponse } from "next/server";
import { checkHermesAuth } from "@/hermes/auth";
import { handleMcpBody, MCP_PROTOCOL_VERSIONS } from "@/hermes/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Le point d'entrée MCP (transport Streamable HTTP, sans état).
 *
 *   POST /api/mcp   Authorization: Bearer HERMES_API_KEY   corps JSON-RPC
 *
 * Même clé que l'API Hermes, même registre, mêmes outils. Pas de flux
 * serveur (GET → 405) ni de session (DELETE → 405) : chaque appel est
 * indépendant, ce qui convient à un hébergement sans état comme Vercel.
 */
function headers() {
  return { "MCP-Protocol-Version": MCP_PROTOCOL_VERSIONS[0], "Cache-Control": "no-store" };
}

export async function POST(request: Request) {
  const auth = checkHermesAuth(request);
  if (!auth.ok) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.message } }, { status: auth.status, headers: headers() });
  const raw = await request.text();
  const { status, body } = await handleMcpBody(raw);
  if (body === null) return new NextResponse(null, { status, headers: headers() });
  return NextResponse.json(body, { status, headers: headers() });
}

export async function GET(request: Request) {
  const auth = checkHermesAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status, headers: headers() });
  // Pas de flux serveur→client : le client n'a rien à écouter ici.
  return NextResponse.json({ error: "Server-initiated streams are not supported; POST JSON-RPC messages" }, { status: 405, headers: { ...headers(), Allow: "POST" } });
}

export async function DELETE() {
  return NextResponse.json({ error: "Sessions are not used" }, { status: 405, headers: { ...headers(), Allow: "POST" } });
}
