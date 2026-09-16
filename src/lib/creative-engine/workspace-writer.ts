import { askHermesText, askHermesVision, hermesAnalysisAvailable, hermesCannotSee } from "@/lib/creative-engine/hermes-analysis";
import { kieClaude } from "@/lib/studio/kie";
import type { CompetitorInspiration } from "@/lib/brandsearch/types";
import type { ProductContext } from "./types";
import { guessProductReference, MAX_PLANNED_CREATIVES, parseLenientJson, PlanValidationError, validatePlan, type CreativePlan } from "./workspace-plan";

/**
 * Le planificateur de brief : un brief en langage naturel (« Create 5 ultra
 * realistic static ads… ») devient N concepts distincts, chacun avec son
 * prompt de génération, en JSON strict. Une seule requête Hermes, qui reçoit
 * le brief, le produit actif s'il y en a un, et la créa d'inspiration jointe
 * comme image (URL hébergée) : c'est Hermes qui la regarde et l'analyse.
 * Claude via Kie n'est qu'un secours pour les briefs texte seul. Rien n'est
 * généré ici, et un plan illisible est une erreur, jamais un prompt unique
 * fabriqué en douce à partir du brief.
 */

/** Ce qu'on sait du produit : une fiche du moteur (avec analyse), une fiche lue en prompt libre, ou rien. */
export type PlanProduct = Pick<ProductContext, "name"> & Partial<Pick<ProductContext, "id" | "store" | "url" | "analysis">> & { price?: string };

export type PlanInput = {
  brief: string;
  count: number;
  ratio: string;
  product: PlanProduct | null;
  /** Une vraie photo du produit existe (référence principale) et peut partir au modèle image. */
  hasReference: boolean;
  /** auto : le planificateur décide par créa ; always : toutes ; never : aucune (le produit reste le contexte commercial). */
  referenceMode?: "auto" | "always" | "never";
  /** Concepts déjà retenus, à éviter quand on réécrit une seule créa. */
  avoid?: string[];
  /** La créa d'inspiration, hébergée en https, jointe à la requête Hermes comme image. */
  referenceImageUrl?: string | null;
  /** Une créa était jointe (même si l'opérateur a choisi de planifier sans la faire lire). */
  referenceAttached?: boolean;
  /** Pubs concurrentes choisies par l'opérateur dans la galerie Brand Search, déjà regardées par Hermes : motifs et ADN, jamais leurs faits. */
  competitorInspiration?: CompetitorInspiration | null;
};

/** Ce qu'Hermes a vu sur l'inspiration, tel qu'il le rend dans le JSON du plan. */
export type ReferenceReading = { seen: boolean; summary: string; elements: string[]; competitorFacts: string[] };

export type PlanOutcome = CreativePlan & {
  engine: "hermes" | "claude";
  competitorInspiration: { domain: string; ads: number; patterns: number } | null;
  referenceAttached: boolean;
  referenceSeen: boolean;
  referenceSummary: string | null;
  referenceElements: string[];
  competitorFacts: string[];
};

/** Le modèle derrière Hermes ne voit pas les images : l'opérateur décide s'il continue en texte seul. */
export class VisionUnavailableError extends Error {}

/** Mots trop génériques pour compter comme une fuite (« product », « ad »…), et absences (« no price visible »). */
const GENERIC_FACT = /^(product|ad|ads|creative|image|photo|the|a|an|new|best|now|today|free|premium|quality)$/i;
const ABSENCE_FACT = /^(no|none|not|without)\b/i;

/**
 * Les faits concurrents qui comptent vraiment : ni génériques, ni absences,
 * ni ce que notre propre produit dit aussi (« Beginner » sur les deux packs
 * n'est pas une fuite). `ownText` : la fiche du produit actif à plat.
 */
export function relevantCompetitorFacts(competitorFacts: string[], ownText = ""): string[] {
  const own = ownText.toLowerCase();
  return competitorFacts
    .map((fact) => fact.trim())
    .filter((fact) => fact.length >= 3 && !GENERIC_FACT.test(fact) && !ABSENCE_FACT.test(fact) && fact.split(/\s+/).length <= 8)
    .filter((fact) => !own || !own.includes(fact.toLowerCase()));
}

/** Les prompts qui reprennent un fait du concurrent : index de créa → faits retrouvés. */
export function findCompetitorLeaks(prompts: string[], competitorFacts: string[], ownText = ""): Array<{ index: number; facts: string[] }> {
  const facts = relevantCompetitorFacts(competitorFacts, ownText);
  return prompts
    .map((prompt, position) => {
      const lower = prompt.toLowerCase();
      return { index: position + 1, facts: facts.filter((fact) => lower.includes(fact.toLowerCase())) };
    })
    .filter((entry) => entry.facts.length > 0);
}

