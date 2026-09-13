import path from "path";
import { NextResponse } from "next/server";
import {
  createKieTask,
  kieClaude,
  pollKieTask,
  toRawBase64,
  uploadBase64,
} from "@/lib/studio/kie";
import { freshAvatarUrl } from "@/lib/ugc/avatar-store";
import {
  characterLock,
  DEFAULT_CASTING,
  voiceForCasting,
  type Casting,
} from "@/lib/ugc/casting";
import { fetchProductFromUrl } from "@/lib/ugc/fetch-product";
import { PRODUCT_LOCK } from "@/lib/ugc/angles";
import { handlingFor, type ProductKind } from "@/lib/ugc/kinds";
import { analyzeCreative, extractAudio, muxAudio, shotFrames, type Shot } from "@/lib/ugc/remake";
import { createBatch, stitchAngle } from "@/lib/ugc/store";
import type { ProductInput, Resolution } from "@/lib/ugc/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Seedance 2.5 — la version que Kie accepte sous ce nom exact. */
const MODEL = "bytedance/seedance-2-5";
const ASPECT_RATIO = "9:16";
const MAX_REFS = 6;
const CREATE_GAP_MS = 700;

/** Formats acceptés par gpt-image-2 ; tout le reste retombe sur la story. */
const SUPPORTED_RATIOS = ["9:16", "3:4", "1:1", "4:3", "16:9"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ce qui bouge d'une déclinaison à l'autre.
 *
 * Cinq rendus rigoureusement identiques n'auraient aucun intérêt, et cinq
 * rendus libres ne seraient plus la même créa. Chaque déclinaison ne reçoit
 * donc qu'un seul levier, nommé.
 *
 * AUCUN de ces leviers ne touche à la géométrie du produit, et c'est délibéré.
 * Les deux premiers essais faisaient varier l'angle de la caméra et la rotation
 * de l'objet — or faire pivoter un produit oblige le modèle à le redessiner
 * sous une face qu'il n'a jamais vue, et c'est précisément là qu'il invente une
 * autre étiquette, un autre bouchon, une autre couleur. Ne restent que des
 * leviers qui agissent AUTOUR du produit : la lumière, l'ombre, le fond, la
 * profondeur, l'étalonnage, la marge. Le produit, lui, se recopie.
 */
const RUGG_VARIATIONS = [
  "the lighting direction: move the key light to the other side of the frame. Same softness, same colour temperature, same overall brightness. The product itself is lit differently but is otherwise untouched.",
  "the background texture and its micro-detail. Same colour, same tone, same treatment — only the grain of the surface differs. Do not touch the product.",
  "the shadow the product casts: same direction, slightly different length and softness. The product itself does not move.",
  "the depth of field: slightly more separation between the product and its background. The product stays perfectly sharp and identical.",
  "the colour grade, by a barely perceptible amount — a touch warmer or cooler across the whole frame. The product keeps its own colours exactly.",
  "the margin around the whole composition: slightly more or less air at the edges. Everything scales together; nothing is re-arranged, nothing is redrawn.",
];

/**
 * Le verrou produit de Rugg Crea.
 *
 * `PRODUCT_LOCK` ne convient pas ici : il est écrit pour la vidéo, parle de
 * plusieurs images de référence et d'un protagoniste, et désigne le produit
 * comme « celui des images qui suivent la première ». Dans ce studio il n'y a
 * qu'une seule référence — la créa elle-même — et le produit à préserver est
 * celui qui s'y trouve déjà.
 *
 * C'est le point sur lequel un modèle image-vers-image lâche en premier : il
 * garde la mise en page, et remplace le flacon par un flacon plausible. Une
 * déclinaison qui ne montre plus le même produit n'est pas une déclinaison,
 * c'est une autre annonce.
 */
const RUGG_PRODUCT_LOCK = [
  "ABSOLUTE PRODUCT FIDELITY. If the attached creative shows a product, that product",
  "is the single most important thing to preserve, ahead of everything else in this",
  "brief. Copy it: identical shape and silhouette, identical proportions, identical",
  "colour and the identical placement of every colour area, identical material and",
  "finish, identical print, pattern, label, cap, seams, buttons and hardware,",
  "identical text and logo ON the product, spelled exactly the same.",
  "",
  "Do NOT substitute it with a similar product. Do NOT redesign, restyle, recolour,",
  "simplify, modernise or 'improve' it. Do NOT change its label, its typography or",
  "its branding. Do NOT show it from a new angle: it keeps the exact same face",
  "toward the camera, the same tilt and the same visible sides as in the attached",
  "image. Any part of it that is hidden in the source stays hidden.",
  "",
  "SINGLE PRODUCT, NO VARIANTS. If the layout has several panels, crops or",
  "close-ups, they all show THAT one product — never a second colourway, never",
  "another size, never a companion item, never an invented alternative.",
].join("\n");

type Body = {
  action?:
    | "analyze"
    | "generate"
    | "assemble"
    | "static-analyze"
    | "static-generate"
    | "rugg-upload"
    | "rugg-generate";
  batchId?: string;
  /** Bande son d.origine, renvoyee au remontage. */
  audioBase64?: string;
  /** Créative source, en data URL. */
  videoBase64?: string;
  productUrl?: string;
  product?: ProductInput;
  shots?: Shot[];
  /** Cadrage relevé plan par plan sur la créa source. */
  framing?: string[];
  /** Impose le cadrage relevé au lieu de laisser le modèle composer. */
  strictFraming?: boolean;
  /** Visuel statique concurrent, en data URL. */
  staticBase64?: string;
  /** Mise en page relevée sur ce visuel, renvoyée à la génération. */
  layout?: string;
  /** Annotations relevées, avec leur texte déjà réécrit pour notre produit. */
  elements?: Array<{
    kind: string;
    style: string;
    position: string;
    sourceText: string;
    role: string;
    adaptedText: string;
  }>;
  /** Direction typographique imposée à tous les textes de la créa. */
  fontStyle?: string;
  /** Format de la créa source, mesuré côté navigateur. */
  aspect?: string;
  /**
   * La créa déposée, une fois chez Kie.
   *
   * Elle est envoyée une seule fois pour tout le lot : c'est la même image qui
   * sert de référence aux cinq déclinaisons, et la reverser à chaque appel
   * coûterait cinq téléversements pour un seul fichier.
   */
  sourceUrl?: string;
  /** Le rang de la déclinaison, qui choisit sa variation. */
  variation?: number;
  /**
   * Laisser bouger un détail au lieu de copier au plus près.
   *
   * Absent, on copie. C'est le cas courant : la créa vient d'un concurrent qui
   * vend le même produit, on la reprend telle quelle, et le lot de cinq sert à
   * garder le rendu le plus propre — pas à obtenir cinq annonces différentes.
   */
  loose?: boolean;
  /**
   * Effacer les marques de la source.
   *
   * Le produit se copie — c'est le même. La marque du concurrent, non : reprise
   * telle quelle, elle s'afficherait sur nos propres annonces.
   */
  stripBrand?: boolean;
  /** Rendu en 2K plutôt qu'en 1K — plus lent, réservé à une créa validée. */
  hd?: boolean;
  /** Script réécrit, dit par la voix de l'avatar au remontage. */
  script?: string;
  /** Voix ElevenLabs imposée ; sinon celle du casting. */
  voice?: string;
  avatarId?: string;
  casting?: Casting;
  resolution?: Resolution;
};

function decode(dataUrl: string) {
  const base64 = dataUrl.includes("base64,")
    ? dataUrl.slice(dataUrl.indexOf("base64,") + 7)
    : dataUrl;
  return Buffer.from(base64, "base64");
}

/**
 * Fait décrire le cadrage de chaque plan à partir de son image clé.
 *
 * On ne demande QUE la mise en scène — échelle de plan, angle, mouvement,
 * lumière. Ni le décor précis ni les personnes de la source : le contenu vient
 * de l'avatar et du produit, seule la grammaire visuelle est reprise.
 */
async function describeShots(frames: string[]): Promise<string[]> {
  const raw = await kieClaude(
    `Each image is one shot from a short vertical ad, in order.

For every shot, describe ONLY the camera work in one sentence:
- shot size (extreme close-up, close-up, medium, wide)
- camera angle and height (eye level, low, high, over the shoulder, mirror shot)
- camera movement if any (static, handheld drift, push in, pan, tilt)
- lighting quality (soft daylight, hard sun, indoor lamp, backlit)

Do NOT describe the people, the products, the brand, the setting details or any on-screen text.

Return ONLY a JSON array of strings, one per image, in order:
["...", "..."]`,
    1500,
    frames
  );

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Description des plans illisible");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown[];
  return parsed.map((item) => String(item || "").trim());
}

/**
 * Extrait le JSON d'une réponse qui l'enrobe de prose.
 *
 * Le modèle explique volontiers ce qu'il voit avant de livrer sa structure, et
 * la referme parfois dans un bloc balisé. Chercher la première accolade
 * suffisait tant qu'aucune phrase n'en contenait ; le bloc balisé, quand il est
 * là, est le repère le plus sûr.
 */
function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

/**
 * Relève une créa publicitaire fixe et la réécrit pour notre produit.
 *
 * Ce n'est pas un simple relevé de mise en page : ce qui fait marcher une
 * statique, c'est son dispositif complet — le post-it manuscrit, la flèche qui
 * pointe, le prix barré, la formulation du hook. Reprendre le cadrage en
 * jetant les annotations, c'est garder l'emballage et perdre l'argument.
 *
 * Une seule passe fait les deux, parce que réécrire une accroche demande de
 * savoir où elle est posée et quelle place elle occupe. Ce qui n'est jamais
 * repris : le nom de la marque et son logo — l'angle se reprend, l'identité
 * d'autrui non.
 */
async function describeStatic(imageBase64: string, product: ProductInput | null) {
  const brief = product
    ? [
        `Product name: ${product.name}`,
        product.brand ? `Brand: ${product.brand}` : "",
        product.description ? `What it is: ${product.description}` : "",
        product.price ? `Price: ${product.price}` : "",
        product.comparePrice ? `Was: ${product.comparePrice}` : "",
        product.keyPoints.filter(Boolean).length
          ? `Selling points: ${product.keyPoints.filter(Boolean).join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "No product supplied yet — leave every adaptedText empty.";

  const raw = await kieClaude(
    `This image is a static ad creative that performs well. I sell a different
product and I want to rebuild the SAME creative device for mine.

Read the image and return ONLY this JSON, nothing else:

{
  "layout": "one paragraph: framing and crop, where the product sits and at what scale and angle, background treatment, lighting quality and colour temperature, how the surface is divided",
  "elements": [
    {
      "kind": "sticky note | handwritten caption | arrow | circle | underline | price tag | badge | sticker",
      "style": "exact visual treatment — colour, texture, font feel (handwritten marker, bold sans, script), rotation, size relative to the frame",
      "position": "where it sits, e.g. top-left over the wall, bottom-left under the product",
      "sourceText": "the exact words in the image, empty string if the element carries no text",
      "role": "hook | benefit | objection handled | price anchor | urgency | social proof",
      "adaptedText": "the same beat rewritten for MY product below — same length, same register, same punctuation habits, same lowercase or uppercase style. Keep it truthful to my product; never invent a claim my product does not support."
    }
  ]
}

Rules for layout:
- Describe the grid, the crops and the framing, but NEVER say the panels show
  different variants, colourways or alternative items. If the source shows two
  versions of a product, describe the panels as different angles or crops only.

Rules for adaptedText:
- Match the rhythm and word count of sourceText closely; these are visual objects with fixed room.
- Keep the same rhetorical move. If the source handles an objection, handle MY product's equivalent objection.
- Use my real price and compare-at price where the source shows a price.
- Never carry over the source's brand name, logo or product category.
- Skip logos entirely: do not emit an element whose kind is a logo, wordmark or
  signature. The rebuilt creative carries no branding at all.

MY PRODUCT:
${brief}`,
    2000,
    [toRawBase64(imageBase64)]
  );

  const json = extractJson(raw);
  if (!json) {
    throw new Error(
      `Le modèle n'a pas rendu de structure — il a répondu : « ${raw.slice(0, 120)}… »`
    );
  }

  return JSON.parse(json) as {
    layout: string;
    elements: Array<{
      kind: string;
      style: string;
      position: string;
      sourceText: string;
      role: string;
      adaptedText: string;
    }>;
  };
}

