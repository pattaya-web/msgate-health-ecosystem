import { characterLock, pronoun, type Casting } from "@/lib/ugc/casting";
import { formatBlock, nicheBlock, type FormatId, type NicheId } from "@/lib/ugc/formats";
import { handlingFor, isPhysical, type ProductKind } from "@/lib/ugc/kinds";
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

/** Même verrou quand aucune personne n'est en référence : toutes les images sont le produit. */
export const PRODUCT_LOCK_NO_AVATAR = PRODUCT_LOCK.replace(
  "the object shown in the reference images that follow the first one.",
  "the object shown in the reference images — ALL of them show the product."
).replace(" The person in the video comes from the first reference image and from nowhere else.", "");

/**
 * Verrou « sujet » : le pendant du verrou produit quand il n'y a rien à tenir.
 * Sans lui, un modèle habitué aux pubs sort un flacon de nulle part.
 */
export const TOPIC_LOCK = [
  'SUBJECT — the protagonist talks about "{{product_name}}". {{product_description}} ',
  "There is NO physical product in this video: do not add packaging, bottles, boxes, phones held ",
  "up to the lens, or any prop that would stand for the subject. Everything is carried by the ",
  "protagonist's words, face and hands.",
].join("");

/**
 * En sujet libre, la scène écrite fait loi : si elle montre un téléphone ou un
 * objet, il y est. On ne garde que l'interdiction d'inventer au-delà d'elle.
 */
