export type ProductKind = "fashion" | "beauty" | "gadget" | "furniture" | "food" | "other";

export const KINDS: Array<{ id: ProductKind; label: string; hint: string }> = [
  { id: "fashion", label: "Vêtement / accessoire", hint: "Porté sur le corps" },
  { id: "beauty", label: "Beauté / soin", hint: "Appliqué, flacon visible" },
  { id: "gadget", label: "Gadget / high-tech", hint: "Tenu et manipulé" },
  { id: "furniture", label: "Meuble / déco", hint: "Posé dans la pièce, à l'échelle" },
  { id: "food", label: "Alimentaire", hint: "Goûté, consommé" },
  { id: "other", label: "Autre", hint: "Montré face caméra" },
];

/**
 * Chaque catégorie impose une manipulation différente. C'est ce bloc qui
 * réinterprète les scènes : un « holds the product » générique donne un meuble
 * porté à bout de bras ou une robe tenue comme un colis. Il est placé après le
 * verrou produit et le surcharge explicitement.
 */
const HANDLING: Record<ProductKind, string> = {
  fashion: [
    "PRODUCT TYPE — APPAREL. The product is a garment or a wearable accessory. The protagonist ",
    "WEARS it on their body for the whole clip: correctly fitted, in the right place, fully visible ",
    "from the angle described. Whenever a scene says the protagonist holds or shows the product, they ",
    "are WEARING it and gesturing at it, pulling at the fabric, or turning their body so the camera ",
    "sees it — never carrying it like a loose object. Show how it falls and moves on a real body. ",
    "The rest of their outfit stays plain and neutral so nothing competes with it.",
  ].join(""),
  beauty: [
    "PRODUCT TYPE — BEAUTY. The product is a cosmetic or skincare item. The container stays visible ",
    "and readable, held in one hand with the label facing the camera. When a scene shows the product ",
    "in use, the protagonist applies it to their own skin or hair with realistic gestures and ",
    "realistic texture — no impossible foam, no glowing effect, no instant transformation.",
  ].join(""),
  gadget: [
    "PRODUCT TYPE — DEVICE. The product is a physical device or tool. The protagonist holds it in ",
    "their hands and actually operates it, with plausible gestures for what it does. Buttons, screens ",
    "and cables look exactly as in the reference images. No invented interface, no fake screen content.",
  ].join(""),
  furniture: [
    "PRODUCT TYPE — FURNITURE. The product is a piece of furniture or home decor. It STANDS in the ",
    "room, at true real-world scale, in the place such an object would normally sit — on the floor, ",
    "against a wall, on a table. The protagonist NEVER holds, lifts or carries it: they stand or sit ",
    "beside it, touch it, sit on it, open it, or gesture towards it while the camera keeps it in shot. ",
    "The room around it looks like an ordinary lived-in home.",
  ].join(""),
  food: [
    "PRODUCT TYPE — FOOD. The product is edible. Packaging stays visible and readable. When a scene ",
    "shows use, the protagonist opens it and tastes it with a genuine, unexaggerated reaction. ",
    "The food itself looks exactly like the reference images — no styling, no substitution.",
  ].join(""),
  other: [
    "PRODUCT TYPE — GENERIC OBJECT. The protagonist holds the product facing the camera, at chest ",
    "height, label side out, hands clear of any detail, and presents it plainly.",
  ].join(""),
};

export function handlingFor(kind: ProductKind) {
  return HANDLING[kind] ?? HANDLING.other;
}

/**
 * Devine la catégorie depuis le type et le titre Shopify. Ce n'est qu'un
 * pré-réglage : l'utilisateur corrige d'un clic, et c'est son choix qui compte.
 */
export function guessKind(text: string): ProductKind {
  const value = text.toLowerCase();
  const rules: Array<[ProductKind, RegExp]> = [
    [
      "fashion",
      /robe|dress|shirt|chemise|tee|t-shirt|pantalon|trouser|jean|veste|jacket|manteau|coat|pull|sweater|hoodie|jupe|skirt|short|chaussure|shoe|sneaker|basket|sac|bag|ceinture|belt|montre|watch|bijou|jewel|collier|necklace|bracelet|bague|ring|lunette|sunglass|chapeau|hat|casquette|cap|legging|body|brassiere|soutien|lingerie|maillot|socks|chaussette/,
    ],
    [
      "beauty",
      /serum|sérum|crème|creme|cream|soin|skincare|collagen|collagène|masque|mask|shampoo|shampooing|lotion|huile|oil|parfum|perfume|maquillage|makeup|rouge à lèvres|lipstick|mascara|gommage|scrub|patch/,
    ],
    [
      "furniture",
      /meuble|furniture|chaise|chair|table|canapé|sofa|fauteuil|armchair|lit|bed|matelas|mattress|étagère|shelf|lampe|lamp|tapis|rug|coussin|cushion|rideau|curtain|miroir|mirror|bureau|desk|commode|dresser|niche|cage|arbre à chat|cat tree/,
    ],
    [
      "food",
      /thé|tea|café|coffee|snack|barre|bar|complément|supplement|gummies|vitamine|vitamin|poudre|powder|boisson|drink|protein|protéine/,
    ],
    [
      "gadget",
      /gadget|device|appareil|machine|outil|tool|chargeur|charger|batterie|battery|écouteur|earbud|casque|headphone|caméra|camera|drone|aspirateur|vacuum|ventilateur|fan|projecteur|projector|robot|électrique|electric|sans fil|cordless|rechargeable|led/,
    ],
  ];
  for (const [kind, pattern] of rules) {
    if (pattern.test(value)) return kind;
  }
  return "other";
}
