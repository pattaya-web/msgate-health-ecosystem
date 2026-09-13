import { createKieTask, kieClaude, pollKieTask, toRawBase64, uploadBase64 } from "@/lib/studio/kie";
import { analyzeCreative, extractAudio, shotFrames } from "@/lib/ugc/remake";
import type { Angle, ProductInput } from "@/lib/ugc/types";
import { clampDuration } from "@/lib/ugc/types";
import type {
  ScriptTemplate,
  StaticElement,
  StaticSpec,
  StyleTemplate,
  VideoShotSpec,
  VideoSpec,
} from "@/lib/creative-library/types";

/**
 * Relevés et adaptations de la bibliothèque.
 *
 * Relever, c'est lire une créa de référence UNE fois et en garder le
 * dispositif. Adapter, c'est rejouer ce dispositif sur un produit : les textes
 * sont réécrits au même calibre, la structure ne bouge pas. Tout passe par le
 * Claude de Kie, en JSON strict — la prose d'enrobage est tolérée et retirée.
 */

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[{[]/);
  const endObj = candidate.lastIndexOf("}");
  const endArr = candidate.lastIndexOf("]");
  const end = Math.max(endObj, endArr);
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

function productBrief(product: ProductInput) {
  const points = product.keyPoints.filter(Boolean);
  return [
    `Name: ${product.name}`,
    product.brand ? `Brand: ${product.brand}` : "",
    product.description ? `What it is: ${product.description}` : "",
    product.price ? `Price: ${product.price}` : "",
    product.comparePrice ? `Was: ${product.comparePrice}` : "",
    points.length ? `Selling points: ${points.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Statiques                                                           */
/* ------------------------------------------------------------------ */

/**
 * Lit une statique de référence : mise en page, éléments, typographie. Les
 * textes sont gardés tels quels — c'est le calibre qu'on réutilisera. Aucun
 * produit n'est encore impliqué : ce relevé est neutre et se range en l'état.
 */
export async function analyzeStaticReference(imageDataUrl: string, aspect: string): Promise<StaticSpec> {
  const raw = await kieClaude(
    `This image is a static ad creative that performs well. I want to save its DEVICE as a
reusable template, to rebuild the same creative later for other products.
Return ONLY this JSON, nothing else:
{
  "layout": "one paragraph: framing and crop, where the product sits and at what scale and angle, background colour and treatment, lighting, how the surface is divided, where the text blocks sit",
  "fontStyle": "one sentence: the single typographic direction — weights, case, serif or sans, colours",
  "elements": [
    {
      "kind": "headline | subheadline | sticky note | handwritten caption | arrow | benefit callout with arrow | circle | underline | price tag | badge | sticker | press logo bar | cta button | icon list item | body paragraph | cartoon character | photo element",
      "style": "exact visual treatment — colour, texture, font feel, rotation, size relative to the frame",
      "position": "where it sits, e.g. top-left over the wall, lower right of the product",
      "sourceText": "the exact words in the image, empty string if the element carries no text",
      "role": "hook | benefit | objection handled | price anchor | urgency | social proof"
    }
  ]
}
Rules:
- List EVERY text and graphic device: arrows, badges, tapes, press bars, buttons, icons, characters.
- Never say panels show different variants: describe them as angles or crops of one product.
- Do not emit the brand logo or wordmark as an element.`,
    2500,
    [toRawBase64(imageDataUrl)]
  );
  const json = extractJson(raw);
  if (!json) throw new Error(`Relevé illisible — le modèle a répondu : « ${raw.slice(0, 120)}… »`);
  const parsed = JSON.parse(json) as { layout?: string; fontStyle?: string; elements?: Array<Partial<StaticElement>> };
  const elements: StaticElement[] = (parsed.elements ?? [])
    .filter((element) => element && (element.kind || element.sourceText))
    .filter((element) => !/logo|wordmark|signature|watermark/i.test(String(element.kind ?? "")))
    .map((element) => ({
      kind: String(element.kind ?? "element"),
      style: String(element.style ?? ""),
      position: String(element.position ?? ""),
      sourceText: String(element.sourceText ?? ""),
      role: String(element.role ?? "benefit"),
      adaptedText: "",
    }));
  return {
    layout: String(parsed.layout ?? ""),
    fontStyle: parsed.fontStyle ? String(parsed.fontStyle) : undefined,
    elements,
    aspect,
  };
}

/**
 * Réécrit les textes d'un style statique pour un produit. Même longueur, même
 * registre, même mouvement rhétorique — et jamais la marque d'origine.
 */
export async function adaptStaticToProduct(spec: StaticSpec, product: ProductInput): Promise<StaticElement[]> {
  const textual = spec.elements.filter((element) => element.sourceText.trim());
  if (!textual.length) return spec.elements;

  const raw = await kieClaude(
    `I rebuild a winning static ad for MY product. Here are the text elements of the source ad.
For each one, write the same beat for my product: same length and rhythm, same register,
same lowercase or uppercase style, same punctuation habits. Keep it truthful — never invent
a claim my product cannot support. Use my real price where the source shows a price. Never
carry over the source brand, product category or press names that I have not earned:
for a press logo bar, write a generic "As seen in" line only if my product has press, else
return an empty string.

MY PRODUCT:
${productBrief(product)}

SOURCE ELEMENTS (JSON):
${JSON.stringify(textual.map((element, index) => ({ index, kind: element.kind, role: element.role, sourceText: element.sourceText })))}

Return ONLY JSON: {"adapted":[{"index":0,"text":"..."}]}`,
    2500
  );
  const json = extractJson(raw);
  if (!json) throw new Error("Adaptation illisible");
  const parsed = JSON.parse(json) as { adapted?: Array<{ index: number; text: string }> };
  const byIndex = new Map((parsed.adapted ?? []).map((row) => [row.index, String(row.text ?? "")]));

  let cursor = 0;
  return spec.elements.map((element) => {
    if (!element.sourceText.trim()) return { ...element, adaptedText: "" };
    const text = byIndex.get(cursor) ?? "";
    cursor += 1;
    return { ...element, adaptedText: text };
  });
}

/* ------------------------------------------------------------------ */
/* Vidéos                                                              */
/* ------------------------------------------------------------------ */

async function transcribe(audio: Buffer): Promise<string> {
  const url = await uploadBase64(`data:audio/mp4;base64,${audio.toString("base64")}`, `ref-${Date.now()}.m4a`);
  const taskId = await createKieTask("elevenlabs/speech-to-text", { audio_url: url });
  const task = await pollKieTask(taskId, 40);
  const direct = (task.urls || []).find((item) => typeof item === "string" && !/^https?:/i.test(item));
  if (direct) return String(direct).trim();
  const fileUrl = (task.urls || []).find((item) => /^https?:/i.test(String(item)));
  if (!fileUrl) return "";
  const res = await fetch(String(fileUrl), { cache: "no-store" });
  const raw = await res.text();
  try {
    return String((JSON.parse(raw) as { text?: string }).text || raw).trim();
  } catch {
    return raw.trim();
  }
}

/**
 * Relève une vidéo de référence : grille de plans (ffmpeg), cadrage de chaque
 * plan et bloc de style (Claude sur les images clés), transcription (ElevenLabs).
 * Le script est ensuite réparti sur les plans au prorata de leur durée.
 */
export async function analyzeVideoReference(buffer: Buffer): Promise<{ spec: VideoSpec; poster: string | null }> {
  const analysis = await analyzeCreative(buffer);
  const [frames, audio] = await Promise.all([
    shotFrames(buffer, analysis.shots).catch(() => [] as string[]),
    extractAudio(buffer).catch(() => null),
  ]);

  const usable = frames.filter(Boolean);
  let framing: string[] = [];
  let styleBlock = "";
  if (usable.length) {
    try {
      const raw = await kieClaude(
        `Each image is one shot from a short vertical ad, in order.
Return ONLY this JSON:
{
  "style": "one paragraph describing the creative DEVICE of this ad: type of creator video (selfie, facecam, podcast, interview, street, vlog, b-roll, screen recording), energy and pacing, lighting, setting mood, how the product is shown, on-screen text habits. Do not name the brand.",
  "shots": ["one sentence per image, in order: shot size, camera angle and height, camera movement, lighting quality. Do NOT describe the people, the product, the brand or the text."]
}`,
        2000,
        usable
      );
      const json = extractJson(raw);
      if (json) {
        const parsed = JSON.parse(json) as { style?: string; shots?: string[] };
        styleBlock = String(parsed.style ?? "");
        framing = (parsed.shots ?? []).map((item) => String(item ?? "").trim());
      }
    } catch {
      // Le cadrage est un bonus : la grille de plans et le script suffisent.
    }
  }

  let transcript = "";
  if (audio) {
    try {
      transcript = await transcribe(audio);
    } catch {
      transcript = "";
    }
  }

  // Le script est réparti sur les plans au prorata de la durée : approximatif,
  // mais chaque plan reçoit ainsi ce qui se dit à peu près à ce moment-là.
  const words = transcript.split(/\s+/).filter(Boolean);
  const total = analysis.shots.reduce((sum, shot) => sum + shot.duration, 0) || 1;
  let wordCursor = 0;
  let frameCursor = 0;
  const shots: VideoShotSpec[] = analysis.shots.map((shot, index) => {
    const take = index === analysis.shots.length - 1
      ? words.length - wordCursor
      : Math.round((shot.duration / total) * words.length);
    const line = words.slice(wordCursor, wordCursor + take).join(" ");
    wordCursor += take;
    const frame = frames[index] ? framing[frameCursor++] ?? "" : "";
    return { index, duration: clampDuration(shot.duration), framing: frame, line };
  });

  const poster = usable[0] ? `data:image/jpeg;base64,${usable[0]}` : null;
  return {
    spec: { duration: analysis.duration, shots, transcript, styleBlock },
    poster,
  };
}

/**
 * Rejoue un style vidéo sur un produit : le script est réécrit plan par plan
 * (même déroulé, même calibre), et chaque plan devient une scène UGC prête à
 * partir en génération, avec son cadrage relevé.
 */
export async function adaptVideoToProduct(style: StyleTemplate, product: ProductInput): Promise<Angle> {
  const spec = style.video;
  if (!spec) throw new Error("Ce style n'est pas une vidéo");
  const spoken = spec.shots.filter((shot) => shot.line.trim());

  let lines = new Map<number, string>();
  if (spoken.length) {
    const raw = await kieClaude(
      `Here is the spoken script of a video ad that performs well, split by shot.
Rewrite it for MY product, shot by shot: keep the same structure beat for beat — same hook
shape, same order of arguments, same closing move — and a very close word count per shot,
because each line has to fit the same edit. Never carry over the source brand or product
category. Stay truthful to my product.

MY PRODUCT:
${productBrief(product)}

SOURCE SHOTS (JSON):
${JSON.stringify(spoken.map((shot) => ({ index: shot.index, seconds: shot.duration, line: shot.line })))}

Return ONLY JSON: {"shots":[{"index":0,"line":"..."}]}`,
      2500
    );
    const json = extractJson(raw);
    if (!json) throw new Error("Réécriture du script illisible");
    const parsed = JSON.parse(json) as { shots?: Array<{ index: number; line: string }> };
    lines = new Map((parsed.shots ?? []).map((row) => [row.index, String(row.line ?? "")]));
  }

  return {
    id: `style-${style.id}`,
    name: style.name,
    pitch: style.pitch,
    scenes: spec.shots.map((shot) => {
      const line = lines.get(shot.index) ?? "";
      return {
        label: `Plan ${shot.index + 1}`,
        duration: shot.duration,
        prompt: [
          `SCENE: ${shot.framing || "Medium shot, eye level, handheld, natural light."} The protagonist ${
            line ? "talks to the camera while showing {{product_name}} naturally." : "shows {{product_name}} in use, no speech, ambient sound only."
          }`,
          line ? `DIALOGUE (exact, no improv): "${line.replace(/"/g, "'")}"` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Scripts                                                             */
/* ------------------------------------------------------------------ */

/**
 * Réadapte un script gagnant à un produit et le découpe en scènes de 4 à 15 s.
 * Le découpage suit les phrases, au débit d'un créateur (~2,4 mots/seconde).
 */
export async function adaptScriptToProduct(script: ScriptTemplate, product: ProductInput): Promise<Angle> {
  const raw = await kieClaude(
    `Here is the spoken script of an ad that performs well:
"""
${script.text}
"""
Rewrite it for MY product. Keep the same structure beat for beat — same hook shape, same
order of arguments, same closing move — and a very close word count. Never carry over the
source brand or product category. Stay truthful to my product.
Then split the rewritten script into 3 to 5 consecutive beats, each 8 to 30 words, and give
each beat a two-word label and a one-sentence on-camera action for a creator holding or
using the product.

MY PRODUCT:
${productBrief(product)}

Return ONLY JSON: {"beats":[{"label":"Hook","action":"...","line":"..."}]}`,
    2500
  );
  const json = extractJson(raw);
  if (!json) throw new Error("Adaptation du script illisible");
  const parsed = JSON.parse(json) as { beats?: Array<{ label: string; action: string; line: string }> };
  const beats = (parsed.beats ?? []).filter((beat) => beat && beat.line);
  if (!beats.length) throw new Error("Le script adapté est vide");

  return {
    id: `script-${script.id}`,
    name: script.name,
    pitch: script.source ? `Script « ${script.name} » (${script.source})` : `Script « ${script.name} »`,
    scenes: beats.map((beat) => {
      const words = String(beat.line).split(/\s+/).filter(Boolean).length;
      return {
        label: String(beat.label || "Beat"),
        duration: clampDuration(Math.ceil(words / 2.4) + 1),
        prompt: [
          `SCENE: ${String(beat.action || "The protagonist talks to the camera holding {{product_name}}.")}`,
          `DIALOGUE (exact, no improv): "${String(beat.line).replace(/"/g, "'")}"`,
        ].join("\n\n"),
      };
    }),
  };
}
