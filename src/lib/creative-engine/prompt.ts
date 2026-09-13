import type { CreativeType } from "@/lib/studio/creative-types";
import type { Ratio } from "@/lib/studio/ratios";
import { VARIATION_STRATEGIES, familyById, isDigitalClass, type CreativeSpec, type ProductContext, type ReferenceStrength } from "@/lib/creative-engine/types";

/**
 * Le prompt de production d'une créa, assemblé depuis sa fiche planifiée.
 * L'ordre est celui du poids : le produit d'abord (ce qui ne bouge pas),
 * puis ce qui domine (emphase), la famille et sa mise en page, l'angle et
 * son accroche, le sujet, la visibilité du produit, la variante, la référence,
 * les consignes, le réalisme et les interdits.
 */

const REFERENCE_BLOCKS: Record<ReferenceStrength, string> = {
  low: "REFERENCE CREATIVE — LOW strength: the attached reference is loose inspiration only. Borrow its general mood and energy; invent your own composition. Never copy its brand, logo, product or claims.",
  medium: "REFERENCE CREATIVE — MEDIUM strength: keep the reference's advertising STRUCTURE — headline position, product placement, the kind of callouts, badges or before/after device — but rebuild every element for THIS product. Never copy its brand, logo, product or claims.",
  high: "REFERENCE CREATIVE — HIGH strength: follow the reference's composition and layout closely — framing, subject position, headline position and size, callout style, colour blocking, badge placement — while replacing ALL content (product, people, text, claims, branded colours) with THIS product's. Never copy its brand, logo, product or claims.",
};

const REALISM =
  "REALISM: highly realistic social-media advertising. Real human proportions, natural skin with pores, believable hair and hands, natural expressions, authentic clothing, realistic lighting. For UGC: iPhone 15 candid quality, imperfect but attractive framing, native TikTok / Instagram / Meta feeling. Product photos: preserve the real product exactly, never invent features, never change the packaging.";

/**
 * UNE image = UNE pub. Dit en tête de prompt, redit dans les interdits : le
 * modèle avait tendance à exprimer la diversité du lot À L'INTÉRIEUR d'une
 * image (planche de plusieurs pubs, collage, storyboard). La diversité vit
 * entre les créas du lot, jamais dans une image.
 */
export const SINGLE_CREATIVE_RULE =
  "ONE SINGLE AD: create ONE single static ad creative. This image is exactly one standalone paid-social ad — one hook, one angle, one composition, one dominant visual hierarchy, one ad mechanism. " +
  "Do not create a collage, grid, contact sheet, moodboard, storyboard, concept board, pitch board, batch preview, or multiple ads in one image. No several mini-posters, no set of ad cards, no separate frames showing different ads. " +
  "A single coherent ad structure is fine (one before/after split, one do/don't comparison, one timeline, one pyramid, one checklist, one annotated diagram) as long as it reads as ONE finished ad. The output must be one standalone ad only.";

const SINGLE_CREATIVE_NEGATIVE =
  "NEGATIVE — MULTIPLE CREATIVES: do not create multiple posters in one image; do not create a contact sheet; do not create a collage of several ads; do not create a concept board or moodboard; do not create several separate frames showing different ads; do not make this look like a collection of creatives or a set of variations. This must be one single finished ad, edge to edge.";

/**
 * Formulations qui, dans un prompt, font produire une planche de plusieurs pubs.
 * Elles sont traquées dans les consignes libres et la mise en page ; les
 * structures légitimes d'une seule pub (split avant/après, grille de bénéfices
 * sous un visuel, tableau) ne sont pas dans cette liste.
 */
const MULTI_CREATIVE_TERMS = [
  "contact sheet",
  "collage",
  "mosaic",
  "moodboard",
  "mood board",
  "concept board",
  "pitch board",
  "storyboard",
  "multiple ads",
  "several ads",
  "set of ads",
  "series of ads",
  "different ads",
  "ad concepts",
  "multiple creatives",
  "several creatives",
  "multiple posters",
  "several posters",
  "variations side by side",
  "show the variations",
  "all variations",
  "batch preview",
  "concept sheet",
  "sheet of",
];

/** Les formulations à risque trouvées dans un texte, pour le contrôle qualité. */
export function multiCreativeRisks(text: string) {
  const lower = text.toLowerCase();
  return MULTI_CREATIVE_TERMS.filter((term) => lower.includes(term));
}

