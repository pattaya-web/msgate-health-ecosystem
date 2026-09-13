export type Gender = "femme" | "homme";
export type AgeBand = "18-25" | "25-35" | "35-50" | "50-65";

export type Casting = { gender: Gender; age: AgeBand };

export const GENDERS: Array<{ id: Gender; label: string }> = [
  { id: "femme", label: "Femme" },
  { id: "homme", label: "Homme" },
];

export const AGE_BANDS: Array<{ id: AgeBand; label: string; english: string }> = [
  { id: "18-25", label: "18–25 ans", english: "in their early twenties" },
  { id: "25-35", label: "25–35 ans", english: "around thirty" },
  { id: "35-50", label: "35–50 ans", english: "in their forties" },
  { id: "50-65", label: "50–65 ans", english: "in their late fifties" },
];

export const DEFAULT_CASTING: Casting = { gender: "femme", age: "25-35" };

function ageEnglish(age: AgeBand) {
  return AGE_BANDS.find((band) => band.id === age)?.english ?? "around thirty";
}

function personEnglish(casting: Casting) {
  return `${casting.gender === "femme" ? "woman" : "man"} ${ageEnglish(casting.age)}`;
}

/**
 * Portrait de référence depuis une description libre : « plus rond, plus
 * vieux, plus moche, plus beau »… L'utilisateur choisit la personne, le
 * cadrage reste celui du portrait de référence pour que Seedance ait de quoi
 * reconstruire le visage sous d'autres angles.
 */
export function avatarPromptFromText(description: string) {
  return [
    "Photorealistic iPhone selfie-style portrait of a real person: ",
    description.trim().replace(/[.\s]+$/, ""),
    ". Framed from mid-thigh up, standing and facing the camera straight on, neutral relaxed ",
    "expression, arms down at their sides so the body shape is clear. Plain everyday indoor ",
    "background, soft natural window light. Real skin texture with pores and small imperfections, ",
    "no retouching, no beauty filter, not a model unless the description says so. No text, no ",
    "watermark, one person only.",
  ].join("");
}

export function pronoun(casting: Casting) {
  return casting.gender === "femme" ? "She" : "He";
}

/**
 * Prompt du portrait de référence. C'est la pièce maîtresse de la cohérence :
 * une seule image d'avatar est générée, puis envoyée en PREMIÈRE référence à
 * chaque clip. Sans elle, Seedance invente une personne différente par scène.
 * Le cadrage mi-corps de face donne au modèle vidéo assez de matière pour
 * reconstruire le visage sous d'autres angles.
 */
export function avatarPrompt(casting: Casting) {
  return [
    "Photorealistic iPhone selfie-style portrait of a real ",
    personEnglish(casting),
    ", framed from mid-thigh up, standing and facing the camera straight on, ",
    "neutral relaxed expression, arms down at their sides so the body shape is clear. ",
    "Plain everyday indoor background, soft natural window light. ",
    "Natural unretouched skin with visible pores, texture and small imperfections, ",
    "realistic hair with flyaways, ordinary casual clothing in plain neutral colours. ",
    "Looks like an ordinary person photographed on a phone, NOT a model, NOT a stock photo, ",
    "NOT studio-lit, NOT retouched, NOT AI-smooth. ",
    "Sharp focus on the face. No text, no watermark, no logo, no border, no collage.",
  ].join("");
}

/**
 * Verrou d'identité, répété dans chaque scène. La première image de référence
 * fait autorité sur la personne, les suivantes sur le produit — l'ordre compte,
 * et le prompt doit l'énoncer sinon le modèle mélange les deux.
 */
export function characterLock(casting: Casting, describe = true, hasReference = true, fromScene = false) {
  /*
   * Sans avatar, il n'y a pas de « première image » : pointer une référence
   * absente laissait le modèle libre de prendre n'importe qui, ou de prendre
   * la photo produit pour la personne. On décrit alors le casting, et on
   * demande la constance d'un clip à l'autre par la description.
   */
  if (!hasReference && fromScene) {
    return [
      "PROTAGONIST — exactly as described in the SCENE below (gender, age, look, outfit); if the scene ",
      "says nothing about the person, pick a believable everyday adult and keep it. A real human being ",
      "with natural skin texture, not a model, not an illustration. Keep the SAME person in every clip ",
      "of this set: same face, same hair, same age, same body type, same outfit. Only one person is in ",
      "frame — no second character, no reflection of another person.",
    ].join("");
  }
  if (!hasReference) {
    return [
      "PROTAGONIST — by default a ",
      personEnglish(casting),
      ". If the SCENE below describes the person (gender, age, look, outfit), the SCENE wins over this ",
      "default. A real human being with natural skin texture, not a model, not an illustration. ",
      "Keep the SAME person in every clip of this set: same face, same hair colour, length and style, ",
      "same age, same body type, same outfit. Do NOT restyle, re-dress or replace ",
      casting.gender === "femme" ? "her" : "him",
      " between scenes. Only one person is in frame — no second character, no reflection of another person.",
    ].join("");
  }
  // Un avatar chargé fait foi sur le genre et l'âge : le décrire en plus ne peut
  // que contredire la photo, alors on se contente de pointer la référence.
  const who = describe ? personEnglish(casting) : "person";
  const they = describe ? (casting.gender === "femme" ? "her" : "him") : "them";
  return [
    "ABSOLUTE CHARACTER CONSISTENCY — the protagonist is EXACTLY the ",
    who,
    " shown in the FIRST reference image. Identical face, identical facial structure, identical eyes, ",
    "identical skin tone, identical hair colour, length and style, identical age, identical body type, ",
    "identical clothing. It must be recognisably the same human being in every clip of this set. ",
    "Do NOT age, restyle, slim, beautify, re-dress or replace ",
    they,
    ". Do NOT change the hairstyle or the outfit between scenes. ",
    "Only one person is in frame — no second character, no reflection of another person.",
  ].join("");
}

/**
 * Voix ElevenLabs par profil de casting.
 *
 * Le remake rejoue le script de la source, mais la voix doit appartenir à
 * l'avatar qu'on voit à l'image : une accroche portée par une voix qui ne
 * colle ni au genre ni à l'âge du visage se remarque immédiatement et casse
 * tout le bénéfice du remake.
 *
 * Identifiants repris du catalogue de l'onglet Voix Off — voir `voices.ts`.
 */
const VOICE_BY_PROFILE: Record<string, string> = {
  "femme:18-25": "kPzsL2i3teMYv0FxEYQ6", // Brittney — fun, jeune
  "femme:25-35": "uYXf8XasLslADfZ2MB4u", // Hope — pétillante
  "femme:35-50": "hpp4J3VqNfWAUOO0d1Us", // Bella — chaleureuse, posée
  "femme:50-65": "aD6riP1btT197c6dACmy", // Rachel M — radio britannique
  "homme:18-25": "vBKc2FfBKJfcZNyEt1n6", // Finn — jeune
  "homme:25-35": "TX3LPaxmHKxFdv7VOQHJ", // Liam — UGC social
  "homme:35-50": "1SM7GgM6IMuvQlz2BwM3", // Mark — décontracté
  "homme:50-65": "nPczCjzI2devNBz1zQrb", // Brian — grave
};

/** Voix par défaut du casting, avec repli sur la voix UGC générique. */
export function voiceForCasting(casting: Casting) {
  return VOICE_BY_PROFILE[`${casting.gender}:${casting.age}`] || "TX3LPaxmHKxFdv7VOQHJ";
}
