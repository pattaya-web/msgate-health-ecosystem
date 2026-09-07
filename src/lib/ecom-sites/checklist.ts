/**
 * Contrôle pré-underwriting.
 *
 * Ne vérifie que ce qui est vérifiable depuis les données du site. Un point
 * « ok » signifie que l'élément est présent et cohérent — pas qu'il est vrai :
 * un underwriter appelle le numéro, écrit à l'adresse e-mail et compare la
 * raison sociale au dossier de la LLC.
 */

import { fullAddress, MAX_PRICE, type EcomSite } from "@/lib/ecom-sites/types";

export type CheckStatus = "ok" | "warn" | "fail";

export type CheckItem = {
  id: string;
  group: "Identité légale" | "Support" | "Politiques" | "Catalogue" | "Paiement" | "Mise en ligne";
  label: string;
  status: CheckStatus;
  detail: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE_MAILBOX = /@(gmail|yahoo|hotmail|outlook|icloud|proton(mail)?|aol)\./i;
/** +1 puis 10 chiffres, la forme qu'un underwriter US compose sans réfléchir. */
const US_PHONE = /^\+1\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;

function check(
  id: string,
  group: CheckItem["group"],
  label: string,
  status: CheckStatus,
  detail: string
): CheckItem {
  return { id, group, label, status, detail };
}

export function evaluateSite(site: EcomSite): CheckItem[] {
  const items: CheckItem[] = [];

  /* ---------------- Identité légale ---------------- */

  items.push(
    site.legalName.trim()
      ? check("legal-name", "Identité légale", "Raison sociale de la LLC dans le footer", "ok", site.legalName)
      : check("legal-name", "Identité légale", "Raison sociale de la LLC dans le footer", "fail", "Champ vide — c'est le premier élément que le processeur recoupe avec le dossier.")
  );

  const addressComplete = Boolean(site.addressLine && site.city && site.region && site.postalCode);
  items.push(
    addressComplete
      ? check("address", "Identité légale", "Adresse enregistrée complète", "ok", `${fullAddress(site)}, ${site.country}`)
      : check("address", "Identité légale", "Adresse enregistrée complète", "fail", "Rue, ville, état et code postal sont tous requis dans le footer.")
  );

  items.push(
    site.stateOfIncorporation.trim()
      ? check("state", "Identité légale", "État d'immatriculation", "ok", `${site.stateOfIncorporation} LLC`)
      : check("state", "Identité légale", "État d'immatriculation", "warn", "Utilisé dans le Legal Notice et la loi applicable des CGV.")
  );

  items.push(
    site.domain.trim()
      ? check("domain", "Identité légale", "Domaine renseigné", "ok", site.domain)
      : check("domain", "Identité légale", "Domaine renseigné", "fail", "Le footer et les politiques citent le domaine — il doit être fixé avant l'envoi.")
  );

  /* ---------------- Support ---------------- */

  const email = site.supportEmail.trim();
  if (!email) {
    items.push(check("email", "Support", "E-mail de support dans le footer", "fail", "Obligatoire, et il doit recevoir réellement."));
  } else if (!EMAIL.test(email)) {
    items.push(check("email", "Support", "E-mail de support dans le footer", "fail", `Format invalide : ${email}`));
  } else if (FREE_MAILBOX.test(email)) {
    items.push(check("email", "Support", "E-mail de support dans le footer", "warn", "Boîte gratuite — un e-mail sur le domaine de la marque passe nettement mieux en underwriting."));
  } else {
    const onBrand = site.domain && email.toLowerCase().endsWith(`@${site.domain.toLowerCase().replace(/^www\./, "")}`);
    items.push(
      check("email", "Support", "E-mail de support dans le footer", "ok", onBrand ? `${email} — sur le domaine` : `${email}`)
    );
  }

  const phone = site.supportPhone.trim();
  if (!phone) {
    items.push(check("phone", "Support", "Numéro de support US joignable", "fail", "Obligatoire. Le processeur appelle ce numéro pendant l'instruction."));
  } else if (!US_PHONE.test(phone)) {
    items.push(check("phone", "Support", "Numéro de support US joignable", "warn", `Format inhabituel : ${phone}. Attendu : +1 (941) 396-6088.`));
  } else {
    items.push(check("phone", "Support", "Numéro de support US joignable", "ok", phone));
  }

  items.push(
    site.supportHours.trim()
      ? check("hours", "Support", "Horaires de support affichés", "ok", site.supportHours)
      : check("hours", "Support", "Horaires de support affichés", "warn", "Des horaires affichés évitent que « personne ne répond » soit interprété comme une ligne morte.")
  );

  /* ---------------- Paiement ---------------- */

  const descriptor = site.billingDescriptor.trim();
  if (!descriptor) {
    items.push(check("descriptor", "Paiement", "Descripteur de facturation publié", "fail", "Le descriptor affiché sur le site fait chuter les chargebacks « transaction non reconnue »."));
  } else if (descriptor.length > 25) {
    items.push(check("descriptor", "Paiement", "Descripteur de facturation publié", "warn", `${descriptor.length} caractères — les réseaux tronquent au-delà de 25.`));
  } else {
    items.push(check("descriptor", "Paiement", "Descripteur de facturation publié", "ok", `"${descriptor}"`));
  }

  /* ---------------- Politiques ---------------- */

  const deliveryOk = site.deliveryMinDays > 0 && site.deliveryMaxDays >= site.deliveryMinDays;
  items.push(
    deliveryOk
      ? check(
          "delivery",
          "Politiques",
          "Délai de livraison affiché",
          site.deliveryMaxDays > 10 ? "warn" : "ok",
          site.deliveryMaxDays > 10
            ? `${site.deliveryMinDays}–${site.deliveryMaxDays} jours ouvrés — au-delà de 10 jours, le dossier est lu comme du dropshipping longue distance.`
            : `${site.deliveryMinDays}–${site.deliveryMaxDays} jours ouvrés après expédition`
        )
      : check("delivery", "Politiques", "Délai de livraison affiché", "fail", "Renseigne une fourchette cohérente dans la Shipping Policy.")
  );

  items.push(
    site.returnWindowDays >= 30
      ? check("returns", "Politiques", "Fenêtre de retour ≥ 30 jours", "ok", `${site.returnWindowDays} jours`)
      : check("returns", "Politiques", "Fenêtre de retour ≥ 30 jours", "warn", `${site.returnWindowDays} jours — en dessous de 30, beaucoup d'acquéreurs tiquent.`)
  );

  items.push(
    site.shipsFrom.trim()
      ? check("ships-from", "Politiques", "Lieu d'expédition indiqué", "ok", site.shipsFrom)
      : check("ships-from", "Politiques", "Lieu d'expédition indiqué", "warn", "La Shipping Policy doit dire d'où partent les colis.")
  );

  const policiesReady = Boolean(site.legalName && addressComplete && email && phone && descriptor);
  items.push(
    policiesReady
      ? check("policies", "Politiques", "5 politiques générées et liées au footer", "ok", "Shipping · Refund · Terms · Privacy · Legal Notice")
      : check("policies", "Politiques", "5 politiques générées et liées au footer", "fail", "Les politiques citent la LLC, l'adresse, l'e-mail, le téléphone et le descriptor — complète-les d'abord.")
  );

  /* ---------------- Catalogue ---------------- */

  const products = site.products;
  items.push(
    products.length >= 4
      ? check("catalog-size", "Catalogue", "Au moins 4 produits en ligne", "ok", `${products.length} produits`)
      : check("catalog-size", "Catalogue", "Au moins 4 produits en ligne", products.length ? "warn" : "fail", `${products.length} produit(s) — un catalogue trop mince ressemble à une vitrine montée pour l'occasion.`)
  );

  const overpriced = products.filter((product) => product.price > MAX_PRICE);
  items.push(
    overpriced.length
      ? check("prices", "Catalogue", `Prix dans les paliers (≤ ${MAX_PRICE})`, "warn", `${overpriced.length} produit(s) au-dessus : ${overpriced.map((p) => p.name).join(", ")}`)
      : check("prices", "Catalogue", `Prix dans les paliers (≤ ${MAX_PRICE})`, "ok", products.length ? "Tous les prix sont dans la grille" : "Aucun produit")
  );

  const noImage = products.filter((product) => !product.imageUrl);
  items.push(
    noImage.length
      ? check("images", "Catalogue", "Chaque produit a son packaging", "warn", `${noImage.length} sans visuel : ${noImage.map((p) => p.name).join(", ")}`)
      : check("images", "Catalogue", "Chaque produit a son packaging", products.length ? "ok" : "warn", products.length ? "Tous les produits ont une image" : "Aucun produit")
  );

  const thin = products.filter((product) => product.description.trim().length < 120);
  items.push(
    thin.length
      ? check("copy", "Catalogue", "Descriptions produit étoffées", "warn", `${thin.length} description(s) sous 120 caractères — trop court est lu comme une page générée.`)
      : check("copy", "Catalogue", "Descriptions produit étoffées", products.length ? "ok" : "warn", products.length ? "Toutes les fiches sont remplies" : "Aucun produit")
  );

  // Un underwriter ajoute un article au panier et va jusqu'au récapitulatif.
  items.push(
    products.length
      ? check("funnel", "Catalogue", "Tunnel d'achat démontrable", "ok", "Panier et page checkout accessibles depuis chaque fiche produit")
      : check("funnel", "Catalogue", "Tunnel d'achat démontrable", "fail", "Sans produit, le panier est vide et le tunnel n'est pas testable.")
  );

  items.push(
    site.categories.length >= 2
      ? check("categories", "Catalogue", "Catalogue structuré en catégories", "ok", site.categories.map((c) => c.label).join(" · "))
      : check("categories", "Catalogue", "Catalogue structuré en catégories", "warn", "Deux catégories minimum pour que /shop ne soit pas une liste plate.")
  );

  /* ---------------- Mise en ligne ---------------- */

  items.push(
    site.logoDataUrl
      ? check("logo", "Mise en ligne", "Logo chargé", "ok", "Repris dans le header, le footer et les packagings générés")
      : check("logo", "Mise en ligne", "Logo chargé", "warn", "Sans logo, le header affiche le nom en texte.")
  );

  items.push(
    site.testimonials.length
      ? check("reviews", "Mise en ligne", "Avis clients", "ok", `${site.testimonials.length} avis saisis`)
      : check("reviews", "Mise en ligne", "Avis clients", "warn", "Aucun avis affiché. N'en publie que des réels — un faux avis est une pratique trompeuse et se repère.")
  );

  return items;
}

export function checklistScore(items: CheckItem[]) {
  const fails = items.filter((item) => item.status === "fail").length;
  const warns = items.filter((item) => item.status === "warn").length;
  return {
    total: items.length,
    ok: items.filter((item) => item.status === "ok").length,
    warns,
    fails,
    /** Prêt à envoyer au processeur quand plus rien ne bloque. */
    ready: fails === 0,
  };
}
