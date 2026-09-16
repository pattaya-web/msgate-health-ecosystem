import { hermesChatConfig } from "@/lib/ask-hermes/config";

/**
 * Secours de l'analyse produit : quand la passerelle Claude de Kie ne répond
 * pas, la même consigne (fiche déjà lue, même JSON attendu) est posée à
 * l'instance Hermes par son API Server, en un seul tour, sans streaming.
 * Kie reste le chemin principal ; ici on ne fait que rendre le texte brut,
 * la lecture et la validation restent dans analysis.ts.
 */

const TIMEOUT_MS = 180_000;

export function hermesAnalysisAvailable() {
  return hermesChatConfig() !== null;
}

const ANALYSIS_SYSTEM =
  "You are the product-analysis engine of the MSGate CRM Creative Engine. The product page has already been read; everything you need is in the message. Answer with the requested JSON object ONLY: no prose before or after, no markdown fences. Infer category, product type, class and every field from the page content itself, never from assumptions about the niche. This is a read-only task: do not browse, do not call tools that write or generate anything.";

export function askHermesForAnalysis(prompt: string): Promise<string> {
  return askHermesText(prompt, ANALYSIS_SYSTEM);
}

/** Un tour texte, sans streaming, avec une consigne système : rend le texte brut de Hermes. */
export function askHermesText(prompt: string, system: string): Promise<string> {
  return askHermes(prompt, system, []);
}

/**
 * Un tour avec des images jointes au message, au format OpenAI que l'API
 * Server de Hermes accepte. Mesuré : Hermes lit une image donnée par URL
 * https (il la charge lui-même et la décrit), mais pas une data URL (« this
 * model does not support image input ») — joindre des URLs hébergées. Si le
 * modèle ne voit vraiment pas, il le dit en prose : à l'appelant de le détecter.
 */
export function askHermesVision(prompt: string, system: string, images: string[], timeoutMs = TIMEOUT_MS): Promise<string> {
  return askHermes(prompt, system, images, timeoutMs);
}

/** Vrai quand la réponse dit que le modèle ne voit pas l'image (Hermes sur un modèle texte seul). */
export function hermesCannotSee(text: string): boolean {
  const sample = text.slice(0, 1200);
  return (
    /(can(?:'|\u2019|no)?t|cannot|unable to|not able to|was(?:n'?t| not) able to|don'?t have (?:the )?(?:ability|capability)|no (?:ability|way) to|doesn'?t support|does not support|not support(?:ed)?|text-only|text only|only (?:process|handle|read|understand) text)[^.\n]{0,80}(image|picture|photo|visual|vision|see|view)/i.test(sample) ||
    /(image|picture|photo|visual)s?[^.\n]{0,60}(not supported|unsupported|can(?:'|\u2019|no)?t be (?:seen|viewed|processed|analy[sz]ed))/i.test(sample) ||
    /no image (?:was )?(?:attached|received|provided)/i.test(sample)
  );
}

async function askHermes(prompt: string, system: string, images: string[], timeoutMs = TIMEOUT_MS): Promise<string> {
  const config = hermesChatConfig();
  if (!config) throw new Error("Hermes non configuré (HERMES_API_URL / HERMES_API_SERVER_KEY)");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
        "X-Hermes-Session-Id": `crm-engine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        "X-Hermes-Session-Key": "msgate-crm:creative-engine",
      },
      body: JSON.stringify({
        model: "hermes-agent",
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: images.length ? [...images.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })), { type: "text" as const, text: prompt }] : prompt },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Hermes a répondu ${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part.text ?? "").join("") : "";
    if (!text.trim()) throw new Error("Hermes n'a rien renvoyé");
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Hermes n'a pas répondu dans les ${Math.round(timeoutMs / 60_000)} minutes`);
    throw error instanceof Error ? error : new Error("Hermes injoignable");
  } finally {
    clearTimeout(timer);
  }
}
