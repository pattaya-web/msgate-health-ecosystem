import { AUTO_PRIORITY, PROVIDERS } from "./config";
import type { ProviderChoice, ProviderId, TransformType } from "./types";

export interface SelectInput {
  transform: TransformType;
  durationSec?: number;
  sourceBytes?: number;
  /** Des photos du produit sont fournies : seuls les modèles à éléments comptent. */
  hasProduct?: boolean;
}

/** Ordre de préférence, restreint aux modèles capables de protéger le produit si besoin. */
function orderFor(input: SelectInput): ProviderId[] {
  const base = AUTO_PRIORITY[input.transform] ?? AUTO_PRIORITY.full;
  if (!input.hasProduct) return base;
  const capable = base.filter((id) => PROVIDERS[id].supportsProduct);
  return capable.length ? capable : base;
}

/** Un provider accepte-t-il cette vidéo ? Renvoie la raison du refus sinon. */
export function providerRejects(id: ProviderId, input: SelectInput): string | null {
  const p = PROVIDERS[id];
  const d = input.durationSec;
  if (d && d < p.minDurationSec) return `${p.label} demande au moins ${p.minDurationSec} s de vidéo.`;
  if (d && d > p.maxDurationSec) return `${p.label} accepte ${p.maxDurationSec} s de vidéo maximum (la tienne fait ${Math.round(d)} s).`;
  if (!p.compressSource && input.sourceBytes && input.sourceBytes > p.maxSourceBytes) {
    return `${p.label} accepte ${Math.round(p.maxSourceBytes / 1e6)} Mo maximum.`;
  }
  return null;
}

/**
 * Mode Auto : premier provider de la liste de priorité qui accepte la vidéo.
 *
 * Règles volontairement simples, et toutes ici. Si rien ne convient, on renvoie
 * le premier de la liste pour que l'erreur du provider soit explicite.
 */
export function selectBestProvider(input: SelectInput): ProviderId {
  const order = orderFor(input);
  for (const id of order) if (!providerRejects(id, input)) return id;
  return order[0];
}

/** Mode Auto sans candidat : une phrase globale plutôt que le refus d'un seul modèle. */
export function noProviderReason(input: SelectInput): string | null {
  const order = orderFor(input);
  if (order.some((id) => !providerRejects(id, input))) return null;
  const maxSec = Math.max(...order.map((id) => PROVIDERS[id].maxDurationSec));
  if (input.durationSec && input.durationSec > maxSec) {
    return input.hasProduct
      ? `Avec des photos de produit, seul ${PROVIDERS[order[0]].label} convient et il accepte ${String(maxSec).replace(".", ",")} s maximum (ta vidéo fait ${Math.round(input.durationSec)} s). Coupe-la.`
      : `Aucun modèle n'accepte une vidéo de ${Math.round(input.durationSec)} s (maximum ${String(maxSec).replace(".", ",")} s). Coupe-la avant de la déposer.`;
  }
  return providerRejects(order[0], input);
}

export function resolveProvider(choice: ProviderChoice, input: SelectInput): ProviderId {
  return choice === "auto" ? selectBestProvider(input) : choice;
}
