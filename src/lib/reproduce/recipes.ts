import type { VideoStyleId } from "@/lib/studio/video-types";

/**
 * Recettes : une créa de référence, relevée à la main d'après ses images, et
 * figée en mécanique rejouable. Chaque recette dit comment la vidéo est
 * construite (blocs, plans, style, sous-titres) et porte le script d'origine
 * beat par beat : c'est lui que Claude réécrit pour le produit du jour.
 *
 * Ce fichier ne dépend de rien côté serveur : l'interface l'importe tel quel.
 */

export type CaptionStyle = "bold" | "small" | "karaoke" | "none";

/** Un plan écrit pour le produit, prêt à partir chez Seedance. */
export type RecipeShot = {
  block: string;
  label: string;
  seconds: number;
  action: string;
  /** Dialogue dit à l'écran, ou phrase de voix off pour un plan muet. */
  line: string;
  silent: boolean;
};

export type RecipeBlock = {
  id: string;
  /** Ce que fait ce bloc dans la vidéo, pour l'écran. */
  label: string;
  /** `speaking` : le personnage parle à la caméra. `broll` : plans muets sous voix off. */
  kind: "speaking" | "broll";
  style: VideoStyleId;
  /** Nombre de plans et durée de chacun, en secondes. */
  shots: number;
  seconds: number;
  captions: CaptionStyle;
  /** Mise en scène imposée à tous les plans du bloc. */
  setup: string;
  /** Script d'origine, un beat par ligne. Claude garde la structure, change le produit. */
  script: string[];
};

export type Recipe = {
  id: string;
  kind: "video" | "static";
  name: string;
  pitch: string;
  /** Fichier d'affiche dans data/references/. */
  poster: string;
  posterAspect: "9:16" | "1:1" | "4:5";
  duration?: number;
  blocks: RecipeBlock[];
  /** Description du personnage / de l'image clé, style compris. */
  keyframe?: string;
  /** Carton final texte, généré en image et collé à la fin. */
  endCard?: boolean;
  /** Pour les statiques : identifiant du style dans la Bibliothèque. */
  styleId?: string;
  /**
   * Mots du script d'origine qui désignent le produit de la référence. Quand
   * l'IA d'écriture est indisponible, ils sont remplacés par le nom du produit
   * pour livrer un script utilisable tout de suite.
   */
  sourceTerms?: string[];
};

