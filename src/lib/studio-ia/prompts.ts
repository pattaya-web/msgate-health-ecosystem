import type { StyleId, TransformType } from "./types";

/**
 * Prompts du Swap vidéo.
 *
 * Le système combine PROMPT SYSTÈME (selon le type de transformation) +
 * STYLE + CONSIGNE UTILISATEUR. L'utilisateur ne voit que sa consigne.
 */

const PRESERVE = `Preserve the original video's exact:
- body movements
- gestures
- pose
- facial performance
- lip and mouth movements, frame-accurate to the speech (same openings, same articulation rhythm, mouth closed when not speaking)
- head movement
- camera movement
- framing
- timing
- background
- lighting
- objects and environment`;

const QUALITY = `The resulting person must remain visually consistent throughout the entire video.

Photorealistic human appearance.
Natural skin texture.
Natural anatomy.
Realistic hair physics.
Realistic hands.
Realistic facial motion.

Do not change the environment.
Do not change the camera.
Do not invent additional objects.
Do not modify objects held by the subject unless explicitly requested.
No identity drift.
No morphing.
No face flickering.
No extra fingers.
No warped hands.
No deformed face.
No duplicated body parts.`;

export const SYSTEM_PROMPTS: Record<TransformType, string> = {
  full: `Replace the main subject in the source video with the person shown in the reference image.

${PRESERVE}

Transfer the reference person's:
- facial identity
- facial structure
- eyes
- nose
- lips
- jawline
- hairstyle
- hair color
- apparent gender
- body appearance where possible
- clothing when visible and requested

${QUALITY}`,

  face: `Replace ONLY the face and head of the main subject in the source video with the face of the person shown in the reference image.

${PRESERVE}
- the subject's original clothing and body

Transfer the reference person's:
- facial identity
- facial structure
- eyes
- nose
- lips
- jawline
- hairstyle
- hair color
- skin tone

Keep the subject's clothing, body shape and everything below the neck exactly as in the source video.

${QUALITY}`,

  outfit: `Change ONLY the clothing of the main subject in the source video to match the outfit worn by the person in the reference image.

${PRESERVE}
- the subject's face, identity, hair and body

Transfer the reference outfit's:
- garments and layers
- colors and patterns
- fabric and fit
- accessories when visible

Do not change the subject's face, hair or identity.

${QUALITY}`,

  "face-outfit": `Replace the face, head and clothing of the main subject in the source video with those of the person shown in the reference image.

${PRESERVE}

Transfer the reference person's:
- facial identity and structure
- eyes, nose, lips, jawline
- hairstyle and hair color
- skin tone
- full outfit: garments, colors, patterns, accessories

Keep the subject's body movements and the scene untouched.

${QUALITY}`,

  character: `Replace the main subject in the source video with the character shown in the reference image, as a complete person: face, hair, apparent gender, body type, skin, clothing and accessories.

${PRESERVE}

The new character must:
- fully match the reference image's identity and look
- perform exactly the same movements, gestures and facial performance as the source subject
- occupy the same position and scale in the frame

${QUALITY}`,
};

/** Styles : une ligne qui oriente le rendu, ajoutée après le prompt système. */
export const STYLE_PROMPTS: Record<StyleId, { label: string; prompt: string }> = {
  natural: {
    label: "Transformation naturelle",
    prompt:
      "Style: natural and subtle. Stay as close as possible to the source video's look, lighting and color grading. The change should feel like a different real person filmed in the exact same conditions.",
  },
  strong: {
    label: "Transformation forte",
    prompt:
      "Style: strong transformation. Prioritize a complete and unmistakable change of identity and appearance matching the reference image, while still preserving motion, camera and environment.",
  },
  ugc: {
    label: "UGC réaliste",
    prompt:
      "Style: authentic UGC smartphone footage. Front camera look, natural imperfect lighting, real skin with pores and slight shine, slight sensor noise, no beauty filter, no cinematic grading. Must look like a genuine self-recorded phone video.",
  },
  cinematic: {
    label: "Cinématique",
    prompt:
      "Style: cinematic. Clean skin detail, soft filmic color grading, gentle contrast, pleasant highlight roll-off, while keeping the original camera movement and framing.",
  },
};

export const TRANSFORM_LABELS: Record<TransformType, string> = {
  full: "Apparence complète",
  face: "Visage uniquement",
  outfit: "Tenue uniquement",
  "face-outfit": "Apparence + tenue",
  character: "Personnage complet",
};

export const DEFAULT_NEGATIVE_PROMPT =
  "identity drift, face flicker, deformed face, distorted eyes, bad anatomy, extra fingers, warped hands, duplicated limbs, changing clothes, changing background, camera changes, unrealistic skin, plastic skin, morphing";

/** Nom du sujet « produit » côté Kling : référencé par @produit dans le prompt. */
export const PRODUCT_ELEMENT = "produit";

/** Consigne de protection du produit, quand ses photos sont fournies. */
export function productPrompt(description: string): string {
  const what = description.trim() || "the product held in the hand";
  return (
    `The object held by the subject is @${PRODUCT_ELEMENT} (${what}). It must remain strictly identical to its reference images: ` +
    `same shape, same colors, same label, same text, same details, same size, same position in the hand. ` +
    `Do not smooth it, simplify it, recolor it or replace it. Keep the fingers holding it exactly as in the source video.`
  );
}

/** Prompt complet envoyé au provider. */
export function buildPrompt(transform: TransformType, style: StyleId, userPrompt: string, product?: { description: string } | null): string {
  const parts = [SYSTEM_PROMPTS[transform] ?? SYSTEM_PROMPTS.full, STYLE_PROMPTS[style]?.prompt ?? ""];
  if (product) parts.push(productPrompt(product.description));
  const user = userPrompt.trim();
  if (user) parts.push(`Additional instructions from the user (they take priority when specific):\n${user}`);
  return parts.filter(Boolean).join("\n\n");
}
