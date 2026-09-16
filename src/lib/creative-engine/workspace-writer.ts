import { askHermesText, hermesAnalysisAvailable } from "@/lib/creative-engine/hermes-analysis";
import { kieClaude } from "@/lib/studio/kie";
import type { ProductContext } from "./types";
import { MAX_PLANNED_CREATIVES, validatePlan, type CreativePlan } from "./workspace-plan";

/**
 * Le planificateur de l'espace produit : un brief en langage naturel
 * (« Create 5 ultra realistic static ads… ») devient N concepts distincts,
 * chacun avec son prompt de génération, en JSON strict. Hermes en premier
 * (mêmes skills et mémoire que sur Telegram), Claude via Kie en secours. Rien
 * n'est généré ici, et un plan illisible est une erreur, jamais un prompt
 * unique fabriqué en douce à partir du brief.
 */

/** Ce qu'on sait du produit : une fiche du moteur (avec analyse), une fiche lue en prompt libre, ou rien. */
export type PlanProduct = Pick<ProductContext, "name"> & Partial<Pick<ProductContext, "id" | "store" | "url" | "analysis">> & { price?: string };

export type PlanInput = {
  brief: string;
  count: number;
  ratio: string;
  product: PlanProduct | null;
  hasReference: boolean;
  /** Concepts déjà retenus, à éviter quand on réécrit une seule créa. */
  avoid?: string[];
  /** Une créa d'inspiration (pub concurrente, style) est jointe au brief : chaque prompt suit sa structure, jamais ses faits. */
  creativeReferenceAttached?: boolean;
  /** Sa description en mots, quand un modèle qui voit a pu la lire ; null sinon. */
  creativeReferenceDescription?: string | null;
  /** Les faits propres au concurrent lus sur l'inspiration (marque, origine, garantie, chiffres…) : à ne jamais reprendre. */
  competitorFacts?: string[];
};

export type CreativeReferenceReading = { description: string; competitorFacts: string[] };

const DESCRIBE_PROMPT =
  'Analyse this ad creative for an image-generation planner that cannot see it. Return ONLY a JSON object, no markdown: {"description": "...", "competitorFacts": ["..."]}. "description": 90 to 160 words, plain English, one paragraph, the creative DNA — format and layout, marketing angle, hook mechanism, subject and framing, where and how big the product is, text blocks (kind, position, hierarchy), type of proof (before/after, testimonial, stat, badge, comparison…), colours and background, lighting and camera feel, overall style (UGC / studio / editorial / meme / infographic). "competitorFacts": every product- or brand-specific element visible or written — brand and product names, logo wording, slogans, claims, guarantees, country of origin, materials, certifications, statistics, study mentions, prices, badges — as short exact strings (max 20). Facts only, no advice.';

/** Lit la créa d'inspiration pour Hermes (texte seul) : son ADN créatif et les faits du concurrent à écarter ; null si aucun modèle qui voit n'est joignable. */
export async function describeCreativeReference(dataUrl: string): Promise<CreativeReferenceReading | null> {
  try {
    const raw = (await kieClaude(DESCRIBE_PROMPT, 900, [dataUrl])).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as { description?: unknown; competitorFacts?: unknown };
      const description = typeof parsed.description === "string" ? parsed.description.trim().slice(0, 1600) : "";
      const competitorFacts = Array.isArray(parsed.competitorFacts) ? parsed.competitorFacts.filter((entry): entry is string => typeof entry === "string" && entry.trim().length >= 3).map((entry) => entry.trim().slice(0, 80)).slice(0, 20) : [];
      if (description.length >= 40) return { description, competitorFacts };
    }
    // Réponse en prose : on garde la description, sans liste de faits.
    return raw.length >= 40 ? { description: raw.slice(0, 1600), competitorFacts: [] } : null;
  } catch {
    return null;
  }
}

/** Mots trop génériques pour compter comme une fuite (« product », « ad »…). */
const GENERIC_FACT = /^(product|ad|ads|creative|image|photo|the|a|an|new|best|now|today|free|premium|quality)$/i;

/** Les prompts qui reprennent un fait du concurrent : index de créa → faits retrouvés. */
export function findCompetitorLeaks(prompts: string[], competitorFacts: string[]): Array<{ index: number; facts: string[] }> {
  const facts = competitorFacts.map((fact) => fact.trim()).filter((fact) => fact.length >= 3 && !GENERIC_FACT.test(fact));
  return prompts
    .map((prompt, position) => {
      const lower = prompt.toLowerCase();
      return { index: position + 1, facts: facts.filter((fact) => lower.includes(fact.toLowerCase())) };
    })
    .filter((entry) => entry.facts.length > 0);
}

