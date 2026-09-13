import { NextResponse } from "next/server";
import { readReferenceSite, type ReferenceProduct } from "@/lib/ecom-sites/reference";
import { noteReferenceRead } from "@/lib/ecom-sites/reference-store";
import { createEcomSite } from "@/lib/ecom-sites/store";
import { MAX_PRICE, type EcomProduct, type EcomThemeId } from "@/lib/ecom-sites/types";
import { kieClaude } from "@/lib/studio/kie";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Au-delà, on n'attend plus la réécriture : le site part avec ses textes de repli. */
const REWRITE_TIMEOUT_MS = 45_000;

type Body = {
  domain?: string;
  brandName?: string;
  themeId?: EcomThemeId;
  /**
   * Identité posée avant la copie, pas après.
   *
   * Le logo et les couleurs arrivaient une fois le site créé — donc après les
   * générations, qui sortaient sans marque. Les demander en amont rend
   * l'enchaînement automatique possible et juste.
   */
  logoDataUrl?: string;
  brandColors?: { primary: string; secondary: string } | null;
  /** Produits retenus, par handle source. Vide = tout le catalogue. */
  handles?: string[];
  /**
   * Copie sans réécriture : instantanée, et strictement fidèle au modèle.
   *
   * La réécriture n'apporte que les textes de marque ; tout ce qui compte —
   * noms, prix, formats, descriptions, photos — vient déjà de la source. La
   * sauter fait passer la copie de deux minutes à deux secondes.
   */
  fast?: boolean;
};

type Rebranded = {
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  promise: string;
  productDisclaimer: string;
  promoBar: string;
  pillars: Array<{ title: string; body: string }>;
  categories: Array<{ id: string; label: string; blurb: string }>;
  products: Array<{
    sourceHandle: string;
    name: string;
    subtitle: string;
    category: string;
    dosage: string;
    description: string;
    bullets: string[];
    usage: string;
    ingredients: string;
    badge: string;
  }>;
};

