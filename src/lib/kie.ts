import { getApiKey, getSettings } from "./db";

export const KIE_BASE = "https://api.kie.ai";

export class KieError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

function headers() {
  const key = getApiKey();
  if (!key) {
    throw new KieError(
      "Aucune cle API KIE configuree (Reglages, ou KIE_API_KEY dans .env.local).",
      401,
    );
  }
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function kieFetch(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${KIE_BASE}${pathname}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let json: { code?: number; msg?: string; data?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new KieError(`Reponse KIE illisible (HTTP ${res.status}) : ${text.slice(0, 300)}`, res.status);
  }
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new KieError(json.msg || `Erreur KIE (HTTP ${res.status})`, json.code || res.status);
  }
  return json.data;
}

/** GET /api/v1/chat/credit -> credits restants */
export async function getCredits(): Promise<number> {
  const data = await kieFetch("/api/v1/chat/credit", { method: "GET" });
  return typeof data === "number" ? data : Number((data as { credits?: number })?.credits ?? 0);
}

/** POST /api/v1/jobs/createTask -> taskId */
export async function createTask(
  model: string,
  input: Record<string, unknown>,
  callBackUrl?: string,
) {
  const body: Record<string, unknown> = { model, input };
  if (callBackUrl) body.callBackUrl = callBackUrl;
  const data = (await kieFetch("/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { taskId?: string; task_id?: string };
  const taskId = data?.taskId || data?.task_id;
  if (!taskId) throw new KieError("KIE n'a pas renvoye de taskId.");
  return taskId;
}

export interface TaskRecord {
  taskId: string;
  model: string;
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  resultUrls: string[];
  creditsConsumed: number;
  failMsg: string;
  progress: number;
  /** Duree de generation renvoyee par KIE, en millisecondes. */
  costTime: number;
}

/** GET /api/v1/jobs/recordInfo?taskId=... */
export async function getTask(taskId: string): Promise<TaskRecord> {
  const data = (await kieFetch(
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { method: "GET" },
  )) as Record<string, unknown>;

  let resultUrls: string[] = [];
  const raw = data?.resultJson;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { resultUrls?: string[] };
      resultUrls = parsed.resultUrls ?? [];
    } catch {
      resultUrls = [];
    }
  }

  return {
    taskId: String(data?.taskId ?? taskId),
    model: String(data?.model ?? ""),
    state: (data?.state as TaskRecord["state"]) ?? "waiting",
    resultUrls,
    creditsConsumed: Number(data?.creditsConsumed ?? 0),
    failMsg: String(data?.failMsg ?? ""),
    // KIE publie tantot 0-1, tantot 0-100 selon le modele : on normalise.
    progress: (() => {
      const p = Number(data?.progress ?? 0);
      if (!Number.isFinite(p) || p <= 0) return 0;
      return p <= 1 ? Math.round(p * 100) : Math.min(Math.round(p), 100);
    })(),
    costTime: Number(data?.costTime ?? 0),
  };
}

/**
 * Couche texte : traduction des scripts et analyse de contenu.
 * KIE expose un endpoint compatible OpenAI sur /v1/chat/completions.
 * Le message systeme y passe comme premier message de la conversation.
 */
export async function askText(prompt: string, system: string, maxTokens = 8000): Promise<string> {
  const key = getApiKey();
  if (!key) throw new KieError("Aucune cle API KIE configuree.", 401);
  const model = getSettings().kieTextModel;

  const res = await fetch(`${KIE_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new KieError(`Erreur modele texte KIE (HTTP ${res.status}) : ${text.slice(0, 400)}`, res.status);
  }

  let json: {
    code?: number;
    msg?: string;
    choices?: { message?: { content?: string } }[];
    content?: { type: string; text?: string }[];
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new KieError(`Reponse texte illisible : ${text.slice(0, 300)}`);
  }

  // KIE renvoie HTTP 200 avec un code d'erreur applicatif (ex. 422 modele inconnu).
  if (json.code && json.code !== 200 && !json.choices) {
    throw new KieError(
      json.msg === "The model is not supported"
        ? `Le modele texte « ${model} » n'est pas disponible sur ton compte KIE. Change-le dans Reglages.`
        : json.msg || "Erreur du modele texte.",
      json.code,
    );
  }

  const openai = json.choices?.[0]?.message?.content;
  if (openai) return openai;
  // Filet de securite si l'endpoint bascule un jour au format Anthropic.
  const anthropic = json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  if (anthropic) return anthropic;
  throw new KieError("Le modele texte a renvoye une reponse vide.");
}

