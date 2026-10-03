import type { StudioCharacter, StudioJob } from "./studio-ia/types";

/*
 * Modèle de données du Studio IA, persisté dans data/db.json.
 *
 * Version réduite de celui de princexd : seuls les réglages et les
 * collections que le Studio lit vraiment sont gardés. Les réglages
 * Instagram, iClosed ou ventes du projet d'origine n'ont rien à faire ici.
 */

export type ID = string;

export interface Settings {
  /** Clé API KIE. Priorité à process.env.KIE_API_KEY si définie. */
  kieApiKey: string;
  /** Modèle texte KIE utilisé pour la traduction / l'analyse de scripts. */
  kieTextModel: string;
  /** Prix d'un crédit KIE en USD (kie.ai facture ~0,005 $/crédit). */
  creditUsdRate: number;
  /** Taux EUR pour l'affichage secondaire. */
  usdToEur: number;
  /** Clé OpenAI pour la transcription audio. Priorité à OPENAI_API_KEY. */
  openaiApiKey: string;
  /** Modèle de transcription (gpt-4o-mini-transcribe, whisper-1…). */
  transcribeModel: string;
  /** Clé ElevenLabs pour la transformation de voix du Swap vidéo. Priorité à ELEVENLABS_API_KEY. */
  elevenLabsApiKey?: string;
  /** Clés Higgsfield (Genjutsu). Priorité à HIGGSFIELD_API_KEY. */
  higgsfieldKeyId?: string;
  higgsfieldKeySecret?: string;
  /** Contexte business injecté dans les prompts IA. */
  brandContext: string;
}

/** Une génération KIE suivie par la file de rendus (onglet Face swap, dock). */
export interface Generation {
  id: ID;
  taskId: string;
  model: string;
  kind: "image" | "video";
  prompt: string;
  input: Record<string, unknown>;
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  resultUrls: string[];
  creditsConsumed: number;
  failMsg: string;
  /** Avancement 0-100 quand KIE le publie ; 0 sinon. */
  progress: number;
  /** Durée réelle de génération en secondes, une fois la tâche finie. */
  costTimeSec: number;
  createdAt: string;
  updatedAt: string;
}

export interface DB {
  settings: Settings;
  generations: Generation[];
  /* --- Studio : swap vidéo, talking photo, création --- */
  studioJobs: StudioJob[];
  studioCharacters: StudioCharacter[];
}

export type CollectionName = Exclude<keyof DB, "settings">;
