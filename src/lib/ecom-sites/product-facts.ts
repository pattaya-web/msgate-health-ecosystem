/**
 * La fiche produit comme source unique, et ce qu'on peut en vérifier.
 *
 * Tout ce qui s'affiche d'un produit — titre, image, description, panier — se
 * lit sur `EcomProduct`. Ce module dit, pour chaque fiche et pour la boutique,
 * ce qui manque, ce qui n'a pas été validé par un humain, ce qui ne correspond
 * plus (une image faite pour un autre nom, un ancien nom resté dans un titre)
 * et quelles promesses commerciales n'ont pas de justificatif. Il ne complète
 * jamais rien : il signale, et c'est l'opérateur qui tranche.
 *
 * Aucune dépendance serveur : l'éditeur l'utilise aussi, pour afficher les
 * mêmes alertes que le contrôle avant publication.
 */

import { RESERVED_SLUGS } from "@/lib/ecom-sites/pages";
import { POLICY_SLUGS } from "@/lib/ecom-sites/policies";
import type { EcomProduct, EcomSite, PageBlock } from "@/lib/ecom-sites/types";

/* ------------------------------------------------------------------ */
/* Noms et adresses                                                     */
/* ------------------------------------------------------------------ */

/** L'adresse qu'aurait un produit d'après son nom (« Automatic cat feeder » → automatic-cat-feeder). */
export function handleForName(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 64) || "product"
  );
}

export function sameName(a: string, b: string) {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return clean(a) === clean(b);
}

/**
 * Renomme un produit en gardant la trace de l'ancien nom et de l'ancienne adresse.
 *
 * L'ancienne adresse reste servie (redirection permanente vers la nouvelle) :
 * un lien déjà partagé, une pub en cours ou un panier ouvert ne tombent pas
 * sur une page introuvable.
 */
export function renameProduct(product: EcomProduct, name: string): EcomProduct {
  const trimmed = name.trim();
  if (!trimmed || trimmed === product.name) return product;
  const previousNames = [...new Set([...(product.previousNames ?? []), product.name])].filter(
    (old) => old && !sameName(old, trimmed)
  );
  return { ...product, name: trimmed, previousNames };
}

