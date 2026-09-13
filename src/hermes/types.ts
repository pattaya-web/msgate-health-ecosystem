import type { ZodType } from "zod";

/**
 * Le contrat d'un outil Hermes.
 *
 * Un outil lit le CRM et rend un JSON structuré, rien d'autre : pas de store en
 * argument, pas de fonction d'écriture importée (la règle ESLint sur
 * src/hermes/tools l'interdit), pas de secret dans la sortie. Le registre les
 * énumère, la route les exécute, le journal les consigne.
 */
export type ToolContext = {
  requestId: string;
  now: Date;
};

export type ReadonlyTool<I, O> = {
  name: string;
  description: string;
  input: ZodType<I>;
  run: (input: I, ctx: ToolContext) => Promise<O>;
};

/** L'enveloppe de toute réponse : succès ou erreur typée, jamais une exception brute. */
export type ToolEnvelope<O> =
  | { ok: true; tool: string; requestId: string; generatedAt: string; durationMs: number; data: O }
  | { ok: false; tool: string; requestId: string; error: { code: "BAD_INPUT" | "UNKNOWN_TOOL" | "UPSTREAM"; message: string; issues?: unknown } };
