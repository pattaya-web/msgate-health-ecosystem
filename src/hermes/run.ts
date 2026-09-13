import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendAudit } from "@/hermes/audit";
import { getTool } from "@/hermes/registry";
import type { ToolEnvelope } from "@/hermes/types";

/**
 * Exécute un outil par son nom : validation de l'entrée, chronométrage,
 * journal, enveloppe. Une erreur amont devient une réponse `ok: false` avec
 * un message court, jamais une trace ni une donnée.
 */
export async function runTool(name: string, rawInput: unknown): Promise<{ status: number; body: ToolEnvelope<unknown> }> {
  const requestId = randomUUID();
  const tool = getTool(name);
  if (!tool) {
    return { status: 404, body: { ok: false, tool: name, requestId, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } } };
  }
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      status: 400,
      body: { ok: false, tool: name, requestId, error: { code: "BAD_INPUT", message: "Invalid input", issues: z.treeifyError(parsed.error) } },
    };
  }
  const started = Date.now();
  try {
    const data = await tool.run(parsed.data, { requestId, now: new Date(started) });
    const durationMs = Date.now() - started;
    const body: ToolEnvelope<unknown> = { ok: true, tool: name, requestId, generatedAt: new Date().toISOString(), durationMs, data };
    void appendAudit({ at: new Date(started).toISOString(), requestId, tool: name, ok: true, durationMs, bytes: Buffer.byteLength(JSON.stringify(data)) });
    return { status: 200, body };
  } catch (error) {
    const durationMs = Date.now() - started;
    void appendAudit({ at: new Date(started).toISOString(), requestId, tool: name, ok: false, durationMs, bytes: 0, error: "UPSTREAM" });
    const message = error instanceof Error ? error.message.slice(0, 200) : "Tool failed";
    return { status: 502, body: { ok: false, tool: name, requestId, error: { code: "UPSTREAM", message } } };
  }
}
