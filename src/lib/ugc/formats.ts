/**
 * Formats et niches.
 *
 * Un angle dit CE QUE la personne raconte (problème → solution, avis honnête…).
 * Le format dit COMMENT c'est filmé : selfie à bout de bras, facecam posée,
 * plateau podcast, interview, micro-trottoir, vlog en marchant. La niche dit
 * QUI parle et d'où : une créatrice mode dans son dressing, un coach fitness
 * dans une salle, un lecteur dans son coin lecture.
 *
 * Les trois axes se combinent librement : c'est ce qui permet de lancer
 * n'importe quel produit — ou n'importe quel sujet — en UGC sans réécrire un
 * prompt à la main.
 */

export type FormatId =
  | "selfie"
  | "facecam"
  | "podcast"
  | "interview"
  | "street"
  | "vlog"
  | "greenscreen"
  | "grwm"
  | "desk"
  | "free";

export type Format = { id: FormatId; label: string; hint: string; setup: string };

const OVERRIDE =
  "SETUP OVERRIDE — the camera, framing and location described here take precedence over any " +
  "location or framing mentioned in the SCENE below. Keep the scene's action and dialogue, but " +
  "stage them in this setup. ";

export const FORMATS: Format[] = [
  {
    id: "selfie",
    label: "Selfie main levée",
    hint: "Le classique TikTok : téléphone à bout de bras",
    setup:
      OVERRIDE +
      "Handheld selfie framing: the protagonist holds the phone at arm's length, slightly above eye " +
      "level, natural micro-shake, framed from the chest up. Everyday indoor location with real " +
      "clutter — a kitchen, a bedroom, a car seat, a hallway.",
  },
  {
    id: "facecam",
    label: "Facecam posée",
    hint: "Téléphone sur support, plan fixe serré, ton confidence",
    setup:
      OVERRIDE +
      "Facecam: the phone is propped on a desk or shelf, perfectly still, at eye level. Tight framing " +
      "from the shoulders up, the protagonist centred, looking straight into the lens as if talking to " +
      "one friend. Soft window light from one side, a lived-in room softly out of focus behind. " +
      "Calm, intimate, confessional energy — no gestures towards the camera, small natural head movements.",
  },
  {
    id: "podcast",
    label: "Plateau podcast",
    hint: "Micro de studio, casque, lumière chaude, extrait de conversation",
    setup:
      OVERRIDE +
      "Podcast studio: the protagonist sits at a table in front of a large studio microphone on a boom " +
      "arm (Shure SM7B style), wearing over-ear headphones around the neck or on the head. Warm tungsten " +
      "key light, a dark or brick wall with a couple of acoustic panels and a soft LED strip in the " +
      "background. Camera on a tripod, medium shot from a slight three-quarter angle, like a clip cut " +
      "from a two-hour conversation. The protagonist talks towards an unseen host slightly off-axis, " +
      "occasionally glancing at the lens. Relaxed, opinionated, mid-conversation energy.",
  },
  {
    id: "interview",
    label: "Interview",
    hint: "Assis face à un intervieweur hors champ, réponses posées",
    setup:
      OVERRIDE +
      "Sit-down interview: the protagonist sits on a stool or chair against a clean, softly lit " +
      "background (a plain wall, a studio backdrop or a tidy living room), framed medium close-up, " +
      "eyes slightly off the lens towards an interviewer who is NEVER shown and NEVER heard. Camera on " +
      "a tripod, static, shallow depth of field. A small lavalier microphone may be clipped to their " +
      "collar. They answer as if replying to a question just asked: a beat of thought, then a direct, " +
      "sincere answer. Documentary tone.",
  },
  {
    id: "street",
    label: "Micro-trottoir",
    hint: "Dehors, micro à main, réponse spontanée à un passant",
    setup:
      OVERRIDE +
      "Street interview: outdoors on a busy city sidewalk or a shopping street in daylight, natural " +
      "crowd blur in the background. A handheld reporter microphone with a foam windscreen enters the " +
      "frame from below, held towards the protagonist by an unseen interviewer. Handheld phone camera, " +
      "medium shot, slight movement. The protagonist reacts spontaneously, a little surprised to be " +
      "asked, then answers with genuine enthusiasm. Ambient street sound.",
  },
  {
    id: "vlog",
    label: "Vlog en marchant",
    hint: "Dehors, caméra face à soi en marchant, lumière naturelle",
    setup:
      OVERRIDE +
      "Walking vlog: the protagonist walks outdoors — a residential street, a park path, a parking " +
      "lot — holding the phone in front of them at arm's length, camera facing them, the background " +
      "moving behind as they walk. Bright natural daylight, slight wind, natural bounce of the " +
      "handheld camera. Energetic, off-the-cuff, talking as thoughts come.",
  },
  {
    id: "greenscreen",
    label: "Fond uni / réaction",
    hint: "Créateur devant un fond neutre, ton commentaire ou réaction",
    setup:
      OVERRIDE +
      "Commentary framing: the protagonist stands or sits in front of a flat, evenly lit plain " +
      "background (a bare wall or a solid colour backdrop), framed from the chest up, phone on a stand. " +
      "The framing leaves clean empty space on one side, like a creator reacting to something that " +
      "will be shown next to them. Punchy, expressive delivery with clear hand gestures. Even, " +
      "shadowless soft light.",
  },
  {
    id: "grwm",
    label: "GRWM / miroir",
    hint: "Devant le miroir ou la coiffeuse, en se préparant",
    setup:
      OVERRIDE +
      "Get-ready-with-me: the protagonist is at a bathroom mirror or a bedroom vanity, phone propped " +
      "against the mirror or on the counter, framed from the waist up. They keep doing small getting-" +
      "ready gestures — fixing hair, adjusting a collar — while talking casually to the camera. Bright " +
      "vanity or bathroom light, personal items around. Chatty, unfiltered energy.",
  },
  {
    id: "desk",
    label: "Au bureau",
    hint: "Assis à son bureau, ordinateur ouvert, ton expert",
    setup:
      OVERRIDE +
      "Desk setup: the protagonist sits at a home office desk with an open laptop or monitor beside " +
      "them, phone on a small tripod at eye level, framed medium close-up. Daylight from a window plus " +
      "a warm desk lamp, a bookshelf or plants behind. Measured, knowledgeable delivery, like someone " +
      "explaining something they do every day.",
  },
  /*
   * Sujet libre : rien n'est imposé. Le texte de chaque scène porte déjà le
   * lieu, le cadrage et l'action ; un bloc de format viendrait l'écraser.
   */
  {
    id: "free",
    label: "Libre",
    hint: "Aucun cadrage imposé : chaque scène écrite fixe le lieu, le plan et l'action",
    setup: "",
  },
];

