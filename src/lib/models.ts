/**
 * Catalogue des modeles KIE utilisables depuis le Studio.
 * Les identifiants suivent le marketplace KIE (docs.kie.ai/market/...).
 * `fields` decrit le formulaire ; tout est envoye tel quel dans `input`.
 *
 * Les champs `file` / `files` passent d'abord par /api/kie/upload : KIE va
 * CHERCHER les medias sur internet, il ne lit jamais un fichier local. On
 * televerse donc chez eux et on n'envoie que l'URL renvoyee.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "url"
  | "urls"
  | "file"
  | "files"
  | "element";

export interface ModelField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  default?: string | number;
  required?: boolean;
  help?: string;
  /**
   * Libelles lisibles des options, quand la valeur technique ne parle pas.
   * « video » ou « input_image » n'apprennent rien a la lecture.
   */
  optionLabels?: Record<string, string>;
  /** Restriction du selecteur de fichier, pour file/files. */
  accept?: "image" | "video" | "audio";
  /** Nombre max de fichiers pour `files`. */
  max?: number;
  /**
   * Reglage court, rendu en pastille sur la ligne du modele plutot qu'en
   * champ pleine largeur : format, definition, duree, qualite.
   */
  compact?: boolean;
  /**
   * Champ toujours envoye avec sa valeur par defaut, jamais affiche.
   * Sert aux parametres a valeur unique qu'il faut pourtant transmettre :
   * omettre `aspect_ratio: auto` laisse Kling imposer son 16:9 et rogner une
   * video verticale.
   */
  hidden?: boolean;
}

/**
 * `swap` n'est pas un type de sortie mais un usage : ce sont des modeles video
 * qui prennent MA video et la transforment. Ils meritent leur propre onglet,
 * c'est le coeur du workflow.
 */
export type ModelKind = "image" | "video" | "swap";

export interface ModelDef {
  id: string;
  name: string;
  kind: ModelKind;
  vendor: string;
  blurb: string;
  /** Cout indicatif en credits, pour estimer avant de lancer. */
  approxCredits: number;
  /**
   * Tarif a la seconde de video, quand le modele facture ainsi.
   * Sans lui, l'estimation affichee ne veut rien dire : un forfait de 160
   * credits en face d'un clip de 10 s factue 240 induit en erreur.
   */
  creditsPerSec?: number;
  /** Mis en avant en tete de liste. */
  best?: boolean;
  /**
   * Identifiant a utiliser quand des images de reference sont fournies.
   *
   * KIE expose deux points d'entree distincts pour un meme modele : l'un pour
   * le texte-vers-image, l'autre pour l'image-vers-image. Les separer dans le
   * catalogue obligeait a choisir le bon avant meme d'avoir ses images. On
   * n'en garde qu'un, et la route bascule toute seule.
   */
  withImages?: string;
  fields: ModelField[];
}

