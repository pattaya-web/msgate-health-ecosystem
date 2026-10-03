import type { ProviderConfig } from "../config";
import type { ProviderInput } from "../types";

export interface StartResult {
  /** Identifiant de tâche chez le provider (taskId KIE). */
  providerJobId: string;
  /** Ce qui a réellement été envoyé, pour relecture et rejeu. */
  payload: Record<string, unknown>;
}

export interface PollResult {
  state: "waiting" | "generating" | "success" | "fail";
  /** 0-100 quand publié par le provider, sinon 0. */
  progress: number;
  resultUrl: string;
  error: string;
  creditsConsumed: number;
}

/**
 * Interface commune des providers vidéo.
 *
 * `buildPayload` est pur : il traduit l'entrée normalisée vers le schéma du
 * modèle. `start` / `poll` parlent au réseau. Séparer les deux permet de tester
 * la traduction sans dépenser un crédit.
 */
export interface VideoProvider {
  config: ProviderConfig;
  buildPayload(input: ProviderInput): Record<string, unknown>;
  generateVideoTransformation(input: ProviderInput, callbackUrl?: string): Promise<StartResult>;
  poll(providerJobId: string): Promise<PollResult>;
}
