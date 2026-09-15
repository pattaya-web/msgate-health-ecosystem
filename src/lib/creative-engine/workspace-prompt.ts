/**
 * Le prompt final de l'espace produit : le texte de l'opérateur tel quel,
 * puis le minimum pour que le modèle sache de quel produit il s'agit, et,
 * quand une référence produit est jointe, la consigne de fidélité. Pure et
 * partagée : l'aperçu côté navigateur et le lot enregistré montrent la même
 * chose.
 */

import { SINGLE_CREATIVE_RULE } from "./prompt";

export type WorkspaceProductFacts = {
  name: string;
  store: string;
  category?: string;
  productType?: string;
  features?: string[];
};

export const FIDELITY_INSTRUCTION =
  "PRODUCT REFERENCE: use the attached product reference image as the visual source of truth. Preserve the real product shape, proportions, colors, material appearance and physical identity, and its packaging only if the packaging is visible in the reference. Do not invent, restyle or redesign the product.";

export function composeWorkspacePrompt(input: { userPrompt: string; product: WorkspaceProductFacts; hasReference: boolean }): string {
  const user = input.userPrompt.trim();
  const { product } = input;
  const descriptor = [product.productType, product.category ? `(${product.category})` : ""].filter(Boolean).join(" ");
  const facts = (product.features ?? []).filter(Boolean).slice(0, 2).join("; ");
  const productLine = `PRODUCT: ${product.name}${product.store ? ` by ${product.store}` : ""}${descriptor ? ` — ${descriptor}` : ""}.${facts ? ` ${facts}.` : ""}`;
  // Une créa = une image : la règle du moteur ferme la porte aux collages, quel que soit le brief.
  return [user, "", productLine, input.hasReference ? FIDELITY_INSTRUCTION : "", SINGLE_CREATIVE_RULE].filter((line, index) => line !== "" || index === 1).join("\n");
}
