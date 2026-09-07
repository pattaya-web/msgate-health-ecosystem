/**
 * Mode outfit : des clips muets façon TikTok, où la protagoniste porte la tenue
 * et la montre sans parler.
 *
 * C'est l'inverse du mode UGC classique, dont le préambule impose une parole
 * continue et lip-syncée. Ici toute parole est un défaut : le modèle doit
 * produire une bouche fermée et une ambiance sonore, rien d'autre. D'où un
 * préambule séparé plutôt qu'un drapeau dans l'existant.
 *
 * Le rythme vient du montage, pas de la caméra : chaque scène est un plan court
 * et fixe dans son intention, et c'est `stitchAngle` qui les enchaîne en une
 * vidéo nerveuse. Demander des cuts À L'INTÉRIEUR d'un clip ferait halluciner
 * une personne différente à chaque coupe.
 */

import { characterLock, type Casting } from "@/lib/ugc/casting";
import { handlingFor } from "@/lib/ugc/kinds";
import { fillTemplate, PRODUCT_LOCK } from "@/lib/ugc/angles";
import type { Angle, ProductInput } from "@/lib/ugc/types";

export const OUTFIT_PREAMBLE = [
  "Photorealistic vertical outfit-showcase video shot on a modern iPhone, handheld with natural ",
  "micro-shake, realistic skin texture with visible pores and imperfections, true-to-life lighting, ",
  "believable everyday location, slight compositional imperfection. ",
  "It must look like a real person filmed this on their phone for social media: NOT cinematic, ",
  "NOT studio-lit, NOT fashion editorial, NOT glossy advertising, NOT AI-smooth. ",

  // Le point qui fait tout le mode : silence.
  "SILENT CLIP — the protagonist does NOT speak. Her mouth stays closed and relaxed throughout. ",
  "No dialogue, no voice-over, no narration, no whispering, no lip movement, no mouthing of words, ",
  "no singing. Ambient room sound only. Any speech or lip-sync is a failure of this shot. ",

  "She holds eye contact with the camera lens for most of the clip, with a calm confident expression ",
  "and small natural micro-movements — a slight smile, a blink, a shift of weight. She is at ease, ",
  "not posing stiffly and not performing for an audience. ",

  "One continuous take, no cuts, no zooms, no transitions inside the clip. Steady framing. ",
  "Full body or three-quarter body in frame so the whole outfit reads clearly. ",
  "Vertical 9:16 composition with the subject centred and headroom above. ",
  "No on-screen text, no captions, no watermark, no logo overlay, no social media UI.",
].join("");

/** Le verrou tenue reprend le verrou produit : la tenue EST le produit. */
export const OUTFIT_LOCK = [
  "The outfit shown in the reference images is worn by the protagonist for the entire clip, ",
  "fitted correctly and fully visible. Every garment keeps its exact cut, colour, fabric, print, ",
  "seams and hardware. Do NOT restyle it, do NOT swap a piece, do NOT add accessories that are ",
  "not in the reference images, do NOT change the shoes between scenes.",
].join("");

export function composeOutfitPrompt(
  scene: string,
  product: ProductInput,
  casting: Casting,
  describeCasting = true
) {
  return [
    characterLock(casting, describeCasting),
    PRODUCT_LOCK,
    // La tenue est portée, jamais tenue à la main : c'est le régime « fashion ».
    handlingFor("fashion"),
    OUTFIT_LOCK,
    OUTFIT_PREAMBLE,
    fillTemplate(scene, product, casting),
  ].join("\n\n");
}

/**
 * Chaque angle est une vidéo complète une fois les scènes montées bout à bout.
 * Les plans sont courts — 4 à 6 secondes — parce que c'est le montage serré qui
 * donne le rythme TikTok, et parce que la seconde de Seedance coûte cher.
 */
