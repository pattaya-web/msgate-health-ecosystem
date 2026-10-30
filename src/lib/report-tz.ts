/**
 * Le fuseau de lecture des chiffres : Paris.
 *
 * La boutique Shopify, les comptes Meta et Triple Whale comptent leurs journées
 * à l'heure de Paris ; Reign compte les siennes à New York. Tout l'outil se
 * cale sur Paris pour que ventes et dépense d'un même jour se comparent
 * vraiment (sinon le ROAS du jour mélange deux journées décalées de 5 à 6 h).
 * Le tableau de bord de Reign, lui, reste en jours de New York : une vente de
 * nuit (minuit à 5-6 h à Paris) y tombe la veille.
 *
 * Module sans dépendance serveur : utilisable côté client comme côté serveur.
 */

export const REPORT_TIME_ZONE = "Europe/Paris";

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Le jour en cours à Paris, « YYYY-MM-DD ». */
export function reportToday() {
  return DAY.format(new Date());
}

/** Une date absolue (avec Z ou décalage) en heure de Paris, « YYYY-MM-DDTHH:mm:ss ». Une date déjà locale est rendue telle quelle. */
export function toReportLocal(value: string | null): string | null {
  if (!value || !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