/**
 * Variante multimodale de askText : le modele voit les images fournies.
 *
 * KIE accepte les parties `image_url` au format OpenAI, en URL publique comme
 * en data URI. La video et l'audio, eux, ne sont PAS ingeres (verifie : le
 * modele repond sans consommer de tokens de prompt), donc pas de
 * transcription possible par ce canal.
 */
export async function askVision(
  prompt: string,
  system: string,
  imageUrls: string[],
  maxTokens = 8000,
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<string> {
  const key = getApiKey();
  if (!key) throw new KieError("Aucune cle API KIE configuree.", 401);
  const model = opts.model || getSettings().kieTextModel;

  const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  for (const url of imageUrls.filter(Boolean)) {
    content.push({ type: "image_url", image_url: { url } });
  }

  // Verifie en octobre 2026 : seul gemini-3-pro est accepte sur ce chat (les
  // flash, GPT et Claude repondent « not supported »). Compter 1 a 2 min avec image.
  let res: Response;
  try {
    res = await fetch(`${KIE_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      }),
      cache: "no-store",
      // Un modele qui ne repond pas en temps raisonnable est abandonne : derriere
      // Cloudflare, au-dela de 100 s le navigateur recoit une erreur de toute facon.
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (e) {
    throw new KieError(`Le modele ${model} n'a pas repondu a temps.`, 504);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new KieError(`Erreur modele vision KIE (HTTP ${res.status}) : ${text.slice(0, 400)}`, res.status);
  }

  let json: {
    code?: number;
    msg?: string;
    choices?: { message?: { content?: string } }[];
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new KieError(`Reponse vision illisible : ${text.slice(0, 300)}`);
  }
  if (json.code && json.code !== 200 && !json.choices) {
    throw new KieError(json.msg || "Erreur du modele vision.", json.code);
  }

  const out = json.choices?.[0]?.message?.content;
  if (!out) throw new KieError("Le modele vision a renvoye une reponse vide.");
  return out;
}

/** Extrait le premier objet JSON d'une reponse LLM (tolere les blocs ```json). */
export function parseJsonLoose<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new KieError("Le modele n'a pas renvoye de JSON exploitable.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/**
 * Televersement d'un fichier chez KIE.
 *
 * Les modeles KIE vont CHERCHER les medias sur internet : ils ne lisent jamais
 * un fichier local, et /api/media n'est servi que sur la machine. On passe donc
 * par le stockage temporaire de KIE, qui renvoie une URL publique.
 *
 * Les fichiers y sont supprimes au bout de 3 jours : c'est du transit, pas du
 * stockage. Le resultat des generations, lui, reste sur KIE.
 */
const KIE_UPLOAD = "https://kieai.redpandaai.co/api/file-stream-upload";

export async function uploadToKie(file: File, uploadPath = "princexd"): Promise<string> {
  const key = getApiKey();
  if (!key) throw new KieError("Aucune cle API KIE configuree.", 401);

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("uploadPath", uploadPath);

  const res = await fetch(KIE_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    cache: "no-store",
  });

  const text = await res.text();
  let json: { success?: boolean; code?: number; msg?: string; data?: { downloadUrl?: string } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new KieError(`Reponse d'upload illisible (HTTP ${res.status}) : ${text.slice(0, 200)}`, res.status);
  }
  if (!res.ok || json.success === false || (json.code && json.code !== 200)) {
    throw new KieError(json.msg || `Echec de l'upload (HTTP ${res.status}).`, json.code || res.status);
  }

  const url = json.data?.downloadUrl;
  if (!url) throw new KieError("L'upload n'a pas renvoye d'URL.");
  return url;
}
