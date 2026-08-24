import { characterLock, pronoun, type Casting } from "@/lib/ugc/casting";
import { handlingFor, type ProductKind } from "@/lib/ugc/kinds";
import type { Angle, ProductInput } from "@/lib/ugc/types";

/**
 * Préambule commun à toutes les scènes, tiré des règles du cours AI UGC V3 : on
 * annonce le type de prise de vue, on interdit l'esthétique pub, et on impose un
 * dialogue exact — c'est ce qui sépare un rendu crédible du « slop ».
 */
export const PREAMBLE = [
  "Photorealistic UGC video shot on a modern iPhone, handheld with natural micro-shake, ",
  "realistic skin texture with visible pores and imperfections, true-to-life lighting, ",
  "believable everyday location, slight compositional imperfection. ",
  "It must look like a real person filmed this quickly on their phone: NOT cinematic, ",
  "NOT studio-lit, NOT fashion editorial, NOT glossy advertising, NOT AI-smooth. ",
  "One continuous take, no cuts, no zooms, no transitions, ambient sound. ",
  "The speaker delivers the line in a natural, conversational creator tone. ",
  "Speak the dialogue EXACTLY as written, no improvisation, no added words. ",
  "DELIVERY: the speaker is ALREADY talking when the clip starts and is still talking when it ends. ",
  "No silence at the head or tail, no dead air, no pause between sentences, no hesitation, ",
  "no waiting for a cue, no breath gap. The speech runs continuously for the whole duration, ",
  "at a natural pace that fills the clip exactly, and stays perfectly lip-synced. ",
  "No on-screen text, no captions, no watermark, no logo overlay, no social media UI.",
].join("");

/**
 * Verrou produit. Il énonce le rang des références — la première image est la
 * personne, les suivantes le produit — parce que sans cet ordre explicite le
 * modèle confond les deux et fabrique un objet qui n'a rien à voir.
 */
export const PRODUCT_LOCK = [
  "ABSOLUTE PRODUCT FIDELITY — the product is the object shown in the reference images that follow ",
  "the first one. Reproduce it EXACTLY: identical shape and silhouette, identical proportions, ",
  "identical colour and placement of every colour area, identical material and texture, ",
  "identical print, pattern, label, seams, buttons, straps and hardware. ",
  "Do NOT substitute it with a similar product. Do NOT redesign, restyle, recolour or simplify it. ",
  "Do NOT invent branding or text on it. It is the same single object in every clip of this set. ",
  "It stays fully visible in frame, never cropped out, never hidden by hands. ",
  "IGNORE any person, model, hand or face appearing in those product reference images: ",
  "they are packshots, not the protagonist. Take ONLY the object from them. ",
  "The person in the video comes from the first reference image and from nowhere else.",
].join("");

/** Jetons remplacés à la volée — mêmes noms que dans l'outil de référence. */
export function fillTemplate(text: string, product: ProductInput, casting: Casting) {
  const points = product.keyPoints.filter(Boolean);
  const map: Record<string, string> = {
    product_name: product.name,
    product_description: product.description,
    product_price: product.price,
    compare_at_price: product.comparePrice,
    brand: product.brand,
    key_points: points.join(", "),
    they: pronoun(casting),
    them: casting.gender === "femme" ? "her" : "him",
    their: casting.gender === "femme" ? "her" : "his",
  };
  points.forEach((point, index) => {
    map[`keypoint${index + 1}`] = point;
  });

  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = map[key];
    if (value !== undefined && value !== "") return value;
    // Un point clé manquant se retire proprement plutôt que d'afficher le jeton.
    return /^keypoint\d+$/.test(key) ? points[0] || product.name : whole;
  });
}

/** Assemble le prompt final d'une scène : verrous d'abord, scène ensuite. */
export function composeScenePrompt(
  scene: string,
  product: ProductInput,
  casting: Casting,
  kind: ProductKind,
  describeCasting = true
) {
  return [
    characterLock(casting, describeCasting),
    PRODUCT_LOCK,
    handlingFor(kind),
    PREAMBLE,
    fillTemplate(scene, product, casting),
  ].join("\n\n");
}

/**
 * Bibliothèque d'angles. Chacun attaque l'achat par un biais différent — c'est
 * la variable qu'on teste en ads, le produit restant constant. Aucune scène ne
 * décrit la personne : elle dit « the protagonist », et l'identité vient
 * uniquement de l'image d'avatar passée en première référence.
 */
