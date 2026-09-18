import { CREATIVE_CATEGORIES, type CreativeCategory, type CreativeType } from "@/lib/studio/creative-types";

/**
 * Un template de prompt de Static : un format de créa (prix en avant,
 * avant/après, avis client…) que le constructeur de prompts adapte au produit
 * choisi. Les templates se créent et se modifient dans l'interface ; les
 * formats livrés avec le studio en sont la première fournée, modifiables
 * comme les autres.
 */
export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  category: CreativeCategory;
  /** La consigne du format, envoyée au modèle après les faits produit. */
  prompt: string;
  /** Aucun logo, marque ou filigrane sur la créa, même s'il figure sur la photo du produit. */
  noLogo: boolean;
  /** Éléments graphiques (badge prix, flèche…) parmi lesquels le constructeur pioche ; vide = libre. */
  visualElements: string[];
  /** Format du studio dont ce template est issu, s'il y en a un. */
  builtinId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptTemplateInput = Pick<PromptTemplate, "name" | "description" | "category" | "prompt" | "noLogo">;

export const TEMPLATE_CATEGORIES = CREATIVE_CATEGORIES;

/** Le template vu par le constructeur de prompts du studio. */
export function templateToCreativeType(template: PromptTemplate): CreativeType {
  return {
    id: template.builtinId ?? template.id,
    name: template.name,
    category: template.category,
    description: template.description,
    preview: { layout: "centered", accents: [] },
    recommendedFor: [],
    promptInstructions: template.prompt,
    defaultVisualElements: template.visualElements,
    defaultVariations: 5,
    enabled: true,
  };
}

/** Sans logo : ni ajouté, ni repris de la photo du produit. Remplace la règle de branding habituelle. */
export const NO_LOGO_RULE =
  "NO LOGO: the creative shows no logo, wordmark, brand badge, monogram, watermark or brand-name typography anywhere — not overlaid, not in a corner, not on the packaging, not in the background. If the product reference photo carries a logo or brand name, render that surface plain and unbranded. The product name may appear only as the headline copy if the creative type asks for text.";
