import { kieClaude } from "@/lib/studio/kie";
import { FORMATS, NICHES, type FormatId, type NicheId } from "@/lib/ugc/formats";
import { isPhysical } from "@/lib/ugc/kinds";
import type { Angle, ProductInput } from "@/lib/ugc/types";
import { clampDuration } from "@/lib/ugc/types";

/**
 * Écrit des angles UGC sur mesure à partir d'un brief.
 *
 * La bibliothèque d'angles couvre les mécaniques classiques ; ici on part du
 * sujet lui-même — un produit, un livre, une histoire, un service — et du
 * format choisi, pour obtenir des scènes avec un dialogue exact. Chaque scène
 * garde la grammaire des angles intégrés (SCENE + DIALOGUE), donc elle passe
 * dans la même chaîne de génération sans traitement particulier.
 */
function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

export async function writeAngles(input: {
  product: ProductInput;
  brief: string;
  count: number;
  format?: FormatId | null;
  niche?: NicheId | null;
  language?: "en" | "fr";
}): Promise<Angle[]> {
  const { product } = input;
  const count = Math.min(6, Math.max(1, input.count || 2));
  const points = product.keyPoints.filter(Boolean);
  const physical = isPhysical(product.kind);
  const format = FORMATS.find((item) => item.id === input.format);
  const niche = NICHES.find((item) => item.id === input.niche && item.id !== "none");
  const language = input.language === "fr" ? "French" : "English";

  const raw = await kieClaude(
    `You write short-form creator videos (TikTok / Reels ads) for a ${physical ? "product" : "topic with no physical product"}.

SUBJECT:
Name: ${product.name}
${product.description ? `What it is: ${product.description}` : ""}
${product.price ? `Price: ${product.price}` : ""}
${product.brand ? `Brand: ${product.brand}` : ""}
${points.length ? `Key points: ${points.join("; ")}` : ""}
Kind: ${product.kind}

${format && format.id !== "free" ? `VIDEO FORMAT: ${format.label} — ${format.hint}.` : ""}
${niche ? `CREATOR NICHE: ${niche.label}.` : ""}
${input.brief.trim() ? `USER BRIEF (follow it closely): ${input.brief.trim()}` : ""}

Write exactly ${count} distinct angles. Each angle attacks the purchase from a different
psychological lever (curiosity, proof, contrast, story, fear of missing out, education…).
Each angle has 3 or 4 consecutive scenes. Each scene:
- "label": two words
- "action": one sentence describing what the protagonist does on camera${physical ? ", the product visible and handled naturally" : ", no product prop, natural gestures"}
- "line": the EXACT spoken dialogue in ${language}, 10 to 24 words, conversational, first person, no hashtags, no emojis. The protagonist is already talking when the clip starts.
Hooks must be strong in the first 3 words. Stay truthful: never invent a claim the subject cannot support. Never mention a competitor by name.

Return ONLY JSON:
{"angles":[{"id":"kebab-id","name":"Short name in French","pitch":"one line in French on what it attacks","scenes":[{"label":"...","action":"...","line":"..."}]}]}`,
    4000
  );

  const json = extractJson(raw);
  if (!json) throw new Error(`Le modèle n'a pas rendu d'angles — « ${raw.slice(0, 100)}… »`);
  const parsed = JSON.parse(json) as {
    angles?: Array<{ id?: string; name?: string; pitch?: string; scenes?: Array<{ label?: string; action?: string; line?: string }> }>;
  };

  const stamp = Date.now().toString(36);
  return (parsed.angles ?? [])
    .filter((angle) => angle && Array.isArray(angle.scenes) && angle.scenes.length)
    .map((angle, index) => ({
      id: `custom-${stamp}-${(angle.id || `angle-${index + 1}`).replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`,
      name: String(angle.name || `Angle ${index + 1}`),
      pitch: String(angle.pitch || ""),
      scenes: (angle.scenes ?? [])
        .filter((scene) => scene && scene.line)
        .map((scene, sceneIndex) => {
          const line = String(scene.line).replace(/"/g, "'").trim();
          const words = line.split(/\s+/).filter(Boolean).length;
          return {
            label: String(scene.label || `Scène ${sceneIndex + 1}`),
            duration: clampDuration(Math.ceil(words / 2.4) + 1),
            prompt: [
              `SCENE: ${String(scene.action || "The protagonist talks to the camera.")}`,
              `DIALOGUE (exact, no improv): "${line}"`,
            ].join("\n\n"),
          };
        }),
    }))
    .filter((angle) => angle.scenes.length);
}

/**
 * Angle écrit à la main : une ligne par scène, « Label | secondes | dialogue ».
 * Les deux premiers champs sont facultatifs — une ligne de dialogue seule
 * suffit, la durée se déduit du nombre de mots.
 */
export function parseManualAngle(text: string, name = "Angle manuel"): Angle | null {
  const scenes = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("|").map((part) => part.trim());
      let label = `Scène ${index + 1}`;
      let seconds: number | null = null;
      let dialogue = line;
      if (parts.length >= 3) {
        label = parts[0] || label;
        seconds = Number(parts[1]) || null;
        dialogue = parts.slice(2).join(" | ");
      } else if (parts.length === 2) {
        if (/^\d+$/.test(parts[0])) {
          seconds = Number(parts[0]);
          dialogue = parts[1];
        } else {
          label = parts[0] || label;
          dialogue = parts[1];
        }
      }
      const clean = dialogue.replace(/"/g, "'").trim();
      const words = clean.split(/\s+/).filter(Boolean).length;
      return {
        label,
        duration: clampDuration(seconds ?? Math.ceil(words / 2.4) + 1),
        prompt: [
          "SCENE: The protagonist talks to the camera, {{product_name}} shown naturally in frame.",
          `DIALOGUE (exact, no improv): "${clean}"`,
        ].join("\n\n"),
      };
    });
  if (!scenes.length) return null;
  return {
    id: `manual-${Date.now().toString(36)}`,
    name,
    pitch: "Écrit à la main",
    scenes,
  };
}