export const DEFAULT_FORMAT: FormatId = "selfie";

export function formatBlock(id?: FormatId | null) {
  if (!id) return "";
  return FORMATS.find((format) => format.id === id)?.setup ?? "";
}

export type NicheId =
  | "none"
  | "fashion"
  | "beauty"
  | "fitness"
  | "home"
  | "tech"
  | "food"
  | "pets"
  | "books"
  | "finance"
  | "parenting"
  | "travel"
  | "gaming";

export type Niche = { id: NicheId; label: string; block: string };

const NICHE_INTRO =
  "CREATOR NICHE — the protagonist is a social media creator in this niche; their wardrobe, " +
  "surroundings and vocabulary follow it, unless the SETUP already fixes the location. ";

export const NICHES: Niche[] = [
  { id: "none", label: "Aucune", block: "" },
  {
    id: "fashion",
    label: "Mode",
    block:
      NICHE_INTRO +
      "Fashion creator: a well put-together but wearable outfit, a bedroom or dressing area with a " +
      "clothing rack and a full-length mirror, natural window light. Speaks about fit, fabric, styling.",
  },
  {
    id: "beauty",
    label: "Beauté",
    block:
      NICHE_INTRO +
      "Beauty creator: clean, glowing but realistic skin, hair done, a vanity with a few products, " +
      "ring-light softness without the ring reflection. Speaks about texture, routine, results.",
  },
  {
    id: "fitness",
    label: "Fitness",
    block:
      NICHE_INTRO +
      "Fitness creator: athletic wear, a gym floor, a home workout corner or a running path, slightly " +
      "out of breath energy. Speaks about performance, recovery, discipline.",
  },
  {
    id: "home",
    label: "Maison / déco",
    block:
      NICHE_INTRO +
      "Home creator: a warm, tidy, real apartment — sofa, plants, wooden surfaces, morning light. " +
      "Speaks about comfort, organisation, everyday life.",
  },
  {
    id: "tech",
    label: "Tech",
    block:
      NICHE_INTRO +
      "Tech creator: a desk with a monitor, cables, a few devices, cool LED accent light. Speaks " +
      "about specs, value, real-world use, honest pros and cons.",
  },
  {
    id: "food",
    label: "Food / cuisine",
    block:
      NICHE_INTRO +
      "Food creator: a home kitchen with a counter, ingredients around, apron or casual clothes. " +
      "Speaks about taste, recipes, what they actually eat.",
  },
  {
    id: "pets",
    label: "Animaux",
    block:
      NICHE_INTRO +
      "Pet owner creator: a living room with a pet bed or toys around; a calm dog or cat may appear " +
      "briefly in the background but never becomes the subject. Speaks as a caring owner.",
  },
  {
    id: "books",
    label: "Lecture / éducation",
    block:
      NICHE_INTRO +
      "Book and learning creator: a reading corner with a bookshelf, a lamp, a mug, cosy knitwear. " +
      "Speaks thoughtfully about ideas, what they learned, who it is for.",
  },
  {
    id: "finance",
    label: "Business / finance",
    block:
      NICHE_INTRO +
      "Business creator: smart-casual outfit, a clean desk or a café table with a laptop, confident " +
      "and concrete. Speaks in numbers, results and decisions.",
  },
  {
    id: "parenting",
    label: "Parents / famille",
    block:
      NICHE_INTRO +
      "Parent creator: a family home with toys or a high chair in the background, casual clothes, " +
      "a tired-but-happy realism. Speaks about saving time, safety, what works with kids.",
  },
  {
    id: "travel",
    label: "Voyage",
    block:
      NICHE_INTRO +
      "Travel creator: a hotel room, an airport lounge or a sunny outdoor spot, a backpack or " +
      "suitcase visible. Speaks about packing, convenience, what they take everywhere.",
  },
  {
    id: "gaming",
    label: "Gaming",
    block:
      NICHE_INTRO +
      "Gaming creator: a gaming desk with RGB accents, a headset, a chair, dim room with screen glow. " +
      "Speaks fast, with humour, about setups and performance.",
  },
];

export const DEFAULT_NICHE: NicheId = "none";

export function nicheBlock(id?: NicheId | null) {
  if (!id || id === "none") return "";
  return NICHES.find((niche) => niche.id === id)?.block ?? "";
}