function ownProductText(product: PlanProduct | null): string {
  return product ? JSON.stringify([product.name, product.store, product.url, product.analysis]) : "";
}

const ANALYSIS_POINTS =
  "creative type, marketing angle, hook mechanism, layout and composition, visual hierarchy, before/after structure, subject positioning, typography hierarchy, badges, arrows, icons, CTA, price blocks, proof elements, photography style, colours, overall vibe";

function creativeReferenceBlock(input: PlanInput): string {
  if (input.referenceImageUrl) {
    const withProduct = input.product
      ? `
SOURCE OF TRUTH, in this order: 1) the active product sheet above, 2) its attached product reference photo, 3) this inspiration image — for creative form only.
CREATIVE TRANSFER, not product swap: understand why this creative works, then rebuild the same logic for the ACTIVE PRODUCT above. Keep its marketing angle, hook mechanism, layout, composition, visual hierarchy, type of proof, visual rhythm, photography and annotation style. Replace EVERY product-specific element with the active product's real facts: its name, brand, packaging, mechanism, benefits, origin, guarantee, certifications, statistics. Never reuse the competitor's product, brand, logo, packaging, claims, guarantees, country of origin, materials, certifications, statistics, studies, icons or factual copy. If the active product has no equivalent for an element (e.g. a "Made in …" badge with no known origin), REMOVE that element instead of inventing one.
Start every "prompt" with this exact sentence: "Follow the inspiration creative's composition, hierarchy and style, with the active product only."`
      : `
It is the PRIMARY creative inspiration: rebuild its structure, angle, hook mechanism, composition and style for the subject of the brief, keeping the same kind of subject unless the brief says otherwise, and vary each creative as the brief asks.
Start every "prompt" with this exact sentence: "Follow the attached inspiration creative's composition, hierarchy and style."`;
    return `
CREATIVE INSPIRATION: an ad creative is ATTACHED TO THIS MESSAGE as an image (${input.referenceImageUrl}). Look at it before planning and analyse: ${ANALYSIS_POINTS}. Report that analysis in the "reference" object of the JSON: "seen": true; "summary": 60 to 120 words of what the image actually shows and how it works; "elements": the concrete visual elements you reuse from it (short phrases, 3 to 12); "competitorFacts": ONLY the product- or brand-specific wording written or shown on it — brand and product names, slogans, claims, guarantees, country of origin, named materials, certifications, statistics, prices, badge wording — as written (never layout, colours, style, object shapes, nor absences).
If you truly cannot see the image, answer with "reference": {"seen": false, "summary": "<why>", "elements": [], "competitorFacts": []} and plan from the brief alone. Never describe or invent what you did not see.${withProduct}`;
  }
  if (input.referenceAttached) {
    return `
CREATIVE INSPIRATION: the operator attached an inspiration image, but it is not readable in this request. Plan from the brief alone and set "reference": {"seen": false, "summary": "not provided to the planner", "elements": [], "competitorFacts": []}. Do not pretend to have seen it.`;
  }
  return "";
}

function competitorInspirationBlock(input: PlanInput): string {
  const inspiration = input.competitorInspiration;
  if (!inspiration || !inspiration.creatives.length) return "";
  const forbidden = relevantCompetitorFacts(inspiration.creatives.flatMap((creative) => creative.competitorFacts), ownProductText(input.product));
  const patterns = inspiration.patterns.length
    ? inspiration.patterns.map((pattern, index) => `  ${String.fromCharCode(65 + index)}. ${pattern.name} — ${pattern.description}${pattern.mechanism ? ` Mechanism: ${pattern.mechanism}` : ""} (${pattern.adIds.length} ad${pattern.adIds.length > 1 ? "s" : ""})`).join("\n")
    : "  (no cluster: use the per-ad DNA below)";
  const ads = inspiration.creatives
    .map((creative) => `  - ad ${creative.id}: ${creative.archetype || "?"} — angle: ${creative.angle}; hook mechanism: ${creative.hookMechanism}; layout: ${creative.layout}; elements: ${creative.elements.join(", ") || "—"}; proof: ${creative.proof || "—"}${creative.headline ? `; headline as written: ${JSON.stringify(creative.headline)}` : ""}`)
    .join("\n");
  const target = input.product ? "the ACTIVE PRODUCT above" : "the subject of the brief";
  const sentence = input.product ? "Follow the selected competitor patterns' composition, hierarchy and style, with the active product only." : "Follow the selected competitor patterns' composition, hierarchy and style.";
  return `
COMPETITOR INSPIRATION (Brand Search · ${inspiration.domain} · ${inspiration.creatives.length} static ad${inspiration.creatives.length > 1 ? "s" : ""} selected by the operator and already analysed visually by you):
Recurring creative patterns:
${patterns}
Per-ad creative DNA:
${ads}
SOURCE OF TRUTH, in this order: 1) the active product sheet above, 2) its attached product reference photo, 3) these competitor ads — creative form only.
CREATIVE TRANSFER, not product swap: rebuild the patterns and mechanisms above for ${target}. Keep angle, hook mechanism, layout, composition, visual hierarchy, type of proof, direct-response structure, annotation and photography style. Replace EVERY product-specific element with the active product's real facts; never reuse the competitor's product, brand, logo, packaging, claims, guarantees, country of origin, materials, certifications, statistics, studies, exact claims or factual copy. If the active product has no equivalent for an element, REMOVE it instead of inventing one.${forbidden.length ? `\nCompetitor-specific wording seen on those ads, FORBIDDEN in every prompt: ${forbidden.map((fact) => `« ${fact} »`).join(", ")}.` : ""}
Distribute the requested creatives across the patterns unless the brief says otherwise, and name the pattern in "angle".
Start every "prompt" with this exact sentence: "${sentence}"`;
}