/**
 * Transcrit la bande son de la créative source.
 *
 * Sans ça, le remake reprend l'image mais pas l'argumentaire — or c'est souvent
 * le script qui fait vendre, pas le cadrage. La piste est d'abord déposée chez
 * Kie : le modèle attend une URL, pas un fichier.
 */
async function transcribeSource(audio: Buffer): Promise<string> {
  const url = await uploadBase64(
    `data:audio/mp4;base64,${audio.toString("base64")}`,
    `remake-${Date.now()}.m4a`
  );
  const taskId = await createKieTask("elevenlabs/speech-to-text", { audio_url: url });
  const task = await pollKieTask(taskId, 40);

  /*
   * Le modèle rend soit du texte direct, soit un JSON portant `text`. Les deux
   * formes existent selon les versions : on accepte l'une comme l'autre plutôt
   * que de parier sur celle du jour.
   */
  const direct = (task.urls || []).find((item) => typeof item === "string" && !/^https?:/i.test(item));
  if (direct) return String(direct).trim();

  const fileUrl = (task.urls || []).find((item) => /^https?:/i.test(String(item)));
  if (!fileUrl) throw new Error("Transcription vide");

  const res = await fetch(String(fileUrl), { cache: "no-store" });
  const raw = await res.text();
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return String(parsed.text || raw).trim();
  } catch {
    return raw.trim();
  }
}

