/**
 * Le modèle d'un montage : des clips coupés mis bout à bout, des textes et des
 * emojis posés dessus avec leur fenêtre de temps, et une musique de fond.
 *
 * Les positions sont en % du cadre (centre de l'élément) et les tailles en
 * pixels pour une largeur de 1080 : l'aperçu et l'export les mettent à leur
 * propre échelle, le rendu est donc le même partout.
 */

export type MontageClip = {
  id: string;
  name: string;
  /** Adresse lue par l'aperçu (locale pendant l'envoi, puis celle du serveur). */
  src: string;
  file?: File;
  /** Adresse du fichier sur le serveur (/api/media/…), connue une fois l'envoi fini. */
  url?: string;
  uploading?: boolean;
  /** Durée du fichier source, en secondes. */
  duration: number;
  /** Début et fin gardés dans le fichier source. */
  in: number;
  out: number;
  width: number;
  height: number;
};

export type TextStyle = "tiktok" | "box" | "plain";

export type MontageText = {
  id: string;
  kind: "text";
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  style: TextStyle;
  color: string;
};

export type MontageEmoji = {
  id: string;
  kind: "emoji";
  /** Code Unicode « 1f525 » ou « 1f1fa-1f1f8 » (nom du PNG Apple). */
  unified: string;
  glyph: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
};

export type MontageOverlay = MontageText | MontageEmoji;

export type MontageMusic = {
  name: string;
  src: string;
  file?: File;
  url?: string;
  uploading?: boolean;
  duration: number;
  /** Où la musique démarre dans le morceau (on saute l'intro). */
  offset: number;
  volume: number;
};

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function clipLength(clip: MontageClip) {
  return Math.max(0, clip.out - clip.in);
}

export function totalLength(clips: MontageClip[]) {
  return clips.reduce((sum, clip) => sum + clipLength(clip), 0);
}

/** Le clip joué au temps t du montage, et le temps correspondant dans son fichier. */
export function clipAt(clips: MontageClip[], t: number): { index: number; local: number; startsAt: number } | null {
  let at = 0;
  for (const [index, clip] of clips.entries()) {
    const len = clipLength(clip);
    if (t < at + len || index === clips.length - 1) return { index, local: clip.in + Math.min(len, Math.max(0, t - at)), startsAt: at };
    at += len;
  }
  return null;
}

/** Coupe un clip en deux au temps t du montage. */
export function splitAt(clips: MontageClip[], t: number): MontageClip[] {
  const hit = clipAt(clips, t);
  if (!hit) return clips;
  const clip = clips[hit.index];
  if (hit.local - clip.in < 0.1 || clip.out - hit.local < 0.1) return clips;
  const left = { ...clip, out: hit.local };
  const right = { ...clip, id: newId("clip"), in: hit.local };
  return [...clips.slice(0, hit.index), left, right, ...clips.slice(hit.index + 1)];
}

/** Emoji → nom du PNG Apple (« 🇺🇸 » → « 1f1fa-1f1f8 », « ❤️ » → « 2764-fe0f »). */
export function emojiUnified(glyph: string) {
  return [...glyph].map((char) => char.codePointAt(0)!.toString(16)).join("-");
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Découpe un texte en morceaux texte / emoji, pour dessiner les emojis en version iPhone. */
export function textParts(text: string): Array<{ emoji: boolean; value: string }> {
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("fr", { granularity: "grapheme" }) : null;
  const graphemes = segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : [...text];
  const parts: Array<{ emoji: boolean; value: string }> = [];
  for (const grapheme of graphemes) {
    const emoji = EMOJI.test(grapheme);
    const last = parts[parts.length - 1];
    if (!emoji && last && !last.emoji) last.value += grapheme;
    else parts.push({ emoji, value: grapheme });
  }
  return parts;
}

/**
 * Le PNG Apple d'un emoji. Le paquet npm n'a que du 64 px (flou en 1080) : le
 * 160 px vient du dépôt d'origine (iamcal/emoji-data), même version, servi par
 * jsDelivr avec l'accès CORS dont le canvas a besoin.
 */
export function appleEmoji(unified: string, size: 64 | 160 = 160) {
  return size === 160
    ? `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@v15.1.2/img-apple-160/${unified}.png`
    : `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/${unified}.png`;
}

/** Variante sans le sélecteur FE0F, que certains PNG Apple n'ont pas dans leur nom. */
export function appleEmojiFallback(unified: string, size: 64 | 160 = 160) {
  return appleEmoji(unified.split("-").filter((part) => part !== "fe0f").join("-"), size);
}