export const OUTFIT_ANGLES: Angle[] = [
  {
    id: "outfit-mirror",
    name: "Miroir → sortie",
    pitch: "Le classique du feed : elle se vérifie au miroir, puis part en tenue.",
    scenes: [
      {
        label: "Miroir",
        duration: 5,
        prompt:
          "SCENE: The protagonist stands in front of a full-length mirror in an ordinary bedroom, " +
          "phone held in one hand at chest height so the mirror reflection is the shot. She wears " +
          "{{product_name}}. She looks straight into the lens through the mirror, then glances down " +
          "at the outfit and back up. Soft daylight from a window off to the side.",
      },
      {
        label: "Tour sur soi",
        duration: 5,
        prompt:
          "SCENE: Same room, same outfit. The protagonist turns a slow full circle on the spot so " +
          "the camera sees the front, the side and the back of {{product_name}}, then comes back to " +
          "facing the lens and holds eye contact. Camera stays still at chest height.",
      },
      {
        label: "Détail",
        duration: 4,
        prompt:
          "SCENE: Closer framing from the waist up, same outfit and same room. The protagonist runs " +
          "her hand along the fabric of {{product_name}} and gives it a small tug so the material " +
          "moves, eyes flicking up to the lens. The texture and the stitching are clearly visible.",
      },
      {
        label: "Départ",
        duration: 5,
        prompt:
          "SCENE: The protagonist walks toward the camera down a hallway or through a doorway, " +
          "still wearing {{product_name}}, the garment moving naturally as she walks. She stops " +
          "close to the lens, looks straight at it, and gives a small confident nod.",
      },
    ],
  },
  {
    id: "outfit-street",
    name: "Extérieur / street",
    pitch: "Lumière naturelle, décor urbain, la tenue en mouvement dehors.",
    scenes: [
      {
        label: "Arrivée",
        duration: 5,
        prompt:
          "SCENE: The protagonist walks toward the camera on an ordinary city pavement in daylight, " +
          "wearing {{product_name}}. Real street behind her, no crowd. She looks into the lens as " +
          "she approaches and stops at three-quarter body framing.",
      },
      {
        label: "Pose",
        duration: 4,
        prompt:
          "SCENE: Same street, same outfit. The protagonist stands still facing the camera, weight " +
          "on one hip, hands relaxed, holding eye contact with a calm half-smile. The full length of " +
          "{{product_name}} is visible from shoes to shoulders.",
      },
      {
        label: "Mouvement",
        duration: 5,
        prompt:
          "SCENE: Same street, same outfit. The protagonist turns away from the camera and back " +
          "again in one motion so {{product_name}} swings and settles, showing how the fabric moves. " +
          "She ends facing the lens.",
      },
      {
        label: "Détail chaussures",
        duration: 4,
        prompt:
          "SCENE: Lower framing on the same street, from the knees down, showing the hem of " +
          "{{product_name}} and the shoes. The protagonist takes two steps toward the camera, then " +
          "the framing rises back to her face and she looks into the lens.",
      },
    ],
  },
  {
    id: "outfit-fit-check",
    name: "Fit check studio",
    pitch: "Fond neutre, plans serrés, la tenue seule — le plus propre pour du paid.",
    scenes: [
      {
        label: "Face",
        duration: 4,
        prompt:
          "SCENE: The protagonist stands facing the camera against a plain neutral wall in a bright " +
          "room, wearing {{product_name}}, arms relaxed at her sides, full body in frame. She holds " +
          "eye contact with the lens, still and confident.",
      },
      {
        label: "Profil",
        duration: 4,
        prompt:
          "SCENE: Same wall, same outfit. The protagonist turns to her side profile so the silhouette " +
          "of {{product_name}} reads clearly, then turns her head back to look into the lens.",
      },
      {
        label: "Dos",
        duration: 4,
        prompt:
          "SCENE: Same wall, same outfit. The protagonist stands with her back to the camera so the " +
          "back of {{product_name}} is fully visible, then looks over her shoulder into the lens.",
      },
      {
        label: "Haut du corps",
        duration: 4,
        prompt:
          "SCENE: Same wall, same outfit, framed from the hips up. The protagonist adjusts the collar " +
          "or shoulder of {{product_name}} with one hand, then drops her hands and looks straight " +
          "into the lens.",
      },
    ],
  },
];

export function outfitAngle(id: string) {
  return OUTFIT_ANGLES.find((angle) => angle.id === id) || null;
}