const SYSTEM =
  "You are the creative planner of the MSGate CRM Creative Engine. You turn an operator's brief into distinct static-ad concepts, each with a generation-ready image prompt. When an image is attached, look at it and analyse it yourself. Answer with the requested JSON object ONLY: no prose, no markdown fences. Read-only task: do not browse beyond the attached image, do not call tools that write or generate anything.";

export function planPrompt(input: PlanInput): string {
  const a = input.product?.analysis;
  const facts = input.product ? [
    `PRODUCT: ${input.product.name}${input.product.store ? ` by ${input.product.store}` : ""}${input.product.id ? ` (CRM id ${input.product.id})` : ""}${input.product.url ? ` — ${input.product.url}` : ""}${input.product.price ? ` — price ${input.product.price}` : ""}`,
    a?.productType || a?.category ? `- type: ${[a?.productType, a?.category ? `(${a.category})` : ""].filter(Boolean).join(" ")}` : "",
    a?.targetCustomer ? `- target customer: ${a.targetCustomer}` : "",
    a?.mainProblem ? `- main problem: ${a.mainProblem}` : "",
    a?.mechanism ? `- mechanism: ${a.mechanism}` : "",
    a?.benefits?.length ? `- benefits: ${a.benefits.slice(0, 4).join(" | ")}` : "",
    a?.features?.length ? `- physical description / visual points: ${a.features.slice(0, 5).join(" | ")}` : "",
    a?.transformation ? `- transformation: ${a.transformation}` : "",
    input.hasReference
      ? (input.referenceMode ?? "auto") === "never"
        ? "- a real photo of the product exists but will NOT be sent to the image model for this batch: the product is the commercial context, never shown physically; sell the outcome, the problem, the transformation, the mechanism"
        : (input.referenceMode ?? "auto") === "always"
          ? "- a real photo of the product is attached to EVERY creative as the visual source of truth: every prompt shows THIS exact product, never a redesigned or imagined one"
          : "- a real photo of the product exists and can be attached PER CREATIVE as the visual source of truth (see the product-reference rule below): when it is, the prompt shows THIS exact product, never a redesigned or imagined one"
      : "- no product photo is attached: describe the product consistently from the facts above",
  ]
    .filter(Boolean)
    .join("\n") : input.hasReference
      ? "NO PRODUCT SHEET: the brief describes the subject. Reference image(s) are attached at generation time as the visual source of truth: every prompt shows exactly what they show, never a redesigned or imagined version."
      : "NO PRODUCT SHEET: the brief is the only source. Describe the subject consistently across creatives.";
  const avoid = input.avoid?.length ? `\nAlready used concepts, do NOT repeat them: ${input.avoid.map((entry) => `« ${entry} »`).join(", ")}.` : "";
  const reference = creativeReferenceBlock(input) + competitorInspirationBlock(input);
  const referenceJson = input.referenceImageUrl || input.referenceAttached ? ', "reference": {"seen": true, "summary": "", "elements": [""], "competitorFacts": [""]}' : "";
  const mode = input.referenceMode ?? "auto";
  const perCreativeFlag = input.hasReference && input.product ? ', "useProductReference": true' : "";
  const referenceRule = input.hasReference && input.product
    ? mode === "never"
      ? "\n- PRODUCT REFERENCE: off for this batch. Do not show the physical product; set \"useProductReference\": false on every creative."
      : mode === "always"
        ? "\n- PRODUCT REFERENCE: on for this batch. Every creative shows the real product; set \"useProductReference\": true on every creative."
        : "\n- PRODUCT REFERENCE, decided per creative: the active product is the commercial context of every creative, but do not force the physical product into every image. A creative may sell the outcome, the transformation, the jawline, attractiveness, the problem, the scientific mechanism or a before/after without showing the product: set \"useProductReference\": false for those (before/after → off; result-focused → off unless the product is actually visible; scientific / anatomy explainer → off unless the product is explicitly part of the composition). Set \"useProductReference\": true only when seeing the real product materially improves the creative: product focus, packaging + benefits, product in hand, UGC showing the product. Never add the product at the bottom of an image or a packshot just because a reference exists; when it is off, the prompt must not describe the product's appearance."
    : "";
  return `Plan ${input.count} static ad creative${input.count > 1 ? "s" : ""} from the operator's brief. Each creative is ONE future image (never a collage or several ads in one image), format ${input.ratio}.

${facts}
${reference}
OPERATOR BRIEF:
"""
${input.brief.trim()}
"""

Rules:
- Follow the brief exactly for style, angle, ratio, product visibility and any distribution it asks for (e.g. « 3 before/after and 2 product-focused » means exactly that split, in that order).
- The ${input.count} creatives must be genuinely different: vary scene, subject, framing, camera angle, product placement, visual hook, composition, lighting, text hierarchy, proof mechanism and context of use, while keeping the requested style family and the same real product.
- Each "prompt" is complete and directly usable by an image model: subject, product placement and visibility, setting, lighting, camera or phone look, composition, on-image text only if the brief asks for it. 60 to 160 words. Plain English. No numbering, no reference to other creatives, no product-fidelity boilerplate (it is appended automatically).
- "angle" is the advertising angle in a few words, "concept" one sentence describing the image idea, "hook" the headline idea (empty string if the brief wants no text).
- Branding: never add a standalone logo, corner logo, watermark or branding block; branding exists only as it appears on the real product or packaging, unless the brief explicitly asks for a logo.${referenceRule}
- The brief may be in French, English or both: read it either way and write the prompts in English.${avoid}

Return ONLY this JSON:
{"count": ${input.count}, "ratio": "${input.ratio}", "format": "static", "creatives": [{"index": 1, "angle": "", "concept": "", "hook": "", "prompt": ""${perCreativeFlag}}]${referenceJson}}`;
}

