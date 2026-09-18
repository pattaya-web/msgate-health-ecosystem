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
  /** Fiche saisie dans le catalogue : une phrase de description et le prix, quand il n'y a pas d'analyse de page. */
  description?: string;
  price?: string;
};

export const FIDELITY_INSTRUCTION =
  "PRODUCT REFERENCE: use the attached product reference image as the visual source of truth. Preserve the real product shape, proportions, colors, material appearance and physical identity, and its packaging only if the packaging is visible in the reference. Do not invent, restyle or redesign the product.";

/** Le branding vient du vrai produit ou de son packaging, jamais d'un logo posé à côté. */
export const BRANDING_RULE =
  "BRANDING: no added standalone logo, corner logo, watermark or artificial branding block; branding appears only as it naturally exists on the real product or packaging.";

/** Une créa d'inspiration a guidé le prompt : sa structure, jamais son produit ni ses faits. */
export const INSPIRATION_RULE =
  "INSPIRATION: the composition and style may be adapted from a reference ad, but the product shown is exactly the PRODUCT above — never another product, brand, logo, packaging, claim, badge, origin, guarantee or certification.";

export function composeWorkspacePrompt(input: { userPrompt: string; product: WorkspaceProductFacts; hasReference: boolean; hasInspiration?: boolean }): string {
  const user = input.userPrompt.trim();
  const { product } = input;
  const descriptor = [product.productType, product.category ? `(${product.category})` : ""].filter(Boolean).join(" ");
  const facts = (product.features ?? []).filter(Boolean).slice(0, 2).join("; ");
  // Sans analyse de page, la description saisie (coupée court) dit ce qu'est le produit.
  const summary = !descriptor && product.description ? product.description.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  const productLine = `PRODUCT: ${product.name}${product.store ? ` by ${product.store}` : ""}${descriptor ? ` — ${descriptor}` : ""}${summary ? ` — ${summary}` : ""}${product.price ? ` — price ${product.price}` : ""}.${facts ? ` ${facts}.` : ""}`;
  // Une créa = une image : la règle du moteur ferme la porte aux collages, quel que soit le brief.
  return [user, "", productLine, input.hasReference ? FIDELITY_INSTRUCTION : "", input.hasInspiration ? INSPIRATION_RULE : "", BRANDING_RULE, SINGLE_CREATIVE_RULE].filter((line, index) => line !== "" || index === 1).join("\n");
}
