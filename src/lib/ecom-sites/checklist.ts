/**
 * Contrôle pré-underwriting.
 *
 * Ne vérifie que ce qui est vérifiable depuis les données du site. Un point
 * « ok » signifie que l'élément est présent et cohérent — pas qu'il est vrai :
 * un underwriter appelle le numéro, écrit à l'adresse e-mail et compare la
 * raison sociale au dossier de la LLC.
 */

import { fullAddress, MAX_PRICE, type EcomSite } from "@/lib/ecom-sites/types";
import {
  brokenLinks,
  handleForName,
  imageIssue,
  missingFacts,
  productLikeTitles,
  reviewState,
  staleNameHits,
  unprovenClaims,
} from "@/lib/ecom-sites/product-facts";

export type CheckStatus = "ok" | "warn" | "fail";

export type CheckItem = {
  id: string;
  group:
    | "Identité légale"
    | "Support"
    | "Politiques"
    | "Catalogue"
    | "Fiches produit"
    | "Cohérence"
    | "Promesses"
    | "Paiement"
    | "Mise en ligne";
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
      ? check("images", "Catalogue", "Chaque produit a sa photo", "warn", `${noImage.length} sans visuel : ${noImage.map((p) => p.name).join(", ")}`)
      : check("images", "Catalogue", "Chaque produit a sa photo", products.length ? "ok" : "warn", products.length ? "Tous les produits ont une image" : "Aucun produit")
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

  /* ---------------- Modalités réelles ---------------- */

  /*
   * Les politiques et la réassurance décrivent un fonctionnement : délais,
   * retours, suivi, descripteur. Le générateur ne peut pas savoir s'il est
   * vrai. Tant que l'opérateur ne l'a pas confirmé, c'est bloquant.
   */
  const ops = site.operations ?? {};
  const opsMissing = [
    !ops.returnShipping || ops.returnShipping === "unset" ? "qui paie le retour" : "",
    !ops.fulfilment || ops.fulfilment === "unset" ? "d'où partent les colis" : "",
    ops.tracking === undefined || ops.tracking === null ? "suivi fourni ou non" : "",
  ].filter(Boolean);
  items.push(
    opsMissing.length
      ? check("operations", "Politiques", "Modalités réelles renseignées", "fail", `À préciser : ${opsMissing.join(", ")}. Les politiques restent neutres en attendant.`)
      : ops.confirmedAt
        ? check("operations", "Politiques", "Modalités réelles renseignées", "ok", `Confirmées le ${ops.confirmedAt.slice(0, 10)}${ops.confirmedBy ? ` par ${ops.confirmedBy}` : ""}`)
        : check("operations", "Politiques", "Modalités réelles renseignées", "fail", "Renseignées mais pas confirmées : coche « délais, retours et facturation conformes à la réalité ».")
  );

  /* ---------------- Fiches produit ---------------- */

  const unvalidated = products.filter((product) => reviewState(product) !== "validated");
  const changed = unvalidated.filter((product) => reviewState(product) === "changed");
  items.push(
    unvalidated.length
      ? check(
          "facts-review",
          "Fiches produit",
          "Fiches produit validées",
          "fail",
          `${unvalidated.length}/${products.length} à valider${changed.length ? ` (dont ${changed.length} modifiée(s) depuis leur validation)` : ""} : ${unvalidated.map((p) => p.name).slice(0, 6).join(", ")}${unvalidated.length > 6 ? "…" : ""}`
        )
      : check("facts-review", "Fiches produit", "Fiches produit validées", products.length ? "ok" : "warn", products.length ? "Chaque fiche a été relue et validée" : "Aucun produit")
  );

  const withMissing = products
    .map((product) => ({ product, missing: missingFacts(product) }))
    .filter((entry) => entry.missing.length);
  items.push(
    withMissing.length
      ? check(
          "facts-missing",
          "Fiches produit",
          "Données produit complètes",
          withMissing.some((entry) => entry.missing.some((m) => m.field === "image" || m.field === "specs")) ? "fail" : "warn",
          withMissing
            .slice(0, 5)
            .map((entry) => `${entry.product.name} : ${entry.missing.map((m) => m.label).join(", ")}`)
            .join(" · ") + (withMissing.length > 5 ? ` · +${withMissing.length - 5}` : "")
        )
      : check("facts-missing", "Fiches produit", "Données produit complètes", products.length ? "ok" : "warn", "Référence, colis, caractéristiques et source renseignés")
  );

  const written = products.filter((product) => product.aiFields?.length && reviewState(product) !== "validated");
  if (written.length) {
    items.push(
      check(
        "facts-ai",
        "Fiches produit",
        "Textes rédigés par l'IA à relire",
        "warn",
        `${written.length} fiche(s) contiennent des textes rédigés et non repris de la source (${[...new Set(written.flatMap((p) => p.aiFields ?? []))].join(", ")}).`
      )
    );
  }

  const imageProblems = products.map((product) => ({ product, issue: imageIssue(product) })).filter((entry) => entry.issue);
  items.push(
    imageProblems.length
      ? check(
          "image-match",
          "Fiches produit",
          "Photos fidèles au produit",
          imageProblems.some((entry) => entry.issue?.level === "fail") ? "fail" : "warn",
          imageProblems
            .slice(0, 5)
            .map((entry) => `${entry.product.name} : ${entry.issue?.text}`)
            .join(" · ") + (imageProblems.length > 5 ? ` · +${imageProblems.length - 5}` : "")
        )
      : check("image-match", "Fiches produit", "Photos fidèles au produit", products.length ? "ok" : "warn", "Chaque photo a été faite pour son produit, sans emballage inventé")
  );

  /* ---------------- Cohérence ---------------- */

  const stale = staleNameHits(site);
  const titled = productLikeTitles(site);
  items.push(
    stale.length || titled.length
      ? check(
          "stale-names",
          "Cohérence",
          "Plus d'ancien nom ni de titre trompeur",
          "fail",
          [
            ...stale.slice(0, 4).map((hit) => `« ${hit.name} » (devenu « ${hit.current} ») dans ${hit.where}`),
            ...titled.slice(0, 3).map((title) => `section titrée avec un nom de produit : « ${title} »`),
          ].join(" · ")
        )
      : check("stale-names", "Cohérence", "Plus d'ancien nom ni de titre trompeur", "ok", "Titres et textes correspondent aux produits vendus")
  );

  const misaligned = products.filter((product) => !product.handle.startsWith(handleForName(product.name)));
  items.push(
    misaligned.length
      ? check(
          "handles",
          "Cohérence",
          "Adresses produit alignées sur les noms",
          "warn",
          misaligned.slice(0, 4).map((p) => `/product/${p.handle} pour « ${p.name} »`).join(" · ") + " — « Aligner l'URL » garde l'ancienne en redirection."
        )
      : check("handles", "Cohérence", "Adresses produit alignées sur les noms", products.length ? "ok" : "warn", "Chaque URL reprend le nom du produit")
  );

  const broken = brokenLinks(site);
  items.push(
    broken.length
      ? check(
          "links",
          "Cohérence",
          "Liens internes valides",
          broken.some((link) => !link.moved) ? "fail" : "warn",
          broken.slice(0, 5).map((link) => (link.moved ? `${link.where} : ${link.href} redirige vers /product/${link.moved}` : `${link.where} : ${link.label} → ${link.href} introuvable`)).join(" · ")
        )
      : check("links", "Cohérence", "Liens internes valides", "ok", "Menu et pied de page mènent à des pages existantes")
  );

  /* ---------------- Promesses ---------------- */

  const claims = unprovenClaims(site);
  const strong = claims.filter((claim) => claim.strong);
  const soft = claims.filter((claim) => !claim.strong);
  const describe = (list: typeof claims) =>
    [...new Map(list.map((claim) => [`${claim.key}|${claim.where}`, claim])).values()]
      .slice(0, 5)
      .map((claim) => `${claim.label} — ${claim.where} : « ${claim.excerpt} »`)
      .join(" · ");
  items.push(
    strong.length
      ? check("claims", "Promesses", "Promesses justifiées", "fail", describe(strong))
      : check("claims", "Promesses", "Promesses justifiées", "ok", "Aucune garantie, certification ou superlatif sans justificatif")
  );
  if (soft.length) {
    items.push(check("claims-soft", "Promesses", "Qualificatifs vagues à remplacer par des faits", "warn", describe(soft)));
  }

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

/** Les points qui empêchent la publication tant qu'ils ne sont ni résolus ni acceptés. */
export function blockingItems(items: CheckItem[]) {
  return items.filter((item) => item.status === "fail");
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