/** Réécrit le script relevé pour notre produit, en gardant son déroulé. */
async function rewriteScript(source: string, product: ProductInput) {
  return kieClaude(
    `Here is the spoken script of an ad that performs well:

"""
${source}
"""

Rewrite it for MY product. Keep the same structure beat for beat — same hook
shape, same order of arguments, same closing move — and a very close word
count, because it has to fit the same edit.

Never carry over the source's brand name or product category. Stay truthful to
my product: do not invent a claim it does not support.

MY PRODUCT:
Name: ${product.name}
${product.description ? `What it is: ${product.description}` : ""}
${product.price ? `Price: ${product.price}` : ""}
${product.keyPoints.filter(Boolean).length ? `Selling points: ${product.keyPoints.filter(Boolean).join("; ")}` : ""}

Return ONLY the rewritten script, no preamble, no quotes.`,
    1200
  ).then((text) => text.trim());
}

const SHOT_INTENTS = [
  "faces the camera holding the product up at chest height, presenting it plainly",
  "uses the product the way it is meant to be used, hands visible, natural gestures",
  "closer framing on the product itself, turning it so the label and texture read clearly",
  "steps back so the product is seen in its everyday setting, then looks at the lens",
  "reacts to the product with a genuine, unexaggerated expression, product still in frame",
];

