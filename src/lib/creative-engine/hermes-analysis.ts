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

export async function askHermesForAnalysis(prompt: string): Promise<string> {
  const config = hermesChatConfig();
  if (!config) throw new Error("Hermes non configuré (HERMES_API_URL / HERMES_API_SERVER_KEY)");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
          {
            role: "system",
            content:
              "You are the product-analysis engine of the MSGate CRM Creative Engine. The product page has already been read; everything you need is in the message. Answer with the requested JSON object ONLY: no prose before or after, no markdown fences. Infer category, product type, class and every field from the page content itself, never from assumptions about the niche. This is a read-only task: do not browse, do not call tools that write or generate anything.",
          },
          { role: "user", content: prompt },
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
    if (controller.signal.aborted) throw new Error("Hermes n'a pas répondu dans les 3 minutes");
    throw error instanceof Error ? error : new Error("Hermes injoignable");
  } finally {
    clearTimeout(timer);
  }
}
