import { POLICY_LABELS, POLICY_SLUGS } from "@/lib/ecom-sites/policies";
import { editedText, fullAddress, type EcomSite } from "@/lib/ecom-sites/types";

/**
 * Le pied de page, déduit puis choisi.
 *
 * Tout y était calculé à partir des champs du site — les politiques, les trois
 * liens de boutique, les trois cartes de paiement. Un dossier de souscription
 * s'en contente ; une marque non : il lui faut un suivi de commande, une FAQ,
 * un Instagram, et pas AMEX si elle ne l'accepte pas. Ce module tient les deux
 * bouts — il donne la valeur déduite quand rien n'a été choisi, et s'efface dès
 * qu'on écrit par-dessus.
 */

export type FooterColumn = { title: string; body?: string; links: Array<{ label: string; href: string }> };

export const DEFAULT_PAYMENTS = ["VISA", "MASTERCARD", "AMEX"];

/**
 * Les adresses sont relatives à la boutique, pas absolues.
 *
 * Écrire `/s/sagerenew/shipping-policy` dans un lien enregistré casserait tous
 * les liens le jour où le site change de slug. On garde `/shipping-policy`, et
 * la racine se pose au rendu. Une adresse externe — http, mailto, tel — passe
 * telle quelle : c'est ainsi qu'on met un Instagram dans le pied de page.
 */
export function footerHref(root: string, href: string) {
  const value = (href || "").trim();
  if (!value) return "#";
  if (/^(https?:|mailto:|tel:|#|\/\/)/i.test(value)) return value;
  return `${root}${value.startsWith("/") ? "" : "/"}${value}`;
}

export function defaultFooterColumns(site?: Pick<EcomSite, "pages">): FooterColumn[] {
  return [
    {
      title: "Legal",
      links: POLICY_SLUGS.map((slug) => ({ label: POLICY_LABELS[slug], href: `/${slug}` })),
    },
    {
      title: "Store",
      links: [
        { label: "Shop", href: "/shop" },
        { label: "About", href: "/about" },
        // Les pages ajoutées, à côté des pages fixes.
        ...(site?.pages ?? []).filter((page) => page.inNav).map((page) => ({ label: page.title, href: `/${page.slug}` })),
        { label: "Contact", href: "/contact" },
      ],
    },
  ];
}

export function footerColumns(site: EcomSite): FooterColumn[] {
  /* Les intitulés déduits prennent les corrections faites dans l'aperçu. */
  return (
    site.footer?.columns ??
    defaultFooterColumns(site)
      .map((column) => ({
        ...column,
        title: editedText(site, column.title),
        links: column.links.map((link) => ({ ...link, label: editedText(site, link.label) })).filter((link) => link.label.trim()),
      }))
      .filter((column) => column.title.trim() || column.links.length)
  );
}

export function footerPayments(site: EcomSite): string[] {
  return site.footer?.payments ?? DEFAULT_PAYMENTS;
}

/**
 * La phrase d'identité, en texte simple.
 *
 * Le rendu la compose en gras par morceaux ; l'éditeur en a besoin en clair,
 * comme texte d'exemple, pour montrer ce qu'on remplacerait en écrivant.
 */
export function defaultLegalLine(site: EcomSite) {
  if (!site.legalName?.trim()) return "";
  const address = fullAddress(site).trim();
  return [
    `${site.domain || site.brandName} is owned and operated by ${site.legalName}`,
    site.stateOfIncorporation ? `, a ${site.stateOfIncorporation} limited liability company` : "",
    address ? ` headquartered at ${address}${site.country ? `, ${site.country}` : ""}` : "",
    ".",
  ].join("");
}

export function defaultCopyright(site: EcomSite, year: number) {
  return `© ${year} ${site.brandName}${site.legalName ? ` — a brand of ${site.legalName}` : ""}.`;
}

/** Une rangée pleine plutôt qu'une colonne esseulée en bout de ligne. */
export function footerCols(count: number) {
  if (count <= 1) return "lg:grid-cols-1";
  if (count === 2) return "lg:grid-cols-2";
  if (count % 4 === 0) return "lg:grid-cols-4";
  return "lg:grid-cols-3";
}