function shotPrompt(
  shot: Shot,
  product: ProductInput,
  casting: Casting,
  kind: ProductKind,
  framing?: string,
  strict = true
) {
  const intent = SHOT_INTENTS[shot.index % SHOT_INTENTS.length];
  return [
    characterLock(casting, false),
    PRODUCT_LOCK,
    handlingFor(kind),
    [
      "Photorealistic UGC video shot on a modern iPhone, handheld with natural micro-shake, ",
      "realistic skin texture, true-to-life lighting, believable everyday location. ",
      "NOT cinematic, NOT studio-lit, NOT glossy advertising, NOT AI-smooth. ",
      "One continuous take, no cuts, no zooms, no on-screen text, no captions, no watermark. ",
      "SILENT PERFORMANCE — the protagonist does not speak and does not mouth words; the final ",
      "montage carries its own soundtrack. Ambient sound only.",
    ].join(""),
    /*
     * Strict : le cadrage relevé sur la source fait loi, plan par plan — c'est
     * ce qui donne « la même créa avec notre produit ». Souple : il n'est qu'une
     * indication, et le modèle recompose. Deux usages réels, d'où le choix
     * laissé avant de lancer plutôt qu'un réglage figé.
     */
    framing
      ? strict
        ? `CAMERA (match this exactly): ${framing}`
        : `CAMERA (loose inspiration, recompose freely): ${framing}`
      : "CAMERA: eye-level medium shot, handheld, soft natural light.",
    `SCENE: The protagonist ${intent}. The product is ${product.name}.`,
  ].join("\n\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;

    /* ---------- Visuel statique : relevé de composition ---------- */
    /* ---------- Rugg Crea : la même créa, redéclinée ---------- */

    /**
     * La créa part chez Kie et revient en URL.
     *
     * Le modèle image-vers-image attend une adresse, pas un fichier. On la
     * dépose une fois pour tout le lot : les cinq déclinaisons pointent alors
     * la même référence, ce qui est exactement ce qu'on veut — décliner UNE
     * créa, pas cinq copies d'un envoi différent.
     */
    if (body.action === "rugg-upload") {
      if (!body.staticBase64) {
        return NextResponse.json({ error: "Image manquante" }, { status: 400 });
      }
      try {
        const url = await uploadBase64(body.staticBase64, `rugg-${Date.now()}.png`);
        return NextResponse.json({ url });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Envoi de la créa impossible" },
          { status: 502 }
        );
      }
    }

    if (body.action === "rugg-generate") {
      if (!body.sourceUrl) {
        return NextResponse.json({ error: "Créa source manquante" }, { status: 400 });
      }

      const loose = body.loose === true;
      const stripBrand = body.stripBrand === true;
      const nudge = RUGG_VARIATIONS[(body.variation ?? 0) % RUGG_VARIATIONS.length];

      /*
       * Copier, pas adapter.
       *
       * Le reste de ce fichier sert à reprendre la créa d'un concurrent POUR UN
       * AUTRE PRODUIT : le relevé y réécrit chaque accroche et remplace l'objet.
       * Ici le produit est le même des deux côtés — c'est le principe du studio —
       * donc il n'y a rien à adapter et rien à relever. L'image part telle quelle
       * en référence, et toute la consigne tient dans un mot : recopie.
       *
       * D'où le lot : cinq copies ne sont pas cinq annonces, ce sont cinq
       * tentatives de la même, parce qu'un modèle image-vers-image est inégal
       * d'un rendu à l'autre. On garde la plus propre.
       */
      const prompt = [
        "THE ATTACHED IMAGE IS AN AD CREATIVE. Reproduce it.",
        "",
        "This is a COPY, not an interpretation and not a creative inspired by it.",
        "Someone comparing your output with the attached image side by side should",
        "struggle to tell them apart. Every judgement call resolves the same way:",
        "copy what is there.",
        "",
        RUGG_PRODUCT_LOCK,
        "",
        "COPY EXACTLY:",
        "- Every word of text, spelled exactly as in the image, in the same place, at the",
        "  same size, in the same typeface and the same colour. Do not rewrite, translate,",
        "  shorten, reword or correct any text. Do not add a word that is not there.",
        "- The layout: same composition, same crop, same panels, same margins, same",
        "  proportions between every zone.",
        "- Every graphic element: badges, arrows, stickers, price tags, handwriting,",
        "  underlines, circles — same shape, same colour, same position, same rotation.",
        "- The background, its texture and its colour.",
        "- The lighting, the shadows and the overall colour grade.",
        stripBrand
          ? [
              "",
              "ONE EXCEPTION — BRANDING. Leave out the source's brand marks: no logo, no",
              "wordmark, no signature, no watermark, and no brand name in the overlaid text.",
              "Where a logo sits, continue the background behind it instead; do not invent a",
              "replacement mark and do not write another brand name. Text printed ON the",
              "product itself is part of the product and stays exactly as it is.",
            ].join("\n")
          : "",
        loose
          ? [
              "",
              "ONE small liberty is allowed, and one only:",
              `${nudge}`,
              "",
              "Everything it does not explicitly name stays exactly as it is, and it NEVER",
              "applies to the product. If in doubt, change less.",
            ].join("\n")
          : [
              "",
              "Take no creative liberty at all. Do not improve the composition, do not tidy",
              "the layout, do not modernise the typography, do not clean up the background.",
              "Reproduce what is there, including what looks imperfect.",
            ].join("\n"),
        "",
        "Photorealistic advertising still. Text must be crisp and correctly kerned, with",
        "no spelling mistake and no garbled letterform.",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const taskId = await createKieTask("gpt-image-2-image-to-image", {
          prompt,
          input_urls: [body.sourceUrl],
          aspect_ratio: SUPPORTED_RATIOS.includes(body.aspect || "") ? body.aspect : "9:16",
          resolution: body.hd ? "2K" : "1K",
        });
        return NextResponse.json({ taskId, prompt });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Génération impossible" },
          { status: 502 }
        );
      }
    }

    if (body.action === "static-analyze") {
      if (!body.staticBase64) {
        return NextResponse.json({ error: "Image manquante" }, { status: 400 });
      }

      // La fiche produit passe d'abord : le relevé réécrit les accroches dans
      // la même passe, il lui faut donc le produit sous les yeux.
      let product: ProductInput | null = body.product ?? null;
      let productError: string | null = null;
      if (!product && body.productUrl) {
        try {
          product = await fetchProductFromUrl(body.productUrl);
        } catch (error) {
          productError = error instanceof Error ? error.message : "Fiche produit illisible";
        }
      }

      let layout = "";
      let elements: Array<{
        kind: string;
        style: string;
        position: string;
        sourceText: string;
        role: string;
        adaptedText: string;
      }> = [];
      let compositionError: string | null = null;
      try {
        const read = await describeStatic(body.staticBase64, product);
        layout = read.layout || "";
        elements = Array.isArray(read.elements) ? read.elements : [];
      } catch (error) {
        compositionError =
          error instanceof Error ? error.message : "Lecture de la composition impossible";
      }

      return NextResponse.json({ layout, elements, compositionError, product, productError });
    }

    /* ---------- Visuel statique : rendu avec notre produit ---------- */
    if (body.action === "static-generate") {
      const product = body.product;
      if (!product?.name) {
        return NextResponse.json({ error: "Produit manquant" }, { status: 400 });
      }

      /**
       * Les photos du produit partent en référence : sans elles le modèle
       * dessinerait un autre article dans la bonne mise en page, ce qui ne sert
       * à rien. La composition relevée ne décrit que le cadre à remplir.
       */
      const refs = product.imageUrls.filter((url) => /^https:\/\//i.test(url)).slice(0, MAX_REFS);
      if (!refs.length) {
        return NextResponse.json(
          { error: "Aucune image produit : charge d'abord la fiche produit" },
          { status: 400 }
        );
      }

      /**
       * Les annotations sont rendues DANS l'image : c'est elles qui portent le
       * hook, et une flèche manuscrite recollée après coup n'a jamais le même
       * grain que celle qui a été peinte avec la scène.
       */
      /*
       * Les logos de la source sont écartés : repris tels quels ils affichent
       * la marque d'autrui, et « adaptés » ils font composer un nom de marque
       * inventé. Ni l'un ni l'autre n'a sa place sur la créa.
       */
      const annotations = (body.elements || [])
        .filter((element) => !/logo|wordmark|signature|watermark/i.test(element.kind))
        .filter((element) => element.adaptedText?.trim() || element.kind)
        .map((element, index) => {
          const text = element.adaptedText?.trim();
          return [
            `${index + 1}. ${element.kind} — ${element.position}.`,
            `Style: ${element.style}.`,
            text ? `It reads exactly: "${text}"` : "No text on this element.",
          ].join(" ");
        });

      const prompt = [
        PRODUCT_LOCK,
        handlingFor(product.kind),
        /*
         * Verrou produit renforcé.
         *
         * Une créa source qui montre deux variantes d'un même article fait
         * décrire « two outfit variants » au relevé — et le modèle obéit en
         * inventant un second vêtement. La mise en page se reprend, le nombre
         * de produits non : chaque case montre le nôtre, tel qu'il est sur les
         * photos de référence.
         */
        [
          "SINGLE PRODUCT, NO VARIANTS. Every panel, crop and close-up shows the exact",
          "same product from the reference images — same colour, same print, same cut,",
          "same fabric. If the layout has several panels, they are different angles or",
          "crops of THAT product, never a second colourway, never another garment, never",
          "an invented alternative. Do not restyle, recolour or reinterpret it.",
        ].join(" "),
        body.layout
          ? `LAYOUT (reproduce this composition exactly — grid, crops, framing, lighting): ${body.layout}`
          : "LAYOUT: centred product shot on a clean background, soft directional light.",
        `SUBJECT: ${product.name}.`,
        /*
         * Les prix sont redonnés ici, pas seulement dans le texte des
         * annotations : un badge prix rendu sans le chiffre exact sort un
         * montant inventé, et c'est le genre d'erreur qui ne se voit qu'après
         * la mise en ligne.
         */
        product.price
          ? `PRICING — set these figures exactly as written, never round or invent: price ${product.price}${
              product.comparePrice ? `, struck-through compare-at price ${product.comparePrice}` : ""
            }.`
          : "",
        annotations.length
          ? [
              "ON-IMAGE TEXT — reproduce each one as part of the photograph, at the",
              "described position and size:",
              annotations.join("\n"),
              "",
              /*
               * La typographie est imposée d'en haut, pas reprise case par case.
               * Décrite élément par élément, elle dérivait vers un rendu
               * quelconque : une direction unique et nommée tient mieux qu'une
               * accumulation de descriptions.
               */
              body.fontStyle
                ? `TYPOGRAPHY — this is the single type direction for every text in the image, it overrides the per-element font description: ${body.fontStyle}`
                : "TYPOGRAPHY: set every text in one confident, well-crafted advertising typeface. Never a default system font, never Arial or Times.",
              "Kerning and baseline must look professionally set. No spelling mistakes.",
            ].join("\n")
          : "No text and no graphic overlay on the image.",
        [
          "Photorealistic advertising still. Any handwriting, arrow or sticker must look",
          "physically present in the scene — real marker on real paper, real ink — not a",
          "digital overlay pasted on top.",
          // Aucun logo : ni celui de la source, ni un nom de marque inventé.
          "NO LOGO, no brand name, no wordmark, no signature, no watermark anywhere in",
          "the frame.",
        ].join(" "),
      ]
        .filter(Boolean)
        .join("\n\n");

      try {
        /**
         * Le format suit la créa source, pas les photos produit.
         *
         * `input_urls` ne contient que nos packshots : laisser le modèle décider
         * lui ferait adopter LEUR cadrage, et une story 9:16 reprise depuis un
         * carré n'a plus rien du visuel qu'on voulait rejouer. Le ratio est
         * donc mesuré sur l'image de référence, côté navigateur, et imposé ici.
         *
         * La sortie est en 1K : deux fois plus rapide qu'en 2K pour un test
         * d'angle, et une créa validée se regénère en 2K si besoin.
         */
        const taskId = await createKieTask("gpt-image-2-image-to-image", {
          prompt,
          input_urls: refs,
          aspect_ratio: SUPPORTED_RATIOS.includes(body.aspect || "") ? body.aspect : "9:16",
          resolution: body.hd ? "2K" : "1K",
        });
        return NextResponse.json({ taskId, prompt });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Génération impossible" },
          { status: 502 }
        );
      }
    }

    /* ---------- Analyse de la créative source ---------- */
    if (body.action === "analyze") {
      if (!body.videoBase64) return NextResponse.json({ error: "Vidéo manquante" }, { status: 400 });
      const buffer = decode(body.videoBase64);

      const analysis = await analyzeCreative(buffer);
      const audio = await extractAudio(buffer);

      /**
       * Cadrage plan par plan. C'est ce qui donne « les mêmes angles, le même
       * zoom » : la structure seule ne dit que le rythme. Si le service de
       * description est indisponible, on garde la grille de plans et les
       * intentions génériques — le montage reste juste, seul le cadrage est
       * approximé.
       */
      /*
       * Les trois relevés partent ensemble. Enchaînés, ils additionnaient leurs
       * attentes — et comme chacun peut patienter sur une limite de débit, la
       * somme atteignait plusieurs minutes pour un travail qui tient en une.
       * Aucun des trois n'a besoin du résultat des autres.
       */
      const [framingResult, productResult, transcriptResult] = await Promise.all([
        (async () => {
          const frames = await shotFrames(buffer, analysis.shots);
          return frames.some(Boolean) ? describeShots(frames) : [];
        })().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Description des plans indisponible",
        })),

        body.productUrl
          ? fetchProductFromUrl(body.productUrl).catch((error: unknown) => ({
              error: error instanceof Error ? error.message : "Fiche produit illisible",
            }))
          : Promise.resolve(null),

        audio
          ? transcribeSource(audio).catch((error: unknown) => ({
              error: error instanceof Error ? error.message : "Script non relevé",
            }))
          : Promise.resolve(""),
      ]);

      const failed = (value: unknown): value is { error: string } =>
        typeof value === "object" && value !== null && "error" in value;

      const framing = failed(framingResult) ? [] : framingResult;
      const framingError = failed(framingResult) ? framingResult.error : null;

      const product = failed(productResult) ? null : productResult;
      const productError = failed(productResult) ? productResult.error : null;

      const sourceScript = failed(transcriptResult) ? "" : transcriptResult;
      let scriptError = failed(transcriptResult) ? transcriptResult.error : null;

      /**
       * La réécriture vient après, parce qu'elle a besoin des deux : le script
       * relevé et la fiche produit. Un échec ici n'arrête rien — le remake sous
       * la bande son d'origine reste utilisable, on le signale seulement.
       */
      let script = "";
      if (sourceScript && product) {
        try {
          script = await rewriteScript(sourceScript, product);
        } catch (error) {
          scriptError = error instanceof Error ? error.message : "Réécriture impossible";
        }
      }

      return NextResponse.json({
        analysis,
        framing,
        framingError,
        product,
        productError,
        sourceScript,
        script,
        scriptError,
        // La bande son repart au client, qui la renverra au montage final.
        audioBase64: audio ? `data:audio/mp4;base64,${audio.toString("base64")}` : null,
      });
    }

    /* ---------- Remontage avec la bande son d'origine ---------- */
    if (body.action === "assemble") {
      if (!body.batchId) return NextResponse.json({ error: "Lot manquant" }, { status: 400 });

      // Les clips sont d'abord recollés bout à bout par le montage existant.
      const stitched = await stitchAngle(body.batchId, "remake");

      /**
       * Voix du remake.
       *
       * Le script réécrit est dit par une voix choisie d'après le casting de
       * l'avatar : une accroche portée par une voix qui ne colle ni au genre ni
       * à l'âge du visage à l'image se remarque tout de suite. Si la revoix
       * échoue, on retombe sur la bande son d'origine plutôt que de rendre un
       * montage muet.
       */
      let audio: Buffer | null = null;
      let voiceError: string | null = null;
      if (body.script?.trim()) {
        try {
          const taskId = await createKieTask("elevenlabs/text-to-speech-multilingual-v2", {
            text: body.script.trim(),
            voice: body.voice || voiceForCasting(body.casting ?? DEFAULT_CASTING),
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0.2,
            speed: 1,
          });
          const task = await pollKieTask(taskId, 40);
          const url = (task.urls || []).find((item) => /^https?:/i.test(String(item)));
          if (!url) throw new Error("Voix vide");
          const res = await fetch(String(url), { cache: "no-store" });
          audio = Buffer.from(await res.arrayBuffer());
        } catch (error) {
          voiceError = error instanceof Error ? error.message : "Voix impossible";
        }
      }

      if (!audio && body.audioBase64) audio = decode(body.audioBase64);
      if (!audio) return NextResponse.json({ file: stitched, audio: false, voiceError });

      const dir = path.join(process.cwd(), ".msgate-cache", "ugc-batches", body.batchId);
      const withAudio = `remake-audio-${Date.now().toString(36)}.mp4`;
      await muxAudio(path.join(dir, stitched), audio, path.join(dir, withAudio));
      return NextResponse.json({
        file: withAudio,
        audio: true,
        voiced: Boolean(body.script?.trim()) && !voiceError,
        voiceError,
      });
    }

    /* ---------- Génération des plans ---------- */
    const product = body.product;
    const shots = body.shots || [];
    if (!product?.name) return NextResponse.json({ error: "Produit manquant" }, { status: 400 });
    if (!shots.length) return NextResponse.json({ error: "Aucun plan à générer" }, { status: 400 });
    if (!body.avatarId) {
      return NextResponse.json(
        { error: "Choisis un avatar enregistré — c'est lui qui garde le même visage" },
        { status: 400 }
      );
    }

    const productRefs = (product.imageUrls ?? [])
      .filter((url) => /^https:\/\//i.test(url))
      .slice(0, MAX_REFS);
    if (!productRefs.length) {
      return NextResponse.json(
        { error: "Aucune image produit : la génération inventerait le produit." },
        { status: 400 }
      );
    }

    const fresh = await freshAvatarUrl(body.avatarId);
    if (!fresh) return NextResponse.json({ error: "Avatar introuvable" }, { status: 404 });

    const casting = body.casting ?? DEFAULT_CASTING;
    const references = [fresh.url, ...productRefs];

    const jobs: Array<{
      angleId: string;
      angleName: string;
      sceneLabel: string;
      duration: number;
      prompt: string;
      taskId: string | null;
      error: string | null;
    }> = [];

    for (const shot of shots) {
      const prompt = shotPrompt(
        shot,
        product,
        casting,
        product.kind,
        body.framing?.[shot.index],
        body.strictFraming !== false
      );
      try {
        const taskId = await createKieTask(MODEL, {
          prompt,
          aspect_ratio: ASPECT_RATIO,
          resolution: body.resolution || "720p",
          duration: shot.duration,
          generate_audio: false,
          reference_image_urls: references,
        });
        jobs.push({
          angleId: "remake",
          angleName: "Remake",
          sceneLabel: `Plan ${shot.index + 1}`,
          duration: shot.duration,
          prompt,
          taskId,
          error: null,
        });
      } catch (error) {
        jobs.push({
          angleId: "remake",
          angleName: "Remake",
          sceneLabel: `Plan ${shot.index + 1}`,
          duration: shot.duration,
          prompt,
          taskId: null,
          error: error instanceof Error ? error.message : "Création impossible",
        });
      }
      await sleep(CREATE_GAP_MS);
    }

    const stored = await createBatch({
      product,
      resolution: body.resolution || "720p",
      jobs: jobs.map((job) => ({
        ...job,
        state: job.taskId ? ("pending" as const) : ("fail" as const),
        urls: [] as string[],
      })),
    });

    return NextResponse.json({ jobs, batchId: stored.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remake impossible" },
      { status: 502 }
    );
  }
}
