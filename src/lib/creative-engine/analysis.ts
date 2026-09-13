import { scrapeProduct } from "@/lib/meta/ad-copy";
import { kieClaude } from "@/lib/studio/kie";
import { fetchProductFromUrl } from "@/lib/ugc/fetch-product";
import type { ProductInput } from "@/lib/ugc/types";
import { PRODUCT_CLASSES, type Angle, type CreativeEmphasis, type ProductAnalysis, type ProductClass } from "@/lib/creative-engine/types";

/**
 * Analyse d'un produit depuis son URL : la page est lue deux fois (fiche
 * structurée + texte brut), puis le moteur IA en tire l'analyse et des angles.
 * Quand le moteur est tombé, un repli déterministe écrit une analyse honnête
 * depuis la fiche et propose les angles génériques les plus sûrs, pour que
 * le lot parte quand même. Rien n'est supposé sur la niche.
 */

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strList = (value: unknown, max = 6) => (Array.isArray(value) ? value.map(str).filter(Boolean).slice(0, max) : []);

export type Analyzed = {
  sheet: ProductInput | null;
  pageText: string;
  analysis: ProductAnalysis;
  angles: Angle[];
  engine: "claude" | "fallback";
  fallbackReason?: string;
};

/** Angles génériques, formulés pour n'importe quel produit ; les accroches citent le produit. */
/**
 * Le public visé, deviné dans le texte quand l'IA n'a rien dit : une page qui
 * parle de barbe et de barbier vise des hommes, une page de maquillage ou de
 * soutien-gorge vise des femmes. Vide quand rien ne tranche.
 */