/** Aligne l'adresse sur le nom ; l'ancienne devient une redirection. */
export function alignHandle(product: EcomProduct, takenHandles: string[]): EcomProduct {
  const base = handleForName(product.name);
  if (base === product.handle) return product;
  const taken = new Set(takenHandles.filter((handle) => handle !== product.handle));
  let handle = base;
  for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}-${suffix}`;
  const previousHandles = [...new Set([...(product.previousHandles ?? []), product.handle])].filter((old) => old !== handle);
  return { ...product, handle, previousHandles };
}

/**
 * Ce qu'un navigateur reçoit d'un produit.
 *
 * Les composants du panier tournent dans le navigateur : leurs données se
 * lisent dans le code source de la page. Les champs de travail — page et
 * photos du site d'origine, anciens noms, validations, notes de génération —
 * n'ont rien à y faire.
 */
export function publicProduct(product: EcomProduct): EcomProduct {
  const rest = { ...product };
  delete rest.sourceUrl;
  delete rest.sourceImageUrl;
  delete rest.sourceImageUrls;
  delete rest.aiFields;
  delete rest.review;
  delete rest.imageInfo;
  delete rest.previousNames;
  delete rest.packagingReferenceUrl;
  rest.packagingTaskId = null;
  return rest;
}

/** La boutique telle qu'un navigateur la reçoit (panier, paiement). */
export function publicSite(site: EcomSite): EcomSite {
  const rest = { ...site, products: site.products.map(publicProduct) };
  delete rest.modelDomain;
  delete rest.publishApproval;
  delete rest.claimProofs;
  delete rest.sectionTitles;
  return rest;
}

/** Le produit derrière une adresse, ancienne comprise. */
export function findProduct(products: EcomProduct[], handle: string) {
  const current = products.find((product) => product.handle === handle);
  if (current) return { product: current, moved: false };
  const moved = products.find((product) => product.previousHandles?.includes(handle));
  return moved ? { product: moved, moved: true } : null;
}

/* ------------------------------------------------------------------ */
/* Validation humaine                                                   */
/* ------------------------------------------------------------------ */

/** Une empreinte courte et stable, calculable dans le navigateur comme sur le serveur. */
function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Ce qui, s'il change, rend une validation caduque. */
export function productSignature(product: EcomProduct) {
  return hash(
    JSON.stringify([
      product.name,
      product.price,
      product.category,
      product.sku ?? "",
      product.dosage,
      product.ingredients,
      product.description,
      product.bullets,
      product.usage,
      product.includedItems ?? [],
      product.variants ?? [],
      product.imageUrl,
      product.packagingMode ?? "product",
      product.packagingReferenceUrl ?? "",
    ])
  );
}

export type ReviewState = "validated" | "changed" | "never";

export function reviewState(product: EcomProduct): ReviewState {
  if (!product.review) return "never";
  return product.review.signature === productSignature(product) ? "validated" : "changed";
}

export function validateProduct(product: EcomProduct, by?: string): EcomProduct {
  return { ...product, review: { at: new Date().toISOString(), by, signature: productSignature(product) } };
}

/* ------------------------------------------------------------------ */
/* Données manquantes                                                   */
/* ------------------------------------------------------------------ */

export type MissingFact = { field: string; label: string };

/**
 * Ce qu'un client ou un analyste cherchera et qu'on n'a pas.
 *
 * Volontairement court : la référence, le contenu du colis, les
 * caractéristiques, la source. On ne demande pas de champ qui n'a pas de sens
 * pour tous les produits.
 */
export function missingFacts(product: EcomProduct): MissingFact[] {
  const missing: MissingFact[] = [];
  if (!product.sku?.trim()) missing.push({ field: "sku", label: "Référence (SKU)" });
  if (!product.includedItems?.some((item) => item.trim())) missing.push({ field: "includedItems", label: "Contenu du colis" });
  if (!product.dosage.trim() && !product.ingredients.trim()) {
    missing.push({ field: "specs", label: "Caractéristiques (taille, matière, capacité…)" });
  }
  if (!product.sourceUrl?.trim() && !product.sourceImageUrl?.trim()) {
    missing.push({ field: "source", label: "Référence produit (page ou photo d'origine)" });
  }
  if (product.description.trim().length < 60) missing.push({ field: "description", label: "Description" });
  if (!product.imageUrl) missing.push({ field: "image", label: "Photo" });
  return missing;
}

/* ------------------------------------------------------------------ */
/* Image                                                                */
/* ------------------------------------------------------------------ */

export type Issue = { level: "fail" | "warn"; text: string };

/** Ce qui cloche entre la fiche et son image, ou null. */
export function imageIssue(product: EcomProduct): Issue | null {
  if (!product.imageUrl) return { level: "fail", text: "aucune photo" };
  const info = product.imageInfo;
  if (!info) {
    if (product.sourceImageUrl && product.imageUrl === product.sourceImageUrl) {
      return { level: "fail", text: "photo du site d'origine affichée telle quelle (marque et droits d'un autre)" };
    }
    return { level: "warn", text: "origine de l'image inconnue (générée avant le suivi des images) : à revoir" };
  }
  if (!sameName(info.forName, product.name)) {
    return { level: "fail", text: `image faite pour « ${info.forName} », le produit s'appelle « ${product.name} »` };
  }
  if (info.kind === "brand-pack" && info.reference !== "verified-pack") {
    return { level: "fail", text: "emballage de marque généré sans référence vérifiée : le client ne recevra pas forcément cette boîte" };
  }
  if (info.kind === "source") return { level: "fail", text: "photo du site d'origine affichée telle quelle" };
  return null;
}

/* ------------------------------------------------------------------ */
/* Textes de la boutique                                                */
/* ------------------------------------------------------------------ */

type Text = { where: string; text: string; product?: string };

function blockTexts(blocks: PageBlock[] | undefined): string[] {
  const out: string[] = [];
  for (const block of blocks ?? []) {
    if (block.type === "heading" || block.type === "paragraph") out.push(block.text);
    else if (block.type === "list") out.push(...block.items);
    else if (block.type === "table") out.push(...block.header, ...block.rows.flat());
  }
  return out;
}

