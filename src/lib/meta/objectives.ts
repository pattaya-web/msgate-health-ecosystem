/**
 * Les campagnes qui ne vendent pas.
 *
 * Trafic, engagement, notoriété, vues de vidéo : ce sont les campagnes de
 * chauffe que l'agence lance sur un compte neuf (« New Engagement Campaign »,
 * « New Traffic Campaign »). Leur dépense n'achète aucune vente : comptée avec
 * le reste, elle fausse le spend, le ROAS et le bénéfice. Elles sont écartées
 * de toutes les stats (Ads Manager, pilotage, profit, tableaux) ; la dépense à
 * vie du compte, elle, les garde — c'est elle qui dit si le compte est chaud.
 */
const NON_SALES = new Set([
  "OUTCOME_TRAFFIC",
  "LINK_CLICKS",
  "OUTCOME_ENGAGEMENT",
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "EVENT_RESPONSES",
  "VIDEO_VIEWS",
  "OUTCOME_AWARENESS",
  "REACH",
  "BRAND_AWARENESS",
]);

export function isNonSalesObjective(objective?: string | null) {
  return Boolean(objective && NON_SALES.has(objective.toUpperCase()));
}
