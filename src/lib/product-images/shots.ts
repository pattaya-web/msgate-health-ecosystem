/**
 * Plans de prise de vue, par famille de produit.
 *
 * La page a d'abord été écrite pour la mode : flat lay, mannequin, unboxing.
 * Un protocole vendu en PDF n'a rien à poser à plat ni à porter — et rendu tel
 * quel il ressemble à un ebook. Chaque famille a donc ses propres plans, et
 * le prompt ne parle de coutures qu'à un vêtement.
 */

export type ProductFamily = "fashion" | "object" | "digital";

export const FAMILIES: Array<{ id: ProductFamily; label: string; hint: string }> = [
  { id: "fashion", label: "Vêtement", hint: "Porté par un mannequin, posé à plat" },
  { id: "object", label: "Objet", hint: "Packshot, tenu en main, détail" },
  {
    id: "digital",
    label: "Programme / digital",
    hint: "Protocole, formation, guide : rendu en coffret premium, jamais en ebook",
  },
];

export type ShotId =
  | "flatlay"
  | "model_front"
  | "model_three_quarter"
  | "model_detail"
  | "packaging"
  | "packshot"
  | "kit_top"
  | "kit_scene"
  | "phone"
  | "lifestyle"
  | "before_after"
  | "before_after_quarter"
  | "before_after_profile"
  | "offer_card";

/** Format de sortie : Kie accepte les trois pour le modèle d'image. */
export type Ratio = "3:4" | "1:1" | "9:16";

export const RATIOS: Array<{ id: Ratio; label: string; hint: string }> = [
  { id: "3:4", label: "3:4", hint: "Fiche produit Shopify, portrait" },
  { id: "1:1", label: "1:1", hint: "Carré, feed" },
  { id: "9:16", label: "9:16", hint: "Story, Reels, TikTok" },
];

export type ShotDefinition = {
  id: ShotId;
  label: string;
  /** Le packaging a besoin du logo en référence, les autres non. */
  needsLogo?: boolean;
  /** Un mannequin apparaît : l'âge et le casting comptent. */
  hasModel?: boolean;
};

const FASHION_SHOTS: ShotDefinition[] = [
  { id: "flatlay", label: "Flat lay" },
  { id: "model_front", label: "Mannequin · face", hasModel: true },
  { id: "model_three_quarter", label: "Mannequin · 3/4", hasModel: true },
  { id: "model_detail", label: "Mannequin · détail", hasModel: true },
  { id: "packaging", label: "Unboxing brandé", needsLogo: true },
];

const OBJECT_SHOTS: ShotDefinition[] = [
  { id: "packshot", label: "Packshot studio" },
  { id: "model_front", label: "Mannequin · en main", hasModel: true },
  { id: "model_three_quarter", label: "Mannequin · 3/4", hasModel: true },
  { id: "model_detail", label: "Détail macro", hasModel: true },
  { id: "packaging", label: "Unboxing brandé", needsLogo: true },
];

/*
 * L'ordre est celui des images dans le CSV réexporté. Le client reçoit un PDF :
 * l'image d'entrée montre le résultat, la deuxième montre honnêtement ce qu'il
 * reçoit, sur écran. Les coffrets restent disponibles mais ne sont plus cochés.
 */
const DIGITAL_SHOTS: ShotDefinition[] = [
  { id: "before_after", label: "Avant / après · face", hasModel: true },
  { id: "offer_card", label: "Contenu du protocole" },
  { id: "before_after_quarter", label: "Avant / après · 3/4", hasModel: true },
  { id: "before_after_profile", label: "Avant / après · profil", hasModel: true },
  { id: "lifestyle", label: "Résultat lifestyle", hasModel: true },
  { id: "kit_top", label: "Coffret · dessus" },
  { id: "kit_scene", label: "Coffret · en scène" },
  { id: "phone", label: "Sur téléphone" },
];

export const SHOTS_BY_FAMILY: Record<ProductFamily, ShotDefinition[]> = {
  fashion: FASHION_SHOTS,
  object: OBJECT_SHOTS,
  digital: DIGITAL_SHOTS,
};

/** Tous les plans, sans doublon, dans l'ordre d'export : le packaging reste dernier. */
export const SHOTS: ShotDefinition[] = [...FASHION_SHOTS, ...OBJECT_SHOTS, ...DIGITAL_SHOTS].filter(
  (shot, index, list) => list.findIndex((other) => other.id === shot.id) === index
);

export const DEFAULT_SHOTS: Record<ProductFamily, ShotId[]> = {
  fashion: ["flatlay", "model_front", "packaging"],
  object: ["packshot", "model_front", "packaging"],
  digital: ["before_after", "offer_card", "before_after_quarter", "before_after_profile", "lifestyle"],
};

/**
 * Devine la famille depuis le titre, le type, les tags et la description
 * Shopify. Ce n'est qu'un pré-réglage : l'utilisateur corrige d'un clic.
 */
export function guessFamily(text: string): ProductFamily {
  const value = text.toLowerCase();
  if (
    /\b(protocol|protocole|system|système|systeme|program|programme|blueprint|guide|course|cours|formation|masterclass|coaching|ebook|e-book|pdf|template|method|méthode|methode|routine|challenge|digital)\b/.test(
      value
    )
  ) {
    return "digital";
  }
  if (
    /robe|dress|shirt|chemise|tee|t-shirt|pantalon|trouser|jean|veste|jacket|manteau|coat|pull|sweater|hoodie|jupe|skirt|short|chaussure|shoe|sneaker|basket|sac|bag|ceinture|belt|bijou|jewel|collier|necklace|bracelet|bague|ring|lunette|sunglass|chapeau|hat|casquette|cap|legging|brassiere|soutien|lingerie|maillot|socks|chaussette|jogger|tracksuit|ensemble/.test(
      value
    )
  ) {
    return "fashion";
  }
  return "object";
}