/** La partie « reference » du JSON rendu par le planificateur, tolérante aux champs manquants. */
export function parseReferenceReading(raw: string): ReferenceReading | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = parseLenientJson<{ reference?: { seen?: unknown; summary?: unknown; elements?: unknown; competitorFacts?: unknown } }>(raw.slice(start, end + 1));
    const ref = parsed.reference;
    if (!ref || typeof ref !== "object") return null;
    const strings = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length >= 2).map((entry) => entry.trim().slice(0, 100)).slice(0, max) : []);
    return { seen: ref.seen === true, summary: typeof ref.summary === "string" ? ref.summary.trim().slice(0, 1600) : "", elements: strings(ref.elements, 12), competitorFacts: strings(ref.competitorFacts, 20) };
  } catch {
    return null;
  }
}

export class CompetitorLeakError extends Error {
  constructor(public leaks: Array<{ index: number; facts: string[] }>) {
    super(`le planificateur a repris des faits du concurrent (créa ${leaks.map((leak) => `${leak.index} : ${leak.facts.map((fact) => `« ${fact} »`).join(", ")}`).join(" ; ")})`);
  }
}

/** Un plan validé qui reprend un fait du concurrent est rejeté : le planificateur repasse une fois avec la liste des fuites, puis c'est une erreur. */
function checkLeaks(plan: CreativePlan, competitorFacts: string[], product: PlanProduct | null) {
  if (!product || !competitorFacts.length) return;
  const leaks = findCompetitorLeaks(plan.creatives.map((creative) => creative.prompt), competitorFacts, ownProductText(product));
  if (leaks.length) throw new CompetitorLeakError(leaks);
}

/** Le mode du lot tranche ; en auto, l'avis du planificateur, sinon une lecture du prompt. Sans photo produit, le champ n'existe pas. */
function applyReferenceMode(plan: CreativePlan, input: PlanInput): CreativePlan {
  if (!input.hasReference || !input.product) return { ...plan, creatives: plan.creatives.map((creative) => { const { useProductReference, ...rest } = creative; void useProductReference; return rest; }) };
  const mode = input.referenceMode ?? "auto";
  return {
    ...plan,
    creatives: plan.creatives.map((creative) => ({
      ...creative,
      useProductReference: mode === "always" ? true : mode === "never" ? false : creative.useProductReference ?? guessProductReference(creative.prompt, input.product?.name ?? ""),
    })),
  };
}

