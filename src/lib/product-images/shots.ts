export type ShotId = "flatlay" | "model_front" | "model_three_quarter" | "model_detail" | "packaging";

export type ShotDefinition = {
  id: ShotId;
  label: string;
  /** Le packaging a besoin du logo en référence, les autres non. */
  needsLogo?: boolean;
};

export const SHOTS: ShotDefinition[] = [
  { id: "flatlay", label: "Flat lay" },
  { id: "model_front", label: "Mannequin · face" },
  { id: "model_three_quarter", label: "Mannequin · 3/4" },
  { id: "model_detail", label: "Mannequin · détail" },
  { id: "packaging", label: "Unboxing brandé", needsLogo: true },
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

/**
 * Le plan unboxing reçoit le logo EN PREMIÈRE référence, puis les photos du
 * produit : il faut donc dire au modèle lequel est lequel, sans quoi il imprime
 * le logo sur le produit lui-même.
 */
const LOGO_IN_SCENE =
  "LOGO FIDELITY — the FIRST reference image is your logo; the other reference images are the " +
  "product itself. Reproduce the logo exactly as it is: identical shapes, identical letterforms and " +
  "spelling, identical proportions, identical colours. " +
  "Do NOT redraw, restyle, recolour, crop, mirror, rotate or re-letter it. " +
  "Do NOT add any word, slogan, symbol or decoration that is absent from it. " +
  "It appears once and only once, printed on the box lid — never on the product, never on the " +
  "tissue paper, nowhere else in the frame.";

/** Bloc technique commun : c'est lui qui donne le rendu « campagne studio ». */
const PHOTOGRAPHY =
  "PHOTOGRAPHY: high-end studio campaign photography, large softbox key light with a soft fill and a " +
  "gentle grounded floor shadow, realistic unretouched skin and material texture, true-to-life colours, " +
  "premium fabric and trim detail, sharp focus, photorealistic, luxury fashion catalogue quality, " +
  "8K detail.";

/** Cadre imposé : portrait 3:4, sujet centré, aucune surcharge graphique. */
const FRAMING =
  "COMPOSITION: vertical 3:4 frame, subject centered, clean minimalist composition, generous negative " +
  "space, no text overlay, no logo overlay, no watermark, no border, no collage, no split screen, " +
  "no second view of the product.";

const PRODUCT_REMINDER =
  "Reminder: the item itself must stay pixel-faithful to the reference images.";

/** Le plan unboxing a sa propre ligne technique : carton mat plutôt que peau. */
const PACKAGING_PHOTOGRAPHY =
  "PHOTOGRAPHY: high-end packaging photography, soft directional daylight from one side with a gentle " +
  "natural shadow, matte cardboard texture, crisp print on the lid, real material texture on the " +
  "product, true-to-life colours, sharp focus, photorealistic, luxury brand catalogue quality, " +
  "8K detail.";

const UNBOXING_REMINDER =
  "Reminder: both the product and the logo must stay pixel-faithful to the reference images.";

/**
 * Casting exclusivement féminin, demandé par la marque : jamais un homme, et une
 * vraie femme plutôt qu'un buste de couture. Chaque prise de vue doit montrer une
 * personne différente : on pioche un profil distinct par produit et par plan, de
 * façon déterministe pour que le même CSV régénéré donne le même casting.
 */
type ModelProfile = { age: number; look: string };

const MODELS: ModelProfile[] = [
  { age: 22, look: "pale skin and light brown wavy hair" },
  { age: 24, look: "South Asian features and long dark hair" },
  { age: 28, look: "warm medium-brown skin and dark curly hair" },
  { age: 33, look: "light olive skin and long chestnut hair" },
  { age: 36, look: "East Asian features and straight black hair" },
  { age: 39, look: "deep brown skin and short natural hair" },
  { age: 42, look: "fair skin and dark blonde hair in a low ponytail" },
  { age: 45, look: "freckled fair skin and auburn hair in a low bun" },
  { age: 49, look: "medium-brown skin and shoulder-length black hair" },
  { age: 53, look: "tan skin and shoulder-length grey hair" },
  { age: 58, look: "warm beige skin and silver hair cut to the jaw" },
  { age: 63, look: "deep brown skin and short white natural hair" },
];

/**
 * Tranche d'âge du casting : la cible n'est pas la même pour un soin anti-âge et
 * pour un vêtement destiné aux 20 ans. « Tous âges » garde le casting d'origine,
 * qui balaie toute la liste.
 */
export type AgeBand = "any" | "20-35" | "35-50" | "45-65";

export const AGE_BANDS: { id: AgeBand; label: string; min: number; max: number }[] = [
  { id: "any", label: "Tous âges", min: 0, max: 200 },
  { id: "20-35", label: "20–35 ans", min: 20, max: 35 },
  { id: "35-50", label: "35–50 ans", min: 35, max: 50 },
  { id: "45-65", label: "45–65 ans", min: 45, max: 65 },
];

/** Une tranche vide ferait un prompt sans mannequin : on retombe sur la liste entière. */
function modelsFor(band: AgeBand): ModelProfile[] {
  const range = AGE_BANDS.find((entry) => entry.id === band);
  if (!range || range.id === "any") return MODELS;
  const inRange = MODELS.filter((model) => model.age >= range.min && model.age <= range.max);
  return inRange.length ? inRange : MODELS;
}

function describeModel(profile: ModelProfile) {
  return `a woman of about ${profile.age} with ${profile.look}`;
}

/** Fonds de studio uniquement : les décors d'appartement sont écartés. */
const STUDIOS = [
  "a warm beige seamless studio backdrop",
  "a soft greige seamless studio backdrop",
  "a warm taupe seamless studio backdrop",
  "an off-white seamless studio cyclorama",
];

/** Rappelé à chaque plan avec mannequin : une femme, réelle, jamais un buste. */
const CASTING =
  "The model is ALWAYS a woman — never a man, never a child. She is a real human being with natural " +
  "skin texture and natural body proportions, not a plastic mannequin, not a dress form, not a doll " +
  "and not an illustration.";

/** Le produit n'est pas toujours un vêtement : on couvre les deux cas. */
const WORN =
  "If the item is apparel or an accessory she WEARS it on her body, correctly fitted and fully " +
  "visible. If it is not wearable she holds it at chest height, facing the camera, label side out, " +
  "hands clear of any detail.";

function pick<T>(pool: T[], seed: string, offset = 0): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(hash + offset * 7) % pool.length];
}

