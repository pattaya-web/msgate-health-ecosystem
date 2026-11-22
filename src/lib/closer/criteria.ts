import type { Answer } from "@/lib/closer/store";

/**
 * Les critères de sélection d'IBOState (ibostate.com), tels que le site les
 * applique : page d'accueil (« Do you qualify? »), quiz du formulaire
 * (apply-quiz.js) et questions avant la réservation (book/index.html).
 * Chaque critère se lit dans les réponses du prospect quand il y répond ;
 * sinon le closer doit le demander pendant le call.
 */

export type CriterionState = "ok" | "ko" | "check" | "ask";

export type Criterion = {
  key: string;
  /** L'exigence, telle que le closer doit la vérifier. */
  title: string;
  /** Ce qui élimine le prospect (ou le met en attente). */
  rule: string;
  /** Les libellés de réponses qui renseignent ce critère. */
  labels: string[];
  /** Verdict d'une réponse : ko = non sélectionné, check = à vérifier, ok = bon. */
  judge: (value: string) => CriterionState;
  /** Un critère « à noter » n'élimine jamais (dettes fiscales). */
  soft?: boolean;
};

const norm = (value: string) => value.toLowerCase().replace(/[–—]/g, "-").trim();
const yes = (value: string) => /^yes\b|^oui\b/.test(norm(value));
const no = (value: string) => /^no\b|^non\b/.test(norm(value));

export const CRITERIA: Criterion[] = [
  {
    key: "us",
    title: "Citoyen américain ou résident permanent (green card)",
    rule: "Non sélectionné s'il n'est ni citoyen US ni résident permanent.",
    labels: ["Citoyen / résident US"],
    judge: (value) => (no(value) ? "ko" : "ok"),
  },
  {
    key: "credit",
    title: "Score de crédit 600 ou plus",
    rule: "Non sélectionné en dessous de 600. « Je ne sais pas » : il doit vérifier (Credit Karma, gratuit).",
    labels: ["Score de crédit"],
    judge: (value) => {
      const v = norm(value);
      if (/below|550|moins|^</.test(v)) return "ko";
      if (/unknown|not sure|don't know|ne sais/.test(v)) return "check";
      return "ok";
    },
  },
  {
    key: "bank",
    title: "Compte bancaire aux États-Unis, en règle",
    rule: "Non sélectionné sans compte US. « Je peux en ouvrir un » : à vérifier.",
    labels: ["Compte bancaire US"],
    judge: (value) => (no(value) ? "ko" : /can get|peux|if needed/.test(norm(value)) ? "check" : "ok"),
  },
  {
    key: "license",
    title: "Permis de conduire américain valide",
    rule: "Exigé sur le site : à demander pendant le call (le formulaire ne le pose pas).",
    labels: ["Permis de conduire"],
    judge: (value) => (no(value) ? "ko" : "ok"),
  },
  {
    key: "record",
    title: "Casier judiciaire vierge",
    rule: "Non sélectionné avec un casier (obligatoire pour représenter une société).",
    labels: ["Casier judiciaire"],
    judge: (value) => (yes(value) ? "ko" : "ok"),
  },
  {
    key: "llc",
    title: "Pas déjà de LLC ni de société aux États-Unis",
    rule: "Non sélectionné s'il possède déjà une société US.",
    labels: ["A déjà une LLC"],
    judge: (value) => (yes(value) ? "ko" : "ok"),
  },
  {
    key: "understands",
    title: "Comprend le programme",
    rule: "Représentant US d'une société européenne, 1 à 5 h par mois depuis son téléphone, payé chaque mois, ne paie jamais rien. S'il ne comprend pas : réexpliquer.",
    labels: ["Comprend le programme"],
    judge: (value) => (no(value) ? "ko" : "ok"),
  },
  {
    key: "taxes",
    title: "Dettes fiscales ou saisies",
    rule: "N'élimine pas : à noter pour le dossier.",
    labels: ["Dettes fiscales / saisies"],
    judge: (value) => (yes(value) ? "check" : "ok"),
    soft: true,
  },
];

export type CriterionResult = { criterion: Criterion; state: CriterionState; value: string };

/** Chaque critère avec son verdict d'après les réponses reçues (« ask » s'il n'y a pas de réponse). */
export function evaluateCriteria(answers: Answer[]): CriterionResult[] {
  return CRITERIA.map((criterion) => {
    const found = answers.find((item) => criterion.labels.includes(item.label));
    if (!found) return { criterion, state: "ask" as const, value: "" };
    return { criterion, state: criterion.judge(found.value), value: found.value };
  });
}

/** Le verdict d'ensemble : un critère éliminatoire non tenu suffit. */
export function overallVerdict(results: CriterionResult[]): "ko" | "check" | "ok" {
  if (results.some((item) => item.state === "ko" && !item.criterion.soft)) return "ko";
  if (results.some((item) => item.state === "check")) return "check";
  return "ok";
}
