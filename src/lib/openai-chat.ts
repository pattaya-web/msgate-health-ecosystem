import { getOpenAiKey, OPENAI_BASE } from "@/lib/openai";

/**
 * Un texte écrit par OpenAI, en JSON.
 *
 * Sert de relais quand Claude chez Kie ne répond pas (429 « Internal error »
 * fréquents) : la copie d'une boutique ne doit pas retomber sur des textes
 * génériques parce qu'un fournisseur est saturé.
 */
export async function openaiJsonText(prompt: string, maxTokens = 6000, timeoutMs = 60_000) {
  const key = getOpenAiKey();
  if (!key) throw new Error("Aucune clé OpenAI configurée");
  let lastError = "";
  for (const model of ["gpt-4.1-mini", "gpt-4o-mini"]) {
    try {
      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      const content = body.choices?.[0]?.message?.content;
      if (res.ok && content) return content;
      lastError = body.error?.message || `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "échec";
    }
  }
  throw new Error(`OpenAI indisponible (${lastError})`);
}