function outcome(rawPlan: CreativePlan, engine: "hermes" | "claude", input: PlanInput, reading: ReferenceReading | null): PlanOutcome {
  const plan = applyReferenceMode(rawPlan, input);
  const competitorFacts = input.competitorInspiration?.creatives.flatMap((creative) => creative.competitorFacts) ?? [];
  checkLeaks(plan, [...(reading?.competitorFacts ?? []), ...competitorFacts], input.product);
  return {
    ...plan,
    engine,
    competitorInspiration: input.competitorInspiration?.creatives.length ? { domain: input.competitorInspiration.domain, ads: input.competitorInspiration.creatives.length, patterns: input.competitorInspiration.patterns.length } : null,
    referenceAttached: Boolean(input.referenceAttached || input.referenceImageUrl),
    referenceSeen: Boolean(input.referenceImageUrl) && reading?.seen === true,
    referenceSummary: reading?.seen ? reading.summary || null : null,
    referenceElements: reading?.seen ? reading.elements : [],
    competitorFacts: relevantCompetitorFacts([...(reading?.seen ? reading.competitorFacts : []), ...competitorFacts], ownProductText(input.product)),
  };
}

async function planOnce(input: PlanInput, count: number, extraRule: string): Promise<PlanOutcome> {
  const prompt = planPrompt({ ...input, count }) + extraRule;
  const withImage = Boolean(input.referenceImageUrl);
  let hermesReason = hermesAnalysisAvailable() ? "" : "Hermes non configuré";
  if (!hermesReason) {
    try {
      const raw = withImage ? await askHermesVision(prompt, SYSTEM, [input.referenceImageUrl as string]) : await askHermesText(prompt, SYSTEM);
      const reading = parseReferenceReading(raw);
      if (withImage && (reading?.seen === false || (!reading && hermesCannotSee(raw)))) {
        throw new VisionUnavailableError(`Le modèle Hermes actuel ne voit pas les images${reading?.summary ? ` — ${reading.summary}` : ""}.`);
      }
      const plan = validatePlan(raw, count, input.ratio);
      if (withImage && !reading?.seen) throw new VisionUnavailableError("Hermes a planifié sans confirmer avoir vu l'image.");
      return outcome(plan, "hermes", input, reading);
    } catch (error) {
      if (error instanceof CompetitorLeakError || error instanceof VisionUnavailableError) throw error;
      hermesReason = error instanceof Error ? error.message : "Hermes indisponible";
    }
  }
  // Une image d'inspiration exige Hermes : pas de lecture par un autre œil en douce.
  if (withImage) throw new Error(`Planification impossible — Hermes : ${hermesReason} (l'image d'inspiration ne peut être lue que par Hermes)`);
  try {
    const raw = await kieClaude(prompt, 4000);
    return outcome(validatePlan(raw, count, input.ratio), "claude", input, null);
  } catch (error) {
    if (error instanceof CompetitorLeakError) throw error;
    throw new Error(`Planification impossible — Hermes : ${hermesReason} ; Kie : ${error instanceof Error ? error.message : "?"}`);
  }
}

export async function planWorkspaceBatch(input: PlanInput): Promise<PlanOutcome> {
  const count = Math.min(MAX_PLANNED_CREATIVES, Math.max(1, Math.round(input.count)));
  try {
    return await planOnce(input, count, "");
  } catch (error) {
    if (error instanceof CompetitorLeakError) {
      const facts = [...new Set(error.leaks.flatMap((leak) => leak.facts))];
      const rule = `\n\nPREVIOUS ATTEMPT REJECTED: these competitor elements appeared in the prompts and must not appear in any form: ${facts.map((fact) => `« ${fact} »`).join(", ")}. Use the active product's own facts or drop the element.`;
      return planOnce(input, count, rule);
    }
    // Un plan mal formé (prose au lieu de JSON, JSON cassé) vaut un second passage, une seule fois.
    if (error instanceof PlanValidationError || /JSON du planificateur/.test(error instanceof Error ? error.message : "")) {
      const rule = `\n\nPREVIOUS ANSWER WAS NOT USABLE (${error instanceof Error ? error.message : "invalid"}). Answer with the JSON object ONLY, exactly ${count} creatives, no prose before or after, newlines inside strings escaped as \\n.`;
      return planOnce(input, count, rule);
    }
    throw error;
  }
}
