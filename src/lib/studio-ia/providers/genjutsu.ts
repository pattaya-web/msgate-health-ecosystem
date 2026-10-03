import { getSettings } from "@/lib/db";
import { HIGGSFIELD, PROVIDERS } from "../config";
import type { ProviderInput } from "../types";
import type { PollResult, StartResult, VideoProvider } from "./types";

/**
 * Higgsfield Genjutsu — Object Swap (docs.higgsfield.ai).
 *
 * POST https://api.higgsfield.ai/higgsfield/genjutsu/object-swap/v1.0
 *   body : { prompt, video_url, image_urls[], resolution: 480p | 720p }
 *   auth : Authorization: Key <KEY_ID>:<KEY_SECRET>
 *   → { status: "queued", request_id, status_url, cancel_url }
 * GET  https://api.higgsfield.ai/requests/{request_id}/status
 *   → { status: queued | in_progress | completed | failed | nsfw | canceled, video: { url }, error }
 *
 * C'est l'outil de la capture : une video, des photos de reference (la fille
 * sous plusieurs angles, le produit) et une phrase. Facture par Higgsfield en
 * dollars, pas en credits KIE : 0,318 $/s en 480p, 0,681 $/s en 720p.
 */

export class HiggsfieldError extends Error {
  code: number;
  constructor(message: string, code = 502) {
    super(message);
    this.code = code;
  }
}

/**
 * Identifiants : variables d'environnement d'abord, sinon Reglages.
 *
 * Deux formats existent chez Higgsfield :
 *  - un couple KEY_ID:KEY_SECRET → en-tete `Authorization: Key id:secret` ;
 *  - une cle unique (nouvelle console) → `Authorization: Bearer <cle>`.
 * On accepte : ID + secret dans deux champs, « id:secret » colle dans le
 * champ secret, ou une cle seule dans le champ secret.
 */
export function getHiggsfieldAuth(): string | null {
  const s = getSettings();
  const single = process.env.HIGGSFIELD_API_KEY?.trim();
  if (single) return single.includes(":") ? `Key ${single}` : `Bearer ${single}`;
  const id = process.env[HIGGSFIELD.envKeyId]?.trim() || (s.higgsfieldKeyId ?? "").trim();
  const secret = process.env[HIGGSFIELD.envKeySecret]?.trim() || (s.higgsfieldKeySecret ?? "").trim();
  if (!secret) return null;
  if (secret.includes(":")) return `Key ${secret}`;
  if (id) return `Key ${id}:${secret}`;
  return `Bearer ${secret}`;
}

/** Compatibilite : vrai si des identifiants sont configures. */
export function getHiggsfieldKeys(): { configured: boolean } {
  return { configured: Boolean(getHiggsfieldAuth()) };
}

function authHeaders(): Record<string, string> {
  const auth = getHiggsfieldAuth();
  if (!auth) {
    throw new HiggsfieldError(
      "Clé Higgsfield manquante : crée-la sur console.higgsfield.ai (API keys) puis colle-la dans Réglages → Higgsfield, ou dans HIGGSFIELD_API_KEY.",
      401,
    );
  }
  return { Authorization: auth, "Content-Type": "application/json" };
}

async function hfFetch(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) }, cache: "no-store" });
    } catch (e) {
      lastErr = (e as Error).message;
      if (attempt < 2) await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
  }
  if (!res) throw new HiggsfieldError(`Higgsfield injoignable (${lastErr || "réseau"}).`, 504);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new HiggsfieldError(`Réponse Higgsfield illisible (HTTP ${res.status}) : ${text.slice(0, 200)}`, res.status);
  }
  if (!res.ok) {
    const detail = String((json.detail as string) ?? (json.error as string) ?? (json.message as string) ?? text.slice(0, 200));
    if (res.status === 401) throw new HiggsfieldError("Clé Higgsfield refusée (401). Vérifie-la dans Réglages → Higgsfield : clé unique, ou ID:SECRET.", 401);
    if (res.status === 402 || /credit|balance|insufficient/i.test(detail)) {
      throw new HiggsfieldError(`Solde Higgsfield insuffisant : ${detail}`, 402);
    }
    throw new HiggsfieldError(`Higgsfield a refusé la demande (HTTP ${res.status}) : ${detail}`, res.status);
  }
  return json;
}

/**
 * Le prompt Genjutsu est court, comme dans leur interface : une phrase de
 * remplacement, la protection du produit si besoin, puis la consigne.
 */
export function genjutsuPrompt(i: ProviderInput): string {
  const user = i.userPrompt?.trim() ?? "";
  // Une consigne deja structuree (bouton « Rédiger la consigne ») part telle quelle.
  if (/^edit @video/i.test(user)) return user.slice(0, 3900);
  const several = (i.referenceImageUrls?.length ?? 0) > 1;
  const parts = [
    several
      ? "Replace the main character entirely with the person shown in my reference images (the same person: close-up face first, then full-body views): reproduce her exact face (eyes, nose, lips, jawline, skin tone), hair and outfit. Nothing of the original person's face may remain."
      : "Replace the main character entirely with the person from my reference image: reproduce her exact face (eyes, nose, lips, jawline, skin tone), hair and outfit. Nothing of the original person's face may remain.",
  ];
  if (i.sceneImageUrl) parts.push("Replace the scene location with the environment from my references.");
  if (i.product?.urls.length) {
    parts.push(`Keep the product held in the hand exactly as shown in the product reference images (${i.product.description?.trim() || "the product"}): same label, colors and shape.`);
  }
  parts.push(i.sceneImageUrl ? "Keep the original video's motion, camera, framing and timing." : "Keep the original video's motion, camera, framing, background and timing.");
  if (user) parts.push(user);
  return parts.join(" ").slice(0, 3900);
}

export const genjutsu: VideoProvider = {
  config: PROVIDERS.genjutsu,
  buildPayload: (i) => ({
    prompt: genjutsuPrompt(i),
    video_url: i.sourceVideoUrl,
    // Ordre = numerotation @Image N de la consigne : personne, produit, decor.
    image_urls: [
      ...(i.referenceImageUrls?.length ? i.referenceImageUrls : [i.referenceImageUrl]),
      ...(i.product?.urls ?? []),
      ...(i.sceneImageUrl ? [i.sceneImageUrl] : []),
    ].slice(0, 8),
    resolution: "720p",
  }),
  async generateVideoTransformation(input): Promise<StartResult> {
    const payload = genjutsu.buildPayload(input);
    const json = await hfFetch(`${HIGGSFIELD.baseUrl}/${HIGGSFIELD.objectSwapPath}`, { method: "POST", body: JSON.stringify(payload) });
    const id = String(json.request_id ?? "");
    if (!id) throw new HiggsfieldError("Higgsfield n'a pas renvoyé d'identifiant de requête.");
    return { providerJobId: id, payload };
  },
  async poll(providerJobId): Promise<PollResult> {
    const json = await hfFetch(`${HIGGSFIELD.baseUrl}/requests/${encodeURIComponent(providerJobId)}/status`, { method: "GET" });
    const status = String(json.status ?? "queued");
    const video = json.video as { url?: string } | null | undefined;
    const state: PollResult["state"] =
      status === "completed" ? "success"
      : status === "failed" || status === "nsfw" || status === "canceled" ? "fail"
      : status === "in_progress" ? "generating"
      : "waiting";
    const error =
      status === "nsfw" ? "contenu refusé par la modération Higgsfield"
      : status === "canceled" ? "requête annulée"
      : String((json.error as string) ?? "");
    return { state, progress: 0, resultUrl: video?.url ?? "", error, creditsConsumed: 0 };
  },
};
