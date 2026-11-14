import type React from "react";
import { editedText, money, type EcomSection, type EcomSite } from "@/lib/ecom-sites/types";

/**
 * La mise en page d'une boutique, en un seul endroit.
 *
 * L'ordre venait du site copié et vivait dans un tableau de noms de blocs.
 * Pour retravailler une page, il faut plus que l'ordre : un titre, un cadrage,
 * un espacement, la possibilité de masquer ou d'insérer. Ce module fait le
 * pont — il dérive des sections modifiables d'un site qui n'en a pas encore,
 * et donne au rendu les classes correspondantes.
 */

/** Les blocs nourris par le site, dans l'ordre où ils tombent par défaut. */
export const SITE_BLOCKS = [
  "pillars",
  "categories",
  "lifestyle",
  "products",
  "about",
  "reviews",
  "assurances",
] as const;

/** Ce qu'on affiche à côté de chaque bloc dans l'éditeur. */
export const BLOCK_LABELS: Record<EcomSection["block"], string> = {
  pillars: "Promesse & piliers",
  categories: "Catégories en images",
  lifestyle: "Bande d'ambiance",
  products: "Produits mis en avant",
  about: "Histoire de marque",
  reviews: "Avis clients",
  assurances: "Réassurance",
  text: "Texte libre",
  image: "Image libre",
};