export const TOPIC_LOCK_FREE = [
  'SUBJECT — the video is about "{{product_name}}". {{product_description}} ',
  "Show ONLY what the SETTING and the SCENE below describe: no invented packaging, bottles, boxes, ",
  "graphics or props beyond them. If the scene shows a phone screen, keep its content simple and ",
  "readable, with real words only.",
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

export type SceneContext = {
  /** Comment c'est filmé : selfie, facecam, podcast, interview… */
  format?: FormatId | null;
  /** Qui parle et d'où : mode, beauté, fitness… */
  niche?: NicheId | null;
  /** Bloc de style relevé sur une vidéo de référence (bibliothèque). */
  styleBlock?: string | null;
  /** Un avatar est passé en première référence. Sans lui, le casting décrit la personne. */
  hasAvatar?: boolean;
  /** Aucun casting choisi : la scène écrite décrit la personne. */
  castingFree?: boolean;
};

/**
 * Assemble le prompt final d'une scène : verrous d'abord, scène ensuite.
 *
 * L'ordre est le poids : identité, produit (ou sujet), manipulation, règles de
 * tournage, puis le format et la niche qui recadrent le lieu, puis le style
 * relevé, et enfin la scène. Un sujet sans objet physique remplace le verrou
 * produit par le verrou sujet — sinon le modèle invente un flacon.
 */
export function composeScenePrompt(
  scene: string,
  product: ProductInput,
  casting: Casting,
  kind: ProductKind,
  describeCasting = true,
  context: SceneContext = {}
) {
  const physical = isPhysical(kind);
  const hasAvatar = context.hasAvatar ?? true;
  return [
    characterLock(casting, describeCasting, hasAvatar, Boolean(context.castingFree)),
    physical
      ? hasAvatar
        ? PRODUCT_LOCK
        : PRODUCT_LOCK_NO_AVATAR
      : fillTemplate(context.format === "free" ? TOPIC_LOCK_FREE : TOPIC_LOCK, product, casting),
    handlingFor(kind),
    PREAMBLE,
    formatBlock(context.format),
    nicheBlock(context.niche),
    context.styleBlock ? `REFERENCE STYLE — ${context.styleBlock}` : "",
    fillTemplate(scene, product, casting),
  ]
    .filter(Boolean)
    .join("\n\n");
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
  {
    id: "interview",
    name: "Interview",
    pitch: "Réponses posées à un intervieweur hors champ. Crédible, documentaire.",
    scenes: [
      {
        label: "Question 1",
        duration: 7,
        prompt:
          "SCENE: The protagonist listens for a beat to an unseen interviewer, nods, then answers. " +
          "{{product_name}} is visible beside them or in their hands.\n\n" +
          'DIALOGUE (exact, no improv): "Honestly? I was sceptical. I had tried everything for {{keypoint1}} and nothing stuck."',
      },
      {
        label: "Question 2",
        duration: 9,
        prompt:
          "SCENE: Same seat, same framing. The protagonist picks up or gestures to {{product_name}} " +
          "while explaining, calm and precise.\n\n" +
          'DIALOGUE (exact, no improv): "What changed is simple. {{product_description}} And {{keypoint2}}, which I did not expect at all."',
      },
      {
        label: "Question 3",
        duration: 7,
        prompt:
          "SCENE: The protagonist looks briefly at the lens, then back to the interviewer, with a small smile.\n\n" +
          'DIALOGUE (exact, no improv): "Would I recommend it? I already did, to my sister. It is {{product_price}} at {{brand}}, so yes."',
      },
    ],
  },
  {
    id: "podcast-clip",
    name: "Extrait podcast",
    pitch: "Un avis tranché sorti d'une longue conversation. Autorité et confidence.",
    scenes: [
      {
        label: "Hook",
        duration: 7,
        prompt:
          "SCENE: The protagonist leans towards the studio microphone, mid-conversation, one hand raised " +
          "to make a point. {{product_name}} sits on the table in front of them.\n\n" +
          'DIALOGUE (exact, no improv): "Can I say something nobody says out loud? Most people are getting {{keypoint1}} completely wrong."',
      },
      {
        label: "Argument",
        duration: 9,
        prompt:
          "SCENE: Same podcast setup. The protagonist picks up {{product_name}}, shows it to the unseen host, " +
          "and turns it so the camera sees it.\n\n" +
          'DIALOGUE (exact, no improv): "This is what I switched to. {{product_description}} The difference is {{keypoint2}}."',
      },
      {
        label: "Punchline",
        duration: 6,
        prompt:
          "SCENE: The protagonist sits back, relaxed, glances at the lens with a grin.\n\n" +
          'DIALOGUE (exact, no improv): "And it is {{product_price}}. That is the part that annoys me — I waited this long."',
      },
    ],
  },
  {
    id: "storytime",
    name: "Storytime facecam",
    pitch: "Une histoire personnelle, du problème à la solution. Format confidence.",
    scenes: [
      {
        label: "Il était une fois",
        duration: 7,
        prompt:
          "SCENE: Facecam, the protagonist close to the lens, low voice, a little conspiratorial. " +
          "{{product_name}} is not in frame yet.\n\n" +
          'DIALOGUE (exact, no improv): "Okay, storytime, because this actually changed my week. So last month I was dealing with {{keypoint1}}."',
      },
      {
        label: "Le tournant",
        duration: 8,
        prompt:
          "SCENE: Same facecam framing. The protagonist reaches out of frame and brings {{product_name}} " +
          "into view, holding it up next to their face.\n\n" +
          'DIALOGUE (exact, no improv): "And a friend just goes, try this. {{product_description}} I rolled my eyes, and then I tried it."',
      },
      {
        label: "Aujourd'hui",
        duration: 8,
        prompt:
          "SCENE: The protagonist smiles, shakes their head slightly, {{product_name}} still visible.\n\n" +
          'DIALOGUE (exact, no improv): "{{keypoint2}}. I am not even exaggerating. {{brand}}, {{product_price}}, link is there if you need it."',
      },
    ],
  },
  {
    id: "testimonial",
    name: "Témoignage résultat",
    pitch: "Avant / après raconté à la première personne, sans promesse impossible.",
    scenes: [
      {
        label: "Avant",
        duration: 6,
        prompt:
          "SCENE: The protagonist talks to the camera, sincere, slight frown remembering.\n\n" +
          'DIALOGUE (exact, no improv): "Before this, {{keypoint1}} was just something I lived with. I had kind of given up."',
      },
      {
        label: "Après",
        duration: 9,
        prompt:
          "SCENE: The protagonist holds {{product_name}} up, calm and clear, product fully visible.\n\n" +
          'DIALOGUE (exact, no improv): "Three weeks with this. {{product_description}} And now {{keypoint2}}. That is the whole story."',
      },
      {
        label: "Conseil",
        duration: 6,
        prompt:
          "SCENE: The protagonist looks straight at the lens, warm, {{product_name}} at chest height.\n\n" +
          'DIALOGUE (exact, no improv): "If you are where I was, just try it. {{product_price}} at {{brand}}. You will see."',
      },
    ],
  },
  {
    id: "myth",
    name: "Mythe vs réalité",
    pitch: "Casse une idée reçue, puis pose le produit comme la vraie réponse.",
    scenes: [
      {
        label: "Le mythe",
        duration: 6,
        prompt:
          "SCENE: The protagonist faces the camera, one finger raised, playful but firm.\n\n" +
          'DIALOGUE (exact, no improv): "Myth: you need to spend a fortune to fix {{keypoint1}}. I believed that for years."',
      },
      {
        label: "La réalité",
        duration: 9,
        prompt:
          "SCENE: The protagonist brings {{product_name}} into frame and shows it clearly, then uses it briefly.\n\n" +
          'DIALOGUE (exact, no improv): "Reality: {{product_description}} It does {{keypoint2}}, and it costs {{product_price}}."',
      },
      {
        label: "CTA",
        duration: 5,
        prompt:
          "SCENE: The protagonist shrugs with a smile, {{product_name}} still visible.\n\n" +
          'DIALOGUE (exact, no improv): "So stop overpaying. {{brand}}, link below."',
      },
    ],
  },
  {
    id: "tutorial",
    name: "Tutoriel en 3 étapes",
    pitch: "Montre comment on s'en sert. Idéal pour un produit qui demande un geste.",
    scenes: [
      {
        label: "Intro",
        duration: 5,
        prompt:
          "SCENE: The protagonist holds {{product_name}} up to the camera, bright and direct.\n\n" +
          'DIALOGUE (exact, no improv): "Here is exactly how I use this, in three steps. Takes a minute."',
      },
      {
        label: "Étape 1 et 2",
        duration: 10,
        prompt:
          "SCENE: Closer framing on the hands and {{product_name}}, the protagonist performing the first " +
          "two real steps of using it, narrating as they go.\n\n" +
          'DIALOGUE (exact, no improv): "Step one, {{keypoint1}}. Step two, {{keypoint2}}. That is it, no tricks."',
      },
      {
        label: "Résultat + CTA",
        duration: 7,
        prompt:
          "SCENE: Back to a medium shot, the protagonist shows the result and looks at the lens.\n\n" +
          'DIALOGUE (exact, no improv): "Step three, enjoy it. {{brand}} has it for {{product_price}}. Link is right there."',
      },
    ],
  },
  {
    id: "faq",
    name: "Questions qu'on me pose",
    pitch: "Répond aux objections les plus fréquentes, une par une.",
    scenes: [
      {
        label: "Question 1",
        duration: 7,
        prompt:
          "SCENE: The protagonist reads an imaginary comment off their phone, then looks up at the lens, " +
          "{{product_name}} beside them.\n\n" +
          'DIALOGUE (exact, no improv): "You keep asking, does it really {{keypoint1}}? Yes. I have used it daily for a month."',
      },
      {
        label: "Question 2",
        duration: 8,
        prompt:
          "SCENE: Same setup. The protagonist picks up {{product_name}} and shows the relevant detail.\n\n" +
          'DIALOGUE (exact, no improv): "Second question, is it worth {{product_price}}? {{product_description}} So, for me, yes."',
      },
      {
        label: "Question 3 + CTA",
        duration: 6,
        prompt:
          "SCENE: The protagonist smiles, holds {{product_name}} at chest height.\n\n" +
          'DIALOGUE (exact, no improv): "And where? {{brand}}. Link in bio. Next question."',
      },
    ],
  },
  {
    id: "comparison",
    name: "Comparatif",
    pitch: "Ce que j'utilisais avant contre ça. Le contraste fait la vente.",
    scenes: [
      {
        label: "Avant",
        duration: 6,
        prompt:
          "SCENE: The protagonist holds up an unbranded, generic old version of a similar item in one " +
          "hand, unimpressed. The generic item has NO readable logo or text.\n\n" +
          'DIALOGUE (exact, no improv): "This is what I used for two years. It was fine. Fine is the problem."',
      },
      {
        label: "Maintenant",
        duration: 9,
        prompt:
          "SCENE: The protagonist puts the generic item down out of frame and holds up {{product_name}}, " +
          "turning it so it is fully visible.\n\n" +
          'DIALOGUE (exact, no improv): "Then I switched to this. {{product_description}} The difference is {{keypoint1}}."',
      },
      {
        label: "Verdict",
        duration: 6,
        prompt:
          "SCENE: The protagonist looks straight at the lens, {{product_name}} at chest height.\n\n" +
          'DIALOGUE (exact, no improv): "Not going back. {{product_price}} at {{brand}}, link below."',
      },
    ],
  },
  {
    id: "book-review",
    name: "Avis lecture",
    pitch: "Pour un livre : de quoi ça parle, le passage qui a marqué, pour qui c'est.",
    scenes: [
      {
        label: "Le pitch",
        duration: 7,
        prompt:
          "SCENE: The protagonist holds {{product_name}} with the cover facing the camera, in a cosy " +
          "reading spot.\n\n" +
          'DIALOGUE (exact, no improv): "I finished this in two days, so let me tell you what it is about. {{product_description}}"',
      },
      {
        label: "Le passage",
        duration: 9,
        prompt:
          "SCENE: The protagonist opens the book, flips to a page, and looks up at the lens while " +
          "keeping the cover visible.\n\n" +
          'DIALOGUE (exact, no improv): "There is a part about {{keypoint1}} that I had to read twice. {{keypoint2}}. It stuck with me."',
      },
      {
        label: "Pour qui",
        duration: 6,
        prompt:
          "SCENE: The protagonist closes the book and holds it at chest height, cover out.\n\n" +
          'DIALOGUE (exact, no improv): "If you are into that, get it. {{product_price}}, {{brand}}. Link is there."',
      },
    ],
  },
];
