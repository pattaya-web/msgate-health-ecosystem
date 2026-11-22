import type { CloserLead } from "@/lib/closer/store";

/**
 * Les leads que le closer doit appeler (tâches du jour).
 *
 * Consigne de Mady (22/11/2026) : on appelle les leads qualifiés (et ceux
 * « à vérifier »), et les non qualifiés SEULEMENT s'ils ont répondu
 * 550–599 au score de crédit. Le but de l'appel : expliquer le programme,
 * filtrer, et poser un deuxième rendez-vous (le call de closing).
 */

/** Le nom d'hôte des réservations d'IBOState : les leads vont au closer qui porte ce nom. */
export const IBOSTATE_HOST = "Kelly";

export type LeadCallStatus = "todo" | "called" | "no-answer" | "booked" | "not-interested" | "not-eligible";

export const LEAD_STATUS_LABEL: Record<LeadCallStatus, string> = {
  todo: "À appeler",
  called: "Appelé",
  "no-answer": "Pas de réponse",
  booked: "RDV posé",
  "not-interested": "Pas intéressé",
  "not-eligible": "Non éligible",
};

/** Un lead sans réponse est relancé jusqu'à 3 essais, un par jour. */
export const MAX_ATTEMPTS = 3;

export type LeadReason = "qualified" | "review" | "credit-550";

export const REASON_LABEL: Record<LeadReason, string> = {
  qualified: "Qualifié",
  review: "À vérifier",
  "credit-550": "Crédit 550–599",
};

const norm = (value: string) => value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, "");

export function creditOf(lead: CloserLead) {
  return lead.answers.find((answer) => answer.label === "Score de crédit")?.value ?? "";
}

/** Pourquoi ce lead est à appeler ; null = on ne l'appelle pas. */
export function leadReason(lead: CloserLead): LeadReason | null {
  if (lead.eligibility === "qualified") return "qualified";
  if (lead.eligibility === "review") return "review";
  return norm(creditOf(lead)) === "550-599" ? "credit-550" : null;
}

/* Fuseau principal de chaque État US (abréviation ou nom complet), comme sur IBOState. */
const STATE_TZ: Record<string, string> = (() => {
  const zones: Record<string, string> = {
    "America/New_York": "CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV",
    "America/Chicago": "AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI",
    "America/Denver": "CO MT NM UT WY ID",
    "America/Phoenix": "AZ",
    "America/Los_Angeles": "CA NV OR WA",
    "America/Anchorage": "AK",
    "Pacific/Honolulu": "HI",
    "America/Puerto_Rico": "PR",
  };
  const names: Record<string, string> = {
    AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware",
    DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
    KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota",
    MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey",
    NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon",
    PA: "pennsylvania", PR: "puerto rico", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee",
    TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  };
  const map: Record<string, string> = {};
  for (const [tz, list] of Object.entries(zones)) {
    for (const ab of list.split(" ")) {
      map[ab.toLowerCase()] = tz;
      if (names[ab]) map[names[ab]] = tz;
    }
  }
  return map;
})();

/** Le fuseau du lead d'après son État (« Austin, Texas » → America/Chicago). */
export function leadTz(lead: Pick<CloserLead, "place">) {
  const state = lead.place.split(",").pop() ?? "";
  const key = state.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return STATE_TZ[key] ?? "America/New_York";
}

/**
 * Le message à envoyer quand le lead ne répond pas (WhatsApp, sinon SMS),
 * au prénom du lead (texte de Mady, 23/11/2026).
 */
export function followUpText(name: string) {
  const first = name.trim().split(/\s+/)[0];
  return [
    `Hi${first ? ` ${first}` : ""}, this is Kelly Miguez, Admissions Manager at IBO State.`,
    "",
    "You recently requested information about our program. As a reminder, eligible participants can earn between $1,000 and $2,000 per month in passive income, subject to meeting our eligibility requirements.",
    "",
    "Please give me a call back or reply to this message so I can share more details about the program and explain how it works!",
  ].join("\n");
}

/** Le lien /book/ d'IBOState pré-rempli : le lead choisit son créneau, le call arrive tout seul dans l'agenda. */
export function bookingLink(lead: Pick<CloserLead, "name" | "phone" | "place">) {
  const query = new URLSearchParams();
  if (lead.name) query.set("name", lead.name);
  if (lead.phone) query.set("phone", lead.phone);
  query.set("tz", leadTz(lead));
  return `https://www.ibostate.com/book/?${query.toString()}`;
}
