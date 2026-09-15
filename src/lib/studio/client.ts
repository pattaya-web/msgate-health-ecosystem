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

function toDataUrl(file: Blob, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Lecture ${label} impossible`));
    reader.readAsDataURL(file);
  });
}

export type MontageOptions = {
  clips: File[];
  captions: Array<{ png: string; start: number; end: number }>;
  music?: File | null;
  voice?: File | null;
  musicVolume?: number;
  muteClips?: boolean;
  speed?: number;
  fps?: 30 | 60;
  height?: 1280 | 1920;
};

/**
 * Monte les clips côté serveur.
 *
 * Remplace le montage navigateur, qui rejouait les vidéos en temps réel dans un
 * canvas pour les filmer avec MediaRecorder : les images n'avaient jamais fini
 * de décoder au moment d'être dessinées, et le rendu tombait autour de 5 images
 * par seconde. ffmpeg concatène et réencode en une passe, sans rien rejouer.
 */
export async function composeMontage(options: MontageOptions): Promise<Blob> {
  const clips = await Promise.all(
    options.clips.map((clip, index) => toDataUrl(clip, `du clip ${index + 1}`))
  );

  const res = await fetch("/api/studio/montage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clips,
      captions: options.captions,
      musicBase64: options.music ? await toDataUrl(options.music, "de la musique") : undefined,
      voiceBase64: options.voice ? await toDataUrl(options.voice, "de la voix-off") : undefined,
      musicVolume: options.musicVolume,
      muteClips: options.muteClips,
      speed: options.speed,
      fps: options.fps,
      height: options.height,
    }),
  });

  if (!res.ok) {
    let message = "Montage impossible";
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
  // Un fichier déjà servi par l'app (bibliothèque) n'a pas besoin du proxy.
  if (url.startsWith("/")) return url;
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
  media?: "image" | "video";
}) {
  const res = await fetch("/api/studio/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Sauvegarde créa impossible");
}

/**
 * Portillon de concurrence sur les sondes de tâches.
 *
 * Chaque image en cours interroge Kie en boucle. Sans limite, un lot de vingt
 * plus les lots précédents restaurés au chargement font des dizaines de sondes
 * simultanées : le serveur sérialise, un appel qui prend une seconde en prend
 * quarante, et des images pourtant terminées continuent d'afficher un spinner.
 *
 * Six à la fois suffisent : les tâches mettent de toute façon une minute, et
 * les autres attendent leur tour au lieu d'engorger la file.
 */
const MAX_CONCURRENT_POLLS = 6;
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_POLLS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

export async function pollStudioTask(taskId: string, tries = 60): Promise<StudioTask> {
  let emptyOk = 0;
  for (let i = 0; i < tries; i++) {
    const { res, body } = await withSlot(async () => {
      const response = await fetch(`/api/studio?taskId=${encodeURIComponent(taskId)}`);
      return { res: response, body: (await response.json()) as StudioTask & { error?: string } };
    });
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
