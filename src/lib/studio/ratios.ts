/**
 * Source unique des ratios du studio. Le type, les boutons et la classe
 * d'aperçu étaient recopiés dans six fichiers : en ajouter un obligeait à tous
 * les retrouver, et un oubli passait le typage sans rien casser visiblement.
 */
export const RATIOS = [
  { id: "3:4", hint: "Feed", aspect: "aspect-[3/4]" },
  { id: "1:1", hint: "Carré", aspect: "aspect-square" },
  { id: "9:16", hint: "Story", aspect: "aspect-[9/16]" },
  { id: "4:3", hint: "Paysage", aspect: "aspect-[4/3]" },
  { id: "16:9", hint: "Large", aspect: "aspect-video" },
] as const;

export type Ratio = (typeof RATIOS)[number]["id"];

export const DEFAULT_RATIO: Ratio = "3:4";

/** Tolère une valeur venue d'une créative enregistrée avant l'ajout d'un ratio. */
export function ratioAspect(ratio: string | undefined) {
  return RATIOS.find((entry) => entry.id === ratio)?.aspect ?? "aspect-[3/4]";
}

/** Un paysage tient moins de colonnes qu'un portrait sans devenir un timbre. */
export function isWideRatio(ratio: string | undefined) {
  return ratio === "4:3" || ratio === "16:9";
}