export function inferGender(text: string) {
  const lower = text.toLowerCase();
  const men = (lower.match(/\b(beard|stubble|barber|shav(e|ing)|men's|for men|masculine|jawline for men|homme|barbe)\b/g) ?? []).length;
  const women = (lower.match(/\b(makeup|make-up|bra|dress|skirt|women's|for women|feminine|femme|maquillage|lingerie)\b/g) ?? []).length;
  if (men && men >= women * 2) return "men";
  if (women && women >= men * 2) return "women";
  return "";
}

function genericAngles(fullName: string, sheet: ProductInput | null, digital = false): Angle[] {
  const name = fullName.split(/\s+[|–—]\s+/)[0].trim().slice(0, 40) || fullName.slice(0, 40);
  const price = sheet?.price || "";
  const compare = sheet?.comparePrice || "";
  const point = sheet?.keyPoints.filter(Boolean)[0] || "";
  const make = (id: string, angle: string, why: string, hooks: string[]): Angle => ({ id, name: angle, why, hooks, source: "auto" });
  return [
    make("problem", "Problème → solution", "A specific daily frustration the product removes, shown before the relief.", [
      `Still dealing with this every day? ${name} ends it.`,
      `The problem isn't you. It's what you've been using. Meet ${name}.`,
      `One thing fixed it. ${name}.`,
    ]),
    make("transformation", "Transformation", "The visible change between before and after using the product.", [
      `Before ${name}. After ${name}.`,
      `What 30 days with ${name} actually looks like.`,
      `Same person. Different result. ${name}.`,
    ]),
    make("price", "Prix / valeur", "Value for money: what you get for the price, versus the alternatives.", [
      compare ? `${compare} → ${price}. Today only.` : `All of this for ${price || "less than you think"}.`,
      `Why pay more for less? ${name}.`,
      `The smartest ${price ? price + " " : ""}you'll spend this month.`,
    ]),
    make("social-proof", "Preuve sociale", "Many people already chose it; the viewer is late, not early.", [
      `Thousands switched to ${name}. Here's why.`,
      `“I wish I'd found this sooner.” — every review of ${name}.`,
      digital ? `Thousands started this month. Your turn: ${name}.` : `Sold out twice. Back in stock: ${name}.`,
    ]),
    make("desire", "Désir / résultat", "The outcome the buyer secretly wants, made concrete and immediate.", [
      point ? `${point}. Finally.` : `The result you've been chasing. ${name}.`,
      `Imagine this by next week. ${name}.`,
      `This is what you actually want. ${name} gets you there.`,
    ]),
    make("convenience", "Simplicité", "How easy and fast it is to use, versus the effort of alternatives.", [
      `No routine to learn. Just ${name}.`,
      `Two minutes a day. That's it.`,
      `Works while you do nothing. ${name}.`,
    ]),
    make("objection", "Objection levée", "The main doubt a buyer has, answered head-on.", [
      `“Does it really work?” Here's the honest answer.`,
      `Sceptical? So were they. ${name}.`,
      `Not another gimmick. Here's the difference.`,
    ]),
    make("comparison", "Comparaison", "Side by side against the generic alternative, on the criteria that matter.", [
      `${name} vs the cheap version.`,
      `What the others don't tell you.`,
      `Spot the difference.`,
    ]),
  ];
}

/**
 * Classe du produit et emphase recommandée, sans IA. Un produit sans objet
 * dont la page parle de transformation, de résultat ou de confiance est un
 * programme de transformation : on vend le résultat, jamais le fichier.
 */
export function classify(sheet: ProductInput | null, pageText: string): { productClass: ProductClass; emphasis: CreativeEmphasis } {
  const text = `${sheet?.name ?? ""} ${sheet?.description ?? ""} ${pageText}`.toLowerCase();
  const kind = sheet?.kind ?? "other";
  if (kind === "digital" || kind === "book" || kind === "topic" || /\b(protocol|protocole|blueprint|programme?|course|formation|ebook|e-book|pdf|guide|masterclass|coaching|template)\b/.test(text)) {
    const transformation = /\b(transformation|glow[- ]?up|results?|confidence|confiance|before|after|avant|après|jawline|skin|physique|routine|30 days|weeks?)\b/.test(text);
    if (/\b(software|saas|web app|mobile app|ios app|android app|desktop app|subscription plan)\b/.test(text) && kind === "digital") return { productClass: "SOFTWARE", emphasis: "balanced" };
    return { productClass: transformation ? "DIGITAL_TRANSFORMATION_PRODUCT" : "DIGITAL_INFORMATION_PRODUCT", emphasis: "outcome" };
  }
  if (/\b(service|consultation|coaching call|agency|agence|séance|session)\b/.test(text) && !sheet?.imageUrls.length) return { productClass: "SERVICE", emphasis: "outcome" };
  const emphasis: CreativeEmphasis = kind === "gadget" || kind === "furniture" ? "product" : "balanced";
  return { productClass: "PHYSICAL_PRODUCT", emphasis };
}

function fallbackAnalysis(sheet: ProductInput | null, pageText: string): ProductAnalysis {
  const { productClass, emphasis } = classify(sheet, pageText);
  /* Sans IA, la catégorie de la fiche est une devinette par mots-clés : pour un
     programme digital elle est souvent fausse (« fashion » sur un protocole
     visage). La classe fait foi. */
  const digitalLabel = productClass === "DIGITAL_TRANSFORMATION_PRODUCT" ? "digital transformation programme" : productClass === "DIGITAL_INFORMATION_PRODUCT" ? "digital guide" : productClass === "SOFTWARE" ? "software" : productClass === "SERVICE" ? "service" : "";
  return {
    brand: sheet?.brand || "",
    category: digitalLabel || sheet?.kind || "",
    productType: digitalLabel || sheet?.kind || "",
    productClass,
    recommendedEmphasis: emphasis,
    price: sheet?.price || "",
    comparePrice: sheet?.comparePrice || "",
    offer: sheet?.comparePrice ? `Compare-at ${sheet.comparePrice}, now ${sheet.price}` : "",
    targetCustomer: "",
    gender: inferGender(`${sheet?.name ?? ""} ${sheet?.description ?? ""} ${(sheet?.keyPoints ?? []).join(" ")} ${pageText.slice(0, 6000)}`),
    ageRange: "",
    mainProblem: "",
    benefits: sheet?.keyPoints.filter(Boolean) ?? [],
    desires: [],
    objections: [],
    mechanism: "",
    features: [],
    transformation: "",
    differentiation: "",
    guarantee: /money[- ]back|garantie|guarantee/i.test(pageText) ? "Money-back guarantee mentioned on the page" : "",
    tone: "",
    cta: "",
    claims: [],
  };
}

export async function analyzeProductUrl(url: string): Promise<Analyzed> {
  const [fetched, scraped] = await Promise.allSettled([fetchProductFromUrl(url), scrapeProduct(url)]);
  const sheet = fetched.status === "fulfilled" && fetched.value.name ? fetched.value : null;
  const page = scraped.status === "fulfilled" ? scraped.value : null;
  const pageText = page?.text?.slice(0, 7000) ?? "";
  const name = sheet?.name || page?.title || url;

  const facts = [
    `URL: ${url}`,
    sheet ? `Name: ${sheet.name}` : page?.title ? `Page title: ${page.title}` : "",
    sheet?.brand ? `Brand: ${sheet.brand}` : "",
    sheet?.price ? `Price: ${sheet.price}${sheet.comparePrice ? ` (compare-at ${sheet.comparePrice})` : ""}` : page?.price ? `Price: ${page.price}` : "",
    sheet?.description ? `Description: ${sheet.description}` : page?.description ? `Meta description: ${page.description}` : "",
    sheet?.keyPoints.filter(Boolean).length ? `Bullets on the page: ${sheet.keyPoints.filter(Boolean).join("; ")}` : "",
    sheet ? `Kind detected: ${sheet.kind}; photos: ${sheet.imageUrls.length}` : "",
    pageText ? `Page text:\n"""\n${pageText}\n"""` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await kieClaude(
      `You are an elite direct-response strategist. Analyze THIS product page only — never assume the niche, never reuse another product. Then propose the 8 most compelling advertising ANGLES for it (an angle is WHY the customer should care, not HOW the ad looks). Angles must fit this exact product: a fashion item gets fit/silhouette/compliments/occasion, a gadget gets annoying-problem/instant-solution/demonstration, a skincare or digital protocol gets visible transformation/confidence/speed/clarity, and so on. For each angle give 3 short hooks (headlines, max 9 words, specific to this product, no generic "upgrade your life").

${facts}

Also classify the product: "productClass" is one of PHYSICAL_PRODUCT, DIGITAL_INFORMATION_PRODUCT, DIGITAL_TRANSFORMATION_PRODUCT (a digital programme sold on the change it produces: protocol, blueprint, glow-up system, course promising a result), SERVICE, SOFTWARE, OTHER. And "recommendedEmphasis" is what should dominate the ads: "outcome" (the result — right for transformation products, courses, protocols, services), "balanced" (result and product equal — skincare bottles, shoes, apparel), or "product" (the item is the hero — gadgets, design-led objects, feature-driven products).

Return ONLY JSON:
{"analysis":{"brand":"","category":"","productType":"","productClass":"","recommendedEmphasis":"","price":"","comparePrice":"","offer":"","targetCustomer":"","gender":"","ageRange":"","mainProblem":"","benefits":[],"desires":[],"objections":[],"mechanism":"","features":[],"transformation":"","differentiation":"","guarantee":"","tone":"","cta":"","claims":[]},
 "angles":[{"name":"","why":"","hooks":["","",""]}]}`,
      4000
    );
    const json = extractJson(raw);
    if (!json) throw new Error("Réponse illisible du moteur IA");
    const parsed = JSON.parse(json) as { analysis?: Record<string, unknown>; angles?: Array<Record<string, unknown>> };
    const a = parsed.analysis ?? {};
    const guessed = classify(sheet, pageText);
    const productClass = (PRODUCT_CLASSES as readonly string[]).includes(str(a.productClass)) ? (str(a.productClass) as ProductClass) : guessed.productClass;
    const emphasisRaw = str(a.recommendedEmphasis).toLowerCase();
    const recommendedEmphasis: CreativeEmphasis = emphasisRaw === "outcome" || emphasisRaw === "balanced" || emphasisRaw === "product" ? emphasisRaw : guessed.emphasis;
    const analysis: ProductAnalysis = {
      brand: str(a.brand) || sheet?.brand || "",
      category: str(a.category),
      productType: str(a.productType),
      productClass,
      recommendedEmphasis,
      price: str(a.price) || sheet?.price || "",
      comparePrice: str(a.comparePrice) || sheet?.comparePrice || "",
      offer: str(a.offer),
      targetCustomer: str(a.targetCustomer),
      gender: str(a.gender),
      ageRange: str(a.ageRange),
      mainProblem: str(a.mainProblem),
      benefits: strList(a.benefits),
      desires: strList(a.desires),
      objections: strList(a.objections),
      mechanism: str(a.mechanism),
      features: strList(a.features, 8),
      transformation: str(a.transformation),
      differentiation: str(a.differentiation),
      guarantee: str(a.guarantee),
      tone: str(a.tone),
      cta: str(a.cta),
      claims: strList(a.claims, 8),
    };
    const angles: Angle[] = (parsed.angles ?? [])
      .map((entry) => ({
        id: uid("angle"),
        name: str(entry.name),
        why: str(entry.why),
        hooks: strList(entry.hooks, 3),
        source: "auto" as const,
      }))
      .filter((angle) => angle.name)
      .slice(0, 10);
    if (!angles.length) throw new Error("Aucun angle proposé");
    return { sheet, pageText, analysis, angles, engine: "claude" };
  } catch (error) {
    return {
      sheet,
      pageText,
      analysis: fallbackAnalysis(sheet, pageText),
      angles: genericAngles(name, sheet, /^DIGITAL_|^SOFTWARE$|^SERVICE$/.test(classify(sheet, pageText).productClass)),
      engine: "fallback",
      fallbackReason: error instanceof Error ? error.message : "Moteur IA indisponible",
    };
  }
}
