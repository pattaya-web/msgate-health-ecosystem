import { CREATIVE_TYPES } from "@/lib/studio/creative-types";

/**
 * Prompt libre du studio statique : le style de créa est facultatif.
 *
 * - `styleId` vide : le prompt part tel quel, rien n'est ajouté.
 * - `styleId` connu : les consignes de rendu du style sont ajoutées après le
 *   prompt, sans réécrire ce que l'opérateur a tapé.
 * - Pas de prompt mais des références : une consigne neutre demande de
 *   reproduire les images de référence en une créa propre, sans style imposé.
 */

export const NO_STYLE = "";

export const REFERENCE_ONLY_PROMPT =
  "Recreate the reference image(s) as one clean, standalone ad creative: same subject, product, composition and mood, faithfully reproduced. No added style, no collage, no extra text beyond what the references show.";

export function styleInstructions(styleId: string): string | null {
  if (!styleId) return null;
  const type = CREATIVE_TYPES.find((item) => item.id === styleId);
  return type?.promptInstructions?.trim() || null;
}

export function applyStyle(prompts: string[], styleId: string): string[] {
  const instructions = styleInstructions(styleId);
  if (!instructions) return prompts;
  return prompts.map((prompt) => (prompt.includes(instructions) ? prompt : `${prompt.trim()}\n\nStyle: ${instructions}`));
}

/** Ce qui part vraiment à la génération, selon ce que l'opérateur a fourni. */
export function resolveFreePrompts(input: { prompts: string[]; styleId: string; hasReferences: boolean }): string[] {
  const base = input.prompts.map((prompt) => prompt.trim()).filter(Boolean);
  if (!base.length && input.hasReferences) return applyStyle([REFERENCE_ONLY_PROMPT], input.styleId);
  return applyStyle(base, input.styleId);
}
