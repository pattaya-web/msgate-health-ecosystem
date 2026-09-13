import { NextResponse } from "next/server";
import { createKieTask, getKieTask } from "@/lib/studio/kie";
import { getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import { sitePalette, type EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "gpt-image-2-text-to-image";
/** Avec un pack de référence, on compose la scène autour du produit réel. */
const MODEL_WITH_PRODUCT = "gpt-image-2-image-to-image";
const CREATE_GAP_MS = 900;
const TRANSIENT = /rate|limit|429|timeout|busy|saturé|too many|frequency/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Body = {
  action?: "generate" | "status";
  siteId?: string;
  taskIds?: string[];
  /**
   * Pack brandé à poser dans les scènes, quand l'appelant en tient un.
   *
   * Un packaging qui vient de sortir vit dans le brouillon de l'onglet, pas
   * encore dans le site stocké : le chercher ici ne donnait rien au moment
   * même où il existait enfin.
   */
  packUrl?: string;
};

/**
 * Ce qu'on demande, et ce qu'on interdit.
 *
 * Une boutique qui n'a que des packshots sur fond blanc a l'air d'un catalogue.
 * Ces visuels donnent l'ambiance — mais ils doivent rester crédibles : le repli
 * du modèle est l'image de banque d'images, lisse et sans source de lumière,
 * qui se repère immédiatement et dessert la marque.
 */
const REALISM = [
  "PHOTOGRAPH, not an illustration and not a 3D render. Shot on a full-frame",
  "camera: real optics with mild edge softness and slight chromatic aberration,",
  "visible fine sensor grain, genuine shallow depth of field where the falloff",
  "follows distance. One identifiable light source, its shadow consistent in",
  "direction, softness and density across every object in frame.",
  "Real skin with pores, fine hair, uneven tone and a little redness at the",
  "knuckles. Real fabric with weave, pilling and creases. Surfaces with dust,",
  "fingerprints, water marks and small scratches. Slight asymmetry everywhere:",
  "objects not perfectly aligned, a towel not perfectly folded.",
  "ABSOLUTELY AVOID: airbrushed plastic skin, waxy highlights, glowing rim light",
  "with no source, perfect symmetry, floating objects, impossible reflections,",
  "over-saturated HDR, haloing, stock-photo blandness, CGI product renders,",
  "mangled or extra fingers, garbled or nonsense text, and any invented logo,",
  "wordmark or brand name anywhere in the scene.",
].join(" ");

/**
 * Comment la marque entre dans une image d'ambiance.
 *
 * Faire dessiner un logo par un modèle d'image donne des lettres tordues, et un
 * faux logo sur un site soumis à underwriting se remarque plus qu'il ne sert.
 * La marque passe donc par le produit : le pack déjà généré — qui porte, lui,
 * le vrai logo — est placé dans la scène. C'est ce qui fait un univers de
 * marque plutôt qu'une banque d'images.
 */
const WITH_PRODUCT = [
  "THE ATTACHED IMAGES ARE MY REAL PRODUCTS, and they are the ONLY packaging",
  "allowed in this photograph.",
  "HARD RULE — read this before composing the scene: every single bottle, jar,",
  "tube, tub or box visible in frame must be one of the attached products,",
  "reproduced with its printed brand logo legible. If the composition would need",
  "more containers than I supplied, DO NOT invent any: leave that part of the",
  "surface empty, or fill it with non-packaging props — a towel, a plant, a",
  "glass of water, a book, a stone dish.",
  "Reproduce each supplied pack exactly: same shape, same cap, same colours, same",
  "label layout, and the SAME BRAND LOGO, sharp and readable. Never redraw the",
  "logo, never restyle it, never replace it with typed letters, never blur it,",
  "never crop it out of frame, never turn the pack away from the camera.",
  "A plain unbranded bottle anywhere in this image is a failed result.",
].join(" ");

/**
 * Ce qu'on interdit selon qu'on ait, ou non, un pack à montrer.
 *
 * Les deux consignes coexistaient : la scène demandait « no branded packaging »
 * pendant que le bloc produit demandait le pack avec sa marque. Le modèle
 * tranchait au milieu et sortait des pots génériques — la marque nulle part.
 * Une seule règle s'applique désormais, celle qui correspond au cas.
 */
const BRAND_RULE = {
  withPack:
    "EVERY container in this photograph is one of my attached products, its logo readable. No unbranded packaging, no invented brand, no competing logo, no text overlay.",
  without: "No branded packaging, no invented logos, no legible label text.",
} as const;

/**
 * Direction artistique commune à toutes les images.
 *
 * C'est elle qui fait la différence entre un site de marque et une page qui
 * sent l'image générée : six visuels tirés au hasard ne forment pas un univers,
 * même bons individuellement. Une focale, une lumière, un rendu et une gamme
 * partagés donnent l'impression d'une seule séance photo — ce qu'un vrai site
 * de marque a, et ce qu'un assemblage n'a jamais.
 */
const ART_DIRECTION = [
  "ART DIRECTION, identical across every image of this set: shot on a 50mm lens at",
  "f/2.0, camera at chest height, soft north-facing window light from the left with",
  "one consistent soft shadow falling right. Muted, slightly desaturated grade with",
  "warm mid-tones and clean whites, gentle film grain, no vignette. Calm, quiet,",
  "unstyled — the look of a real brand's own photography, never a stock library.",
].join(" ");

/** Un visuel à produire : sa place sur le site, et ce qu'il montre. */
type Slot = { key: string; prompt: string };

/**
 * De quoi parle cette boutique, en une phrase utilisable.
 *
 * Sans ça, les visuels sortaient génériques — « une personne dans un intérieur »
 * pouvait illustrer n'importe quelle marque, donc aucune. Les noms de produits
 * disent la catégorie mieux qu'un champ de niche : « Hyaluronic Acid Gel Cream »
 * situe immédiatement une routine de soin, un lieu, un geste.
 */
function brandBrief(site: EcomSite) {
  const names = site.products.slice(0, 8).map((product) => product.name).filter(Boolean);
  const categories = site.categories.map((category) => category.label).filter(Boolean);

  return [
    site.promise || site.heroSubtitle || "",
    categories.length ? `Product categories: ${categories.join(", ")}.` : "",
    names.length ? `The catalogue includes: ${names.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function slotsFor(site: EcomSite, hasPack: boolean): Slot[] {
  const theme = sitePalette(site.themeId, site.brandColors);
  const brief = brandBrief(site);
  const brandRule = hasPack ? BRAND_RULE.withPack : BRAND_RULE.without;
  const palette = `Colour world: ${theme.accent} accents against ${theme.sand}, calm and coherent across every image.`;

  /*
   * Le brief passe en tête de chaque prompt : c'est lui qui ancre la scène dans
   * la bonne catégorie. Un même cadrage sert une marque de soin et une marque
   * de compléments, mais pas avec le même décor ni le même geste.
   */
  const anchor = brief
    ? `This is the brand's own world, infer the setting and the gesture from it: ${brief}`
    : "A calm modern consumer brand.";

  const slots: Slot[] = [
    {
      key: "hero",
      prompt: [
        "Wide lifestyle banner for the homepage of a direct-to-consumer brand.",
        anchor,
        "One real person using the category's product in their own bathroom or",
        "bedroom, caught mid-gesture, not posing. Generous empty space on one side",
        "for a headline.",
        brandRule,
        palette,
        ART_DIRECTION,
        REALISM,
      ].join(" "),
    },
  ];

  for (const category of site.categories.slice(0, 4)) {
    slots.push({
      key: `category:${category.id}`,
      prompt: [
        `Lifestyle still for the "${category.label}" section of this brand's website.`,
        category.blurb ? `The section covers: ${category.blurb}.` : "",
        anchor,
        "An everyday moment that belongs to this exact category — the right room,",
        "the right surface, the right gesture — with my products in the frame.",
        brandRule,
        palette,
        ART_DIRECTION,
        REALISM,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  slots.push(
    {
      key: "lifestyle:0",
      prompt: [
        "Close detail shot for this brand's website: hands mid-routine, texture of",
        "the product on skin or on a surface, morning light.",
        anchor,
        "Lived in, slightly untidy, real.",
        brandRule,
        palette,
        ART_DIRECTION,
        REALISM,
      ].join(" "),
    },
    {
      key: "lifestyle:1",
      prompt: [
        "Still life for this brand's website: my products grouped on a real bathroom",
        "counter or vanity, soft daylight, with a plant, a folded towel and a stone",
        "dish as the only other objects.",
        anchor,
        "No people in frame.",
        brandRule,
        palette,
        ART_DIRECTION,
        REALISM,
      ].join(" "),
    }
  );

  return slots;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;

    if (body.action === "status") {
      const taskIds = (body.taskIds ?? []).slice(0, 40);
      const results = await Promise.all(
        taskIds.map(async (taskId) => {
          try {
            const task = await getKieTask(taskId);
            return { taskId, state: task.state, urls: task.urls, failMsg: task.failMsg ?? null };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Statut illisible";
            // Une limite de cadence ne veut pas dire que la tâche a échoué.
            if (TRANSIENT.test(message)) return { taskId, state: "pending", urls: [], failMsg: null };
            return { taskId, state: "fail", urls: [], failMsg: message };
          }
        })
      );
      return NextResponse.json({ results });
    }

    if (!body.siteId) return NextResponse.json({ error: "siteId requis" }, { status: 400 });
    const site = await getEcomSite(body.siteId);
    if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });

    /*
     * Tous les packs brandés, pas un seul.
     *
     * Une scène tirée d'un unique pack donnait le même flacon partout ; et
     * quand ce pack manquait, le modèle inventait un packaging générique. On
     * prend le catalogue régénéré au complet — jamais une photo restée au site
     * modèle, qui porterait la marque de quelqu'un d'autre — et chaque scène
     * pioche dedans.
     */
    const branded = [
      ...new Set(
        [
          body.packUrl?.trim() || "",
          ...site.products
            .filter((product) => product.imageUrl && product.imageUrl !== product.sourceImageUrl)
            .map((product) => product.imageUrl),
        ].filter(Boolean)
      ),
    ];

    /*
     * Pas de pack brandé, pas de visuels.
     *
     * Le repli « scène sans produit » existait pour habiller un site en
     * attendant les packagings. Il ne servait à rien : ces images sortaient
     * sans la marque, on les payait, et il fallait tout refaire une fois les
     * packs prêts. Mieux vaut refuser et le dire.
     */
    if (!branded.length) {
      return NextResponse.json(
        { error: "Génère d'abord les packagings : sans pack brandé, les scènes sortiraient sans ta marque." },
        { status: 409 }
      );
    }

    const slots = slotsFor(site, true);
    const jobs: Array<{ key: string; taskId: string | null; error: string | null }> = [];

    /*
     * Combien de packs par scène.
     *
     * Une étagère avec un seul flacon ne raconte pas une gamme ; un gros plan
     * sur trois pots n'a plus de sujet. Le nombre suit ce que la scène montre,
     * et l'entrée dans la liste tourne pour ne pas répéter le même produit.
     */
    const packsFor = (key: string, index: number) => {
      /*
       * Une étagère demande de quoi la garnir.
       *
       * Avec un seul pack fourni, le modèle complétait la scène avec des
       * flacons inventés, sans marque — exactement ce qu'on cherche à éviter.
       * On lui donne assez de vrais produits pour qu'il n'ait jamais besoin
       * d'en imaginer un.
       */
      const wanted = key === "lifestyle:1" ? 5 : key === "hero" ? 3 : key.startsWith("category:") ? 3 : 2;
      const take = Math.min(wanted, branded.length);
      return Array.from({ length: take }, (_, offset) => branded[(index + offset) % branded.length]);
    };

    for (const [index, slot] of slots.entries()) {
      // Espacé : Kie compte les appels et coupe au-delà d'une certaine cadence.
      if (index) await sleep(CREATE_GAP_MS);
      try {
        const refs = packsFor(slot.key, index);
        const taskId = refs.length
          ? await createKieTask(MODEL_WITH_PRODUCT, {
              prompt: `${WITH_PRODUCT} ${slot.prompt}`,
              input_urls: refs,
              aspect_ratio: slot.key === "hero" ? "16:9" : "4:3",
              resolution: "1K",
            })
          : await createKieTask(MODEL, {
              prompt: slot.prompt,
              aspect_ratio: slot.key === "hero" ? "16:9" : "4:3",
              resolution: "1K",
            });
        jobs.push({ key: slot.key, taskId, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Création impossible";
        jobs.push({
          key: slot.key,
          taskId: null,
          error: TRANSIENT.test(message) ? "Kie saturé — relance" : message,
        });
      }
    }

    // Les taskId sont posés sur le site : un rechargement retrouve les visuels
    // en cours au lieu de les perdre.
    await updateEcomSite(site.id, {
      mediaTaskIds: jobs.map((job) => job.taskId).filter((id): id is string => Boolean(id)),
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération des visuels impossible" },
      { status: 502 }
    );
  }
}