/** Une scène éditable côté interface : le prompt est recomposé à la volée. */
export type StoryScene = { label: string; duration: number; action: string; line: string };

export type StoryDraft = {
  title: string;
  /** L'histoire reformulée en trois ou quatre phrases : ce que dira la vidéo. */
  summary: string;
  /**
   * Qui, où, avec quelle caméra — répété tel quel dans chaque clip. C'est ce
   * qui fait qu'un script écrit par l'utilisateur garde SON personnage et SON
   * cadrage, au lieu d'un protagoniste réinventé à chaque scène.
   */
  setting?: string;
  description: string;
  keyPoints: string[];
  scenes: StoryScene[];
};

/**
 * Cale les scènes sur la durée totale voulue. On part de la durée annoncée
 * par le modèle, sinon du nombre de mots, puis on répartit l'écart au prorata
 * en restant dans les bornes de Seedance (4 à 15 s par clip).
 */
export function fitScenes(scenes: StoryScene[], target: number): StoryScene[] {
  if (!scenes.length) return scenes;
  const base = scenes.map((scene) => {
    const words = scene.line.split(/\s+/).filter(Boolean).length;
    return scene.duration > 0 ? scene.duration : Math.ceil(words / 2.4) + 1;
  });
  const sum = base.reduce((total, value) => total + value, 0) || 1;
  const scaled = base.map((value) => clampDuration((value / sum) * target));
  // Les arrondis et les bornes décalent le total : on corrige scène par scène.
  let diff = Math.round(target) - scaled.reduce((total, value) => total + value, 0);
  for (let guard = 0; diff !== 0 && guard < 40; guard += 1) {
    const index = guard % scaled.length;
    const step = diff > 0 ? 1 : -1;
    const next = scaled[index] + step;
    if (next >= 4 && next <= 15) {
      scaled[index] = next;
      diff -= step;
    }
  }
  return scenes.map((scene, index) => ({ ...scene, duration: scaled[index] }));
}

