/**
 * Qui surveille quoi, entre les écrans et le veilleur global.
 *
 * Les générations tournent chez Kie quel que soit l'écran ouvert ; ce qui
 * s'arrêtait en changeant de page, c'était leur suivi. Le veilleur du shell
 * reprend : les lots du Creative Engine sont rafraîchis côté serveur, et les
 * tâches du studio static (gardées dans localStorage) sont sondées puis
 * rangées en bibliothèque quand le studio n'est pas monté pour le faire.
 */

type Registry = { staticStudioMounted: boolean; claimed: Set<string> };

const registry: Registry = ((globalThis as typeof globalThis & { __msgateGeneration?: Registry }).__msgateGeneration ??= { staticStudioMounted: false, claimed: new Set() });

export function markStaticStudioMounted(mounted: boolean) {
  registry.staticStudioMounted = mounted;
}

export function isStaticStudioMounted() {
  return registry.staticStudioMounted;
}

/** Réserve une tâche Kie : vrai si personne ne la suivait encore. */
export function claimTask(taskId: string) {
  if (registry.claimed.has(taskId)) return false;
  registry.claimed.add(taskId);
  return true;
}

export function releaseTask(taskId: string) {
  registry.claimed.delete(taskId);
}

export const STUDIO_JOBS_KEY = "msgate.studio.jobs";