export const RECIPES: Recipe[] = [
  {
    id: "cartoon-dialogue",
    kind: "video",
    name: "Cartoon : le produit répond",
    pitch: "Une femme dessinée parle au produit, qui a des yeux et des bras. Une chambre, un plan, dialogue comique sous-titré.",
    poster: "ad-684941947962268/frames/shot-01.jpg",
    posterAspect: "9:16",
    duration: 32,
    keyframe:
      "3D-cartoon illustration in a warm modern animation style: a brunette woman in her thirties, dark long-sleeve top and blue jeans, kneeling on a wooden floor in a bright bedroom (unmade bed, bedside lamp, soft daylight). Facing her stands THE PRODUCT as a cartoon character: the real product from the reference images, exactly as it is, with two big cartoon eyes and thin black stick arms and legs, expressive. No text.",
    blocks: [
      {
        id: "dialogue",
        label: "Dialogue cartoon",
        kind: "speaking",
        style: "cartoon3d",
        shots: 5,
        seconds: 6,
        captions: "bold",
        setup:
          "Same single scene in every shot: the cartoon woman kneeling on the left, the product-character standing on the right, bright bedroom behind, static camera at eye level, medium wide. They take turns speaking; the one who speaks gestures, the other reacts. Comedic timing, warm and playful.",
        script: [
          "WOMAN: I have to apologize. I mean, let's be honest — I thought you were a gimmick.",
          "PRODUCT: Ouch. I'm not an accessory, Karen. I've been doing real work every single night.",
          "WOMAN: Okay, fine. Three weeks in and… things are different. You know what I mean.",
          "PRODUCT: I know exactly what you mean. Your husband knows too.",
          "WOMAN: Thank you. Really. — PRODUCT: You're welcome. Same time tonight?",
        ],
      },
    ],
  },
  {
    id: "ugc-testimonial",
    kind: "video",
    name: "UGC témoignage après la séance",
    pitch: "Une femme essoufflée après le sport, salon lumineux, produit au poignet levé vers la caméra. Un seul plan, sous-titres gras.",
    poster: "ad-762376256431931/frames/shot-01.jpg",
    posterAspect: "9:16",
    duration: 20,
    keyframe:
      "Photorealistic iPhone selfie of a fit red-haired woman in her forties, black sports bra, slightly sweaty after a workout, standing in a bright living room with a beige sofa, plants and a window behind. She raises her fist towards the camera to show THE PRODUCT worn on her wrist, exactly as in the reference images. Natural light, real skin texture, no text.",
    blocks: [
      {
        id: "testimonial",
        label: "Témoignage facecam",
        kind: "speaking",
        style: "ugc",
        shots: 3,
        seconds: 7,
        captions: "bold",
        setup:
          "Handheld selfie framing, chest up, the creator slightly out of breath and glowing after a workout, living room behind. The product stays visible on her raised wrist for most of the clip. She talks fast, excited, like she just has to tell someone.",
        script: [
          "I can barely talk right now, I just finished my workout, but I have to tell you about this.",
          "Two weeks with this on my wrist and I have not felt this much energy in years — I'm not exaggerating.",
          "If you're dragging through your days like I was, just get it. Link is right there.",
        ],
      },
    ],
  },
  {
    id: "ugc-gym-knockoff",
    kind: "video",
    sourceTerms: ["cheap version of this", "the real one"],
    name: "UGC salle de sport : faux contre vrai",
    pitch: "Homme grisonnant assis sur un banc, un plan long, insert du faux produit au début, petits sous-titres, offre en fin.",
    poster: "ad-851576821070762/frames/shot-01.jpg",
    posterAspect: "9:16",
    duration: 30,
    keyframe:
      "Photorealistic phone video still: a fit grey-haired man in his fifties with a short beard, black t-shirt and shorts, sitting on a bench in a bright modern gym with machines and large windows behind. He holds his forearm up to show THE PRODUCT worn on his wrist, exactly as in the reference images. Natural daylight, real skin, no text.",
    blocks: [
      {
        id: "talk",
        label: "Facecam salle de sport",
        kind: "speaking",
        style: "ugc",
        shots: 5,
        seconds: 6,
        captions: "small",
        setup:
          "Same gym bench, same framing in every shot: phone propped at eye level, medium shot, the man seated, calm and confident, occasionally lifting his wrist to show the product. Gym ambience.",
        script: [
          "So I bought a cheap version of this first. It snapped on day one. Total waste.",
          "Then I got the real one. Total difference — heavy, cold, solid. You feel it the second you put it on.",
          "A few days in, my energy is back. My wife noticed before I did.",
          "Don't buy the cheap knock-offs. Get the real thing.",
          "They have buy one get one free right now. Your wife will thank you, trust me.",
        ],
      },
    ],
  },
  {
    id: "hook-vsl",
    kind: "video",
    sourceTerms: ["the damn bracelet", "that bracelet", "bracelet", "Authentic stone", "The same stone", "the stone"],
    name: "Hook UGC + montage VSL",
    pitch: "18 s de facecam qui choque, puis 40 s de b-roll IA sous voix off avec sous-titres karaoké et carton final.",
    poster: "ad-873569008678177/frames/shot-01.jpg",
    posterAspect: "9:16",
    duration: 60,
    endCard: true,
    keyframe:
      "Photorealistic phone video still: a brunette woman in her forties in a white silk slip, standing in a warm wooden hallway at night, holding a piece of red lingerie in one hand, smiling knowingly at the camera. Warm lamp light, real skin texture, no text.",
    blocks: [
      {
        id: "hook",
        label: "Hook facecam",
        kind: "speaking",
        style: "ugc",
        shots: 2,
        seconds: 9,
        captions: "bold",
        setup:
          "Handheld selfie framing in the hallway, medium shot, the woman talking straight to the lens, half embarrassed half proud, holding the red lingerie. Same outfit and place in both shots.",
        script: [
          "I can't believe I'm sharing this, but that bracelet my husband bought… we did five rounds last night.",
          "Ladies, if your man has issues — just get him the damn bracelet.",
        ],
      },
      {
        id: "broll",
        label: "B-roll voix off",
        kind: "broll",
        style: "cinematic",
        shots: 7,
        seconds: 6,
        captions: "karaoke",
        setup:
          "Silent cinematic b-roll, dark and dramatic, one idea per shot: extreme macro of the product; raw black stones on a table; a man stretching in bed at sunrise; a roman warrior holding the stone; the stone crackling with golden energy; a shirtless man with energy glowing on his wrist; hands forging the product over embers; a website mockup with a big SHOP NOW button. No speech, no text.",
        script: [
          "But when my husband told me how it works, it made perfect sense.",
          "The same stone roman warriors wore into battle produces a natural electromagnetic field.",
          "A raw surge of energy, straight through the wrist, all day and all night.",
          "And it works — or your money back. No questions asked.",
          "Right now there's a buy one get one free deal, and it's disappearing quickly.",
          "Authentic stone takes weeks to source and forge. Act now before it's gone.",
          "Secure yours today. Link below.",
        ],
      },
    ],
  },
  {
    id: "static-before-after-app",
    kind: "static",
    name: "Statique avant / après (app)",
    pitch: "Le même visage en deux panneaux, promesse en 1, 2, 4 semaines, mention gratuite. Pour une app ou un programme.",
    poster: "606837069_1585605106020656_2559893013482453444_n.jpg",
    posterAspect: "4:5",
    blocks: [],
    styleId: "builtin-before-after-app",
  },
  {
    id: "static-before-after-clean",
    kind: "static",
    name: "Statique avant / après épurée",
    pitch: "Titre fin sur fond blanc, deux portraits « You now / Your potential », flèche au centre. Pour un site ou un service.",
    poster: "Capture d'écran 2026-09-10 190019.png",
    posterAspect: "9:16",
    blocks: [],
    styleId: "builtin-before-after-clean",
  },
];

export function recipeFor(id: string | undefined) {
  return RECIPES.find((recipe) => recipe.id === id) ?? null;
}

/** Durée totale d'une recette, calculée depuis ses blocs. */
export function recipeSeconds(recipe: Recipe) {
  return recipe.blocks.reduce((total, block) => total + block.shots * block.seconds, 0);
}