export function buildPrompt(
  shot: ShotId,
  product: { handle: string; title: string; type?: string },
  age: AgeBand = "any"
): string {
  const subject = product.title || product.handle;
  const category = product.type ? ` (${product.type})` : "";
  const seed = product.handle;
  const studio = pick(STUDIOS, seed, 0);
  const cast = modelsFor(age);

  switch (shot) {
    case "flatlay":
      return (
        `${FIDELITY}\n\n` +
        `SCENE: Top-down flat lay of ${subject}${category} on ${studio}, laid out perfectly flat and ` +
        `centered, opened out and arranged naturally so that no part of it is folded away or hidden, ` +
        `styled editorially with balanced spacing around it. No props, no hands, no packaging in frame.` +
        `\n\n${PHOTOGRAPHY}\n\n${FRAMING} ${PRODUCT_REMINDER}`
      );

    case "model_front":
      return (
        `${FIDELITY}\n\n` +
        `MODEL: ${describeModel(pick(cast, seed, 0))}. ${CASTING}\n\n` +
        `WARDROBE: she presents ${subject}${category} exactly as it appears in the reference images. ` +
        `${WORN} Everything else she wears stays plain and neutral so nothing competes with the item.` +
        `\n\n` +
        `POSE: standing full body, straight on at eye level, relaxed confident posture, weight on one ` +
        `leg, arms clear of the item so no part of it is covered, looking directly into the lens with a ` +
        `subtle friendly expression. Head to feet inside the frame.\n\n` +
        `SET: ${studio}.\n\n${PHOTOGRAPHY}\n\n${FRAMING} ${PRODUCT_REMINDER}`
      );

    case "model_three_quarter":
      return (
        `${FIDELITY}\n\n` +
        `MODEL: ${describeModel(pick(cast, seed, 3))} — a clearly different woman from any other ` +
        `image in this set. ` +
        `${CASTING}\n\n` +
        `WARDROBE: she presents ${subject}${category} exactly as it appears in the reference images, ` +
        `seen from a new angle but keeping the exact same design, cut and colours. ${WORN}\n\n` +
        `POSE: standing full body at a three-quarter angle, shot from a slightly elevated camera, body ` +
        `turned about 45 degrees, head towards the lens, calm editorial expression, arms relaxed and ` +
        `away from the item.\n\n` +
        `SET: ${pick(STUDIOS, seed, 1)}.\n\n${PHOTOGRAPHY}\n\n${FRAMING} ${PRODUCT_REMINDER}`
      );

    case "model_detail":
      return (
        `${FIDELITY}\n\n` +
        `MODEL: ${describeModel(pick(cast, seed, 6))} — again a different woman. ${CASTING}\n\n` +
        `WARDROBE: ${subject}${category} worn on her body exactly as in the reference images. ${WORN}` +
        `\n\n` +
        `SUBJECT FRAMING: tight close-up cropped on the part of the body where the item sits, so that ` +
        `the item and her hands fill the frame. Show the real material texture, the actual weave, the ` +
        `actual stitching and the actual trims exactly as they appear in the reference. Background ` +
        `softly blurred.\n\n` +
        `SET: ${pick(STUDIOS, seed, 2)}.\n\n${PHOTOGRAPHY}\n\n${FRAMING} ${PRODUCT_REMINDER}`
      );

    case "packaging":
      return (
        `${FIDELITY}\n\n` +
        `${LOGO_IN_SCENE}\n\n` +
        `SCENE: Top-down unboxing photograph. ${subject}${category} lies inside an open premium ` +
        `matte box, nested in tone-on-tone tissue paper, on a textured natural surface — raw linen ` +
        `or pale stone. The lid rests beside the box, angled just enough that the logo printed on it ` +
        `reads clearly. Soft daylight from one side, gentle natural shadows, warm neutral palette.` +
        `\n\nNothing else is in frame: no white studio sweep, no second box, no ribbon, no bag, ` +
        `no confetti, no hands, no text and no barcode.\n\n` +
        `${PACKAGING_PHOTOGRAPHY}\n\n${FRAMING} ${UNBOXING_REMINDER}`
      );
  }
}

export function shotLabel(id: ShotId) {
  return SHOTS.find((shot) => shot.id === id)?.label ?? id;
}

/**
 * Remet une sélection de plans dans l'ordre de `SHOTS`, quel que soit l'ordre
 * dans lequel l'utilisateur a coché les boutons. C'est cet ordre qui devient
 * celui des images du produit dans le CSV : le packaging doit rester le dernier.
 */
export function orderShots(ids: Iterable<ShotId>): ShotId[] {
  const wanted = new Set(ids);
  return SHOTS.filter((shot) => wanted.has(shot.id)).map((shot) => shot.id);
}
