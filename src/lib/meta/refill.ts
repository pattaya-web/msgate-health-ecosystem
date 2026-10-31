import type { AdsetNode, CampaignNode } from "@/lib/meta/types";

/**
 * « Besoin de refill » : un ad set actif doit toujours tourner avec 3 à 4
 * créas. En dessous de 3 créas réellement actives (allumées, ni refusées, ni
 * en erreur), il faut le réalimenter. Module sans dépendance serveur.
 */

export const REFILL_MIN = 3;

const NOT_LIVE = /DISAPPROVED|WITH_ISSUES|DELETED|ARCHIVED|PAUSED/;

/** Les créas qui diffusent vraiment dans l'ad set. */
export function liveCreatives(adset: AdsetNode) {
  return adset.ads.filter((ad) => ad.status === "ACTIVE" && !NOT_LIVE.test(ad.effectiveStatus || "")).length;
}

/** Ad set allumé avec moins de 3 créas actives. */
export function needsRefill(adset: AdsetNode) {
  return adset.status === "ACTIVE" && liveCreatives(adset) < REFILL_MIN;
}

/** Les ad sets à réalimenter d'une campagne allumée. */
export function adsetsToRefill(campaign: CampaignNode) {
  return campaign.status === "ACTIVE" ? campaign.adsets.filter(needsRefill) : [];
}
