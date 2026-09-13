/**
 * Bibliothèque de créas de référence.
 *
 * Deux rayons. Les STYLES : une créa qu'on aime — statique ou vidéo — relevée
 * une fois pour toutes (mise en page, annotations, grille de plans, cadrages,
 * script) et rangée avec son affiche, pour la rejouer sur n'importe quel
 * produit d'un clic. Les SCRIPTS : les textes d'ads qui marchent, gardés tels
 * quels, et réadaptés produit par produit sans réécrire la structure.
 *
 * C'est le mode industriel : produit → type → style → script → lancer.
 */

export type StyleKind = "static" | "video";

export type PosterLayout =
  | "callouts"
  | "list"
  | "statement"
  | "tape"
  | "letter"
  | "cartoon"
  | "bed"
  | "columns"
  | "wall"
  | "body";

/** Un élément graphique relevé sur une statique : flèche, badge, post-it… */
export type StaticElement = {
  kind: string;
  style: string;
  position: string;
  /** Texte d'origine, gardé pour montrer le calibre à respecter. */
  sourceText: string;
  role: string;
  /** Texte réécrit pour le produit courant — vide dans la bibliothèque. */
  adaptedText: string;
};

export type StaticSpec = {
  layout: string;
  elements: StaticElement[];
  fontStyle?: string;
  /** Ratio mesuré sur la référence : 9:16, 1:1, 4:5… */
  aspect: string;
};

export type VideoShotSpec = {
  index: number;
  duration: number;
  /** Cadrage relevé sur l'image clé : échelle, angle, mouvement, lumière. */
  framing: string;
  /** Ce qui est dit pendant ce plan, découpé depuis la transcription. */
  line: string;
};

export type VideoSpec = {
  duration: number;
  shots: VideoShotSpec[];
  /** Transcription intégrale de la voix. */
  transcript: string;
  /** Un paragraphe sur le ton, le rythme et le dispositif — sert de bloc de style. */
  styleBlock: string;
};

export type StyleTemplate = {
  id: string;
  kind: StyleKind;
  name: string;
  /** Une ligne pour choisir vite dans la grille. */
  pitch: string;
  tags: string[];
  createdAt: string;
  /** Fichier d'affiche dans le dossier de la bibliothèque, quand il y en a un. */
  poster?: string;
  /** Aperçu dessiné en SVG pour les styles intégrés sans image déposée. */
  preview?: {
    bg: string;
    fg: string;
    headline: string;
    sub?: string;
    accent?: string;
    /** Composition à dessiner : quatre flèches, liste, ruban, lettre… */
    layout?: PosterLayout;
  };
  /** Style intégré : non supprimable, sert de base de départ. */
  builtin?: boolean;
  /** Affiche d'un style intégré lue dans data/references/ (chemin relatif). */
  referencePoster?: string;
  static?: StaticSpec;
  video?: VideoSpec;
};

export type ScriptTemplate = {
  id: string;
  name: string;
  createdAt: string;
  tags: string[];
  /** Le texte d'origine, tel qu'il a été envoyé. */
  text: string;
  /** D'où il vient : nom de la marque source, produit, note libre. */
  source?: string;
  /** Format vidéo pressenti — informatif. */
  format?: string;
};

export type LibraryIndex = {
  styles: StyleTemplate[];
  scripts: ScriptTemplate[];
};
