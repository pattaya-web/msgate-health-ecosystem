/**
 * Lecture pure d'un brief de l'espace produit (partagée navigateur / serveur) :
 * combien d'images il demande, s'il veut seulement des prompts, et la forme
 * du plan structuré que le planificateur renvoie et que l'aperçu affiche.
 */

export const MAX_PLANNED_CREATIVES = 30;

export type PlannedCreative = {
  index: number;
  angle: string;
  concept: string;
  hook: string;
  prompt: string;
};

export type CreativePlan = {
  count: number;
  ratio: string;
  format: string;
  creatives: PlannedCreative[];
};

const WORDS: Record<string, number> = { one: 1, une: 1, un: 1, two: 2, deux: 2, three: 3, trois: 3, four: 4, quatre: 4, five: 5, cinq: 5, six: 6, seven: 7, sept: 7, eight: 8, huit: 8, nine: 9, neuf: 9, ten: 10, dix: 10, twelve: 12, douze: 12, fifteen: 15, quinze: 15, twenty: 20, vingt: 20 };
const NUMBER = "(\\d{1,2}|one|une|un|two|deux|three|trois|four|quatre|five|cinq|six|seven|sept|eight|huit|nine|neuf|ten|dix|twelve|douze|fifteen|quinze|twenty|vingt)";
/** Un total : « 5 ads », « 15 static concepts », « dix visuels ». */
const TOTAL_NOUN = "(?:ads?|creatives?|cr[ée]as?|images?|visuels?|visuals?|statics?|concepts?|photos?|pubs?|variations?|versions?|pictures?|renders?)";
/** Une part : « 3 before/after », « 2 product-focused », « 5 lifestyle ». */
const PART_NOUN = "(?:before[\\s/-]*after|avant[\\s/-]*apr[èe]s|product[\\s-]*focused|product[\\s-]*focus|packshots?|lifestyle|ugc|testimonials?|t[ée]moignages?|scientific|infographics?|comparisons?|problem[\\s-]*solution|unboxing|close[\\s-]*ups?|selfies?)";
const TOTAL_RE = new RegExp(`\\b${NUMBER}\\s*(?:x\\s*)?(?:[\\w'-]+\\s+){0,4}?${TOTAL_NOUN}\\b`, "gi");
const PART_RE = new RegExp(`\\b${NUMBER}\\s*(?:x\\s*)?(?:[\\w'-]+\\s+){0,2}?${PART_NOUN}`, "gi");

const PART_TEST = new RegExp(PART_NOUN, "i");

function toNumber(token: string) {
  const lower = token.toLowerCase();
  return /^\d+$/.test(lower) ? Number.parseInt(lower, 10) : WORDS[lower] ?? 0;
}

/**
 * Le nombre d'images demandé : un total explicite (« Create 15 creatives ») gagne ;
 * sinon la somme des parts (« 3 before/after and 2 product-focused » = 5) ; sinon 1.
 * Un ratio comme « 3:4 » n'est jamais lu comme un nombre. Borné par MAX_PLANNED_CREATIVES.
 */
export function parseRequestedCount(brief: string): number {
  const text = brief.replace(/\b\d{1,2}\s*[:x×]\s*\d{1,2}\b/gi, " ");
  const parts = [...text.matchAll(PART_RE)].map((match) => toNumber(match[1])).filter((value) => value > 0);
  // « 2 product-focused creatives » est une part, pas un total : un total ne contient aucun nom de part.
  const totals = [...text.matchAll(TOTAL_RE)].filter((match) => !PART_TEST.test(match[0])).map((match) => toNumber(match[1])).filter((value) => value > 0);
  const count = totals.length ? Math.max(...totals) : parts.length ? parts.reduce((sum, value) => sum + value, 0) : 1;
  return Math.min(MAX_PLANNED_CREATIVES, Math.max(1, count));
}

/** « Prepare prompts only », « prompts only », « do not generate », « ne génère pas » : planifier sans ouvrir la génération. */
export function isPromptsOnly(brief: string): boolean {
  return /\b(prompts?\s+only|only\s+(the\s+)?prompts?|prepare\s+(the\s+)?prompts?|do\s+not\s+generate|don'?t\s+generate|no\s+generation|ne\s+g[ée]n[èe]re\s+pas|sans\s+g[ée]n[ée]rer|juste\s+les\s+prompts|seulement\s+les\s+prompts)\b/i.test(brief);
}

/** Un ratio écrit dans le brief (« 3:4 », « 9:16 », « ratio 1:1 »), sinon null. */
export function parseRequestedRatio(brief: string): string | null {
  const match = brief.match(/\b(3:4|4:3|9:16|16:9|1:1|4:5|2:3|3:2)\b/);
  return match ? match[1] : null;
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

/**
 * Le JSON d'un modèle de langage n'est pas toujours strict : retours à la ligne
 * nus dans un prompt, virgule après le dernier élément, guillemets typographiques.
 * On lit tel quel, puis avec ces réparations, avant de déclarer le plan illisible.
 */
export function parseLenientJson<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    const repaired = json
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\r?\n/g, " ")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired) as T;
  }
}

export class PlanValidationError extends Error {}

/** Lecture stricte du JSON du planificateur : exactement `count` créas distinctes, chacune avec un prompt exploitable. */
export function validatePlan(raw: string, count: number, fallbackRatio: string): CreativePlan {
  const json = extractJson(raw);
  if (!json) throw new PlanValidationError("le planificateur n'a pas renvoyé de JSON");
  let parsed: { count?: unknown; ratio?: unknown; format?: unknown; creatives?: unknown };
  try {
    parsed = parseLenientJson(json);
  } catch {
    throw new PlanValidationError(`JSON du planificateur invalide (début : « ${json.slice(0, 80).replace(/\s+/g, " ")}… »)`);
  }
  if (!Array.isArray(parsed.creatives)) throw new PlanValidationError("pas de liste « creatives » dans le plan");
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const creatives: PlannedCreative[] = parsed.creatives
    .map((entry, index) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      return { index: index + 1, angle: str(record.angle), concept: str(record.concept), hook: str(record.hook), prompt: str(record.prompt) };
    })
    .filter((creative) => creative.prompt.length >= 40);
  if (creatives.length < count) throw new PlanValidationError(`${creatives.length} prompt(s) exploitable(s) sur ${count} demandés`);
  const distinct = new Set(creatives.map((creative) => creative.prompt.toLowerCase().replace(/\s+/g, " "))).size;
  if (distinct < count) throw new PlanValidationError("plusieurs créas ont le même prompt");
  const ratio = str(parsed.ratio) || fallbackRatio;
  return { count, ratio, format: str(parsed.format) || "static", creatives: creatives.slice(0, count).map((creative, index) => ({ ...creative, index: index + 1 })) };
}