function handleOf(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function parseJson(raw: string): Rebranded {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Claude n'a pas renvoyé de JSON exploitable");
  return JSON.parse(candidate.slice(start, end + 1)) as Rebranded;
}

function buildPrompt(brandName: string, products: ReferenceProduct[]) {
  const catalogue = products
    .map((product, index) =>
      [
        `--- SOURCE PRODUCT ${index + 1} (handle: ${product.handle}, price: $${product.price})`,
        `Name: ${product.name}`,
        product.dosage ? `Format line: ${product.dosage}` : "",
        `Page text: ${product.raw.slice(0, 900)}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  return `You are rebranding an existing US ecommerce catalogue under a new brand name. The new store will be submitted to a payment processor for merchant underwriting, so the copy must be plain, concrete and defensible.

New brand name: ${brandName}

Below is the source catalogue. This store is being rebuilt as faithfully as possible: the lineup, the product names, the formats, the doses and the prices all stay exactly as they are — I keep them unchanged. Your job is only to write the pieces the source does not give me: the brand-level copy, the category labels, the short subtitles, the bullet lines, the usage line and the ingredient line. Write them so they sit naturally next to products I am not touching.

${catalogue}

Hard rules:
- Never claim a product treats, cures or prevents any disease.
- Never invent clinical trials, doctor endorsements, press mentions, certifications or awards.
- Never invent customer reviews, ratings or review counts.
- Keep ingredient names and doses realistic and consistent with the source format.
- Plain, concrete English. No em dashes.

Return ONLY a JSON object shaped exactly like this, with one entry in "products" per source product, in the same order, and "sourceHandle" copied from the source:
{
  "tagline": "three to five words",
  "heroTitle": "short sentence under 60 characters",
  "heroSubtitle": "two sentences: what the brand sells and who it is for",
  "promise": "one paragraph on sourcing, testing and honest labelling",
  "productDisclaimer": "the standard US disclaimer for this category, or empty string",
  "promoBar": "short uppercase marquee line with shipping and guarantee",
  "pillars": [ { "title": "short", "body": "two sentences" } ],
  "categories": [ { "id": "kebab-case", "label": "short", "blurb": "one line" } ],
  "products": [
    {
      "sourceHandle": "copied from the source block",
      "name": "new product name",
      "subtitle": "one short line",
      "category": "must match one category id",
      "dosage": "e.g. Daily . 2 gummies",
      "description": "150 to 220 characters",
      "bullets": ["four short benefit lines"],
      "usage": "one sentence",
      "ingredients": "comma separated actives with doses",
      "badge": "Bestseller, Hero, New, or empty string"
    }
  ]
}

Give 3 pillars and 3 to 4 categories.`;
}

/**
 * Ce qu'on écrit nous-mêmes quand le modèle de langage n'est pas là.
 *
 * Un site ne doit jamais échouer à se créer parce qu'un fournisseur d'IA est
 * indisponible : la copie perdait deux minutes en tentatives avant de tout
 * jeter, alors que la source contient déjà l'essentiel. Ces textes sont
 * volontairement plats et défendables — c'est ce qu'un souscripteur attend, et
 * ils se réécrivent ensuite d'un bouton.
 */
function fallbackCopy(brandName: string, products: ReferenceProduct[]): Rebranded {
  /*
   * Les catégories sortent des noms de produits.
   *
   * Elles servent aux sections du site et aux visuels d'ambiance : inventer un
   * découpage qui ne recoupe pas le catalogue donnerait des rayons vides.
   */
  const buckets: Array<{ id: string; label: string; blurb: string; test: RegExp }> = [
    { id: "skincare", label: "Skincare", blurb: "Serums, creams and treatments.", test: /serum|cream|cleanser|toner|mask|moistur|spf|retinol|acid|eye|face|skin/i },
    { id: "hair", label: "Hair & scalp", blurb: "Scalp care and hair support.", test: /hair|scalp|shampoo|conditioner|biotin/i },
    { id: "supplements", label: "Supplements", blurb: "Daily capsules, gummies and powders.", test: /capsule|gumm|tablet|powder|collagen|vitamin|supplement|drops/i },
    { id: "body", label: "Body", blurb: "Everyday body care.", test: /body|lotion|hand|foot|bath|scrub/i },
  ];

  const used = buckets.filter((bucket) => products.some((product) => bucket.test.test(product.name)));
  const categories = (used.length ? used : [{ id: "all", label: "All products", blurb: "The full range.", test: /./ }]).map(
    ({ id, label, blurb }) => ({ id, label, blurb })
  );

  const categoryFor = (name: string) =>
    (used.find((bucket) => bucket.test.test(name)) || { id: categories[0].id }).id;

  return {
    tagline: "Simple formulas, honest labels",
    heroTitle: `${brandName} makes it simple`,
    heroSubtitle: `${brandName} sells a short, focused range with the full formula printed on every label. No exaggerated promises, no confusing claims.`,
    promise:
      "We keep the range small so we can stand behind it. Every batch is made by an established manufacturer, the full ingredient list and doses are printed on the label, and what is on the label is what is in the bottle. If a product is not right for you, send it back within the return window.",
    productDisclaimer:
      "These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.",
    promoBar: "FREE US SHIPPING OVER $50 - 30-DAY GUARANTEE",
    pillars: [
      { title: "Short range", body: "We sell a handful of products, not a catalogue. Each one earns its place." },
      { title: "Full labels", body: "Every active and its dose is printed on the pack. Nothing hides behind a blend." },
      { title: "Easy returns", body: "Send it back within the return window for a refund. No forms, no argument." },
    ],
    categories,
    products: products.map((product) => ({
      sourceHandle: product.handle,
      name: product.name,
      subtitle: product.dosage || "",
      category: categoryFor(product.name),
      dosage: product.dosage || "",
      description: product.description || "",
      descriptionBlocks: product.descriptionBlocks,
      bullets: [],
      usage: "",
      ingredients: "",
      badge: "",
    })),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.domain?.trim()) return NextResponse.json({ error: "Modèle requis" }, { status: 400 });
    if (!body.brandName?.trim()) return NextResponse.json({ error: "Nom de marque requis" }, { status: 400 });

    const read = await readReferenceSite(body.domain);
    await noteReferenceRead(read.domain, read.products.length);
    if (!read.products.length) {
      return NextResponse.json(
        { error: `Aucun produit lisible sur ${read.domain}. ${read.warnings.join(" ")}`.trim() },
        { status: 422 }
      );
    }

    /*
     * La réécriture ne peut plus faire échouer la copie.
     *
     * Elle passait avant tout le reste, et un modèle indisponible chez Kie
     * coûtait deux minutes trente d'attente pour finir sans rien créer. Elle
     * est maintenant bornée dans le temps, et son échec fait retomber sur des
     * textes écrits ici — le catalogue, lui, ne dépend d'aucun modèle.
     */
    let rebranded = fallbackCopy(body.brandName, read.products);
    let rewritten = false;

    if (!body.fast) {
      try {
        const raw = await Promise.race([
          kieClaude(buildPrompt(body.brandName, read.products), 8000),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Réécriture trop longue")), REWRITE_TIMEOUT_MS)
          ),
        ]);
        rebranded = parseJson(raw);
        rewritten = true;
      } catch {
        // Textes de repli : la boutique se crée quand même, et tout de suite.
      }
    }

    const categories = (rebranded.categories || []).map((category) => ({
      id: category.id || handleOf(category.label || "all"),
      label: category.label || "",
      blurb: category.blurb || "",
    }));
    const categoryIds = new Set(categories.map((category) => category.id));


    /*
     * On parcourt la SOURCE, pas la réponse du modèle.
     *
     * L'inverse coûtait des produits : le catalogue final valait ce que le
     * modèle avait bien voulu réécrire, et s'il en oubliait la moitié, la
     * boutique arrivait à moitié vide sans que rien ne le signale. La source
     * fait foi sur le nombre comme sur le contenu ; la réponse du modèle n'est
     * plus qu'un complément qu'on va chercher par `sourceHandle`.
     */
    const rebrandedByHandle = new Map(
      (rebranded.products || []).map((product) => [product.sourceHandle, product])
    );

    /*
     * Dédoublonnage à l'entrée.
     *
     * Un site modèle peut exposer deux fois la même référence — variantes
     * éclatées, pages en double, collection qui se répète. Ce n'est pas notre
     * affaire de deviner pourquoi : un catalogue qui affiche sept fois le même
     * gel se voit immédiatement, et se corrige ici une bonne fois.
     */
    // Une sélection faite à l'aperçu restreint le catalogue dès la copie.
    const wanted = body.handles?.length ? new Set(body.handles) : null;

    const seenSource = new Set<string>();
    const uniqueSources = read.products.filter((source) => {
      if (wanted && !wanted.has(source.handle)) return false;
      const key = (source.name || source.handle).trim().toLowerCase();
      if (!key || seenSource.has(key)) return false;
      seenSource.add(key);
      return true;
    });

    /*
     * Une sélection qui ne retient rien est une erreur, pas un catalogue vide.
     *
     * Les handles viennent de l'aperçu d'un autre site, ou le modèle a changé
     * depuis la lecture : le filtre écarte tout, et la boutique se créait sans
     * un seul produit, sans rien signaler. Mieux vaut refuser et le dire.
     */
    if (wanted && !uniqueSources.length) {
      return NextResponse.json(
        {
          error: `Aucun des produits sélectionnés n'existe sur ${read.domain}. Relis le site et coche à nouveau.`,
        },
        { status: 422 }
      );
    }

    /*
     * Identifiants uniques, garantis.
     *
     * `handleOf` dérive du nom : deux références au libellé proche — la version
     * simple et sa déclinaison VIP, par exemple — retombaient sur le même
     * identifiant. Tout ce qui cible un produit par son handle traitait alors
     * les deux comme un seul : cocher l'un cochait l'autre, et générer le
     * packaging de l'un écrasait celui de l'autre.
     */
    const usedHandles = new Set<string>();
    const uniqueHandle = (base: string) => {
      const root = base || "product";
      let candidate = root;
      let suffix = 2;
      while (usedHandles.has(candidate)) candidate = `${root}-${suffix++}`;
      usedHandles.add(candidate);
      return candidate;
    };

    const products: EcomProduct[] = uniqueSources.map((source, index) => {
      const product = rebrandedByHandle.get(source.handle) ||
        (rebranded.products || [])[index] || {
          name: "",
          subtitle: "",
          category: "",
          dosage: "",
          description: "",
          bullets: [],
          usage: "",
          ingredients: "",
          badge: "",
          sourceHandle: source.handle,
        };
      // Le prix vient toujours du modèle, jamais du modèle de langage.
      const sourcePrice = source?.price || 0;
      const price = Math.min(sourcePrice > 0 ? sourcePrice : 29.99, MAX_PRICE);

      /*
       * Fidélité au modèle.
       *
       * Le nom, le prix, le format et le descriptif viennent du site source, pas
       * du modèle de langage : on rebâtit une boutique qui existe, on n'en
       * invente pas une autre. La réécriture ne sert plus que là où la source ne
       * dit rien — sous-titres, arguments, textes de marque.
       *
       * La photo source devient le visuel affiché immédiatement, et sert de
       * gabarit à la génération de packaging : le produit garde sa forme, seuls
       * la couleur et le logo changent.
       */
      const name = source?.name || product.name || "";

      return {
        handle: uniqueHandle(handleOf(name || `product-${index + 1}`)),
        name,
        subtitle: product.subtitle || "",
        category: categoryIds.has(product.category) ? product.category : categories[0]?.id || "",
        price,
        compareAtPrice: null,
        dosage: source?.dosage || product.dosage || "",
        description: source?.description || product.description || "",
        descriptionBlocks: source?.descriptionBlocks,
        bullets: Array.isArray(product.bullets) ? product.bullets.slice(0, 6) : [],
        usage: product.usage || "",
        ingredients: product.ingredients || "",
        badge: product.badge || "",
        imageUrl: source?.imageUrl || "",
        sourceImageUrl: source?.imageUrl || "",
        sourceImageRatio: source?.imageRatio || 0,
        packagingTaskId: null,
      };
    });

    const site = await createEcomSite({
      brandName: body.brandName,
      themeId: body.themeId || "glow",
      // Le site naît déjà brandé : les générations qui suivent ont de quoi travailler.
      logoDataUrl: body.logoDataUrl || "",
      brandColors: body.brandColors ?? null,
      // Les packagings sortiront au format du modèle, pas en carré par défaut.
      imageRatio: read.imageRatio || "1:1",
      // Et la page d'accueil suivra l'enchaînement de blocs du modèle.
      layout: read.layout || [],
      sectionTitles: read.headings || [],
      tagline: rebranded.tagline || "",
      heroTitle: rebranded.heroTitle || "",
      heroSubtitle: rebranded.heroSubtitle || "",
      promise: rebranded.promise || "",
      productDisclaimer: rebranded.productDisclaimer || "",
      promoBar: rebranded.promoBar || "FREE US SHIPPING OVER $50 ✦ 30-DAY GUARANTEE",
      pillars: (rebranded.pillars || []).slice(0, 4),
      categories,
      products,
    });

    return NextResponse.json({
      site,
      copiedFrom: read.domain,
      source: read.source,
      rewritten,
      warnings: rewritten
        ? read.warnings
        : [
            ...read.warnings,
            "Textes de marque écrits en repli : produits, prix et photos sont ceux du modèle. Relance « Générer la copy » pour les faire réécrire.",
          ],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Copie impossible" },
      { status: 502 }
    );
  }
}
