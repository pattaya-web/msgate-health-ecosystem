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
export function characterLock(casting: Casting, describe = true) {
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
