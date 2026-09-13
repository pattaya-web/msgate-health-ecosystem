import type { StyleTemplate } from "@/lib/creative-library/types";

/**
 * Styles intégrés, relevés sur les statiques d'une marque de bracelets au
 * marketing agressif (grosse promesse, garantie, quatre bénéfices fléchés,
 * barre de presse). Ce sont les dispositifs, pas les visuels : chaque style
 * décrit la mise en page et ses éléments, avec le texte d'origine comme calibre.
 * Le produit, les textes et les prix sont réécrits à l'application.
 */
const PRESS_BAR = {
  kind: "press logo bar",
  style:
    "a thin horizontal rule, then five white press wordmarks side by side in their own editorial typefaces, small, evenly spaced across the full width",
  position: "bottom band, centred, above the lower edge",
  sourceText: "Men's Health · Forbes · The Guardian · Cosmopolitan · WellBeing",
  role: "social proof",
  adaptedText: "",
};

const GUARANTEE = {
  kind: "subheadline",
  style: "light-weight sans-serif, small, white, centred under the headline",
  position: "directly under the headline",
  sourceText: "Or get your money back.",
  role: "objection handled",
  adaptedText: "",
};

function callout(position: string, sourceText: string, arrow: string) {
  return {
    kind: "benefit callout with hand-drawn arrow",
    style: `bold condensed uppercase sans-serif in white, two short lines, with a thin white hand-drawn curved arrow ${arrow} pointing at the product`,
    position,
    sourceText,
    role: "benefit",
    adaptedText: "",
  };
}