export function newSectionId() {
  return `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Les sections d'un site, dérivées si besoin.
 *
 * Un site copié avant cette fonctionnalité n'a qu'un `layout`. Plutôt que de
 * migrer les données stockées — ce qui obligerait à réécrire chaque site pour
 * une fonctionnalité qu'on n'a peut-être pas envie d'utiliser — on dérive à la
 * lecture. La première retouche enregistre le résultat.
 */
export function sectionsOf(site: EcomSite): EcomSection[] {
  if (site.sections?.length) return withLateBlocks(site.sections);

  const fromModel = (site.layout ?? []).filter((block): block is (typeof SITE_BLOCKS)[number] =>
    (SITE_BLOCKS as readonly string[]).includes(block)
  );
  const order = [...fromModel, ...SITE_BLOCKS.filter((block) => !fromModel.includes(block))];

  /* Les titres relevés sur le modèle se distribuent dans l'ordre de la page. */
  /*
   * Sauf ceux qui sont des noms de produits : le modèle titrait une rangée de
   * produits avec le nom de l'un d'eux, et la copie affichait « Cat scratching
   * post tower » au-dessus d'un griffoir mural. Le bloc garde alors son titre
   * générique.
   */
  const names = site.products.flatMap((product) => [product.name, ...(product.previousNames ?? [])]);
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const titles = (site.sectionTitles ?? []).filter((title) => !names.some((name) => clean(name) === clean(title)));

  return order.map((block) => ({
    id: `${block}-0`,
    block,
    align: "left" as const,
    space: "normal" as const,
    // Seuls les blocs à titre en consomment un.
    title: block === "pillars" || block === "categories" || block === "products" ? titles.shift() || "" : "",
  }));
}

/**
 * Les blocs du site apparus après coup, ajoutés aux pages déjà retouchées.
 *
 * Une page enregistrée porte la liste des blocs qui existaient le jour où on
 * l'a réglée. Ajouter un bloc au site ne doit pas obliger à rouvrir chaque
 * boutique pour l'y remettre : on complète à la lecture, en fin de page, là où
 * ce bloc se rendait avant d'être réglable. Un bloc dont on ne veut pas se
 * masque — il reste alors dans la liste, et n'est pas re-ajouté.
 */
function withLateBlocks(sections: EcomSection[]): EcomSection[] {
  const missing = SITE_BLOCKS.filter((block) => !sections.some((section) => section.block === block));
  if (!missing.length) return sections;
  return [
    ...sections,
    ...missing.map((block) => ({ id: `${block}-0`, block, align: "left" as const, space: "normal" as const, title: "" })),
  ];
}

/**
 * Les cartes d'un bloc de réassurance.
 *
 * Tant qu'on n'y a pas touché, elles se déduisent des réglages de la boutique :
 * le seuil de port offert, la fenêtre de retour, les horaires du support. C'est
 * ce que la page affichait quand ce bandeau était écrit en dur, et un site
 * existant ne change donc pas d'aspect. Dès la première retouche, la liste
 * enregistrée fait foi — y compris vide.
 */
export function assuranceItems(site: EcomSite, section: EcomSection) {
  return section.items ?? defaultAssurances(site);
}

export function defaultAssurances(site: EcomSite): Array<{ title: string; body: string }> {
  return rawAssurances(site)
    .map((item) => ({ title: editedText(site, item.title), body: editedText(site, item.body) }))
    .filter((item) => item.title.trim() || item.body.trim());
}

/**
 * Les cartes de réassurance, écrites à partir du fonctionnement réel.
 *
 * Elles promettaient « Tracked end to end » et « We send a prepaid label »
 * quel que soit le fonctionnement de la boutique. Elles ne disent désormais
 * que ce que les réglages confirment : le suivi seulement s'il est fourni,
 * l'étiquette prépayée seulement si c'est la boutique qui paie le retour.
 */
function rawAssurances(site: EcomSite): Array<{ title: string; body: string }> {
  const ops = site.operations ?? {};
  const tracking = ops.tracking === true ? " Every order ships with tracking." : "";
  const returns =
    ops.returnShipping === "prepaid-label"
      ? "Email us with your order number and we send a prepaid return label."
      : ops.returnShipping === "customer-paid"
        ? "Email us with your order number for return instructions. Return shipping is paid by the customer unless the item is faulty or not as described."
        : "Email us with your order number to start a return. Full terms in the Refund Policy.";
  const channels = site.supportPhone.trim() ? "email and phone" : "email";
  return [
    site.freeShippingThreshold > 0
      ? {
          title: "Free US shipping",
          body: `On orders over ${money(site.freeShippingThreshold, site.currency)}. Delivery in ${site.deliveryMinDays}–${site.deliveryMaxDays} business days.${tracking}`,
        }
      : { title: "US shipping", body: `Delivery in ${site.deliveryMinDays}–${site.deliveryMaxDays} business days.${tracking}` },
    { title: `${site.returnWindowDays}-day returns`, body: returns },
    { title: "Customer support", body: `${site.supportHours || "Weekdays"} by ${channels}.` },
  ];
}

/**
 * Les piliers de la page d'accueil, quand la boutique n'en a pas écrit.
 *
 * Des faits tirés des réglages (d'où partent les colis, en combien de temps,
 * comment on retourne, quand le support répond) plutôt que « Trusted
 * materials » ou « Premium quality », qu'on ne peut pas justifier.
 */
export function factPillars(site: EcomSite): Array<{ title: string; body: string }> {
  const handling = Math.max(1, site.handlingTimeDays || 1);
  return [
    {
      title: `Ships from ${site.shipsFrom || "the United States"}`,
      body: `Orders leave within ${handling} business day${handling > 1 ? "s" : ""} and arrive in ${site.deliveryMinDays}–${site.deliveryMaxDays} business days.`,
    },
    {
      title: `${site.returnWindowDays}-day returns`,
      body: `Write to ${site.supportEmail || "our support team"} with your order number to start a return. Full terms in the Refund Policy.`,
    },
    {
      title: "Plain product pages",
      body: "Each page lists the product's specifications and what comes in the box. Ask us before you order if something is missing.",
    },
  ];
}

/** Les piliers affichés : ceux de la boutique, sinon les faits tirés des réglages. */
export function pillarsOf(site: EcomSite) {
  return site.pillars.length ? site.pillars : factPillars(site);
}

/** L'espacement vertical d'une section, du plus serré au plus aéré. */
export function spaceClass(space: EcomSection["space"]) {
  if (space === "tight") return "py-8 md:py-10";
  if (space === "airy") return "py-20 md:py-28";
  return "py-14 md:py-20";
}

/** La valeur par défaut d'un réglage nommé, quand on passe aux pixels. */
export function defaultPad(space: EcomSection["space"]) {
  if (space === "tight") return 40;
  if (space === "airy") return 112;
  return 72;
}

/**
 * Le style d'une section : marges en pixels, et fond.
 *
 * Les marges posées à la main l'emportent sur le réglage nommé ; sans elles,
 * ce sont les classes qui s'appliquent, et rien ne change pour les sites déjà
 * en ligne.
 */
export function sectionStyle(section: EcomSection): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (typeof section.padTop === "number") style.paddingTop = section.padTop;
  if (typeof section.padBottom === "number") style.paddingBottom = section.padBottom;
  if (section.background === "sand") style.background = "var(--sand)";
  if (section.background === "wash") style.background = "var(--wash)";
  return style;
}

/** Les marges sont-elles pilotées à la main ? */
export function hasCustomPad(section: EcomSection) {
  return typeof section.padTop === "number" || typeof section.padBottom === "number";
}

/** Le cadrage du texte d'une section. */
export function alignClass(align: EcomSection["align"]) {
  return align === "center" ? "text-center [&>*]:mx-auto" : "";
}
