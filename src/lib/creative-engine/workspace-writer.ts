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
  /** Une créa de référence est jointe au brief (et à la génération) : chaque prompt suit sa structure. */
  creativeReferenceAttached?: boolean;
  /** Sa description en mots, quand un modèle qui voit a pu la lire ; null sinon. */
  creativeReferenceDescription?: string | null;
};

const DESCRIBE_PROMPT =
  "Describe this ad creative for an image-generation planner that cannot see it. In 90 to 140 words, plain English, one paragraph: format and layout, subject and framing, where and how big the product is, text blocks (what kind, where, hierarchy; quote short visible text), colours and background, lighting and camera feel, overall style (UGC / studio / editorial / meme / infographic). Facts only, no advice, no markdown.";

/** Met des mots sur la créa de référence pour que Hermes (texte seul) puisse la suivre ; null si aucun modèle qui voit n'est joignable. */
export async function describeCreativeReference(dataUrl: string): Promise<string | null> {
  try {
    const text = (await kieClaude(DESCRIBE_PROMPT, 600, [dataUrl])).trim();
    return text.length >= 40 ? text.slice(0, 1200) : null;
  } catch {
    return null;
  }
}

function creativeReferenceBlock(input: PlanInput): string {
  if (!input.creativeReferenceAttached) return "";
  const seen = input.creativeReferenceDescription
    ? `Description: ${input.creativeReferenceDescription}`
    : "It could not be described here; the image model will see it at generation time.";
  return `
REFERENCE CREATIVE: the operator attached a real ad creative as the model for this batch; the same image is attached to the image model at generation time. ${seen}
Every creative keeps its composition, visual hierarchy, framing, text placement and style; only the scene, subject, angle and hook change as the brief asks. Start every "prompt" with this exact sentence: "Follow the attached reference creative's composition, hierarchy and style."`;
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
- "angle" is the advertising angle in a few words, "concept" one sentence describing the image idea, "hook" the headline idea (empty string if the brief wants no text).${avoid}

Return ONLY this JSON:
{"count": ${input.count}, "ratio": "${input.ratio}", "format": "static", "creatives": [{"index": 1, "angle": "", "concept": "", "hook": "", "prompt": ""}]}`;
}

export async function planWorkspaceBatch(input: PlanInput): Promise<CreativePlan & { engine: "hermes" | "claude" }> {
  const count = Math.min(MAX_PLANNED_CREATIVES, Math.max(1, Math.round(input.count)));
  const prompt = planPrompt({ ...input, count });
  let hermesReason = hermesAnalysisAvailable() ? "" : "Hermes non configuré";
  if (!hermesReason) {
    try {
      const raw = await askHermesText(prompt, SYSTEM);
      return { ...validatePlan(raw, count, input.ratio), engine: "hermes" };
    } catch (error) {
      hermesReason = error instanceof Error ? error.message : "Hermes indisponible";
    }
  }
  try {
    const raw = await kieClaude(prompt, 4000);
    return { ...validatePlan(raw, count, input.ratio), engine: "claude" };
  } catch (error) {
    throw new Error(`Planification impossible — Hermes : ${hermesReason} ; Kie : ${error instanceof Error ? error.message : "?"}`);
  }
}