/* ------------------------------------------------------------------ */
/* Blocs communs                                                        */
/* ------------------------------------------------------------------ */

/**
 * Placé en tête de chaque prompt : les modèles d'image pondèrent davantage les
 * premiers tokens, et c'est la fidélité au produit qui doit primer sur le style.
 */
const FIDELITY_FASHION =
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
  "inventing it. Treat the reference as the ground truth for the product and the prompt as the scene only. " +
  "ONE SINGLE ARTICLE. If the reference images show several different garments or objects — a matching " +
  "top, a co-ord set, an accessory, a second colourway — reproduce ONLY the one named in the title and " +
  "leave every other article out of the frame entirely. Never merge details between them. " +
  "Specifically: do NOT add stripes, bands, contrast panels, piping, side tape, graphics, text or logos " +
  "that are not already on the item. A plain garment stays plain.";

/** Même verrou, formulé pour un objet : forme, matière, étiquette, sans couture ni ourlet. */
const FIDELITY_OBJECT =
  "ABSOLUTE PRODUCT FIDELITY — this instruction overrides every other one below. " +
  "Reproduce the object from the reference images exactly as it is: identical shape and proportions, " +
  "identical colours and finish, identical materials and surface texture, identical label, print, " +
  "typography and graphics at the same scale and position, identical caps, buttons, ports, straps, " +
  "handles and hardware. " +
  "Do NOT add, remove, move, resize, restyle or redesign any element. " +
  "Do NOT invent branding, text, logos or decorative details that are absent from the reference. " +
  "Do NOT change the shade, saturation or finish. Do NOT smooth, stylise or idealise the material. " +
  "If a part of the product is not visible in the reference images, keep it out of frame rather than " +
  "inventing it. Treat the reference as the ground truth for the product and the prompt as the scene only. " +
  "ONE SINGLE PRODUCT. If the reference images show several objects — a set, an accessory, a second " +
  "colourway — reproduce ONLY the one named in the title and leave every other one out of the frame.";

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
  "premium detail, sharp focus, photorealistic, luxury catalogue quality, 8K detail.";

const RATIO_WORDS: Record<Ratio, string> = {
  "3:4": "vertical 3:4",
  "1:1": "square 1:1",
  "9:16": "tall vertical 9:16",
};

/** Cadre imposé : le ratio choisi, sujet centré, aucune surcharge graphique. */
function framing(ratio: Ratio) {
  return (
    `COMPOSITION: ${RATIO_WORDS[ratio]} frame, subject centered, clean minimalist composition, generous ` +
    "negative space, no text overlay, no logo overlay, no watermark, no border, no collage, no split " +
    "screen, no second view of the product."
  );
}

const PRODUCT_REMINDER = "Reminder: the item itself must stay pixel-faithful to the reference images.";

/** Le plan unboxing a sa propre ligne technique : carton mat plutôt que peau. */
const PACKAGING_PHOTOGRAPHY =
  "PHOTOGRAPHY: high-end packaging photography, soft directional daylight from one side with a gentle " +
  "natural shadow, matte cardboard texture, crisp print on the lid, real material texture on the " +
  "product, true-to-life colours, sharp focus, photorealistic, luxury brand catalogue quality, " +
  "8K detail.";

/**
 * La boîte est décrite au détail près, et toujours par les mêmes mots. Sans
 * cette spécification chaque rendu en réinvente une : format, teinte et papier
 * changeaient d'un produit à l'autre, ce qui ruine l'idée d'un packaging de
 * marque reconnaissable d'une fiche à la suivante.
 */
const BOX = [
  "THE BOX IS ALWAYS THE SAME, in this exact and unchanging specification: ",
  "a rigid rectangular gift box in plain matte white card, clean square corners, no gloss, no texture, ",
  "no ribbon, no magnetic flap, no window, no printed pattern. ",
  "Photographed square to the camera from directly above. ",
  /**
   * La taille est la seule dimension qui suit le produit. Une boîte au gabarit
   * fixe donne un écrin de bijou pour un pantalon, ou un carton de déménagement
   * pour une bague : le rendu perd toute crédibilité.
   */
  "SCALE: the box is sized FOR THIS EXACT ITEM — just big enough to hold it with a small even margin ",
  "around it, and no bigger. The item must plausibly fit, folded as it would really be packed, and it ",
  "must fill most of the interior. A garment gets a wide flat apparel box, a small accessory gets a ",
  "small shallow box. Never a box that dwarfs the item, never one the item could not physically fit in. ",
  "Keep the real-world size relationship between the box and the product believable at a glance. ",
  "The supplied logo is printed once, centered, on the separate lid, in a single flat colour. ",
  "The lid rests flat beside the box, fully in frame, so that logo reads clearly. ",
  "Inside, plain white tissue paper, matte, lightly creased, no colour and no pattern. ",
  "The whole set sits on a textured natural surface — raw linen or pale stone. ",
  "Soft daylight from one side, gentle natural shadows, warm neutral palette. ",
].join("");

const UNBOXING_REMINDER =
  "Reminder: both the product and the logo must stay pixel-faithful to the reference images.";

/* ------------------------------------------------------------------ */
/* Casting                                                              */
/* ------------------------------------------------------------------ */

/**
 * Chaque prise de vue doit montrer une personne différente : on pioche un
 * profil distinct par produit et par plan, de façon déterministe pour que le
 * même CSV régénéré donne le même casting. Le casting féminin reste le défaut,
 * demandé par la première marque servie ; un protocole de grooming masculin
 * choisit « Homme » ou « Mixte » dans la barre.
 */
