import { businessOverviewTool } from "@/hermes/tools/business-overview";
import type { ReadonlyTool } from "@/hermes/types";

/**
 * Les outils que Hermes peut appeler. Ajouter un outil = l'écrire dans
 * src/hermes/tools/ et l'inscrire ici ; rien d'autre à brancher.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ReadonlyTool<any, unknown>[] = [businessOverviewTool];

export function getTool(name: string) {
  return TOOLS.find((tool) => tool.name === name) ?? null;
}
