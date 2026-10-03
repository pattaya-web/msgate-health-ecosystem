import type { StudioJob, StudioJobStatus, VoiceAmbience, VoiceEngine, VoiceMode } from "./types";

/** Libellés partagés client/serveur (aucune dépendance Node ici). */

export const STATUS_LABEL: Record<StudioJobStatus, string> = {
  queued: "En file d'attente",
  uploading: "Envoi des fichiers",
  generating_video: "Vidéo en génération",
  processing_voice: "Transformation de voix",
  merging: "Assemblage",
  syncing_lips: "Synchro des lèvres",
  completed: "Terminé",
  failed: "Échec",
};

export const VOICE_MODE_LABEL: Record<VoiceMode, string> = {
  keep: "Garder ma voix",
  transform: "Transformer ma voix",
  none: "Sans audio",
};

export const VOICE_ENGINE_LABEL: Record<VoiceEngine, string> = {
  "elevenlabs-sts": "ElevenLabs speech-to-speech",
  "kie-tts": "ElevenLabs TTS via KIE",
};

export const VOICE_AMBIENCE_LABEL: Record<VoiceAmbience, string> = {
  raw: "Brute (micro)",
  close: "Proche",
  room: "Dans la pièce (2 m)",
  far: "Loin",
};

export interface Step {
  key: string;
  label: string;
  state: "done" | "current" | "todo" | "skipped";
}

/** Étapes visuelles d'un job, selon son statut et son mode audio. */
export function stepsOf(job: StudioJob): Step[] {
  const order: StudioJobStatus[] = ["uploading", "generating_video", "processing_voice", "merging", "syncing_lips", "completed"];
  const labels: Record<string, string> = {
    uploading: "Fichiers envoyés",
    generating_video: "Vidéo en génération",
    processing_voice: "Transformation de voix",
    merging: "Assemblage",
    syncing_lips: "Synchro des lèvres",
    completed: "Terminé",
  };
  const pos = job.status === "queued" ? -1 : job.status === "failed" ? order.indexOf("completed") : order.indexOf(job.status);
  return order
    .filter((s) => job.type === "video-transform" || (s !== "processing_voice" && s !== "merging" && s !== "syncing_lips"))
    .filter((s) => s !== "processing_voice" || job.voiceMode === "transform")
    .filter((s) => s !== "syncing_lips" || (job.lipSync && job.voiceMode !== "none"))
    .map((s) => {
      const i = order.indexOf(s);
      let state: Step["state"] = i < pos ? "done" : i === pos ? "current" : "todo";
      if (job.status === "completed") state = "done";
      if (job.status === "failed") state = i < pos ? "done" : "todo";
      if (s === "processing_voice" && job.voiceError) state = "skipped";
      if (s === "syncing_lips" && job.lipSyncError) state = "skipped";
      return { key: s, label: labels[s], state };
    });
}