const ASPECTS_IMG = ["auto", "1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "21:9"];
const ASPECTS_VID = ["9:16", "16:9", "1:1"];

const promptField = (placeholder: string, required = true): ModelField => ({
  key: "prompt",
  label: "Prompt",
  type: "textarea",
  required,
  placeholder,
});

const durationSel = (options = ["5", "10"], def = "5"): ModelField => ({
  key: "duration",
  label: "Durée (s)",
  type: "select",
  options,
  default: def,
  compact: true,
});

const resolutionSel = (options = ["720p", "1080p"], def = "720p"): ModelField => ({
  key: "resolution",
  label: "Résolution",
  type: "select",
  options,
  default: def,
  compact: true,
});

const aspectVid = (options = ASPECTS_VID, def = "9:16"): ModelField => ({
  key: "aspect_ratio",
  label: "Format",
  type: "select",
  options,
  default: def,
  compact: true,
});

/* ===================================================================== */
/* SWAP VIDEO — le workflow Kraft : ma video + un personnage de reference */
/* ===================================================================== */

/**
 * Consigne par defaut des modeles d'apparence.
 *
 * C'est elle qui fait tout le travail : sans instruction explicite de tout
 * conserver, le modele se croit autorise a refaire la scene, et l'objet tenu
 * en main disparait.
 */
/**
 * Consigne par defaut des modeles d'apparence.
 *
 * Reequilibree apres essai : la premiere version consacrait cinq lignes a
 * « garde tout identique » contre une au changement d'apparence. Wan, qui est
 * un modele d'edition et reste deja proche de la source, a suivi la majorite
 * et n'a quasiment pas transforme le visage.
 *
 * L'instruction de transformation passe donc en premier et en majuscules, la
 * clause de conservation est ramenee a une phrase.
 */
const GARDER_LA_SCENE =
  "TRANSFORME COMPLÈTEMENT le visage et la tête de la personne pour qu'ils deviennent " +
  "ceux de la personne de l'image de référence : mêmes traits, même forme du visage, " +
  "mêmes yeux, même nez, même bouche, même carnation, même coiffure et même couleur de cheveux. " +
  "L'identité doit changer entièrement — le résultat ne doit plus ressembler à la personne d'origine. " +
  "En revanche, ne touche pas au reste : décor, meubles, lumière, vêtements, " +
  "objets tenus dans les mains, position des mains, gestes et cadrage restent ceux de la vidéo. " +
  "L'objet @produit tenu dans la main doit rester strictement identique à ses images de référence : " +
  "même forme, même couleur, même étiquette, même texte, mêmes détails. Ne le lisse pas, ne le simplifie pas.";

const SWAP: ModelDef[] = [
  {
    id: "wan/2-7-videoedit",
    name: "Wan 2.7 — Changer l'apparence",
    kind: "swap",
    vendor: "Alibaba",
    blurb: "Édition vidéo : il retouche ta vidéo au lieu de la refaire. Le seul où tu choisis le format 9:16.",
    approxCredits: 240,
    creditsPerSec: 24,
    best: true,
    fields: [
      {
        key: "reference_image",
        label: "Visage",
        type: "file",
        accept: "image",
        required: true,
      },
      {
        key: "video_url",
        label: "Vidéo",
        type: "file",
        accept: "video",
        required: true,
        help: "Elle est conservée : ce que tu tiens en main reste en main.",
      },
      {
        key: "prompt",
        label: "Consigne",
        type: "textarea",
        required: true,
        default: GARDER_LA_SCENE,
      },
      { key: "negative_prompt", label: "À éviter", type: "text", compact: true,
        default:
          "visage inchangé, ressemblance avec la personne d'origine, traits masculins, " +
          "objet lissé ou sans détail, mains déformées, décor modifié",
      },
      {
        key: "aspect_ratio",
        label: "Format",
        type: "select",
        options: ["9:16", "16:9", "1:1", "4:3", "3:4"],
        default: "9:16",
        help: "Doit correspondre à ta vidéo, sinon le cadrage est rogné.",
      },
      resolutionSel(["720p", "1080p"], "1080p"),
      {
        key: "audio_setting",
        label: "Son",
        type: "select",
        options: ["origin", "auto"],
        optionLabels: { origin: "Garder ta voix", auto: "Laisser le modèle décider" },
        default: "origin",
      },
    ],
  },
  {
    id: "kling-3.0-omni/transformation",
    name: "Kling 3.0 Omni — Transformation",
    kind: "swap",
    vendor: "Kuaishou",
    blurb: "Plus créatif, mais il recrée la scène : le décor bouge et le format reste automatique. À essayer en second.",
    approxCredits: 200,
    creditsPerSec: 20,
    fields: [
      {
        key: "image_urls",
        label: "Visage",
        type: "files",
        accept: "image",
        required: true,
        max: 4,
        help: "La photo du visage/corps que tu veux à la place du tien.",
      },
      {
        key: "video_urls",
        label: "Vidéo",
        type: "files",
        accept: "video",
        required: true,
        max: 1,
        help: "Elle est conservée : ce que tu tiens en main reste en main.",
      },
      {
        key: "elements",
        label: "Produit",
        type: "element",
        help:
          "Le modèle régénère toute l'image et aplatit les petits objets, faute de savoir à quoi ils ressemblent. " +
          "Donne-lui 1 à 4 photos de ton produit : c'est le seul moyen qu'il le rende fidèlement.",
      },
      {
        key: "prompt",
        label: "Consigne",
        type: "textarea",
        required: true,
        default: GARDER_LA_SCENE,
        help: "C'est cette consigne qui protège le produit et le décor. Modifie-la avec précaution.",
      },
      /*
       * check-models: allow aspect_ratio — la doc n'annonce que « auto », mais
       * l'API ne valide pas ce champ (verifie : toute valeur passe). Sans lui,
       * une video verticale ressort en 16:9 avec le visage rogne, donc on
       * expose le choix. « auto » reste le defaut documente.
       */
      {
        key: "aspect_ratio",
        label: "Format",
        type: "select",
        options: ["auto", "9:16", "16:9", "1:1"],
        default: "9:16",
        help: "« auto » devrait suivre ta vidéo, mais Kling est sorti en 16:9 sur ton essai. Force 9:16 pour un reel.",
      },
      /*
       * `audio` vaut false par defaut chez Kling : sans ce champ, le rendu sort
       * muet alors que la video d'origine avait du son.
       */
      {
        key: "audio",
        label: "Son",
        type: "select",
        options: ["true", "false"],
        optionLabels: { true: "Garder le son", false: "Rendu muet" },
        default: "true",
      },
      /*
       * La duree du rendu se regle quand on fournit une video + des images.
       * C'est le seul vrai levier de vitesse : le temps de calcul suit la
       * longueur produite, pas celle de la source.
       */
      {
        key: "duration",
        label: "Durée du rendu",
        type: "select",
        options: ["", "3", "5", "6", "8", "10", "12", "15"],
        optionLabels: {
          "": "Toute la vidéo",
          "3": "3 s — le plus rapide",
          "5": "5 s",
          "6": "6 s",
          "8": "8 s",
          "10": "10 s",
          "12": "12 s",
          "15": "15 s",
        },
        default: "",
        help: "Raccourcir le rendu raccourcit le calcul, et coûte moins cher : la facture est à la seconde.",
      },
      resolutionSel(["720p", "1080p", "4k"], "720p"),
    ],
  },
  {
    id: "kling-3.0/motion-control",
    name: "Kling 3.0 — Motion Control",
    kind: "swap",
    vendor: "Kuaishou",
    blurb: "Refait entièrement le personnage à partir de ta photo. Perd ce que tu tiens en main — à réserver aux vidéos sans objet.",
    approxCredits: 270,
    creditsPerSec: 27,
    fields: [
      {
        key: "input_urls",
        label: "Visage",
        type: "files",
        accept: "image",
        required: true,
        max: 1,
        help: "Le visage, les épaules et le buste doivent être bien visibles.",
      },
      {
        key: "video_urls",
        label: "Vidéo",
        type: "files",
        accept: "video",
        required: true,
        max: 1,
        help: "Entre 3 et 30 secondes, 100 Mo maximum.",
      },
      { key: "mode", label: "Qualité", type: "select", options: ["720p", "1080p"], default: "1080p" , compact: true },
      {
        key: "character_orientation",
        label: "Orientation du personnage",
        type: "select",
        options: ["video", "image"],
        optionLabels: { video: "Suivre ma vidéo (recommandé)", image: "Suivre la photo" },
        default: "video",
        help: "Qui décide de la position et de l'angle du personnage.",
      },
      {
        key: "background_source",
        label: "Décor",
        type: "select",
        options: ["input_video", "input_image"],
        optionLabels: {
          input_video: "Garder le décor de ma vidéo",
          input_image: "Prendre le décor de la photo",
        },
        default: "input_video",
      },
    ],
  },
  {
    id: "kling-2.6/motion-control",
    name: "Kling 2.6 — Motion Control",
    kind: "swap",
    vendor: "Kuaishou",
    blurb: "La version économique du Motion Control. Perd aussi les objets tenus en main.",
    approxCredits: 110,
    creditsPerSec: 11,
    fields: [
      {
        key: "input_urls",
        label: "Visage",
        type: "files",
        accept: "image",
        required: true,
        max: 1,
        help: "Le visage, les épaules et le buste doivent être bien visibles.",
      },
      {
        key: "video_urls",
        label: "Vidéo",
        type: "files",
        accept: "video",
        required: true,
        max: 1,
        help: "Entre 3 et 30 secondes, 100 Mo maximum.",
      },
      { key: "mode", label: "Qualité", type: "select", options: ["720p", "1080p"], default: "720p" , compact: true },
      {
        key: "character_orientation",
        label: "Orientation du personnage",
        type: "select",
        options: ["video", "image"],
        optionLabels: { video: "Suivre ma vidéo (recommandé)", image: "Suivre la photo" },
        default: "video",
        help: "Qui décide de la position et de l'angle du personnage.",
      },
    ],
  },
];

/* ===================================================================== */
/* IMAGE                                                                  */
/* ===================================================================== */

const gptImageFields = (edit: boolean): ModelField[] => [
  promptField(
    edit
      ? "Remplace le visage de la personne par celui de la deuxième image. Garde la scène, la pose et les vêtements."
      : "Un homme en hoodie noir devant un laptop dans un café, photo iPhone, grain léger.",
  ),
  {
    key: "input_urls",
    label: "Images de référence",
    type: "files",
    accept: "image",
    // Jamais obligatoire : sans image, la route reste sur le texte-vers-image.
    max: 12,
    help: "Facultatif. La scène d'abord, le visage ensuite.",
  } as ModelField,
  { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: edit ? "auto" : "4:5" , compact: true },
  { key: "resolution", label: "Définition", type: "select", options: ["1K", "2K", "4K"], default: "1K" , compact: true },
  {
    key: "background",
    label: "Fond",
    type: "select",
    options: ["auto", "opaque", "transparent"],
    optionLabels: {
      auto: "Auto",
      opaque: "Plein",
      transparent: "Transparent (détourage)",
    },
    default: "auto",
    compact: true,
    help: "« Transparent » découpe le sujet sans arrière-plan, pour l'incruster ailleurs. Sinon, laisse Auto.",
  },
];

const IMAGE: ModelDef[] = [
  {
    id: "gpt-image-2-text-to-image",
    withImages: "gpt-image-2-image-to-image",
    name: "GPT Image 2",
    kind: "image",
    vendor: "OpenAI",
    blurb: "Le plus fidèle aux consignes, et le meilleur sur le texte incrusté.",
    approxCredits: 6,
    best: true,
    fields: gptImageFields(false),
  },
  {
    id: "gpt-image-2-5-flare-text-to-image",
    withImages: "gpt-image-2-5-flare-image-to-image",
    name: "GPT Image 2.5 Flare",
    kind: "image",
    vendor: "OpenAI",
    blurb: "Plus récent, rendu plus contrasté.",
    approxCredits: 6,
    fields: gptImageFields(false),
  },
  {
    id: "gpt-image/1.5-text-to-image",
    withImages: "gpt-image/1.5-image-to-image",
    name: "GPT Image 1.5",
    kind: "image",
    vendor: "OpenAI",
    blurb: "La génération précédente, un peu moins chère.",
    approxCredits: 4,
    fields: [
      promptField("Cover de reel : fond noir, gros texte blanc, style éditorial."),
      { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: "4:5" , compact: true },
    ],
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    kind: "image",
    vendor: "Google",
    blurb: "Très bon sur le texte incrusté et les compositions chargées.",
    approxCredits: 18,
    best: true,
    fields: [
      promptField("Cover de reel : fond noir, gros texte blanc, style éditorial, très contrasté."),
      { key: "image_input", label: "Images de référence", type: "files", accept: "image", max: 12 },
      { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: "9:16" , compact: true },
      { key: "resolution", label: "Définition", type: "select", options: ["1K", "2K", "4K"], default: "1K" , compact: true },
    ],
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    kind: "image",
    vendor: "Google",
    blurb: "Rapide et propre, texte-vers-image comme édition.",
    approxCredits: 8,
    fields: [
      promptField("Un bureau minimaliste avec deux écrans affichant un dashboard Shopify, lumière naturelle."),
      { key: "image_input", label: "Images de référence", type: "files", accept: "image", max: 12 },
      { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: "4:5" , compact: true },
      { key: "resolution", label: "Définition", type: "select", options: ["1K", "2K", "4K"], default: "1K" , compact: true },
    ],
  },
  {
    id: "google/nano-banana",
    withImages: "google/nano-banana-edit",
    name: "Nano Banana",
    kind: "image",
    vendor: "Google",
    blurb: "Le moins cher. Pour les fonds de carrousel.",
    approxCredits: 4,
    fields: [
      promptField("Un bureau minimaliste, lumière naturelle, photo réaliste."),
      { key: "image_urls", label: "Images de référence", type: "files", accept: "image", max: 12 },
      { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: "4:5" , compact: true },
      { key: "output_format", label: "Fichier", type: "select", options: ["png", "jpeg"], default: "png" , compact: true },
    ],
  },
  {
    id: "bytedance/seedream-v4-text-to-image",
    withImages: "bytedance/seedream-v4-edit",
    name: "Seedream v4",
    kind: "image",
    vendor: "ByteDance",
    blurb: "Photo lifestyle et personnages. Quand le rendu est trop lisse ailleurs.",
    approxCredits: 5,
    fields: [
      promptField("Homme 25 ans en hoodie noir devant un laptop dans un café, photo iPhone, grain léger."),
      { key: "image_urls", label: "Images de référence", type: "files", accept: "image", max: 12 },
      { key: "image_size", label: "Format", type: "select", options: ["square_hd", "square", "portrait_4_3", "portrait_3_2", "portrait_16_9", "landscape_4_3", "landscape_3_2", "landscape_16_9", "landscape_21_9"], default: "portrait_4_3" , compact: true },
    ],
  },
  {
    id: "wan/2-7-image-pro",
    name: "Wan 2.7 Image Pro",
    kind: "image",
    vendor: "Alibaba",
    blurb: "Photoréalisme poussé, rendu qui ne sent pas l'IA.",
    approxCredits: 12,
    fields: [
      promptField("Photo prise sur le vif, lumière naturelle, grain de capteur."),
      { key: "input_urls", label: "Images de référence", type: "files", accept: "image", max: 12 },
      { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: "4:5" , compact: true },
    ],
  },
];

/* ===================================================================== */
/* VIDEO                                                                  */
/* ===================================================================== */

const VIDEO: ModelDef[] = [
  {
    id: "kling-3.0/video",
    name: "Kling 3.0",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Texte ou image de départ, jusqu'à 11 s, son natif.",
    approxCredits: 100,
    best: true,
    fields: [
      promptField("Plan serré sur des mains qui scrollent un dashboard Shopify, lumière chaude, caméra fixe."),
      { key: "image_urls", label: "Image de départ (facultatif)", type: "files", accept: "image", max: 2 },
      durationSel(["3", "4", "5", "6", "7", "8", "9", "10", "11"], "5"),
      aspectVid(),
      { key: "mode", label: "Qualité", type: "select", options: ["std", "pro", "4K"], default: "pro" , compact: true },
      { key: "sound", label: "Son natif", type: "select", options: ["true", "false"], default: "false" , compact: true },
      { key: "multi_shots", label: "Multi-plans", type: "select", options: ["false", "true"], default: "false" , compact: true },
    ],
  },
  {
    id: "kling-3.0-omni/image-to-video",
    name: "Kling 3.0 Omni — Image → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Anime une image fixe, jusqu'à 15 s et 4K.",
    approxCredits: 100,
    best: true,
    fields: [
      promptField("La caméra recule lentement, la personne se retourne vers l'objectif."),
      { key: "image_urls", label: "Image de départ", type: "files", accept: "image", required: true, max: 2 },
      durationSel(["3", "4", "5", "6", "7", "8", "9", "10", "12", "15"], "5"),
      resolutionSel(["720p", "1080p", "4k"], "720p"),
      aspectVid(["auto", "9:16", "16:9", "1:1"], "auto"),
      { key: "audio", label: "Son natif", type: "select", options: ["false", "true"], default: "false" , compact: true },
    ],
  },
  {
    id: "kling-3.0-omni/text-to-video",
    name: "Kling 3.0 Omni — Texte → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Génération pure depuis un prompt, dernière génération.",
    approxCredits: 100,
    fields: [
      promptField("Travelling avant dans un loft moderne au lever du soleil, ambiance cinéma."),
      durationSel(["3", "4", "5", "6", "7", "8", "9", "10", "12", "15"], "5"),
      resolutionSel(["720p", "1080p", "4k"], "720p"),
      aspectVid(["auto", "9:16", "16:9", "1:1"], "9:16"),
      { key: "audio", label: "Son natif", type: "select", options: ["false", "true"], default: "false" , compact: true },
    ],
  },
  {
    id: "kling/v3-turbo-image-to-video",
    name: "Kling 3 Turbo — Image → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Le bon compromis vitesse/prix de la gamme 3.",
    approxCredits: 90,
    fields: [
      promptField("La caméra fait un lent panoramique autour du sujet."),
      { key: "image_urls", label: "Image de départ", type: "files", accept: "image", required: true, max: 2 },
      durationSel(["5", "10"], "5"),
      resolutionSel(["720p", "1080p"], "720p"),
    ],
  },
  {
    id: "kling/v3-turbo-text-to-video",
    name: "Kling 3 Turbo — Texte → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Génération rapide depuis un prompt.",
    approxCredits: 90,
    fields: [
      promptField("Rotation lente autour d'un colis e-commerce sur fond blanc, lumière studio."),
      durationSel(["5", "10"], "5"),
      aspectVid(["1:1", "9:16", "16:9"], "9:16"),
      resolutionSel(["720p", "1080p"], "720p"),
    ],
  },
  {
    id: "kling-2.6/image-to-video",
    name: "Kling 2.6 — Image → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Très stable, un bon rapport qualité/prix.",
    approxCredits: 55,
    fields: [
      promptField("La personne se retourne lentement vers la caméra."),
      { key: "image_urls", label: "Image de départ", type: "files", accept: "image", required: true, max: 2 },
      durationSel(),
      { key: "sound", label: "Son natif", type: "select", options: ["false", "true"], default: "false" , compact: true },
    ],
  },
  {
    id: "kling-2.6/text-to-video",
    name: "Kling 2.6 — Texte → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "La 2.6 en texte-vers-vidéo.",
    approxCredits: 55,
    fields: [
      promptField("Plan large sur une terrasse à Dubaï, coucher de soleil, mouvement de drone lent."),
      { key: "sound", label: "Son natif", type: "select", options: ["false", "true"], default: "false" , compact: true },
      aspectVid(["1:1", "16:9", "9:16"], "9:16"),
      durationSel(),
    ],
  },
  {
    id: "kling/v2-5-turbo-image-to-video-pro",
    name: "Kling 2.5 Turbo Pro — Image → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Le moins cher des Kling. Pour tester avant de passer en 3.0.",
    approxCredits: 42,
    fields: [
      promptField("La caméra recule lentement."),
      { key: "image_url", label: "Image de départ", type: "file", accept: "image", required: true },
      { key: "tail_image_url", label: "Image de fin (facultatif)", type: "file", accept: "image" },
      durationSel(),
      { key: "negative_prompt", label: "À éviter", type: "text", compact: true, placeholder: "flou, déformation" },
    ],
  },
  {
    id: "kling/v2-5-turbo-text-to-video-pro",
    name: "Kling 2.5 Turbo Pro — Texte → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Version texte du 2.5 Turbo.",
    approxCredits: 42,
    fields: [
      promptField("Rotation lente autour d'un colis e-commerce sur fond blanc."),
      aspectVid(),
      durationSel(),
    ],
  },
  {
    id: "kling/v2-1-master-image-to-video",
    name: "Kling 2.1 Master — Image → Vidéo",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "L'ancien haut de gamme. Mouvement très fluide, cher.",
    approxCredits: 160,
    fields: [
      promptField("Mouvement de caméra cinématique autour du sujet."),
      { key: "image_url", label: "Image de départ", type: "file", accept: "image", required: true },
      durationSel(),
    ],
  },
  {
    id: "bytedance/seedance-2",
    name: "Seedance 2",
    kind: "video",
    vendor: "ByteDance",
    blurb: "Jusqu'en 4K avec son. Accepte images et vidéos de référence.",
    approxCredits: 100,
    best: true,
    fields: [
      promptField("POV : quelqu'un ouvre son téléphone et voit 47 notifications de commandes Shopify."),
      { key: "first_frame_url", label: "Première image (facultatif)", type: "file", accept: "image" },
      { key: "last_frame_url", label: "Dernière image (facultatif)", type: "file", accept: "image" },
      { key: "reference_image_urls", label: "Images de référence", type: "files", accept: "image", max: 12 },
      resolutionSel(["480p", "720p", "1080p", "4k"], "720p"),
      aspectVid(["adaptive", "9:16", "16:9", "1:1", "4:3", "3:4", "21:9"], "9:16"),
      { key: "duration", label: "Durée (s)", type: "number", default: 5 , compact: true },
      { key: "generate_audio", label: "Générer le son", type: "select", options: ["true", "false"], default: "true" , compact: true },
    ],
  },
  {
    id: "bytedance/seedance-2-fast",
    name: "Seedance 2 Fast",
    kind: "video",
    vendor: "ByteDance",
    blurb: "Plus rapide et moins cher. Pour itérer.",
    approxCredits: 60,
    fields: [
      promptField("POV : le téléphone s'allume et affiche 47 notifications."),
      { key: "first_frame_url", label: "Première image (facultatif)", type: "file", accept: "image" },
      { key: "reference_image_urls", label: "Images de référence", type: "files", accept: "image", max: 12 },
      resolutionSel(["480p", "720p"], "720p"),
      aspectVid(["adaptive", "9:16", "16:9", "1:1"], "9:16"),
      { key: "duration", label: "Durée (s)", type: "number", default: 5 , compact: true },
      { key: "generate_audio", label: "Générer le son", type: "select", options: ["true", "false"], default: "true" , compact: true },
    ],
  },
  {
    id: "bytedance/seedance-2-mini",
    name: "Seedance 2 Mini",
    kind: "video",
    vendor: "ByteDance",
    blurb: "Le moins cher du catalogue vidéo.",
    approxCredits: 25,
    fields: [
      promptField("Plan serré sur un carnet et un stylo, lumière du matin."),
      { key: "first_frame_url", label: "Première image (facultatif)", type: "file", accept: "image" },
      resolutionSel(["480p", "720p"], "720p"),
      aspectVid(["adaptive", "9:16", "16:9"], "9:16"),
      { key: "duration", label: "Durée (s)", type: "number", default: 5 , compact: true },
    ],
  },
  {
    id: "bytedance/seedance-1.5-pro",
    name: "Seedance 1.5 Pro",
    kind: "video",
    vendor: "ByteDance",
    blurb: "La génération précédente, très bon marché en 480p.",
    approxCredits: 40,
    fields: [
      promptField("Travelling latéral dans un showroom, lumière naturelle."),
      { key: "input_urls", label: "Image de départ (facultatif)", type: "files", accept: "image", max: 2 },
      aspectVid(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"], "9:16"),
      resolutionSel(["480p", "720p", "1080p"], "720p"),
      { key: "duration", label: "Durée (s)", type: "number", default: 5 , compact: true },
      { key: "generate_audio", label: "Générer le son", type: "select", options: ["false", "true"], default: "false" , compact: true },
    ],
  },
  {
    id: "google/veo3-fast",
    name: "Veo 3.1 Fast",
    kind: "video",
    vendor: "Google",
    blurb: "8 s avec le son. Le meilleur rapport qualité/prix en B-roll.",
    approxCredits: 60,
    fields: [
      promptField("Plan serré sur des mains qui scrollent un dashboard, lumière chaude, caméra fixe."),
      aspectVid(["9:16", "16:9"], "9:16"),
      {
        key: "enableTranslation",
        label: "Traduire le prompt en anglais",
        type: "select",
        options: ["true", "false"],
        default: "true",
      },
    ],
  },
  {
    id: "google/veo3",
    name: "Veo 3.1 Quality",
    kind: "video",
    vendor: "Google",
    blurb: "La version haut de gamme de Veo. À garder pour les plans héros.",
    approxCredits: 300,
    fields: [
      promptField("Travelling avant dans un loft moderne au lever du soleil, ambiance cinéma."),
      aspectVid(["9:16", "16:9"], "9:16"),
    ],
  },
  {
    id: "sora-2-image-to-video",
    name: "Sora 2 — Image → Vidéo",
    kind: "video",
    vendor: "OpenAI",
    blurb: "Anime une image fixe. Mouvement de caméra très naturel.",
    approxCredits: 30,
    fields: [
      promptField("La caméra recule lentement, la personne se retourne vers l'objectif."),
      { key: "image_urls", label: "Image de départ", type: "files", accept: "image", required: true, max: 1 },
      { key: "aspect_ratio", label: "Format", type: "select", options: ["portrait", "landscape"], default: "portrait" , compact: true },
    ],
  },
  {
    id: "sora-2-text-to-video",
    name: "Sora 2 — Texte → Vidéo",
    kind: "video",
    vendor: "OpenAI",
    blurb: "Excellent en scènes réalistes et en mouvement de caméra naturel.",
    approxCredits: 30,
    fields: [
      promptField("POV : quelqu'un ouvre son téléphone et voit 47 notifications de commandes."),
      { key: "aspect_ratio", label: "Format", type: "select", options: ["portrait", "landscape"], default: "portrait" , compact: true },
    ],
  },
  {
    id: "hailuo/2-3-image-to-video-pro",
    name: "Hailuo 2.3 Pro",
    kind: "video",
    vendor: "MiniMax",
    blurb: "Très bon sur les mouvements de corps et les expressions de visage.",
    approxCredits: 30,
    fields: [
      promptField("La personne parle face caméra, gestuelle naturelle."),
      { key: "image_url", label: "Image de départ", type: "file", accept: "image", required: true },
      durationSel(["6", "10"], "6"),
      resolutionSel(["768p", "1080p"], "768p"),
    ],
  },
  {
    id: "minimax-h3/reference-to-video",
    name: "MiniMax H3 — Référence → Vidéo",
    kind: "video",
    vendor: "MiniMax",
    blurb: "Génère à partir d'images ET de vidéos de référence en même temps.",
    approxCredits: 50,
    fields: [
      promptField("Décris la scène voulue."),
      { key: "reference_image_urls", label: "Images de référence", type: "files", accept: "image", max: 12 },
      { key: "reference_video_urls", label: "Vidéos de référence", type: "files", accept: "video", max: 2 },
      { key: "duration", label: "Durée (s)", type: "number", default: 5 , compact: true },
      aspectVid(["adaptive", "9:16", "16:9"], "9:16"),
      resolutionSel(["768p", "1080p"], "768p"),
    ],
  },
  {
    id: "wan/2-7-image-to-video",
    name: "Wan 2.7 — Image → Vidéo",
    kind: "video",
    vendor: "Alibaba",
    blurb: "Rendu photoréaliste, bon marché à la seconde.",
    approxCredits: 80,
    fields: [
      promptField("Le sujet avance vers la caméra, lumière naturelle."),
      { key: "first_frame_url", label: "Image de départ", type: "file", accept: "image", required: true },
      durationSel(),
      resolutionSel(["720p", "1080p"], "720p"),
    ],
  },
  {
    id: "wan/2-5-image-to-video",
    name: "Wan 2.5 — Image → Vidéo",
    kind: "video",
    vendor: "Alibaba",
    blurb: "La version précédente, encore moins chère.",
    approxCredits: 60,
    fields: [
      promptField("Le sujet tourne la tête vers la caméra."),
      { key: "image_url", label: "Image de départ", type: "file", accept: "image", required: true },
      durationSel(),
      resolutionSel(["480p", "720p", "1080p"], "720p"),
    ],
  },
  {
    id: "pixverse-v6/image-to-video",
    name: "PixVerse v6",
    kind: "video",
    vendor: "PixVerse",
    blurb: "Le plus économique. Pour vérifier un cadrage.",
    approxCredits: 25,
    fields: [
      promptField("La caméra zoome doucement sur le sujet."),
      { key: "image_urls", label: "Image de départ", type: "files", accept: "image", required: true, max: 2 },
      { key: "quality", label: "Qualité", type: "select", options: ["360p", "540p", "720p", "1080p"], default: "720p" , compact: true },
      { key: "duration", label: "Durée (s)", type: "number", default: 5 , compact: true },
    ],
  },
];

export const MODELS: ModelDef[] = [...SWAP, ...IMAGE, ...VIDEO];

export function getModel(id: string) {
  return MODELS.find((m) => m.id === id);
}

/** Modeles d'un onglet, les recommandes d'abord. */
export function modelsOfKind(kind: ModelKind) {
  return MODELS.filter((m) => m.kind === kind).sort((a, b) => Number(b.best ?? false) - Number(a.best ?? false));
}
