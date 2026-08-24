export type ShotId = "flatlay" | "model_front" | "model_three_quarter" | "model_detail" | "packaging";

export type ShotDefinition = {
  id: ShotId;
  label: string;
  /** Le packaging a besoin du logo en référence, les autres non. */
  needsLogo?: boolean;
};

export const SHOTS: ShotDefinition[] = [
  { id: "flatlay", label: "Flat lay" },
  { id: "model_front", label: "Modèle · face" },
  { id: "model_three_quarter", label: "Modèle · 3/4" },
  { id: "model_detail", label: "Modèle · détail" },
  { id: "packaging", label: "Packaging brandé", needsLogo: true },
];

/**
 * Placé en tête de chaque prompt : les modèles d'image pondèrent davantage les
 * premiers tokens, et c'est la fidélité au produit qui doit primer sur le style.
 */
const FIDELITY =
  "ABSOLUTE PRODUCT FIDELITY — this instruction overrides every other one below. " +
  "Reproduce the item from the reference images exactly as it is: identical silhouette and cut, " +
  "identical proportions and length, identical colour and identical placement of every colour block, " +
  "identical fabric, weave and texture, identical print, graphic or pattern at the same scale and the " +
  "same position, identical seams, stitching, panel lines, collar, cuffs, hem, waistband, pockets, " +
  "zips, buttons, drawstrings, labels, trims and hardware. " +
  "Do NOT add, remove, move, resize, restyle or redesign any element. " +
  "Do NOT invent branding, text, logos or decorative details that are absent from the reference. " +
  "Do NOT change the shade, saturation or finish. Do NOT smooth, stylise or idealise the material. " +
  "Do NOT re-tailor the fit or alter how the item drapes. " +
  "If a part of the product is not visible in the reference images, keep it out of frame rather than " +
  "inventing it. Treat the reference as the ground truth for the product and the prompt as the scene only.";

const BASE =
  "Ultra-realistic photograph, shot on a full-frame camera with a 50mm lens, natural window light, " +
  "authentic unretouched skin and material texture, true-to-life colors, shallow depth of field, " +
  "candid editorial feel. No text, no watermark, no logo overlay, no borders, no collage. " +
  "Reminder: the product itself must remain pixel-faithful to the reference images.";

/**
 * Casting exclusivement féminin, demandé par la marque. Chaque prise de vue avec
 * modèle doit montrer une personne différente : on pioche un profil distinct par
 * produit et par plan, de façon déterministe pour que le même CSV régénéré donne
 * le même casting.
 */
const MODELS = [
  "a woman in her late 20s with warm medium-brown skin and dark curly hair",
  "a woman in her 30s with light olive skin and long chestnut hair",
  "a woman in her 40s with deep brown skin and short natural hair",
  "a woman in her early 20s with pale skin and light brown wavy hair",
  "a woman in her 30s with East Asian features and straight black hair",
  "a woman in her 50s with tan skin and shoulder-length grey hair",
  "a woman in her early 20s with South Asian features and long dark hair",
  "a woman in her 40s with freckled fair skin and auburn hair in a low bun",
];

const SETTINGS = [
  "a sunlit minimalist apartment",
  "a bright loft with white walls and plants",
  "a warm scandinavian living room",
  "a modern studio with soft neutral backdrop",
];

function pick<T>(pool: T[], seed: string, offset = 0): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(hash + offset * 7) % pool.length];
}

export function buildPrompt(
  shot: ShotId,
  product: { handle: string; title: string; type?: string },
  brand?: string
): string {
  const subject = product.title || product.handle;
  const category = product.type ? ` (${product.type})` : "";
  const seed = product.handle;

  switch (shot) {
    case "flatlay":
      return (
        `${FIDELITY}\n\nSCENE: Top-down flat lay product photography of ${subject}${category}. ` +
        `The product is laid flat and centered on a neutral linen surface, arranged naturally without ` +
        `folding away or hiding any part of it, soft directional daylight, gentle natural shadows. ` +
        `Props, if any, stay at the edges and never overlap the product. ${BASE}`
      );

    case "model_front":
      return (
        `${FIDELITY}\n\nSCENE: Lifestyle photograph of ${pick(MODELS, seed, 0)} wearing or using ` +
        `${subject}${category} in ${pick(SETTINGS, seed, 0)}, photographed straight on at eye level, ` +
        `full product visible in frame. Natural relaxed pose, genuine expression, arms clear of the ` +
        `product so nothing is hidden. ${BASE}`
      );

    case "model_three_quarter":
      return (
        `${FIDELITY}\n\nSCENE: Lifestyle photograph of ${pick(MODELS, seed, 3)} — a clearly different ` +
        `woman from any other image in this set — wearing or using ${subject}${category} in ` +
        `${pick(SETTINGS, seed, 1)}, shot from a three-quarter angle, slightly elevated, full product ` +
        `visible. The product keeps the exact same design seen from this new angle. ${BASE}`
      );

    case "model_detail":
      return (
        `${FIDELITY}\n\nSCENE: Close-up detail photograph of ${pick(MODELS, seed, 6)} — again a ` +
        `different woman — interacting with ${subject}${category}: hands and product fill the frame, ` +
        `background softly blurred. Show the real material texture, the actual stitching and the actual ` +
        `trims exactly as they appear in the reference. ${BASE}`
      );

    case "packaging":
      return (
        `${FIDELITY}\n\nSCENE: Product packaging photograph: ${subject}${category} presented next to a ` +
        `premium matte ${brand ? `${brand}-branded ` : "branded "}box and tissue wrap, styled on a clean ` +
        `neutral surface with soft daylight. Reproduce the supplied logo exactly as provided — same ` +
        `shapes, same proportions, same colours — printed once, centered on the box lid, at a realistic ` +
        `scale. Do not redraw, restyle, recolour or add any other text or mark. ${BASE}`
      );
  }
}

export function shotLabel(id: ShotId) {
  return SHOTS.find((shot) => shot.id === id)?.label ?? id;
}
