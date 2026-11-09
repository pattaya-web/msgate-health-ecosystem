import { getOpenAiKey, OPENAI_BASE } from "@/lib/openai";

/**
 * Les documents de LLC qui n'ont pas de texte : PDF scannés, photos, captures.
 *
 * Les statuts et la lettre EIN arrivent presque toujours scannés : la lecture
 * texte du PDF n'en tire rien, et le formulaire restait vide. Un modèle de
 * vision lit le document comme on le lirait à l'écran — PDF envoyé tel quel,
 * images en data URL — et rend directement les champs.
 */

export type VisualDoc = { fileName: string; pdfBase64?: string; imageDataUrl?: string };

/** Du plus économique au plus solide : on passe au suivant si l'un refuse. */
const MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4o"];

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

function partsFor(docs: VisualDoc[]): Part[] {
  const parts: Part[] = [];
  for (const doc of docs) {
    if (doc.pdfBase64) {
      const data = doc.pdfBase64.includes("base64,") ? doc.pdfBase64.slice(doc.pdfBase64.indexOf("base64,") + 7) : doc.pdfBase64;
      parts.push({ type: "file", file: { filename: doc.fileName.endsWith(".pdf") ? doc.fileName : `${doc.fileName}.pdf`, file_data: `data:application/pdf;base64,${data}` } });
    } else if (doc.imageDataUrl) {
      parts.push({ type: "image_url", image_url: { url: doc.imageDataUrl } });
    }
  }
  return parts;
}

/** Les champs lus sur les documents, ou une erreur lisible si aucun modèle n'a répondu. */
export async function readLlcVisually(docs: VisualDoc[], prompt: string): Promise<Record<string, string>> {
  const key = getOpenAiKey();
  if (!key) throw new Error("Lecture des scans indisponible : aucune clé OpenAI configurée.");
  const files = partsFor(docs);
  if (!files.length) throw new Error("Aucun document à lire.");

  let lastError = "";
  for (const model of MODELS) {
    try {
      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: [...files, { type: "text", text: prompt }] }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        lastError = body.error?.message || `HTTP ${res.status}`;
        continue;
      }
      const raw = body.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([field, value]) => [field, typeof value === "string" ? value.trim() : ""]));
    } catch (error) {
      lastError = error instanceof Error ? error.message : "échec";
    }
  }
  throw new Error(`Lecture des scans impossible (${lastError}). Remplis les champs à la main.`);
}