export const BUILTIN_STYLES: StyleTemplate[] = [
  {
    id: "builtin-claim-callouts",
    kind: "static",
    builtin: true,
    name: "Promesse + 4 bénéfices fléchés",
    pitch: "Gros claim souligné, garantie, produit au centre, quatre flèches, barre de presse.",
    tags: ["agressif", "bénéfices", "presse", "carré"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "callouts", bg: "#0b2a6f", fg: "#ffffff", headline: "ROCK HARD MORNINGS", sub: "IN 72 HOURS.", accent: "#9fb7e8" },
    static: {
      aspect: "1:1",
      fontStyle:
        "one bold condensed uppercase grotesque for the headline and callouts (the first word of the headline is underlined), a light sans for the sub-line; everything in pure white on the dark ground",
      layout:
        "Square ad on a deep saturated single-colour background with a soft radial vignette (darker at the edges, lighter behind the product). Headline in two lines at the top, centred, the first word underlined; a small sub-line under it. The product is the hero, centred, photographed floating at a slight three-quarter angle with a soft glossy reflection, occupying about 40% of the height. Four short benefit callouts sit around the product — two on the left, two on the right — each with a thin hand-drawn curved arrow pointing at the product. A thin rule near the bottom, then a row of press wordmarks.",
      elements: [
        {
          kind: "headline",
          style: "very large bold condensed uppercase sans-serif, white, two lines, first word underlined with a thick rule",
          position: "top centre, spanning most of the width",
          sourceText: "ROCK HARD MORNINGS IN 72 HOURS.",
          role: "hook",
          adaptedText: "",
        },
        GUARANTEE,
        callout("upper left of the product", "BURNS OFF BEER BELLY", "curving down-right"),
        callout("lower left of the product", "BOOSTS DESIRE", "curving up-right"),
        callout("upper right of the product", "MELTS MAN BOOBS", "curving down-left"),
        callout("lower right of the product", "REDUCES JOINT PAIN", "curving up-left"),
        PRESS_BAR,
      ],
    },
  },
  {
    id: "builtin-struggling-list",
    kind: "static",
    builtin: true,
    name: "« Struggling with ? » + liste NO MORE",
    pitch: "Question qui pique, liste de 3 problèmes barrés avec icônes, produit à droite, bouton CTA.",
    tags: ["problème", "liste", "clair", "cta"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "list", bg: "#e9eaec", fg: "#111111", headline: "Struggling with", sub: "MAN BOOBS?", accent: "#111111" },
    static: {
      aspect: "1:1",
      fontStyle:
        "heavy black grotesque, mixed case for the question with the key words in caps, a black label chip for the list header; all text in near-black on a pale ground",
      layout:
        "Square ad on a very light grey, softly textured background. Top-left: a two-line question headline. Below it, a small black rectangular label reading a list header, then a vertical list of three problems, each with a small black line-icon on the left and a thin hand-drawn arrow pointing right towards the product. The product sits on the right half, large, floating at a three-quarter angle with a soft shadow. Bottom-left: a pill-shaped black button with white uppercase text.",
      elements: [
        {
          kind: "headline",
          style: "heavy grotesque, first line regular weight mixed case, second line extra-bold uppercase, black",
          position: "top left",
          sourceText: "Struggling with MAN BOOBS?",
          role: "hook",
          adaptedText: "",
        },
        {
          kind: "label chip",
          style: "small black rectangle with white bold uppercase text",
          position: "under the headline, left",
          sourceText: "NO MORE:",
          role: "benefit",
          adaptedText: "",
        },
        {
          kind: "icon list item with arrow",
          style: "simple black line icon, then bold black text, then a thin hand-drawn arrow pointing right",
          position: "left column, first row",
          sourceText: "Dad bod",
          role: "objection handled",
          adaptedText: "",
        },
        {
          kind: "icon list item with arrow",
          style: "simple black line icon, then bold black text, then a thin hand-drawn arrow pointing right",
          position: "left column, second row",
          sourceText: "Man boobs",
          role: "objection handled",
          adaptedText: "",
        },
        {
          kind: "icon list item with arrow",
          style: "simple black line icon, then bold black text, then a thin hand-drawn arrow pointing right",
          position: "left column, third row",
          sourceText: "Love handles",
          role: "objection handled",
          adaptedText: "",
        },
        {
          kind: "cta button",
          style: "black pill button with small white bold uppercase text",
          position: "bottom left",
          sourceText: "TRY RISK FREE",
          role: "urgency",
          adaptedText: "",
        },
      ],
    },
  },
  {
    id: "builtin-bold-statement",
    kind: "static",
    builtin: true,
    name: "Déclaration choc + 4 mini-claims",
    pitch: "Fond noir, phrase choc en haut, produit seul, quatre micro-preuves aux coins, presse.",
    tags: ["choc", "noir", "preuves", "presse"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "statement", bg: "#0a0a0a", fg: "#ffffff", headline: "VIAGRA IS OVER.", sub: "Or money back guaranteed.", accent: "#8a8a8a" },
    static: {
      aspect: "1:1",
      fontStyle:
        "extra-bold uppercase grotesque for the headline, light italic sans for the sub-line, small regular sans for the corner claims; all white on black",
      layout:
        "Square ad on a pure black background. A single bold uppercase statement on one line at the top, centred, with a small light italic sub-line under it. The product is centred and large, floating, lit with a cool rim light so its edges glow against the black. Four small two-line claims sit at the four corners around the product, in small white text, without arrows. Thin rule at the bottom and a row of press wordmarks.",
      elements: [
        {
          kind: "headline",
          style: "extra-bold uppercase grotesque, white, one line, ends with a full stop",
          position: "top centre",
          sourceText: "VIAGRA IS OVER.",
          role: "hook",
          adaptedText: "",
        },
        {
          kind: "subheadline",
          style: "light italic sans-serif, small, white",
          position: "under the headline",
          sourceText: "Or money back guaranteed.",
          role: "objection handled",
          adaptedText: "",
        },
        { kind: "corner claim", style: "small regular sans, white, two lines", position: "upper left corner", sourceText: "Works in 43 seconds", role: "benefit", adaptedText: "" },
        { kind: "corner claim", style: "small regular sans, white, two lines", position: "upper right corner", sourceText: "8x stronger than the usual fix", role: "benefit", adaptedText: "" },
        { kind: "corner claim", style: "small regular sans, white, two lines", position: "lower left corner", sourceText: "Zero side effects", role: "objection handled", adaptedText: "" },
        { kind: "corner claim", style: "small regular sans, white, two lines", position: "lower right corner", sourceText: "Wake up ready", role: "benefit", adaptedText: "" },
        PRESS_BAR,
      ],
    },
  },
  {
    id: "builtin-sale-tape",
    kind: "static",
    builtin: true,
    name: "Bannière promo + ruban « Buy 1 Get 1 »",
    pitch: "Badge « Amazon's Choice », claim souligné, deux produits, ruban rouge diagonal, mention best seller.",
    tags: ["promo", "urgence", "bogo", "badge"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "tape", bg: "#ffffff", fg: "#111111", headline: "ROCK HARD MORNINGS", sub: "IN 72 HOURS OR EVERY CENT BACK", accent: "#d81e1e" },
    static: {
      aspect: "1:1",
      fontStyle:
        "heavy condensed uppercase grotesque in black for the headline with the first word underlined, a small bold sans in the badge, bold white uppercase on the red tape",
      layout:
        "Square ad on a clean white background. Top-left corner: a small dark-green rectangular badge with white text. Headline in two lines under it, centred, black, first word underlined; a smaller uppercase sub-line. Two copies of the product side by side in the middle, large, photographed at a three-quarter angle with a soft shadow. A red diagonal tape banner crosses the whole image over the products, repeating a short promo phrase in white uppercase. At the bottom, centred, a small marketplace wordmark and the words Best Seller in italic.",
      elements: [
        { kind: "badge", style: "small dark green rectangle, white bold sans text", position: "top left corner", sourceText: "Amazon's Choice", role: "social proof", adaptedText: "" },
        {
          kind: "headline",
          style: "heavy condensed uppercase, black, two lines, first word underlined",
          position: "top centre under the badge",
          sourceText: "ROCK HARD MORNINGS IN 72 HOURS OR EVERY CENT BACK",
          role: "hook",
          adaptedText: "",
        },
        {
          kind: "diagonal tape banner",
          style: "wide bright red ribbon crossing the image at about 12 degrees, white bold uppercase text repeated along it, slightly wrinkled like real tape",
          position: "across the middle, over the two products",
          sourceText: "BLACK FRIDAY SALE · BUY 1 GET 1 FREE ·",
          role: "urgency",
          adaptedText: "",
        },
        { kind: "footer claim", style: "small black text, the second word in bold italic", position: "bottom centre", sourceText: "Best Seller", role: "social proof", adaptedText: "" },
      ],
    },
  },
  {
    id: "builtin-announcement-letter",
    kind: "static",
    builtin: true,
    name: "Lettre d'annonce sur fond rouge",
    pitch: "Titre « We are saying goodbye », paragraphe d'explication, rangée de produits en bas.",
    tags: ["lettre", "texte", "rouge", "urgence"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "letter", bg: "#b31212", fg: "#ffffff", headline: "WE ARE SAYING GOODBYE", sub: "Prices are going up soon.", accent: "#ffd4d4" },
    static: {
      aspect: "1:1",
      fontStyle: "bold uppercase grotesque for the headline, small regular sans for the body copy, all white on deep red",
      layout:
        "Square ad on a flat deep red background. A two-line bold uppercase headline at the top, centred. Under it, a short body paragraph of three or four sentences in small white text, centred, like a letter from the brand. The bottom third shows four copies of the product in a row, close together, cropped at the lower edge, photographed at a three-quarter angle.",
      elements: [
        { kind: "headline", style: "bold uppercase grotesque, white, two lines", position: "top centre", sourceText: "WE ARE SAYING GOODBYE", role: "hook", adaptedText: "" },
        {
          kind: "body paragraph",
          style: "small regular sans, white, centred, four short sentences",
          position: "middle, under the headline",
          sourceText:
            "We've been holding back on major discounts for as long as we could. But with rising demand and limited stock this season, it's now unavoidable. Prices are going up soon. Now is your last chance to lock in 40% OFF before prices increase forever.",
          role: "urgency",
          adaptedText: "",
        },
      ],
    },
  },
  {
    id: "builtin-cartoon-reaction",
    kind: "static",
    builtin: true,
    name: "Réaction cartoon + claim souligné",
    pitch: "Produit géant sur fond violet, personnage illustré choqué, phrase avec mot-clé souligné.",
    tags: ["cartoon", "humour", "violet", "claim"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "cartoon", bg: "#5b2fd6", fg: "#ffffff", headline: "YOUR WIFE WILL NOTICE", sub: "In 72 hours. Or Get Your Money Back.", accent: "#ffd166" },
    static: {
      aspect: "4:5",
      fontStyle: "extra-bold uppercase grotesque with the key phrase underlined, a small regular sans for the sub-line, all white on a saturated purple",
      layout:
        "Portrait ad on a saturated purple background. The product fills the upper two-thirds, photographed large at a three-quarter angle. Bottom-left: a three-line bold uppercase headline with the last phrase underlined, and a small sub-line under it. Bottom-right: a flat-style cartoon illustration of a person with wide eyes and hands on their cheeks, shocked, drawn in a clean vector style with bold outlines, only the head and shoulders visible.",
      elements: [
        { kind: "headline", style: "extra-bold uppercase grotesque, white, three lines, final phrase underlined", position: "bottom left", sourceText: "YOUR WIFE WILL NOTICE YOUR WOOD QUALITY", role: "hook", adaptedText: "" },
        { kind: "subheadline", style: "small regular sans, white", position: "under the headline, bottom left", sourceText: "In 72 hours. Or Get Your Money Back.", role: "objection handled", adaptedText: "" },
        {
          kind: "cartoon character",
          style: "flat vector illustration, bold outlines, wide eyes, open mouth, hands on cheeks, shocked expression, only head and shoulders",
          position: "bottom right corner, overlapping the lower edge",
          sourceText: "",
          role: "hook",
          adaptedText: "",
        },
      ],
    },
  },
  {
    id: "builtin-bed-scene",
    kind: "static",
    builtin: true,
    name: "Scène intime + emoji",
    pitch: "Produit posé sur un lit, titre suggestif avec emoji, sous-titre, barre de presse.",
    tags: ["lifestyle", "suggestif", "emoji", "presse"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "bed", bg: "#2a2622", fg: "#ffffff", headline: "SHE'LL NEED NEW SHEETS", sub: "Energy that lasts all night", accent: "#c9a97a" },
    static: {
      aspect: "1:1",
      fontStyle: "bold uppercase grotesque for the headline with one word in a lighter weight, small sans sub-line, white with a soft drop shadow",
      layout:
        "Square lifestyle photograph: a neatly made bed in warm evening light, wooden headboard, cream sheets, a bedside lamp softly glowing. Two products lie on the sheets in the lower half, sharp, at a three-quarter angle. Headline in two lines at the top, centred, with a single emoji at the end of the second line; a small sub-line under it. Thin rule and press wordmarks at the very bottom.",
      elements: [
        { kind: "headline", style: "bold uppercase grotesque, white with soft shadow, two lines, ends with a single emoji", position: "top centre", sourceText: "SHE'LL NEED NEW SHEETS 🍆", role: "hook", adaptedText: "" },
        { kind: "subheadline", style: "small sans, white", position: "under the headline", sourceText: "Magnetic energy that lasts all night", role: "benefit", adaptedText: "" },
        PRESS_BAR,
      ],
    },
  },
  {
    id: "builtin-serif-two-columns",
    kind: "static",
    builtin: true,
    name: "Titre serif + deux colonnes d'icônes",
    pitch: "« From Basic to Alpha » en serif italique, produit au centre, bénéfices en icônes des deux côtés.",
    tags: ["serif", "élégant", "icônes", "bleu"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "columns", bg: "#1a44c8", fg: "#ffffff", headline: "From Basic Dad", sub: "To Alpha Dad", accent: "#bcd0ff" },
    static: {
      aspect: "1:1",
      fontStyle: "an elegant high-contrast serif in italic for the headline, small bold sans for the icon labels and light sans for their sub-labels, all white on royal blue",
      layout:
        "Square ad on a royal blue background with a subtle radial glow behind the product. Two-line italic serif headline at the top, centred, with a small sub-line. The product floats in the centre, large. Two columns of benefits frame it — two on the left, three on the right — each with a small white round icon, a short bold label and a lighter one-line sub-label. Thin rule and press wordmarks at the bottom.",
      elements: [
        { kind: "headline", style: "high-contrast italic serif, white, two lines", position: "top centre", sourceText: "From Basic Dad To Alpha Dad", role: "hook", adaptedText: "" },
        { kind: "subheadline", style: "small light sans, white", position: "under the headline", sourceText: "Or get your money back.", role: "objection handled", adaptedText: "" },
        { kind: "icon benefit", style: "small white circular line icon, bold label, light sub-label", position: "left column, upper", sourceText: "No Pills — no side effects", role: "objection handled", adaptedText: "" },
        { kind: "icon benefit", style: "small white circular line icon, bold label, light sub-label", position: "left column, lower", sourceText: "100% natural power", role: "benefit", adaptedText: "" },
        { kind: "icon benefit", style: "small white circular line icon, bold label, light sub-label", position: "right column, upper", sourceText: "Melts fat", role: "benefit", adaptedText: "" },
        { kind: "icon benefit", style: "small white circular line icon, bold label, light sub-label", position: "right column, middle", sourceText: "Brings back energy", role: "benefit", adaptedText: "" },
        { kind: "icon benefit", style: "small white circular line icon, bold label, light sub-label", position: "right column, lower", sourceText: "Boosts desire", role: "benefit", adaptedText: "" },
        PRESS_BAR,
      ],
    },
  },
  {
    id: "builtin-wall-reveal",
    kind: "static",
    builtin: true,
    name: "Mur cassé + checklist de bénéfices",
    pitch: "Titre « Wear this to… », quatre bénéfices en ligne, modèle qui traverse un mur, produit à côté.",
    tags: ["impact", "fitness", "checklist", "blanc"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "wall", bg: "#f4f4f4", fg: "#111111", headline: "WEAR THIS TO", sub: "FIX YOUR BALLS", accent: "#111111" },
    static: {
      aspect: "1:1",
      fontStyle: "heavy uppercase grotesque in black for the headline, small bold uppercase for the checklist, black on a white brick wall",
      layout:
        "Square ad on a white painted brick wall. Two-line bold uppercase headline at the top, centred. Under it, a single row of four short benefits in small bold uppercase, evenly spaced. The middle shows the wall physically breaking open: a muscular person bursts through the bricks on the left, photoreal, debris flying, while the product floats large on the right half against the wall. Thin rule and press wordmarks at the bottom.",
      elements: [
        { kind: "headline", style: "heavy uppercase grotesque, black, two lines", position: "top centre", sourceText: "WEAR THIS TO FIX YOUR BALLS", role: "hook", adaptedText: "" },
        { kind: "benefit row", style: "four short bold uppercase phrases in one line, black, evenly spaced", position: "under the headline", sourceText: "DAD BOD DISAPPEAR · ENERGY RESTORED · MORNING WOOD LIKE 15 · MELT MAN BOOBS", role: "benefit", adaptedText: "" },
        { kind: "photo element", style: "photoreal muscular person bursting through the brick wall, debris flying, dramatic light", position: "left half, middle", sourceText: "", role: "hook", adaptedText: "" },
        PRESS_BAR,
      ],
    },
  },
  {
    id: "builtin-body-overlay",
    kind: "static",
    builtin: true,
    name: "Photo corps + titre script + flèches",
    pitch: "Photo lifestyle du corps, produit incrusté, titre en script, quatre bénéfices fléchés, presse.",
    tags: ["lifestyle", "script", "bénéfices", "sensuel"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "body", bg: "#3a2a22", fg: "#ffffff", headline: "One Round To Unstoppable", sub: "Without pills or needles. Money back guaranteed.", accent: "#e8c9a8" },
    static: {
      aspect: "4:5",
      fontStyle: "an elegant script or italic serif for the headline, small light sans for the sub-line, bold condensed uppercase for the callouts, all white with a subtle shadow over the photo",
      layout:
        "Portrait lifestyle photograph, warm skin tones and soft light, a close crop of a body from the waist to the thighs, no face visible. The product is composited large in the centre of the frame, sharp, floating in front of the body. Headline in an elegant script at the top with a small sub-line. Four benefit callouts around the product with thin hand-drawn arrows. Press wordmarks along the bottom edge.",
      elements: [
        { kind: "headline", style: "elegant script or italic serif, white, one or two lines", position: "top centre", sourceText: "One Round To Unstoppable", role: "hook", adaptedText: "" },
        { kind: "subheadline", style: "small light sans, white", position: "under the headline", sourceText: "Without pills & needles. Money Back Guaranteed.", role: "objection handled", adaptedText: "" },
        callout("upper left of the product", "BURNS OFF BEER BELLY", "curving down-right"),
        callout("lower left of the product", "BOOSTS DESIRE", "curving up-right"),
        callout("upper right of the product", "MELTS MAN BOOBS", "curving down-left"),
        callout("lower right of the product", "REDUCES JOINT PAIN", "curving up-left"),
        PRESS_BAR,
      ],
    },
  },
  {
    id: "builtin-before-after-app",
    kind: "static",
    builtin: true,
    referencePoster: "606837069_1585605106020656_2559893013482453444_n.jpg",
    name: "Avant / après + promesse datée",
    pitch: "Le même visage en deux panneaux, titre confession, promesse en 1, 2, 4 semaines, mention gratuite. Pour une app ou un programme.",
    tags: ["avant-après", "app", "programme", "portrait"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "statement", bg: "#1f1f1f", fg: "#ffffff", headline: "IT DIDN'T WORK UNTIL I DID IT RIGHT", sub: "In a week, you'll start to feel it", accent: "#cfcfcf" },
    static: {
      aspect: "4:5",
      fontStyle: "bold uppercase grotesque for the headline, regular sans for the timeline lines with one emoji each, medium uppercase for the offer line; all white on a near-black band",
      layout:
        "Portrait ad in two parts. Top 55%: two photographs side by side of the SAME person, same framing, same neutral background, same clothes — left the 'before' (tired, sagging, no smile), right the 'after' (lifted, bright, gentle smile). Thin gap between the panels. Bottom 45%: a near-black band with a three-line bold uppercase headline, then three short timeline lines each ending with an emoji, then a two-line uppercase offer. Tiny vertical disclaimer along the right edge.",
      elements: [
        { kind: "before-after pair", style: "two photoreal portraits of the same person, identical framing and background, subtle realistic difference, no labels", position: "top half, side by side", sourceText: "", role: "hook", adaptedText: "" },
        { kind: "headline", style: "bold uppercase grotesque, white, three lines", position: "top of the dark band, left aligned", sourceText: "FACE YOGA DIDN'T WORK FOR ME UNTIL I STARTED DOING IT RIGHT", role: "hook", adaptedText: "" },
        { kind: "timeline line", style: "regular sans, white, one emoji at the end", position: "dark band, first line", sourceText: "In a week, you'll start to feel it 🥰", role: "benefit", adaptedText: "" },
        { kind: "timeline line", style: "regular sans, white, one emoji at the end", position: "dark band, second line", sourceText: "In two weeks, you'll start to see it 👀", role: "benefit", adaptedText: "" },
        { kind: "timeline line", style: "regular sans, white, one emoji at the end", position: "dark band, third line", sourceText: "In four weeks, you'll have a lifted face 😊", role: "benefit", adaptedText: "" },
        { kind: "offer line", style: "medium uppercase sans, white, two lines", position: "bottom of the dark band", sourceText: "ANTI-AGING FACE YOGA IS NOW FOR FREE", role: "urgency", adaptedText: "" },
        { kind: "disclaimer", style: "tiny grey text rotated 90 degrees", position: "right edge of the dark band", sourceText: "Results may vary due to personal features", role: "objection handled", adaptedText: "" },
      ],
    },
  },
  {
    id: "builtin-before-after-clean",
    kind: "static",
    builtin: true,
    referencePoster: "Capture d'écran 2026-09-10 190019.png",
    name: "Avant / après épurée « You now / Your potential »",
    pitch: "Fond blanc, titre fin en deux lignes, deux portraits côte à côte avec une flèche, étiquettes en bas. Pour un site ou un service.",
    tags: ["avant-après", "épuré", "service", "premium"],
    createdAt: "2026-09-11T00:00:00.000Z",
    preview: { layout: "statement", bg: "#ffffff", fg: "#233137", headline: "Bespoke Facial Protocol", sub: "No Surgery", accent: "#9aaeb5" },
    static: {
      aspect: "9:16",
      fontStyle: "light thin grotesque for the first headline line, regular weight for the second, tiny uppercase mono caption; charcoal text on white",
      layout:
        "Tall vertical ad on a pure white background. Small logo mark top left. Two-line headline in a thin elegant grotesque, upper third, left aligned: first line light, second line regular. A tiny uppercase mono caption under it. The lower half is a wide photo strip on a pale grey-blue background: two half-body portraits of the SAME person side by side, same pose and framing, left 'before' and right 'after' with a subtle, believable improvement; a small white circular arrow button between them; a small rounded label under each portrait.",
      elements: [
        { kind: "headline", style: "thin elegant grotesque, two lines, first line lighter, charcoal", position: "upper third, left", sourceText: "Bespoke Facial Protocol No Surgery", role: "hook", adaptedText: "" },
        { kind: "caption", style: "tiny uppercase monospace, grey", position: "under the headline", sourceText: "RENDERING · FOR ILLUSTRATIVE PURPOSES ONLY", role: "objection handled", adaptedText: "" },
        { kind: "before-after pair", style: "two photoreal half-body portraits of the same person, identical framing, subtle improvement, pale grey-blue background, small white round arrow between them", position: "lower half, full width", sourceText: "", role: "hook", adaptedText: "" },
        { kind: "label", style: "small rounded pill, translucent white, small text", position: "under the left portrait", sourceText: "You now", role: "benefit", adaptedText: "" },
        { kind: "label", style: "small rounded pill, translucent white, small text", position: "under the right portrait", sourceText: "Your potential", role: "benefit", adaptedText: "" },
      ],
    },
  },
];
