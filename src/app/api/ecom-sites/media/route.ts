import { NextResponse } from "next/server";
import { createKieTask, getKieTask } from "@/lib/studio/kie";
import { getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import { sitePalette, type EcomProduct, type EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
 * Un seul produit par scène, montré tel qu'il est.
 *
 * Les scènes regroupaient trois à cinq packs pour « raconter une gamme » : le
 * modèle les déformait, en inventait d'autres et les mélangeait à des
 * accessoires qu'on finissait par croire inclus. Une scène montre désormais UN
 * produit, celui de sa catégorie, avec sa photo de fiche comme référence.
 */
const WITH_PRODUCT = [
  "THE ATTACHED IMAGE IS THE EXACT PRODUCT SOLD. Show it once, exactly as photographed:",
  "same shape, same colours, same materials, same parts, same size. Do not redesign it,",
  "do not add a box or packaging around it, do not add a second unit.",
].join(" ");

/** Ce qui rend une scène crédible et honnête, pour toutes les boutiques. */
const SCENE_RULES = [
  "SCALE: keep real-world proportions between the product, hands, people, pets and furniture;",
  "nothing is oversized or miniature compared with how the product is really used.",
  "HONESTY: every other object in frame is an ordinary household item that clearly is not for sale;",
  "never show extra units, refills, matching accessories or other products of the brand, and nothing",
  "that a shopper could believe comes with the purchase.",
  "No text overlay, no logo, no packaging, no invented brand anywhere in the scene.",
].join(" ");

/**
 * Direction artistique commune à toutes les images.
 *
 * Une focale, une lumière, un rendu partagés donnent l'impression d'une seule
 * séance photo. Les décors, eux, varient d'une image à l'autre : six fois le
 * même salon se remarque autant qu'un assemblage de banques d'images.
 */
const ART_DIRECTION = [
  "ART DIRECTION, identical across every image of this set: shot on a 50mm lens at",
  "f/2.0, camera at chest height, soft window light with one consistent soft shadow.",
  "Muted, slightly desaturated grade with warm mid-tones and clean whites, gentle film",
  "grain, no vignette. Calm and unstyled, a real brand's own photography, never stock.",
].join(" ");

/** Les décors, un par image : la boutique ne doit pas montrer six fois la même pièce. */
const SETTINGS = [
  "a bright living room with a wooden floor",
  "a kitchen corner by a window",
  "a hallway or entryway with natural light",
  "a bedroom with linen bedding",
  "a home office or reading nook",
  "a sunny window sill or balcony door",
  "a laundry or utility room",
];

/** Un visuel à produire : sa place sur le site, ce qu'il montre, et le produit qu'il montre. */
type Slot = { key: string; prompt: string; product?: EcomProduct };

/** Ce que vend la boutique, en une phrase : le décor et le geste s'en déduisent. */
function brandBrief(site: EcomSite) {
  const categories = site.categories.map((category) => category.label).filter(Boolean);
  return [site.heroSubtitle || "", categories.length ? `Product categories: ${categories.join(", ")}.` : ""]
    .filter(Boolean)
    .join(" ");
}

/** Une photo de fiche utilisable comme référence : faite pour CE produit, jamais celle du site modèle. */
function showable(product: EcomProduct) {
  if (!product.imageUrl || product.imageUrl === product.sourceImageUrl) return false;
  if (product.imageInfo?.kind === "source") return false;
  return true;
}

/** Une adresse que Kie peut lire : les médias de la boutique sont servis par notre domaine. */
function absoluteUrl(url: string) {
  if (/^https?:\/\//.test(url)) return url;
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || "https://www.mabillmafia.com";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

function slotsFor(site: EcomSite): Slot[] {
  const palette = `Colour world: ${sitePalette(site.themeId, site.brandColors).accent} accents, calm and coherent across every image.`;
  const brief = brandBrief(site);
  const anchor = brief ? `What the shop sells: ${brief}` : "";
  const products = site.products.filter(showable);
  const pick = (index: number, category?: string) =>
    category
      ? products.find((product) => product.category === category)
      : products.length
        ? products[index % products.length]
        : undefined;
  let setting = 0;
  const nextSetting = () => SETTINGS[setting++ % SETTINGS.length];

  const scene = (product: EcomProduct | undefined, framing: string) =>
    [
      product ? `The product is "${product.name}".` : "",
      framing,
      anchor,
      `Setting: ${nextSetting()}.`,
      SCENE_RULES,
      palette,
      ART_DIRECTION,
      REALISM,
    ]
      .filter(Boolean)
      .join(" ");

  const heroProduct = pick(0);
  const slots: Slot[] = [
    {
      key: "hero",
      product: heroProduct,
      prompt: scene(
        heroProduct,
        "Wide homepage banner: the product in real everyday use, whoever uses it caught mid-moment, not posing. Generous empty space on one side for a headline."
      ),
    },
  ];

  site.categories.slice(0, 4).forEach((category) => {
    const product = pick(0, category.id);
    slots.push({
      key: `category:${category.id}`,
      product,
      prompt: scene(
        product,
        `Lifestyle still for the "${category.label}" section${category.blurb ? ` (${category.blurb})` : ""}: the product where and how it is actually used.`
      ),
    });
  });

  const detail = pick(1);
  const inUse = pick(2);
  slots.push(
    {
      key: "lifestyle:0",
      product: detail,
      prompt: scene(detail, "Close detail shot: the product's material and one real feature, in hand or in use, shallow depth of field."),
    },
    {
      key: "lifestyle:1",
      product: inUse,
      prompt: scene(inUse, "Quiet in-context shot: the product alone in its everyday place, no people, lived-in and slightly untidy."),
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

    const slots = slotsFor(site);
    /*
     * Pas de photo de fiche, pas de scène : sans référence, le modèle dessine
     * un produit qui n'existe pas. Mieux vaut refuser et le dire.
     */
    if (!slots.some((slot) => slot.product)) {
      return NextResponse.json(
        { error: "Génère d'abord les photos produit : sans elles, les scènes montreraient un produit inventé." },
        { status: 409 }
      );
    }

    const jobs: Array<{ key: string; taskId: string | null; error: string | null }> = [];
    for (const [index, slot] of slots.entries()) {
      // Espacé : Kie compte les appels et coupe au-delà d'une certaine cadence.
      if (index) await sleep(CREATE_GAP_MS);
      try {
        // Une catégorie sans produit photographié n'a pas de scène : on ne l'invente pas.
        if (!slot.product) throw new Error("Aucun produit photographié dans cette catégorie");
        const taskId = await createKieTask(MODEL_WITH_PRODUCT, {
          prompt: `${WITH_PRODUCT} ${slot.prompt}`,
          input_urls: [absoluteUrl(slot.product.imageUrl)],
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