const NEGATIVE =
  "NEGATIVE: no generic branding, no vague motivational lines, no excessive text, no artistic layouts that hide the argument, no corporate stock-photo feel, no watermark, no fake reviews with names or star ratings presented as verified, no clinical claims, no guaranteed results, no invented product functions, no competitor logos. All text real, correctly spelled English, professionally kerned.";

function list(values: string[] | undefined, max = 4) {
  return (values ?? []).filter(Boolean).slice(0, max).join("; ");
}

/** Le bloc produit : les faits de la page, rien d'inventé. */
export function productBlock(context: ProductContext) {
  const a = context.analysis;
  return [
    `PRODUCT: ${context.name}${a?.brand ? ` by ${a.brand}` : ""}${a?.productType ? ` — ${a.productType}` : ""}${a?.category ? ` (${a.category})` : ""}.`,
    a?.price ? `Price: ${a.price}${a.comparePrice ? `, compare-at ${a.comparePrice}` : ""}.` : "",
    a?.offer ? `Offer: ${a.offer}.` : "",
    a?.targetCustomer ? `Target customer: ${a.targetCustomer}${a.gender ? `, ${a.gender}` : ""}${a.ageRange ? `, ${a.ageRange}` : ""}.` : "",
    a?.mainProblem ? `Main problem solved: ${a.mainProblem}.` : "",
    a?.benefits?.length ? `Strongest benefits: ${list(a.benefits)}.` : "",
    a?.desires?.length ? `Desires: ${list(a.desires, 3)}.` : "",
    a?.objections?.length ? `Objections to handle: ${list(a.objections, 3)}.` : "",
    a?.mechanism ? `Mechanism: ${a.mechanism}.` : "",
    a?.transformation ? `Transformation promised: ${a.transformation}.` : "",
    a?.differentiation ? `Differentiation: ${a.differentiation}.` : "",
    a?.guarantee ? `Guarantee: ${a.guarantee}.` : "",
    a?.tone ? `Brand tone: ${a.tone}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Ce que le client achète vraiment, dit au modèle avant tout le reste. */
function emphasisBlock(spec: CreativeSpec, digital: boolean) {
  if (spec.emphasis === "outcome") {
    return (
      "EMPHASIS — OUTCOME FIRST: the RESULT dominates this creative. The customer is buying the transformation, the relief, the way people react — not the item. " +
      "The product can be absent, tiny, or a small branded element near the call to action. Sell the change." +
      (digital ? " This is a digital programme: nobody is buying a file." : "")
    );
  }
  if (spec.emphasis === "balanced") {
    return "EMPHASIS — BALANCED: the result and the product share the frame, roughly equal weight: a large result image plus a small-to-medium product element, a headline and a call to action.";
  }
  return "EMPHASIS — PRODUCT FIRST: the product is the hero — large, exact, beautifully shown, its features and design doing the selling, the result as support.";
}

/** Comment le produit apparaît, et pour un digital, sous quelle forme. */
function visibilityBlock(spec: CreativeSpec, context: ProductContext, digital: boolean) {
  const photos = context.imageUrls.length > 0;
  const level: Record<CreativeSpec["productVisibility"], string> = {
    none: "PRODUCT VISIBILITY — NONE: do not show the product at all. Brand presence is limited to a small footer line with the brand name and a short call to action.",
    subtle: "PRODUCT VISIBILITY — SUBTLE: the product appears once, small — a small logo or brand line, a small badge, a small element near the call to action. The headline sells desire, not the product name.",
    medium: "PRODUCT VISIBILITY — MEDIUM: the product is clearly present but secondary, about a fifth of the frame, next to or under the main image.",
    hero: "PRODUCT VISIBILITY — HERO: the product is the main subject and fills a large part of the frame.",
  };
  const fidelity = photos ? " When the product is shown, it must match the reference product photos exactly — same shape, colours, materials, labels, packaging." : " No product photo is provided: if shown, show it only as described, plainly, without inventing branding.";
  const digitalRule = digital
    ? spec.physicalProductAllowed
      ? " DIGITAL PRODUCT: a physical mockup (a box, a booklet, a card set) is allowed if it serves the layout, but the product is delivered online — never claim it ships."
      : " DIGITAL PRODUCT — NO PHYSICAL OBJECT: never turn it into a hardcover, paperback, box, package, printed booklet, or an item someone holds. When it needs to be visible, show it as a phone or tablet screen, a laptop, a dashboard, a checklist, a protocol interface, a roadmap, a small UI card, or a subtle cover preview inside a screen."
    : "";
  return level[spec.productVisibility] + fidelity + digitalRule;
}

function brandBlock(spec: CreativeSpec, context: ProductContext) {
  const brand = context.analysis?.brand || context.store;
  if (spec.emphasis === "product") {
    return `BRAND: "${brand}" and the product name may be prominent on this creative.`;
  }
  return `BRAND: do NOT put "${brand}" or the product name in large text. The big text is the hook. The brand appears small — a footer line such as "${brand} · Start today →", a small label or a small logo — once.`;
}

function subjectBlock(spec: CreativeSpec) {
  if (!spec.subject) return "";
  const who = `${spec.subject.gender === "man" ? "a man" : "a woman"} aged ${spec.subject.ageRange}`;
  return `SUBJECT: ${who}${spec.subject.notes ? `, ${spec.subject.notes}` : ""}. A real, believable person, natural skin, not a model unless the brand tone demands it. Only this person in frame unless the layout says otherwise.`;
}

export type ComposeInput = {
  context: ProductContext;
  spec: CreativeSpec;
  preset: CreativeType;
  hasReference: boolean;
  referenceStrength: ReferenceStrength;
  instructions: string;
  ratio: Ratio;
};

export function composeCreativePrompt(input: ComposeInput): string {
  const { spec, context } = input;
  const family = familyById(spec.familyId);
  const strategy = VARIATION_STRATEGIES.find((item) => item.id === spec.strategy) ?? VARIATION_STRATEGIES[0];
  const digital = isDigitalClass(context.analysis?.productClass);
  const ratioWords: Record<string, string> = { "3:4": "vertical 3:4", "1:1": "square 1:1", "9:16": "tall vertical 9:16", "4:5": "vertical 4:5", "16:9": "wide 16:9" };
  const angle = [...context.suggestedAngles, ...context.customAngles].find((item) => item.id === spec.angleId);

  const single = spec.singleCreativeOnly !== false;
  /* Contrôle qualité : une consigne libre ou une mise en page qui parle de
     planche ou de collage est explicitement reprise, sans réduire l'ambition
     de la pub elle-même. */
  const risks = single ? multiCreativeRisks(`${input.instructions} ${spec.layout} ${spec.referenceStrategy}`) : [];
  const simplify = risks.length
    ? `SIMPLIFY: some wording above (${risks.join(", ")}) could be read as a request for several ads in one image. It is not. Interpret it as ONE ad and ignore any collage, board or multi-ad reading.`
    : "";

  return [
    `Photorealistic direct-response ad creative, ${ratioWords[input.ratio] ?? input.ratio} frame, for paid social.`,
    single ? SINGLE_CREATIVE_RULE : "",
    productBlock(context),
    emphasisBlock(spec, digital),
    `VISUAL MECHANISM — ${family?.label ?? spec.familyId}: ${family?.mechanism ?? ""}`,
    `LAYOUT: ${spec.layout}.${single ? " This layout is the structure of ONE ad, filling the whole frame." : ""}`,
    `ANGLE — ${spec.angleName}: ${angle?.why ?? ""} Every element serves THIS angle and no other.`,
    `HEADLINE, exact text, the biggest text on the creative: "${spec.hook.replace(/"/g, "'")}". One short supporting line at most, then a small call to action where the format allows it.`,
    `STYLE — ${input.preset.name}: ${input.preset.promptInstructions}`,
    subjectBlock(spec),
    visibilityBlock(spec, context, digital),
    brandBlock(spec, context),
    `${strategy.prompt} This is execution ${spec.variation} of this angle, a complete advertisement on its own; its sibling executions are separate images and never appear in this frame.`,
    input.hasReference ? `${REFERENCE_BLOCKS[input.referenceStrength]} For this creative: ${spec.referenceStrategy}.` : "",
    input.instructions.trim() ? `USER INSTRUCTIONS (priority over everything above except product truth): ${input.instructions.trim()}` : "",
    simplify,
    "STRUCTURE: the viewer must read PROBLEM → DESIRE → RESULT → ACTION within two seconds. Scroll-stopping, instantly understood, believable, a clear reason to act.",
    REALISM,
    NEGATIVE,
    single ? SINGLE_CREATIVE_NEGATIVE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