function creativeReferenceBlock(input: PlanInput): string {
  if (!input.creativeReferenceAttached) return "";
  const seen = input.creativeReferenceDescription
    ? `What it looks like: ${input.creativeReferenceDescription}`
    : "It could not be read here; treat the brief's description of it as the guide.";
  const facts = input.competitorFacts?.length ? `\nCompetitor-specific elements seen on it, FORBIDDEN in every prompt: ${input.competitorFacts.map((fact) => `« ${fact} »`).join(", ")}.` : "";
  const product = input.product ? "the ACTIVE PRODUCT above" : "the subject of the brief";
  return `
CREATIVE INSPIRATION: the operator attached an ad creative (often a competitor's) as inspiration. ${seen}${facts}
SOURCE OF TRUTH, in this order: 1) the active product sheet above, 2) its attached product reference photo, 3) this inspiration image — for creative form only.
CREATIVE TRANSFER, not product swap: understand why this creative works, then rebuild the same logic for ${product}. Keep its marketing angle, hook mechanism, layout, composition, visual hierarchy, type of proof, visual rhythm, photography and annotation style. Replace EVERY product-specific element with the active product's real facts: its name, brand, packaging, mechanism, benefits, origin, guarantee, certifications, statistics. Never reuse the competitor's product, brand, logo, packaging, claims, guarantees, country of origin, materials, certifications, statistics, studies, icons or factual copy. If the active product has no equivalent for an element (e.g. a "Made in …" badge with no known origin), REMOVE that element instead of inventing one.
Start every "prompt" with this exact sentence: "Follow the inspiration creative's composition, hierarchy and style, with the active product only."`;
}

const SYSTEM =
  "You are the creative planner of the MSGate CRM Creative Engine. You turn an operator's brief into distinct static-ad concepts, each with a generation-ready image prompt. Answer with the requested JSON object ONLY: no prose, no markdown fences. Read-only task: do not browse, do not call tools that write or generate anything.";

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
      ? "- a real photo of the product is attached at generation time as the visual source of truth: every prompt shows THIS exact product, never a redesigned or imagined one"
      : "- no product photo is attached: describe the product consistently from the facts above",
  ]
    .filter(Boolean)
    .join("\n") : input.hasReference
      ? "NO PRODUCT SHEET: the brief describes the subject. Reference image(s) are attached at generation time as the visual source of truth: every prompt shows exactly what they show, never a redesigned or imagined version."
      : "NO PRODUCT SHEET: the brief is the only source. Describe the subject consistently across creatives.";
  const avoid = input.avoid?.length ? `\nAlready used concepts, do NOT repeat them: ${input.avoid.map((entry) => `« ${entry} »`).join(", ")}.` : "";
  const reference = creativeReferenceBlock(input);
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
- Branding: never add a standalone logo, corner logo, watermark or branding block; branding exists only as it appears on the real product or packaging, unless the brief explicitly asks for a logo.
- The brief may be in French, English or both: read it either way and write the prompts in English.${avoid}

Return ONLY this JSON:
{"count": ${input.count}, "ratio": "${input.ratio}", "format": "static", "creatives": [{"index": 1, "angle": "", "concept": "", "hook": "", "prompt": ""}]}`;
}

/** Un plan validé qui reprend un fait du concurrent est rejeté : le planificateur repasse une fois avec la liste des fuites, puis c'est une erreur. */
function checkLeaks(plan: CreativePlan, competitorFacts: string[] | undefined) {
  if (!competitorFacts?.length) return plan;
  const leaks = findCompetitorLeaks(plan.creatives.map((creative) => creative.prompt), competitorFacts);
  if (leaks.length) throw new CompetitorLeakError(leaks);
  return plan;
}

export class CompetitorLeakError extends Error {
  constructor(public leaks: Array<{ index: number; facts: string[] }>) {
    super(`le planificateur a repris des faits du concurrent (créa ${leaks.map((leak) => `${leak.index} : ${leak.facts.map((fact) => `« ${fact} »`).join(", ")}`).join(" ; ")})`);
  }
}

async function planOnce(input: PlanInput, count: number, extraRule: string): Promise<CreativePlan & { engine: "hermes" | "claude" }> {
  const prompt = planPrompt({ ...input, count }) + extraRule;
  let hermesReason = hermesAnalysisAvailable() ? "" : "Hermes non configuré";
  if (!hermesReason) {
    try {
      const raw = await askHermesText(prompt, SYSTEM);
      return { ...checkLeaks(validatePlan(raw, count, input.ratio), input.competitorFacts), engine: "hermes" };
    } catch (error) {
      if (error instanceof CompetitorLeakError) throw error;
      hermesReason = error instanceof Error ? error.message : "Hermes indisponible";
    }
  }
  try {
    const raw = await kieClaude(prompt, 4000);
    return { ...checkLeaks(validatePlan(raw, count, input.ratio), input.competitorFacts), engine: "claude" };
  } catch (error) {
    if (error instanceof CompetitorLeakError) throw error;
    throw new Error(`Planification impossible — Hermes : ${hermesReason} ; Kie : ${error instanceof Error ? error.message : "?"}`);
  }
}

export async function planWorkspaceBatch(input: PlanInput): Promise<CreativePlan & { engine: "hermes" | "claude" }> {
  const count = Math.min(MAX_PLANNED_CREATIVES, Math.max(1, Math.round(input.count)));
  try {
    return await planOnce(input, count, "");
  } catch (error) {
    if (!(error instanceof CompetitorLeakError)) throw error;
    const facts = [...new Set(error.leaks.flatMap((leak) => leak.facts))];
    const rule = `\n\nPREVIOUS ATTEMPT REJECTED: these competitor elements appeared in the prompts and must not appear in any form: ${facts.map((fact) => `« ${fact} »`).join(", ")}. Use the active product's own facts or drop the element.`;
    return planOnce(input, count, rule);
  }
}