export const ANGLES: Angle[] = [
  {
    id: "problem-solution",
    name: "Problème → solution",
    pitch: "Nomme la frustration en 3 secondes, puis montre que le produit la règle.",
    scenes: [
      {
        label: "Hook",
        duration: 6,
        prompt:
          "SCENE: The protagonist is at home, visibly frustrated, talking straight into the phone " +
          "camera held at arm's length. The product is not in frame yet.\n\n" +
          'DIALOGUE (exact, no improv): "Okay I need to talk about this because I was so tired of {{keypoint1}}."',
      },
      {
        label: "Révélation",
        duration: 8,
        prompt:
          "SCENE: The protagonist, same room and same outfit, now holds {{product_name}} up to the " +
          "camera and turns it slowly so the whole product is clearly visible.\n\n" +
          'DIALOGUE (exact, no improv): "And then I found this. {{product_description}}"',
      },
      {
        label: "Preuve",
        duration: 8,
        prompt:
          "SCENE: The protagonist actually uses {{product_name}}, filmed slightly closer, the product " +
          "in real use and fully in frame.\n\n" +
          'DIALOGUE (exact, no improv): "{{keypoint2}}. I genuinely did not expect that."',
      },
      {
        label: "CTA",
        duration: 6,
        prompt:
          "SCENE: The protagonist holds {{product_name}} at chest height, looking straight at the lens " +
          "with a calm confident smile.\n\n" +
          'DIALOGUE (exact, no improv): "{{brand}} sells it for {{product_price}} right now. Link is right there, go get it."',
      },
    ],
  },
  {
    id: "price-shock",
    name: "Choc de prix",
    pitch: "Oppose le prix attendu au prix réel. Marche fort sur les gadgets.",
    scenes: [
      {
        label: "Hook",
        duration: 5,
        prompt:
          "SCENE: The protagonist holds {{product_name}} close to the phone camera, eyebrows raised, " +
          "genuinely surprised expression.\n\n" +
          'DIALOGUE (exact, no improv): "Guess how much this cost me. No seriously, guess."',
      },
      {
        label: "Révélation prix",
        duration: 7,
        prompt:
          "SCENE: Same room, same outfit. The protagonist turns {{product_name}} to show it fully.\n\n" +
          'DIALOGUE (exact, no improv): "{{product_price}}. That is it. I paid {{compare_at_price}} for the last one."',
      },
      {
        label: "Justification",
        duration: 8,
        prompt:
          "SCENE: The protagonist demonstrates {{product_name}} in real use, camera slightly closer on " +
          "the product.\n\n" +
          'DIALOGUE (exact, no improv): "And it does {{keypoint1}}. For that price I am not complaining."',
      },
      {
        label: "CTA",
        duration: 5,
        prompt:
          "SCENE: The protagonist holds {{product_name}} visible, direct eye contact with the lens.\n\n" +
          'DIALOGUE (exact, no improv): "It is on the {{brand}} site. Tap the link before they put the price back up."',
      },
    ],
  },
  {
    id: "honest-review",
    name: "Avis honnête",
    pitch: "Concède un défaut avant de vendre. La réserve crée la crédibilité.",
    scenes: [
      {
        label: "Hook",
        duration: 6,
        prompt:
          "SCENE: The protagonist sits on a sofa, relaxed, holding {{product_name}} loosely, speaking " +
          "to the phone propped in front of them.\n\n" +
          'DIALOGUE (exact, no improv): "I have had this for three weeks now, so here is my honest take."',
      },
      {
        label: "Le défaut",
        duration: 7,
        prompt:
          "SCENE: Same sofa, same outfit, slight shrug, turning {{product_name}} in their hands.\n\n" +
          'DIALOGUE (exact, no improv): "It is not perfect. It took me a day to get used to it."',
      },
      {
        label: "Le retournement",
        duration: 9,
        prompt:
          "SCENE: The protagonist leans forward, more engaged, {{product_name}} clearly in frame.\n\n" +
          'DIALOGUE (exact, no improv): "But {{keypoint1}}, and honestly that alone made it worth it."',
      },
      {
        label: "CTA",
        duration: 6,
        prompt:
          "SCENE: The protagonist holds {{product_name}} at chest height, direct look at the lens.\n\n" +
          'DIALOGUE (exact, no improv): "If that sounds like your problem too, it is {{product_price}} on {{brand}}. Link below."',
      },
    ],
  },
  {
    id: "unboxing",
    name: "Déballage",
    pitch: "Le moment du colis. Angle sûr quand le produit est beau en main.",
    scenes: [
      {
        label: "Hook",
        duration: 5,
        prompt:
          "SCENE: Top-down phone shot of the protagonist's hands opening a plain parcel on a table, " +
          "natural daylight.\n\n" +
          'DIALOGUE (exact, off camera): "This just landed and I have been waiting two weeks for it."',
      },
      {
        label: "Révélation",
        duration: 7,
        prompt:
          "SCENE: The protagonist's hands lift {{product_name}} out of the parcel and hold it up into " +
          "the light, turning it slowly so every side is visible.\n\n" +
          'DIALOGUE (exact, off camera): "Okay. {{product_description}}"',
      },
      {
        label: "Premier usage",
        duration: 9,
        prompt:
          "SCENE: The protagonist uses {{product_name}} for the first time, handheld phone camera, " +
          "genuine reaction on their face, same outfit as before.\n\n" +
          'DIALOGUE (exact, no improv): "{{keypoint1}}. Yeah, that is better than I expected."',
      },
      {
        label: "CTA",
        duration: 5,
        prompt:
          "SCENE: The protagonist holds {{product_name}} towards the lens, warm smile.\n\n" +
          'DIALOGUE (exact, no improv): "{{product_price}} from {{brand}}. Link is in the bio, go."',
      },
    ],
  },
  {
    id: "three-reasons",
    name: "3 raisons",
    pitch: "Format liste. Rythme rapide, bon pour les vues jusqu'au bout.",
    scenes: [
      {
        label: "Hook",
        duration: 5,
        prompt:
          "SCENE: The protagonist stands in a bright room holding {{product_name}}, energetic.\n\n" +
          'DIALOGUE (exact, no improv): "Three reasons I will not shut up about this."',
      },
      {
        label: "Raison 1",
        duration: 6,
        prompt:
          "SCENE: The protagonist holds up one finger, then shows the relevant part of " +
          "{{product_name}} close to the camera. Same room, same outfit.\n\n" +
          'DIALOGUE (exact, no improv): "One. {{keypoint1}}."',
      },
      {
        label: "Raison 2",
        duration: 6,
        prompt:
          "SCENE: The protagonist holds up two fingers, then demonstrates {{product_name}} in use. " +
          "Same room, same outfit.\n\n" +
          'DIALOGUE (exact, no improv): "Two. {{keypoint2}}."',
      },
      {
        label: "Raison 3 + CTA",
        duration: 8,
        prompt:
          "SCENE: The protagonist holds up three fingers, then holds {{product_name}} at chest height, " +
          "direct eye contact.\n\n" +
          'DIALOGUE (exact, no improv): "Three. {{keypoint3}}. {{brand}}, {{product_price}}. Go."',
      },
    ],
  },
  {
    id: "insider",
    name: "L'initié",
    pitch: "Quelqu'un « du métier » explique ce que la marque ne dit pas.",
    scenes: [
      {
        label: "Hook",
        duration: 6,
        prompt:
          "SCENE: The protagonist films themselves in a hallway, slightly conspiratorial tone, leaning " +
          "towards the lens.\n\n" +
          'DIALOGUE (exact, no improv): "I worked in this industry for six years, so let me save you some money."',
      },
      {
        label: "Le mécanisme",
        duration: 9,
        prompt:
          "SCENE: The protagonist holds {{product_name}} up and points at a specific part of it. Same " +
          "outfit, same lighting.\n\n" +
          'DIALOGUE (exact, no improv): "What you are actually paying for is {{keypoint1}}. This one does it for {{product_price}}."',
      },
      {
        label: "La preuve",
        duration: 8,
        prompt:
          "SCENE: The protagonist uses {{product_name}} to demonstrate the point, camera closer on the " +
          "product.\n\n" +
          'DIALOGUE (exact, no improv): "{{keypoint2}}. That is the whole trick."',
      },
      {
        label: "CTA",
        duration: 5,
        prompt:
          "SCENE: The protagonist holds {{product_name}} visible, calm direct delivery.\n\n" +
          'DIALOGUE (exact, no improv): "{{brand}}, link is below. Do not pay {{compare_at_price}} for the same thing."',
      },
    ],
  },
];