type ModelProfile = { age: number; look: string };

const WOMEN: ModelProfile[] = [
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

const MEN: ModelProfile[] = [
  { age: 23, look: "pale skin, short dark hair and a clean shave" },
  { age: 26, look: "South Asian features, short black hair and a trimmed beard" },
  { age: 29, look: "warm medium-brown skin and a short fade with a light stubble" },
  { age: 33, look: "light olive skin, tousled chestnut hair and a short beard" },
  { age: 37, look: "East Asian features and neat straight black hair" },
  { age: 41, look: "deep brown skin and a close-cropped cut" },
  { age: 45, look: "fair skin, dark blonde hair swept back and a groomed beard" },
  { age: 50, look: "tan skin and salt-and-pepper short hair" },
  { age: 56, look: "warm beige skin and silver hair with a trimmed grey beard" },
  { age: 62, look: "deep brown skin and short white hair" },
];

export type Gender = "woman" | "man" | "mixed";

export const GENDERS: Array<{ id: Gender; label: string }> = [
  { id: "woman", label: "Femme" },
  { id: "man", label: "Homme" },
  { id: "mixed", label: "Mixte" },
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

type Cast = { profile: ModelProfile; woman: boolean };

/** Une tranche vide ferait un prompt sans mannequin : on retombe sur la liste entière. */
function inBand(list: ModelProfile[], band: AgeBand): ModelProfile[] {
  const range = AGE_BANDS.find((entry) => entry.id === band);
  if (!range || range.id === "any") return list;
  const kept = list.filter((model) => model.age >= range.min && model.age <= range.max);
  return kept.length ? kept : list;
}

/** « Mixte » alterne femme et homme d'un plan à l'autre, toujours dans le même ordre. */
function castFor(gender: Gender, band: AgeBand, seed: string, offset: number): Cast {
  const woman = gender === "woman" || (gender === "mixed" && (hash(seed) + offset) % 2 === 0);
  const pool = inBand(woman ? WOMEN : MEN, band);
  return { profile: pick(pool, seed, offset), woman };
}

function describeCast(cast: Cast) {
  return `a ${cast.woman ? "woman" : "man"} of about ${cast.profile.age} with ${cast.profile.look}`;
}

/** Rappelé à chaque plan avec mannequin : une vraie personne, jamais un buste. */
function castingRule(cast: Cast) {
  return (
    `The model is a ${cast.woman ? "woman — never a man" : "man — never a woman"}, never a child. ` +
    `${cast.woman ? "She" : "He"} is a real human being with natural skin texture and natural body ` +
    "proportions, not a plastic mannequin, not a dress form, not a doll and not an illustration."
  );
}

/** Le produit n'est pas toujours un vêtement : on couvre les deux cas. */
function wornRule(cast: Cast, family: ProductFamily) {
  const s = cast.woman ? "she" : "he";
  const S = cast.woman ? "She" : "He";
  const her = cast.woman ? "her" : "his";
  if (family === "fashion") {
    return (
      `If the item is apparel or an accessory ${s} WEARS it on ${her} body, correctly fitted and fully ` +
      `visible. If it is not wearable ${s} holds it at chest height, facing the camera, label side out, ` +
      "hands clear of any detail."
    );
  }
  return (
    `${S} holds the product at chest height, facing the camera, label side out, hands clear of any ` +
    "detail, presenting it plainly and naturally — as if showing it to a friend. If the product is " +
    `something one wears or uses on the body, ${s} uses it exactly as intended instead.`
  );
}

/** Fonds de studio uniquement : les décors d'appartement sont écartés. */
const STUDIOS = [
  "a warm beige seamless studio backdrop",
  "a soft greige seamless studio backdrop",
  "a warm taupe seamless studio backdrop",
  "an off-white seamless studio cyclorama",
];

function hash(seed: string) {
  let value = 0;
  for (let i = 0; i < seed.length; i += 1) value = (value * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(value);
}

function pick<T>(pool: T[], seed: string, offset = 0): T {
  return pool[(hash(seed) + offset * 7) % pool.length];
}

/* ------------------------------------------------------------------ */
/* Programme digital : le coffret                                       */
/* ------------------------------------------------------------------ */

/**
 * Un programme vendu en PDF n'a pas de forme. On lui en donne une, toujours la
 * même d'une fiche à l'autre : un coffret premium, un livret et des cartes
 * d'étapes. C'est ce qui le fait lire comme un « système » et non comme un
 * ebook — et ce qui rend le catalogue reconnaissable d'un protocole au suivant.
 */
function kitSpec(product: Product, hasLogo: boolean) {
  const brand = product.vendor?.trim();
  const above = hasLogo
    ? ", and the supplied logo printed small above the title in a single flat colour"
    : brand
      ? `, and the brand name "${brand}" printed small above the title in the same typeface`
      : "";
  return (
    "THE PRODUCT IS A PREMIUM PHYSICAL KIT, always the same across the whole range, in this exact " +
    "and unchanging specification: a rigid rectangular box in matte bone-white soft-touch card, " +
    "clean square corners, no gloss, no ribbon, no window, no pattern. The lid carries the title " +
    `"${product.title}" printed once, centered, in a fine black sans-serif, with a thin black rule ` +
    `under it${above}. Nothing else is printed: no slogan, no bullet list, no invented words. ` +
    "Beside or inside the box: a slim matching guide booklet with the same cover, and a neat stack of " +
    "numbered step cards in the same bone-white card, one card partly visible. " +
    "This is a SYSTEM, NOT A BOOK: never a paperback, never a book spine, never a hardcover, never an " +
    "e-reader, never a tablet showing a PDF page. " +
    "TEXT ACCURACY: every printed word must be real, correctly spelled English, and the title must read " +
    `exactly "${product.title}" — nothing added, nothing abbreviated.`
  );
}

/** Le thème du programme nourrit le décor, jamais le texte. */
function themeSpec(product: Product) {
  const about = [product.description, product.tags]
    .map((part) => (part ?? "").trim().replace(/[.\s]+$/, ""))
    .filter(Boolean)
    .join(". ");
  if (!about) return "";
  return (
    `THEME: the programme is about — ${about}. Let the setting and one or two quiet props hint at this ` +
    "theme (choose real objects that belong to it), always secondary to the kit, never cluttering the " +
    "frame. Do not write the theme anywhere."
  );
}

/**
 * Le programme tel qu'il est livré : sur écran. La couverture est composée
 * comme le coffret (marque petite, titre, filet) pour que les deux familles de
 * visuels se répondent, mais rien n'est imprimé, rien n'est relié.
 */
function screenSpec(product: Product, hasLogo: boolean) {
  const brand = product.vendor?.trim();
  const header = hasLogo
    ? "the supplied logo small and centered at the top"
    : brand
      ? `the brand name "${brand}" small and centered at the top`
      : "nothing at the top";
  return (
    "THE PRODUCT IS A DIGITAL PROGRAMME delivered as a PDF and followed on the phone. It exists ONLY " +
    "on screens: no physical box, no booklet, no printed cards, no paperback, no book spine, no " +
    "e-reader. Both screens use the same friendly iOS-style design: pure white background, rounded " +
    "soft-grey cards, a rounded modern sans-serif, one soft accent colour, generous spacing — it " +
    "must look effortless, simple and fun to follow, like a well-made habit app, never like a " +
    "document. " +
    `COVER SCREEN: ${header}, the title "${product.title}" large and centered, a thin black rule ` +
    `under it, and below it a rounded pill button reading "Start today".` +
    " ROUTINE SCREEN: " +
    (hasLogo ? "the supplied logo tiny at the top, " : "") +
    'a warm greeting "Good morning" with a sun emoji, a rounded progress bar labelled "Day 3 of 30", ' +
    "then a checklist of five daily steps in rounded cards, each with ONE emoji on the left that " +
    "matches the step and a big rounded green tick on the right (the first three ticked, the last " +
    "two still empty). The steps are short, real, correctly spelled English phrases of two to four " +
    "words that fit the theme of the programme. " +
    `TEXT ACCURACY: the title must read exactly "${product.title}"; every other word must be real ` +
    "English, correctly spelled, readable. No other logos, no invented brand, no gibberish."
  );
}

/** Sur l'image « Contenu » le logo est la seule référence : il se pose tel quel sur le fond uni. */
const OFFER_LOGO =
  "LOGO FIDELITY — the reference image is the logo. Reproduce it exactly: identical shapes, " +
  "letterforms, spelling, proportions and colours. Do NOT redraw, restyle, recolour, crop or " +
  "re-letter it, and do not put it in a box or a circle. It appears once, at the top, nowhere else.";

/** Le logo, seule référence envoyée sur les plans écran : il ne doit aller que sur les écrans. */
const SCREEN_LOGO =
  "LOGO FIDELITY — the reference image is the logo. Reproduce it exactly: identical shapes, " +
  "letterforms, spelling, proportions and colours. Do NOT redraw, restyle, recolour, crop or " +
  "re-letter it. It appears ONLY on the screens, where the layout says so — never printed on an " +
  "object, never on the wall, never as a watermark.";

const SCREEN_REMINDER = "Reminder: the title on screen must read exactly as specified.";

const KIT_PHOTOGRAPHY =
  "PHOTOGRAPHY: high-end product photography, soft directional daylight from one side with a gentle " +
  "natural shadow, real soft-touch card texture, crisp legible print, true-to-life colours, sharp " +
  "focus, photorealistic, luxury brand catalogue quality, 8K detail.";

const KIT_REMINDER = "Reminder: the printed title must read exactly as specified, with no other text.";

/** Quand un logo est fourni sur un plan coffret, il n'y a pas d'autre référence. */
const KIT_LOGO =
  "LOGO FIDELITY — the reference image is your logo. Reproduce it exactly: identical shapes, " +
  "letterforms, spelling, proportions and colours. Do NOT redraw, restyle, recolour, crop or " +
  "re-letter it. It appears once, small, on the box lid above the title — nowhere else.";

/* ------------------------------------------------------------------ */
/* Programme digital : l'avant / après                                  */
/* ------------------------------------------------------------------ */

/**
 * Ce qui change entre les deux moitiés se lit dans la fiche Shopify : titre,
 * type, tags, description. Une règle par thème courant ; à défaut, on laisse
 * la description elle-même dire ce que le programme promet. Les règles vont
 * de la plus précise à la plus large : « facial hair » doit tomber dans le
 * grooming, pas dans la coupe de cheveux.
 */
type Axis = { before: string; after: string };

const AXES: Array<[RegExp, Axis]> = [
  [
    /\bskin|peau|acne|acné|glow\b|teint|complexion|blemish/,
    {
      before:
        "dull, tired, congested skin with visible redness, blemishes, clogged pores and dark circles, " +
        "unwashed hair pushed back",
      after:
        "clear, even, healthy skin with a natural glow, no blemishes, bright rested eyes, clean groomed hair, " +
        "a visibly leaner face with a sharper jawline and a cleaner neck",
    },
  ],
  [
    /physique|\bbody\b|corps|muscle|training|workout|fitness|posture|\bweight\b|poids|nutrition/,
    {
      before:
        "a soft, untrained physique with a little belly, rounded shoulders and a slouched posture, in a " +
        "plain baggy t-shirt",
      after:
        "a lean, athletic physique with visible definition in the arms and shoulders, upright open " +
        "posture, in the same t-shirt now fitting well",
    },
  ],
  [
    /groom|beard|barbe\b|\bbrow|sourcil|shav|rasage|facial hair|visage|nails|oral/,
    {
      before: "patchy, unkempt facial hair, wild brows, oily tired skin, a puffy undefined jaw and a soft neck",
      after:
        "a short, cleanly shaped beard line or a clean shave that follows the jaw, tidy brows, fresh matte " +
        "skin, and a visibly sharper jawline: defined mandible angle, less fullness under the chin, a " +
        "cleaner neck — the same face, leaner and cared for",
    },
  ],
  [
    /haircut|hairstyle|\bhair\b|cheveux|coiffure|barber|coupe/,
    {
      before: "overgrown, shapeless, unstyled hair with no defined cut, flattened and dull",
      after: "a sharp, precise haircut that suits the face, freshly cut, styled and clean",
    },
  ],
  [
    /\bstyle\b|outfit|wardrobe|capsule|proportion|tenue|vêtement|vetement|dress(ed|ing)?\b|\bfit\b/,
    {
      before: "ill-fitting, wrinkled, mismatched clothes in clashing colours, sleeves and hems too long",
      after:
        "a well-fitted, coordinated outfit in a coherent neutral palette, tailored proportions, " +
        "clean lines",
    },
  ],
  [
    /transformation|glow.?up|aesthetic|blueprint|ultimate|complete|system|looksmax/,
    {
      before:
        "a tired, neglected overall look: dull skin, shapeless hair, slouched posture, baggy " +
        "wrinkled clothes",
      after:
        "a complete glow-up: clear skin, a sharper jawline and leaner face, a sharp haircut, upright " +
        "posture, fitted clean clothes, a confident presence",
    },
  ],
];

function axisFor(product: Product): Axis {
  const text = `${product.title} ${product.type ?? ""} ${product.tags ?? ""} ${product.description ?? ""}`.toLowerCase();
  for (const [pattern, axis] of AXES) {
    if (pattern.test(text)) return axis;
  }
  const promise = (product.description || product.title).trim().replace(/[.\s]+$/, "");
  return {
    before: "the neglected starting point that this programme is designed to fix",
    after: `the exact result this programme promises — ${promise}`,
  };
}

/* ------------------------------------------------------------------ */
/* Construction du prompt                                               */
/* ------------------------------------------------------------------ */

export type Product = {
  handle: string;
  title: string;
  type?: string;
  vendor?: string;
  description?: string;
  tags?: string;
};

export type PromptOptions = {
  family?: ProductFamily;
  age?: AgeBand;
  gender?: Gender;
  ratio?: Ratio;
  /** Un logo est envoyé en référence (unboxing, coffret, contenu). */
  hasLogo?: boolean;
  /** Couleur de fond de l'image « Contenu du protocole », en hexadécimal. */
  brandColor?: string;
  /** Couleur du texte et couleur d'accent, lues sur la boutique. */
  textColor?: string;
  accentColor?: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

function hexOr(value: string | undefined, fallback: string) {
  return value && HEX.test(value) ? value.toLowerCase() : fallback;
}

/** Luminance relative, pour choisir une encre lisible sur le fond. */
function luminanceOf(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function readable(background: string, ink: string) {
  return Math.abs(luminanceOf(background) - luminanceOf(ink)) > 0.4;
}

/** Ardoise sombre : la couleur du carton final de Reproduire, neutre pour n'importe quelle marque. */
export const DEFAULT_BRAND_COLOR = "#233137";

export function buildPrompt(shot: ShotId, product: Product, options: PromptOptions = {}): string {
  const family = options.family ?? "fashion";
  const age = options.age ?? "any";
  const gender = options.gender ?? "woman";
  const hasLogo = Boolean(options.hasLogo);
  const ratio = options.ratio ?? "3:4";
  const brandColor = hexOr(options.brandColor, DEFAULT_BRAND_COLOR);
  /*
   * L'encre vient de la boutique si elle se lit sur le fond ; sinon blanc ou
   * quasi-noir selon la clarté du fond. L'accent suit la même règle et retombe
   * sur l'encre.
   */
  const autoInk = luminanceOf(brandColor) > 0.5 ? "#111111" : "#ffffff";
  const textColor = hexOr(options.textColor, autoInk);
  const ink = readable(brandColor, textColor) ? textColor : autoInk;
  const accentCandidate = hexOr(options.accentColor, ink);
  const accent = readable(brandColor, accentCandidate) ? accentCandidate : ink;
  const subject = product.title || product.handle;
  const category = product.type ? ` (${product.type})` : "";
  const seed = product.handle;
  const studio = pick(STUDIOS, seed, 0);
  const fidelity = family === "fashion" ? FIDELITY_FASHION : FIDELITY_OBJECT;
  const body = family === "fashion" ? "full body" : "from the waist up";

  switch (shot) {
    case "flatlay":
      return (
        `${fidelity}\n\n` +
        `SCENE: Top-down flat lay of ${subject}${category} on ${studio}, laid out perfectly flat and ` +
        `centered, opened out and arranged naturally so that no part of it is folded away or hidden, ` +
        `styled editorially with balanced spacing around it. No props, no hands, no packaging in frame.` +
        `\n\n${PHOTOGRAPHY}\n\n${framing(ratio)} ${PRODUCT_REMINDER}`
      );

    case "packshot":
      return (
        `${fidelity}\n\n` +
        `SCENE: Studio packshot of ${subject}${category} standing or resting naturally on ${studio}, ` +
        `seen slightly from above at a three-quarter angle so its front and one side both read, label ` +
        `facing the camera, centered. No props, no hands, no packaging in frame.` +
        `\n\n${PHOTOGRAPHY}\n\n${framing(ratio)} ${PRODUCT_REMINDER}`
      );

    case "model_front": {
      const cast = castFor(gender, age, seed, 0);
      const s = cast.woman ? "she" : "he";
      return (
        `${fidelity}\n\n` +
        `MODEL: ${describeCast(cast)}. ${castingRule(cast)}\n\n` +
        `WARDROBE: ${s} presents ${subject}${category} exactly as it appears in the reference images. ` +
        `${wornRule(cast, family)} Everything else ${s} wears stays plain and neutral so nothing ` +
        `competes with the item.\n\n` +
        `POSE: standing ${body}, straight on at eye level, relaxed confident posture, arms clear of ` +
        `the item so no part of it is covered, looking directly into the lens with a subtle friendly ` +
        `expression.${family === "fashion" ? " Head to feet inside the frame." : ""}\n\n` +
        `SET: ${studio}.\n\n${PHOTOGRAPHY}\n\n${framing(ratio)} ${PRODUCT_REMINDER}`
      );
    }

    case "model_three_quarter": {
      const cast = castFor(gender, age, seed, 3);
      const s = cast.woman ? "she" : "he";
      return (
        `${fidelity}\n\n` +
        `MODEL: ${describeCast(cast)} — a clearly different person from any other image in this set. ` +
        `${castingRule(cast)}\n\n` +
        `WARDROBE: ${s} presents ${subject}${category} exactly as it appears in the reference images, ` +
        `seen from a new angle but keeping the exact same design and colours. ${wornRule(cast, family)}` +
        `\n\n` +
        `POSE: standing ${body} at a three-quarter angle, shot from a slightly elevated camera, body ` +
        `turned about 45 degrees, head towards the lens, calm editorial expression, arms relaxed and ` +
        `away from the item.\n\n` +
        `SET: ${pick(STUDIOS, seed, 1)}.\n\n${PHOTOGRAPHY}\n\n${framing(ratio)} ${PRODUCT_REMINDER}`
      );
    }

    case "model_detail": {
      const cast = castFor(gender, age, seed, 6);
      const her = cast.woman ? "her" : "his";
      const detail =
        family === "fashion"
          ? `SUBJECT FRAMING: tight close-up cropped on the part of the body where the item sits, so ` +
            `that the item and ${her} hands fill the frame. Show the real material texture, the actual ` +
            `weave, the actual stitching and the actual trims exactly as they appear in the reference. ` +
            `Background softly blurred.`
          : `SUBJECT FRAMING: tight macro close-up on the product in ${her} hands, filling the frame, ` +
            `label readable. Show the real surface texture, the actual material, the actual print and ` +
            `the actual hardware exactly as they appear in the reference. Background softly blurred.`;
      return (
        `${fidelity}\n\n` +
        `MODEL: ${describeCast(cast)} — again a different person. ${castingRule(cast)}\n\n` +
        `WARDROBE: ${subject}${category} exactly as in the reference images. ${wornRule(cast, family)}` +
        `\n\n${detail}\n\n` +
        `SET: ${pick(STUDIOS, seed, 2)}.\n\n${PHOTOGRAPHY}\n\n${framing(ratio)} ${PRODUCT_REMINDER}`
      );
    }

    case "packaging":
      return (
        `${fidelity}\n\n` +
        `${LOGO_IN_SCENE}\n\n` +
        `SCENE: Top-down unboxing photograph. ${subject}${category} lies inside an open box. ` +
        `${BOX}` +
        `\n\nNothing else is in frame: no white studio sweep, no second box, no ribbon, no bag, ` +
        `no confetti, no hands, no text and no barcode.\n\n` +
        `${PACKAGING_PHOTOGRAPHY}\n\n${framing(ratio)} ${UNBOXING_REMINDER}`
      );

    case "kit_top":
      return (
        `${kitSpec(product, hasLogo)}\n\n` +
        `${hasLogo ? `${KIT_LOGO}\n\n` : ""}` +
        `SCENE: Top-down photograph of the closed kit box, square to the camera, the guide booklet and ` +
        `the step cards laid neatly beside it with even spacing, on a textured natural surface — pale ` +
        `stone or raw linen. Nothing else in frame: no hands, no plants, no other text.\n\n` +
        `${KIT_PHOTOGRAPHY}\n\n${framing(ratio)} ${KIT_REMINDER}`
      );

    case "kit_scene":
      return (
        `${kitSpec(product, hasLogo)}\n\n` +
        `${hasLogo ? `${KIT_LOGO}\n\n` : ""}` +
        `${themeSpec(product)}\n\n` +
        `SCENE: Three-quarter view at table height of the kit box standing slightly open, the booklet ` +
        `leaning against it and two step cards fanned in front, on a clean stone or oak surface in a ` +
        `bright minimal interior, soft window light, shallow depth of field so the title stays sharp ` +
        `and the room melts away. No hands, no screens.\n\n` +
        `${KIT_PHOTOGRAPHY}\n\n${framing(ratio)} ${KIT_REMINDER}`
      );

    case "phone":
      return (
        `${themeSpec(product)}\n\n` +
        `SCENE: A modern smartphone resting on a pale stone surface next to a small stack of bone-white ` +
        `step cards, seen from directly above. The screen shows the programme as a clean, minimal ` +
        `checklist app on a white background: the title "${product.title}" at the top in black, then ` +
        `four short step labels with small ticks, each two or three real English words that fit the ` +
        `theme. No logos, no icons other than ticks, no numbers, no invented brand. This is an app ` +
        `screen, NOT a book cover, NOT a PDF page, NOT an e-reader.\n\n` +
        `TEXT ACCURACY: every word on screen must be real, correctly spelled English, and the title ` +
        `must read exactly "${product.title}".\n\n` +
        `${KIT_PHOTOGRAPHY}\n\n${framing(ratio)} Reminder: the title on screen must read exactly as specified.`
      );

    case "lifestyle": {
      const cast = castFor(gender, age, seed, 4);
      const S = cast.woman ? "She" : "He";
      return (
        `${screenSpec(product, hasLogo)}\n\n` +
        `${hasLogo ? `${SCREEN_LOGO}\n\n` : ""}` +
        `${themeSpec(product)}\n\n` +
        `MODEL: ${describeCast(cast)}. ${castingRule(cast)} ${S} looks like the outcome of the ` +
        `programme: healthy, well groomed, confident and at ease, in plain neutral clothing.\n\n` +
        `SCENE: ${S} sits or stands in a bright, calm interior that belongs to the theme (a clean ` +
        `bathroom, a sunlit bedroom, a minimal home gym — whichever fits), holding ${cast.woman ? "her" : "his"} ` +
        `own smartphone in one hand at chest height, the screen turned towards the camera and showing ` +
        `the COVER SCREEN of the programme, readable. The person is the subject, the phone is a natural ` +
        `prop. No box, no booklet, no printed material anywhere. Natural, unposed, editorial.\n\n` +
        `${PHOTOGRAPHY}\n\n${framing(ratio)} ${SCREEN_REMINDER}`
      );
    }

    /*
     * Une seule image, à plat, qui dit tout : ce que contient le programme, ce
     * qu'il promet, la garantie. Pas d'appareil, pas de boîte, pas de photo —
     * de la couleur et de la typographie, comme un hero de site SaaS.
     */
    case "offer_card": {
      const brand = product.vendor?.trim();
      const promise = (product.description || product.title).trim().replace(/[.\s]+$/, "");
      const top = hasLogo
        ? "the supplied logo, small and centered"
        : brand
          ? `the brand name "${brand}" small and centered, in letter-spaced capitals`
          : "nothing";
      return (
        `OFFER CARD — a clean, flat, purely typographic product visual for a digital programme, ` +
        `designed like the hero of a premium SaaS landing page. No device, no box, no book, no ` +
        `photo, no person, no mockup, no illustration: only one flat colour, type and thin line ` +
        `icons.\n\n` +
        `BACKGROUND: one flat solid colour, exactly ${brandColor}, edge to edge. No gradient, no ` +
        `texture, no pattern, no shapes.\n\n` +
        `${hasLogo ? `${OFFER_LOGO}\n\n` : ""}` +
        `LAYOUT, top to bottom, everything centered, generous even spacing:\n` +
        `1. At the top: ${top}.\n` +
        `2. The title "${product.title}", large, in a clean modern geometric sans-serif.\n` +
        `3. One bold promise line of at most ten words, written FRESH — never a copy of the ` +
        `description, never about "looks" or "transforming your look" — that tells the reader how ` +
        `their LIFE changes once they look their best: the way people treat them at work, in dating ` +
        `and relationships, in every room they walk into. Second person, plain confident English, ` +
        `the shape of "Walk into every room like you belong there" or "Be taken seriously at work. ` +
        `Be noticed everywhere else." The programme behind it: ${promise}.\n` +
        `4. A thin horizontal rule in exactly ${accent}.\n` +
        `5. A small letter-spaced label "WHAT'S INSIDE", then five short lines of two to five words ` +
        `each, listing concretely what the programme contains, each line with a thin line-icon ` +
        `check mark in exactly ${accent} on its left, all derived from the same description.\n` +
        `6. At the bottom: a rounded outline badge, outlined in exactly ${accent}, reading ` +
        `"30-day money-back guarantee". Nothing under it.\n\n` +
        `TYPOGRAPHY: every piece of text in ONE single colour, exactly ${ink}, one typeface family, ` +
        `perfect alignment, real and correctly spelled English, and nothing else written anywhere. ` +
        `TEXT ACCURACY: the title must read exactly "${product.title}".\n\n` +
        `STYLE: minimal, premium, aesthetic, lots of breathing room — never a flyer, never clip-art, ` +
        `never emoji, never a drop shadow, never a 3D effect.\n\n` +
        `COMPOSITION: ${RATIO_WORDS[ratio]} frame, no border, no watermark.`
      );
    }

    /*
     * Trois angles, trois personnes différentes : une fiche produit avec
     * plusieurs avant / après se lit comme plusieurs clients transformés, pas
     * comme la même photo répétée. Le profil est celui qui montre le mieux la
     * mâchoire et la posture ; le trois-quarts, la coupe et la barbe.
     */
    case "before_after":
    case "before_after_quarter":
    case "before_after_profile": {
      const angle = shot === "before_after" ? 0 : shot === "before_after_quarter" ? 1 : 2;
      const cast = castFor(gender, age, seed, 8 + angle);
      const axis = axisFor(product);
      const S = cast.woman ? "She" : "He";
      const stacked = ratio === "9:16";
      const first = stacked ? "TOP half" : "LEFT half";
      const second = stacked ? "BOTTOM half" : "RIGHT half";
      const promise = (product.description || product.title).trim().replace(/[.\s]+$/, "");
      const pose = [
        "chest up, straight on, at eye level, looking directly into the lens",
        "chest up, three-quarter view with the head turned about 45 degrees to the camera's left, eyes " +
          "to the lens, so the jaw, cheekbone and hairline all read",
        "chest up, true side profile with the head turned 90 degrees to face the right edge of the frame, " +
          "looking straight ahead and NOT at the camera, so the jawline, chin, nose line, neck and " +
          "posture read cleanly against the background",
      ][angle];
      /*
       * Une image de vente, pas une photo de suivi. Les deux moitiés gardent
       * la même personne, le même cadrage et la même lumière — c'est ce qui
       * rend la comparaison crédible — mais tout ce que le programme change
       * change fort : posture, regard, peau, coiffure, assurance. Et l'image
       * dit elle-même ce qu'elle promet, en une ligne : ce n'est pas un
       * visage qui change, c'est une vie.
       */
      return (
        `ULTRA-REALISTIC PHOTOGRAPH, indistinguishable from a real iPhone 15 Pro front-camera selfie: ` +
        `24 mm equivalent, natural window daylight, neutral white balance, true skin tones, visible ` +
        `pores, fine lines, stray hairs, slight sensor noise, no beauty filter. NOT an illustration, ` +
        `NOT 3D, NOT painted, NOT AI-smooth, no green or teal colour cast, no HDR glow.\n\n` +
        `BEFORE / AFTER — one single photograph split in two equal halves by a thin white line: ` +
        `${first} is BEFORE, ${second} is AFTER. It must stop the scroll: the difference reads at ` +
        `thumbnail size, instantly.\n\n` +
        `IN FRAME: only the person, chest up, against a plain light wall. No props, no plants, no ` +
        `towels, no furniture, no products, no hands holding anything, nothing else.\n\n` +
        `SAME PERSON IN BOTH HALVES — this overrides everything else: ${describeCast(cast)}. Identical ` +
        `face, identical bone structure, identical eye colour, identical age, identical height and ` +
        `build baseline, the same plain neutral clothing colour, the same framing, the same plain ` +
        `neutral background, the same natural window light, the same phone camera. ` +
        `${castingRule(cast)}\n\n` +
        `POSE, IDENTICAL IN BOTH HALVES: ${pose}.\n\n` +
        `BEFORE (${first}): ${axis.before}. ${S} looks like someone who avoids mirrors: shoulders ` +
        `dropped, eyes dull and slightly away from the lens, mouth flat, the face of a person who ` +
        `feels invisible at work and on dates. Not ugly — neglected and unsure.\n` +
        `AFTER (${second}): ${axis.after}. ${S} looks like someone people notice when ${cast.woman ? "she" : "he"} ` +
        `walks in: chin level, shoulders open, direct eye contact, an easy confident closed-mouth smile, skin ` +
        `that catches the light, hair with shape, and a JAWLINE that reads — defined mandible angle, ` +
        `taut skin under the chin, a clean neck line — the face a few kilos leaner. The best version of ` +
        `the SAME person, ` +
        `unmistakably ${cast.woman ? "her" : "him"} — thirty days later, not a different human.\n\n` +
        `THE CHANGE IS ONLY what the programme delivers — ${promise}. Push the contrast as far as it ` +
        `stays believable for thirty days of consistent effort: grooming, skin, posture, expression, ` +
        `confidence — no surgery look, no impossible body change, no different person. Do NOT ` +
        `flatter one side with different lighting, angle or lens. No filters, no smoothing, no ` +
        `retouching: real pores and real skin texture on BOTH sides.\n\n` +
        `TEXT ON THE IMAGE, and nothing else written:\n` +
        `- "BEFORE" small in the top-left corner of its half and "AFTER" small in the top-left corner of ` +
        `its half, white sans-serif on a thin black pill;\n` +
        `- at the bottom, centered across the whole frame on a soft dark gradient: the title ` +
        `"${product.title}" in small letter-spaced capitals, and under it ONE bold white line of at ` +
        `most seven words that says how ${cast.woman ? "her" : "his"} life changed — the way people treat ` +
        `${cast.woman ? "her" : "him"} at work, in dating, in every room — written fresh, in confident ` +
        `plain English, the shape of "Same face. Different life." or "People started looking. So did ` +
        `she." Never "transform your look", never a claim about health. Real, correctly spelled ` +
        `English, no logo, no watermark.\n\n` +
        `PHOTOGRAPHY: raw phone-camera realism, natural daylight, unretouched skin, true-to-life ` +
        `colours, sharp focus, photorealistic — a real progress photo, not a studio shot.\n\n` +
        `COMPOSITION: ${RATIO_WORDS[ratio]} frame filled edge to edge by the two halves, the person ` +
        `centered in each half, no outer border, no collage frame, no third panel.`
      );
    }
  }
}

export function shotLabel(id: ShotId) {
  return SHOTS.find((shot) => shot.id === id)?.label ?? id;
}

/** Un plan avec mannequin est concerné par l'âge et le casting. */
export function hasModel(id: ShotId) {
  return Boolean(SHOTS.find((shot) => shot.id === id)?.hasModel);
}

/** Plans sans aucune référence image : ni photo produit, ni logo. */
export function standalone(id: ShotId) {
  return id === "phone" || BEFORE_AFTER.has(id);
}

/** Les trois angles de l'avant / après. */
export const BEFORE_AFTER = new Set<ShotId>(["before_after", "before_after_quarter", "before_after_profile"]);

/** Plans qui affichent le logo s'il est fourni, et n'ont besoin d'aucune autre référence. */
export function usesKit(id: ShotId) {
  return id === "kit_top" || id === "kit_scene" || id === "offer_card" || id === "lifestyle";
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