/** Tous les textes visibles de la boutique hors politiques, avec leur emplacement. */
export function siteTexts(site: EcomSite, options: { products?: boolean } = {}): Text[] {
  const texts: Text[] = [];
  const push = (where: string, ...values: Array<string | undefined>) => {
    for (const value of values) if (value?.trim()) texts.push({ where, text: value });
  };
  push("Bandeau promo", site.promoBar);
  push("Accroche", site.tagline, site.heroTitle, site.heroSubtitle);
  push("Promesse", site.promise);
  for (const pillar of site.pillars) push("Piliers", pillar.title, pillar.body);
  for (const title of site.sectionTitles ?? []) push("Titres de section", title);
  for (const section of site.sections ?? []) {
    push("Sections", section.title, section.body);
    for (const item of section.items ?? []) push("Réassurance", item.title, item.body);
  }
  for (const category of site.categories) push("Catégories", category.label, category.blurb);
  if (site.aboutStory) {
    push("Page About", site.aboutStory.heading, ...site.aboutStory.paragraphs);
    for (const point of site.aboutStory.points) push("Page About", point.title, point.body);
  }
  for (const page of site.pages ?? []) push(`Page ${page.title}`, page.title, ...blockTexts(page.blocks));
  for (const link of site.nav ?? []) push("Menu", link.label);
  for (const column of site.footer?.columns ?? []) push("Pied de page", column.title, column.body, ...column.links.map((link) => link.label));
  for (const edited of Object.values(site.textEdits ?? {})) push("Textes corrigés", edited);
  if (options.products !== false) {
    for (const product of site.products) {
      const where = `Fiche ${product.name}`;
      const values = [product.subtitle, product.description, ...product.bullets, product.usage, product.badge, ...blockTexts(product.descriptionBlocks)];
      for (const value of values) if (value?.trim()) texts.push({ where, text: value, product: product.handle });
    }
  }
  return texts;
}