/** Transforme les scènes éditées en angle prêt pour la génération. */
export function angleFromStory(draft: StoryDraft): Angle {
  return {
    id: "story",
    name: draft.title || "Mon histoire",
    pitch: draft.summary,
    scenes: draft.scenes
      .filter((scene) => scene.line.trim() || scene.action.trim())
      .map((scene) => ({
        label: scene.label || "Scène",
        duration: clampDuration(scene.duration),
        prompt: [
          draft.setting?.trim()
            ? `SETTING — where and camera, identical in every clip of this set (when a reference image of the person is supplied, that image wins over any description of the person here): ${draft.setting.trim()}`
            : "",
          `SCENE: ${scene.action.trim() || "The protagonist talks to the camera."}`,
          scene.line.trim()
            ? `DIALOGUE (exact, no improv): "${scene.line.replace(/"/g, "'").trim()}"`
            : "SILENT SHOT — nobody speaks, no lip movement, no narration. Ambient sound only.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      })),
  };
}

/**
 * Découpe un script écrit à la main, sans IA.
 *
 * Quand le passage Claude de Kie est en panne, ou quand l'utilisateur a déjà
 * tout écrit, réécrire n'apporte rien. On lit ce qui se lit sans modèle. Les
 * scripts arrivent sous deux formes :
 *
 * - minutés : « 0:03–0:06 » ouvre une scène, la phrase entre guillemets est la
 *   réplique, le reste du bloc est l'action ;
 * - à entêtes : CHARACTER, ENVIRONMENT, CAMERA, STYLE… décrivent la mise en
 *   place, PERFORMANCE, GESTURES, DELIVERY décrivent le jeu, DIALOGUE porte la
 *   réplique. Une seule réplique et pas de repère de temps = une seule prise.
 */
const SETTING_KEY =
  /^\s*(IMPORTANT|CHARACTER|PERSONNAGE|AVATAR|LOCATION|LIEU|ENVIRONMENT|ENVIRONNEMENT|SETTING|DÉCOR|DECOR|CAMERA|CAMÉRA|STYLE|LIGHT(ING)?|LUMIÈRE|LOOK|WARDROBE|OUTFIT|TENUE)\s*[:—-]/i;
const ACTION_KEY = /^\s*(PERFORMANCE|GESTURES?|GESTES?|DELIVERY|ACTION|EXPRESSION|JEU|BODY LANGUAGE|TONE|TON)\s*[:—-]/i;
const DIALOGUE_KEY = /^\s*[A-ZÉ ]*(DIALOGUE|SCRIPT|LINES?|RÉPLIQUES?|REPLIQUES?|TEXTE|VOICE ?OVER)\s*[:—-]/i;
const TIME = /^\s*(\d{1,2}):(\d{2})\s*[–—-]+\s*(\d{1,2}):(\d{2})/;
const QUOTE = /["“«]([^"”»]{3,})["”»]/;

export function draftFromText(story: string): StoryDraft {
  const lines = story.replace(/\r/g, "").split("\n");
  const announced = Number(story.match(/(\d{1,3})\s*[- ]\s*second/i)?.[1] || 0);
  const firstLine = story.trim().split("\n")[0].replace(/^create\s+/i, "").trim();
  const title = firstLine.slice(0, 48) || "Mon histoire";

  /*
   * Sans repère de temps : une seule prise. La réplique est le bloc SCRIPT /
   * DIALOGUE (à défaut, la plus longue phrase entre guillemets), et TOUT le
   * reste du prompt devient la description de la scène, tel quel. Découper
   * un prompt libre en pseudo-scènes à chaque guillemet donnait « Aesthetic
   * Lab » en scène à part entière.
   */
  if (!lines.some((line) => TIME.test(line))) {
    let line = "";
    let rest = story;
    const headerAt = lines.findIndex((entry) => DIALOGUE_KEY.test(entry));
    if (headerAt >= 0) {
      // Le bloc court de l'entête jusqu'à la fin de la citation.
      const after = lines.slice(headerAt).join("\n");
      const quoted = after.match(QUOTE);
      const inline = lines[headerAt].replace(DIALOGUE_KEY, "").trim();
      line = (quoted ? quoted[1] : inline || lines.slice(headerAt + 1).find((entry) => entry.trim()) || "").trim();
      const block = quoted ? after.slice(0, after.indexOf(quoted[0]) + quoted[0].length) : lines[headerAt];
      rest = story.replace(block, " ");
    } else {
      const quotes = [...story.matchAll(new RegExp(QUOTE.source, "g"))].map((match) => match[1].trim());
      line = quotes.sort((x, y) => y.length - x.length)[0] ?? "";
      if (line) rest = story.replace(line, " ");
    }
    const action = rest
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/^create\s+/i, "");
    const words = line.split(/\s+/).filter(Boolean).length;
    return {
      title,
      setting: "",
      summary: "",
      description: "",
      keyPoints: [],
      scenes: [
        {
          label: "Prise unique",
          duration: clampDuration(announced || (words ? Math.ceil(words / 2.4) + 1 : 6)),
          action: action || "The protagonist talks to the camera.",
          line,
        },
      ],
    };
  }

  const setting: string[] = [];
  const performance: string[] = [];
  const dialogue: string[] = [];
  const body: string[] = [];

  // Un entête ouvre un bloc qui court jusqu'à la ligne vide suivante.
  let bucket: string[] | null = null;
  for (const line of lines) {
    const key = SETTING_KEY.test(line)
      ? setting
      : ACTION_KEY.test(line)
        ? performance
        : DIALOGUE_KEY.test(line)
          ? dialogue
          : null;
    if (key) {
      bucket = key;
      const rest = line.replace(SETTING_KEY, "").replace(ACTION_KEY, "").replace(DIALOGUE_KEY, "").trim();
      if (rest) bucket.push(rest);
      continue;
    }
    if (bucket && line.trim() && !TIME.test(line)) {
      bucket.push(line.trim());
      continue;
    }
    if (!line.trim()) bucket = null;
    if (!bucket) body.push(line);
  }

  const blocks: Array<{ text: string; seconds?: number }> = [];
  if (body.some((line) => TIME.test(line))) {
    let current: { text: string; seconds?: number } | null = null;
    for (const line of body) {
      const time = line.match(TIME);
      if (time) {
        if (current) blocks.push(current);
        const seconds = Number(time[3]) * 60 + Number(time[4]) - (Number(time[1]) * 60 + Number(time[2]));
        current = { text: line.replace(TIME, "").replace(/^[\s—–-]+/, ""), seconds: seconds > 0 ? seconds : undefined };
      } else if (current) {
        current.text += `\n${line}`;
      }
    }
    if (current) blocks.push(current);
  } else {
    for (const paragraph of body.join("\n").split(/\n\s*\n/)) {
      if (QUOTE.test(paragraph)) blocks.push({ text: paragraph });
    }
  }

  const performanceText = performance.join(" ").replace(/\s+/g, " ").trim();

  // Bloc DIALOGUE sans repère de temps : une seule prise, tout le jeu dedans.
  if (!blocks.length && dialogue.length) {
    const joined = dialogue.join(" ");
    const quoted = joined.match(QUOTE);
    blocks.push({ text: `"${(quoted ? quoted[1] : joined).trim()}"`, seconds: announced || undefined });
  }

  const scenes: StoryScene[] = blocks
    .map((block, index) => {
      const quote = block.text.match(QUOTE);
      const line = quote ? quote[1].trim() : "";
      const around = block.text
        .replace(QUOTE, " ")
        .replace(/\b(she|he|they)\s+says?\s*:?/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s.—–-]+|[\s.—–-]+$/g, "")
        .trim();
      // Le jeu décrit par entêtes s'applique à une prise unique ; sur plusieurs, il va en mise en place.
      const action = [around, blocks.length === 1 ? performanceText : ""].filter(Boolean).join(". ");
      const words = line.split(/\s+/).filter(Boolean).length;
      return {
        label: `Scène ${index + 1}`,
        duration: clampDuration(block.seconds ?? (words ? Math.ceil(words / 2.4) + 1 : 4)),
        action: action || "The protagonist talks to the camera.",
        line,
      };
    })
    .filter((scene) => scene.line || scene.action);

  const settingText = [setting.join(" "), blocks.length > 1 ? performanceText : ""]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title,
    setting: settingText,
    summary: "",
    description: "",
    keyPoints: [],
    scenes: scenes.length ? scenes : [{ label: "Scène 1", duration: 6, action: "", line: "" }],
  };
}

/**
 * Mode histoire : un texte libre, des sources facultatives (fiche produit,
 * site entier, image), un script de base facultatif. Claude reformule
 * l'histoire, puis écrit le script scène par scène avec le dialogue exact.
 */
export async function writeStory(input: {
  story: string;
  sourceText?: string;
  sourceTitle?: string;
  scriptText?: string;
  hasProduct: boolean;
  format?: FormatId | null;
  niche?: NicheId | null;
  language?: "en" | "fr";
  /** Durée totale visée, en secondes : le script est calibré dessus. */
  targetSeconds?: number;
}): Promise<StoryDraft> {
  const target = Math.min(180, Math.max(8, Math.round(input.targetSeconds || 30)));
  const sceneCount = Math.min(10, Math.max(2, Math.round(target / 8)));
  const totalWords = Math.round(target * 2.4);
  const format = FORMATS.find((item) => item.id === input.format);
  const niche = NICHES.find((item) => item.id === input.niche && item.id !== "none");
  const language = input.language === "fr" ? "French" : "English";

  const raw = await kieClaude(
    `You write a short-form creator video (TikTok / Reels) from a user's story.

USER STORY (raw, in their words):
"""
${input.story.trim()}
"""
${input.sourceTitle || input.sourceText ? `SOURCE (a product page or a website the creator talks about):\n${input.sourceTitle ? `Title: ${input.sourceTitle}\n` : ""}${(input.sourceText || "").slice(0, 3500)}\n` : ""}
${input.scriptText ? `BASE SCRIPT (a winning ad script — keep its structure beat for beat, its hook shape and its closing move, but tell the USER STORY with it):\n"""\n${input.scriptText}\n"""\n` : ""}
${format && format.id !== "free" ? `VIDEO FORMAT: ${format.label} — ${format.hint}.` : ""}
${niche ? `CREATOR NICHE: ${niche.label}.` : ""}
${input.hasProduct ? "A physical product is shown on camera." : "No physical product: the creator only talks; no props."}

IF THE USER STORY IS ALREADY A SCRIPT (it names a character, a location, a camera, timed shots or quoted lines): keep it FAITHFULLY. Same shots in the same order, dialogue VERBATIM, camera and framing notes carried into each scene's "action", a silent cut kept as a scene with an empty "line". Do not rewrite their words, do not add scenes, do not add a sales outro they did not write.

Step 0 — "setting": one paragraph in English with the character (gender, age, look, outfit), the location and the camera, taken from the user story when it gives them, otherwise a believable choice. It is repeated in every clip, so it must be concrete.
Step 1 — reformulate the story into a clear, punchy brief of 3 or 4 sentences in French ("summary"): who talks, what happens, what the viewer should feel and do.
Step 2 — write the script for a TOTAL length of ${target} seconds: exactly ${sceneCount} consecutive scenes of 4 to 15 seconds each, about ${totalWords} spoken words in total (a creator speaks ~2.4 words per second). Each scene:
- "label": two words
- "action": one sentence describing what the creator does on camera
- "line": the EXACT spoken dialogue in ${language}, conversational, first person, no hashtags, no emojis. The creator is already talking when the clip starts. Give each scene a "seconds" number so that all scenes add up to ${target}.
Strong hook in the first 3 words. Stay truthful to the story and the source. Never invent claims.
Also give "title" (short, French), "description" (one sentence about the subject, for the CTA) and "keyPoints" (up to 3 short facts taken from the story or the source).

Return ONLY JSON:
{"title":"...","setting":"...","summary":"...","description":"...","keyPoints":["..."],"scenes":[{"label":"...","action":"...","line":"...","seconds":6}]}`,
    4000
  );

  const json = extractJson(raw);
  if (!json) throw new Error(`Le modèle n'a pas rendu de script — « ${raw.slice(0, 100)}… »`);
  const parsed = JSON.parse(json) as {
    title?: string;
    setting?: string;
    summary?: string;
    description?: string;
    keyPoints?: string[];
    scenes?: Array<{ label?: string; action?: string; line?: string; seconds?: number }>;
  };
  const scenes = fitScenes(
    (parsed.scenes ?? [])
      .filter((scene) => scene && (scene.line || scene.action))
      .map((scene, index) => ({
        label: String(scene.label || `Scène ${index + 1}`),
        duration: Number(scene.seconds) || 0,
        action: String(scene.action || "The protagonist talks to the camera."),
        line: String(scene.line || "").trim(),
      })),
    target
  );
  if (!scenes.length) throw new Error("Le script est vide");
  return {
    title: String(parsed.title || input.story.trim().slice(0, 48)),
    setting: String(parsed.setting || ""),
    summary: String(parsed.summary || ""),
    description: String(parsed.description || ""),
    keyPoints: (parsed.keyPoints ?? []).map((point) => String(point)).filter(Boolean).slice(0, 3),
    scenes,
  };
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Conversation de cadrage. L'utilisateur parle comme il pense ; l'IA renvoie
 * une réponse courte qui reformule, pose une ou deux questions si quelque
 * chose manque, et tient à jour un brief propre — celui qu'on enverra à
 * l'écriture du script quand l'utilisateur dira « c'est ça ».
 */
export async function chatStory(input: {
  messages: ChatMessage[];
  targetSeconds?: number;
  language?: "en" | "fr";
}): Promise<{ reply: string; brief: string }> {
  const transcript = input.messages
    .slice(-16)
    .map((message) => `${message.role === "user" ? "USER" : "ASSISTANT"}: ${message.content}`)
    .join("\n\n");

  const raw = await kieClaude(
    `You are a creative director helping someone brief a short creator video (TikTok / Reels, about ${input.targetSeconds || 30} seconds, spoken in ${input.language === "fr" ? "French" : "English"}).
They talk to you in French, loosely. Your job: understand what they really want, reformulate it clearly, and ask at most two short questions when something important is missing (who talks, what is sold or told, what the viewer should feel or do, the tone). Never write the script itself here.

CONVERSATION SO FAR:
${transcript}

Answer in French. Return ONLY JSON:
{"reply":"your short conversational answer (2 to 5 sentences), warm and direct","brief":"the current best reformulation of what they want, 3 to 6 sentences in French, complete enough to write a script from — update it at every turn"}`,
    1500
  );
  const json = extractJson(raw);
  if (!json) return { reply: raw.trim().slice(0, 800), brief: "" };
  const parsed = JSON.parse(json) as { reply?: string; brief?: string };
  return { reply: String(parsed.reply || "").trim(), brief: String(parsed.brief || "").trim() };
}
