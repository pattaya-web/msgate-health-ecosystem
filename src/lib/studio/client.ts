import type { Ratio } from "@/lib/studio/ratios";

export type StudioTask = {
  taskId: string;
  state?: string;
  urls: string[];
  failMsg?: string;
};

export async function studioPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Studio indisponible");
  return data;
}

/**
 * Garantit un vrai MP4 à télécharger.
 *
 * Quand MediaRecorder a déjà produit du MP4, on ne touche à rien. Sinon la
 * capture WebM part au serveur, qui la réencode avec ffmpeg — renommer un WebM
 * en `.mp4` donnerait un fichier refusé par les régies et beaucoup de lecteurs.
 */
export async function toMp4(blob: Blob): Promise<Blob> {
  if (blob.type.includes("mp4")) return blob;
  const res = await fetch("/api/studio/mp4", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) {
    let message = "Conversion MP4 impossible";
    try {
      message = ((await res.json()) as { error?: string }).error || message;
    } catch {
      // réponse non-JSON : on garde le message générique
    }
    throw new Error(message);
  }
  return new Blob([await res.arrayBuffer()], { type: "video/mp4" });
}

/**
 * Incruste le calque texte sur la vidéo d'origine, côté serveur.
 * La vidéo n'est pas rejouée : elle est réencodée une fois avec l'image posée
 * dessus, donc durée, cadence et bande son sont conservées.
 */
export async function burnOverlay(video: File, overlayPng: string): Promise<Blob> {
  const videoBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture de la vidéo impossible"));
    reader.readAsDataURL(video);
  });

  const res = await fetch("/api/studio/burn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoBase64, overlayPng }),
  });

  if (!res.ok) {
    let message = "Incrustation impossible";
    try {
      message = ((await res.json()) as { error?: string }).error || message;
    } catch {
      // réponse non-JSON
    }
    throw new Error(message);
  }
  return new Blob([await res.arrayBuffer()], { type: "video/mp4" });
}

/** Durée réelle d'un fichier vidéo, lue par le navigateur. */
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const finish = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => finish(el.duration);
    el.onerror = () => finish(0);
    window.setTimeout(() => finish(el.duration), 4000);
    el.src = url;
  });
}

/** Nom de fichier aléatoire, pour ne jamais réécrire un export précédent. */
export function randomVideoName(prefix = "creative") {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}.mp4`;
}

export function assetProxy(url: string) {
  return `/api/studio/asset?url=${encodeURIComponent(url)}`;
}

export function libraryFileUrl(id: string, file: string) {
  return `/api/studio/library/file?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`;
}

export async function saveStaticCreative(body: {
  brief?: string;
  prompt: string;
  ratio: Ratio;
  resolution: "1K" | "2K";
  resultUrls: string[];
  referenceUrls?: string[];
}) {
  const res = await fetch("/api/studio/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Sauvegarde créa impossible");
}

export async function pollStudioTask(taskId: string, tries = 60): Promise<StudioTask> {
  let emptyOk = 0;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`/api/studio?taskId=${encodeURIComponent(taskId)}`);
    const body = (await res.json()) as StudioTask & { error?: string };
    if (!res.ok) throw new Error(body.error || "Poll impossible");
    const state = (body.state || "").toLowerCase();
    if ((state === "success" || state === "completed" || state === "finished") && body.urls?.length) {
      return body;
    }
    if (state === "success" || state === "completed" || state === "finished") {
      emptyOk += 1;
      if (emptyOk >= 6) throw new Error("Tâche OK mais aucune image renvoyée");
    }
    if (state === "fail" || state === "failed" || state === "error") {
      throw new Error(body.failMsg || "Génération échouée");
    }
    await new Promise((r) => setTimeout(r, i < 4 ? 1200 : 2200));
  }
  throw new Error("Timeout — réessaie");
}