/** Les anciens noms de produits encore présents quelque part. */
export function staleNameHits(site: EcomSite) {
  const hits: Array<{ name: string; current: string; where: string }> = [];
  const texts = siteTexts(site);
  for (const product of site.products) {
    for (const old of product.previousNames ?? []) {
      if (!old.trim() || site.products.some((other) => sameName(other.name, old))) continue;
      const pattern = new RegExp(`\\b${old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      for (const text of texts) {
        if (pattern.test(text.text)) hits.push({ name: old, current: product.name, where: text.where });
      }
    }
  }
  return hits;
}

/**
 * Les titres de section repris du site modèle qui sont des noms de produits.
 *
 * Le modèle titrait souvent une rangée de produits avec le nom de l'un d'eux ;
 * repris tel quel, on obtient une section « Cat scratching post tower » qui
 * présente un griffoir mural. Un titre qui n'est le nom d'aucun produit de la
 * boutique, ou celui d'un seul produit au-dessus de plusieurs, est trompeur.
 */
export function productLikeTitles(site: EcomSite) {
  const names = site.products.flatMap((product) => [product.name, ...(product.previousNames ?? [])]);
  /*
   * Seuls les titres affichés comptent : ceux d'une page d'accueil retouchée
   * (`sections`). Les titres relevés sur le modèle (`sectionTitles`) qui sont
   * des noms de produits sont déjà écartés au rendu (sectionsOf).
   */
  return (site.sections ?? [])
    .filter((section) => !section.hidden && section.block !== "text" && section.block !== "image")
    .map((section) => section.title ?? "")
    .filter((title) => title && names.some((name) => sameName(name, title)));
}

/* ------------------------------------------------------------------ */
/* Liens                                                                */
/* ------------------------------------------------------------------ */

/** Les liens internes qui ne mènent nulle part. */
export function brokenLinks(site: EcomSite) {
  const links: Array<{ label: string; href: string; where: string }> = [];
  for (const link of site.nav ?? []) links.push({ ...link, where: "Menu" });
  for (const column of site.footer?.columns ?? []) for (const link of column.links) links.push({ ...link, where: "Pied de page" });

  const pages = new Set([...RESERVED_SLUGS, ...POLICY_SLUGS, ...(site.pages ?? []).map((page) => page.slug)]);
  const broken: Array<{ label: string; href: string; where: string; moved?: string }> = [];
  for (const link of links) {
    const href = link.href.trim();
    if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) continue;
    const path = href.replace(/^\/s\/[^/]+/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (!path || path === "/") continue;
    const parts = path.replace(/^\//, "").split("/");
    if (parts[0] === "product") {
      const found = findProduct(site.products, parts[1] ?? "");
      if (!found) broken.push(link);
      else if (found.moved) broken.push({ ...link, moved: found.product.handle });
      continue;
    }
    if (parts.length > 1 || !pages.has(parts[0])) broken.push(link);
  }
  return broken;
}

/* ------------------------------------------------------------------ */
/* Promesses commerciales                                               */
/* ------------------------------------------------------------------ */

/**
 * Les promesses qui demandent un justificatif.
 *
 * `strong` : une affirmation qu'un analyste ou un client peut contester
 * (garantie, certification, approbation, superlatif). Les autres sont des
 * qualificatifs vagues : on les signale pour qu'on les remplace par un fait.
 */
export const CLAIMS: Array<{ key: string; re: RegExp; label: string; strong: boolean }> = [
  { key: "guarantee", re: /\bguarantee[sd]?\b|money[- ]back/i, label: "garantie", strong: true },
  { key: "satisfaction", re: /satisfaction (guaranteed|promise)/i, label: "satisfaction garantie", strong: true },
  { key: "warranty", re: /\bwarrant(y|ies)\b|lifetime/i, label: "garantie constructeur / à vie", strong: true },
  { key: "certified", re: /\bcertified\b|\bcertification\b|\bISO\s?\d{3,5}\b|\bCE[- ]marked\b/i, label: "certification", strong: true },
  { key: "approved", re: /\b(vet|veterinarian|doctor|dermatologist|fda)[- ](approved|recommended|tested)\b|\bapproved by\b/i, label: "approbation / recommandation", strong: true },
  { key: "clinical", re: /\bclinical(ly)?\b|\bproven\b|\bscientifically\b/i, label: "preuve clinique / scientifique", strong: true },
  { key: "superlative", re: /#\s?1\b|\bnumber one\b|\bbest[- ]selling\b|\bbest\b|\baward/i, label: "superlatif ou récompense", strong: true },
  { key: "made-in", re: /\bmade in (the )?(usa|us|america)\b/i, label: "fabriqué aux États-Unis", strong: true },
  { key: "fast-shipping", re: /\bfast (shipping|delivery)\b|\bships? (today|same day|in 24)/i, label: "expédition rapide", strong: false },
  { key: "free-returns", re: /\bfree returns?\b|\bprepaid (return )?label\b/i, label: "retours gratuits / étiquette prépayée", strong: true },
  { key: "safety", re: /\bnon[- ]toxic\b|\bsafe for\b|\bsafe\b|\bhypoallergenic\b|\bbpa[- ]free\b|\bfood[- ]grade\b/i, label: "innocuité / sécurité", strong: false },
  { key: "eco", re: /\beco[- ]friendly\b|\bsustainable\b|\borganic\b|\bbiodegradable\b|\ball[- ]natural\b/i, label: "écologique / naturel", strong: false },
  { key: "quality", re: /\bpremium\b|\btrust(ed|worthy)?\b|\bquality\b|\bdurable\b|\bcarefully (selected|chosen|select)\b/i, label: "qualité / confiance (vague)", strong: false },
];

export type ClaimHit = { key: string; label: string; strong: boolean; where: string; excerpt: string };

function excerpt(text: string, re: RegExp) {
  const match = re.exec(text);
  if (!match) return text.slice(0, 80);
  const start = Math.max(0, match.index - 30);
  return `${start ? "…" : ""}${text.slice(start, match.index + match[0].length + 40)}${match.index + match[0].length + 40 < text.length ? "…" : ""}`;
}

/**
 * Les promesses non justifiées.
 *
 * Une promesse de fiche produit est couverte quand la fiche est validée (on a
 * relu ses caractéristiques) ; une promesse de boutique l'est quand un
 * justificatif est saisi pour elle (`claimProofs`).
 */
export function unprovenClaims(site: EcomSite): ClaimHit[] {
  const hits: ClaimHit[] = [];
  const validated = new Set(site.products.filter((product) => reviewState(product) === "validated").map((product) => product.handle));
  for (const text of siteTexts(site)) {
    if (text.product && validated.has(text.product)) continue;
    for (const claim of CLAIMS) {
      if (site.claimProofs?.[claim.key]?.trim()) continue;
      if (claim.re.test(text.text)) hits.push({ key: claim.key, label: claim.label, strong: claim.strong, where: text.where, excerpt: excerpt(text.text, claim.re) });
    }
  }
  return hits;
}
