/**
 * Politiques générées à partir de l'entité déclarée.
 *
 * Tout ce qui est vérifiable par un underwriter — raison sociale, adresse,
 * téléphone, e-mail, délais, fenêtre de retour, descripteur de facturation —
 * vient des champs du site et n'est jamais inventé ici : une politique qui
 * contredit le dossier de la LLC est le motif de refus le plus courant.
 */

import { fullAddress, money, type EcomSite } from "@/lib/ecom-sites/types";

export const POLICY_SLUGS = [
  "shipping-policy",
  "refund-policy",
  "terms",
  "privacy-policy",
  "legal-notice",
] as const;

export type PolicySlug = (typeof POLICY_SLUGS)[number];

export const POLICY_LABELS: Record<PolicySlug, string> = {
  "shipping-policy": "Shipping Policy",
  "refund-policy": "Refund Policy",
  terms: "Terms & Conditions",
  "privacy-policy": "Privacy Policy",
  "legal-notice": "Legal Notice",
};

export type PolicySection = { heading: string; body: string[] };
export type PolicyDoc = { slug: PolicySlug; title: string; updated: string; sections: PolicySection[] };

function updatedOn(site: EcomSite) {
  return new Date(site.updatedAt || Date.now()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Bloc d'identité répété au bas de chaque politique — ce que le processeur recoupe. */
function identity(site: EcomSite) {
  return [
    `${site.domain || site.brandName} is owned and operated by ${site.legalName}, a ${site.stateOfIncorporation} limited liability company.`,
    `Registered address: ${fullAddress(site)}, ${site.country}.`,
    `Email: ${site.supportEmail} · Phone: ${site.supportPhone} · Support hours: ${site.supportHours}.`,
  ];
}

function shipping(site: EcomSite): PolicySection[] {
  const handling = site.handlingTimeDays === 1 ? "1 business day" : `${site.handlingTimeDays} business days`;
  return [
    {
      heading: "Processing time",
      body: [
        `Orders are picked and packed within ${handling} of payment clearing. Orders placed after 2 PM EST, on weekends or on US public holidays begin processing the next business day.`,
        `You receive a confirmation email as soon as the order is placed, and a second email with tracking as soon as the parcel leaves our fulfilment centre.`,
      ],
    },
    {
      heading: "Delivery time",
      body: [
        `Standard delivery within the United States takes ${site.deliveryMinDays} to ${site.deliveryMaxDays} business days from dispatch.`,
        `Delivery times are estimates given in business days and exclude weekends and public holidays. Carrier delays, severe weather and incorrect or incomplete addresses can extend them.`,
      ],
    },
    {
      heading: "Shipping rates",
      body: [
        site.freeShippingThreshold > 0
          ? `Standard shipping is free on orders over ${money(site.freeShippingThreshold, site.currency)}. Below that threshold, a flat shipping fee is calculated and shown at checkout before payment.`
          : `Shipping is calculated and shown at checkout before payment.`,
        `All duties and taxes, where applicable, are displayed at checkout. We do not add charges after an order is placed.`,
      ],
    },
    {
      heading: "Where we ship from",
      body: [
        `Orders are picked, packed and dispatched from our fulfilment centre in ${site.shipsFrom}. Every parcel ships domestically with a US carrier and a tracking number.`,
        `We currently ship to addresses within the United States. We do not deliver to PO boxes or freight-forwarding addresses.`,
      ],
    },
    {
      heading: "Lost, delayed or damaged parcels",
      body: [
        `If tracking has not moved for five business days, or your parcel arrives damaged, contact ${site.supportEmail} or call ${site.supportPhone} within 30 days of dispatch. We open a carrier claim and reship or refund the order — you are not asked to wait for the claim to close.`,
      ],
    },
    { heading: "Who we are", body: identity(site) },
  ];
}

function refund(site: EcomSite): PolicySection[] {
  return [
    {
      heading: `${site.returnWindowDays}-day returns`,
      body: [
        `You may return any item within ${site.returnWindowDays} days of delivery for a full refund of the purchase price. Items should be returned in resalable condition, and opened products are accepted where the item did not suit you — tell us what went wrong and we will make it right.`,
        `To start a return, email ${site.supportEmail} or call ${site.supportPhone} with your order number. We reply with a prepaid return label and instructions. Do not ship anything back before you receive the label.`,
      ],
    },
    {
      heading: "Refunds",
      body: [
        `Refunds are issued to the original payment method within 5 to 10 business days of us receiving the return. Your bank may take an additional statement cycle to display the credit.`,
        `Refunds are issued in full, including any shipping paid on the original order when the return is due to our error, a damaged item or an item that does not match its description.`,
      ],
    },
    {
      heading: "Cancellations",
      body: [
        `An order can be cancelled free of charge at any point before it is dispatched. Email ${site.supportEmail} or call ${site.supportPhone} and we will stop the order if it has not yet left the warehouse. Once dispatched, treat it as a return.`,
      ],
    },
    {
      heading: "Before you dispute a charge",
      body: [
        `Charges from this store appear on your statement as "${site.billingDescriptor}". If you do not recognise a charge, contact us first — we answer during ${site.supportHours} and can identify, cancel or refund an order faster than a bank dispute, which typically takes 45 to 90 days to resolve.`,
      ],
    },
    { heading: "Who we are", body: identity(site) },
  ];
}

function terms(site: EcomSite): PolicySection[] {
  return [
    {
      heading: "Agreement",
      body: [
        `These Terms & Conditions govern your use of ${site.domain} and any purchase you make through it. By placing an order you accept these terms. If you do not accept them, please do not use the site.`,
      ],
    },
    {
      heading: "Orders and pricing",
      body: [
        `All prices are shown in ${site.currency} and include the item price. Shipping and any applicable tax are calculated and displayed at checkout before you confirm payment. No charge is taken until you confirm the order.`,
        `We may decline or cancel an order where an item is out of stock, a price or description contains an obvious error, or where payment cannot be verified. If we cancel a paid order, it is refunded in full.`,
      ],
    },
    {
      heading: "Payment",
      body: [
        `Payment is taken at the time the order is placed. Your statement will show the billing descriptor "${site.billingDescriptor}".`,
        `We do not store full card numbers. Payment details are handled by our payment processor over an encrypted connection.`,
      ],
    },
    {
      heading: "Returns",
      body: [
        `Our ${site.returnWindowDays}-day return terms are set out in full in the Refund Policy, which forms part of these terms.`,
      ],
    },
    {
      heading: "Product information",
      body: [
        site.productDisclaimer ||
          `Product descriptions, images and ingredient lists are provided for information. We work to keep them accurate and current, and correct any error as soon as we are made aware of it.`,
      ],
    },
    {
      heading: "Limitation of liability",
      body: [
        `To the extent permitted by law, our liability in connection with any order is limited to the amount you paid for that order. Nothing in these terms limits liability that cannot be limited by law.`,
      ],
    },
    {
      heading: "Governing law",
      body: [
        `These terms are governed by the laws of the State of ${site.stateOfIncorporation}, United States, without regard to its conflict of law provisions.`,
      ],
    },
    { heading: "Contact", body: identity(site) },
  ];
}

function privacy(site: EcomSite): PolicySection[] {
  return [
    {
      heading: "What we collect",
      body: [
        `When you place an order we collect the name, shipping address, billing address, email address and phone number you provide, along with the contents and value of your order.`,
        `Payment card details are entered directly with our payment processor. We receive only a confirmation of payment and the last four digits of the card — never the full number.`,
        `We collect basic technical data — IP address, browser type, pages viewed — to keep the site working and to detect fraudulent orders.`,
      ],
    },
    {
      heading: "Why we use it",
      body: [
        `To take, fulfil, deliver and support your order; to answer your questions; to process returns and refunds; to prevent fraud and card testing; and to meet our tax and accounting obligations.`,
        `We send marketing email only if you opt in. Every marketing email carries an unsubscribe link that works immediately.`,
      ],
    },
    {
      heading: "Who we share it with",
      body: [
        `We share the minimum necessary with our payment processor, our fulfilment and shipping carriers, and our email and analytics providers. Each is bound to use the data only to provide their service to us.`,
        `We do not sell personal information, and we do not share it for cross-context behavioural advertising.`,
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        `Order records are kept for as long as tax and accounting law requires, typically seven years. Marketing contact details are kept until you unsubscribe.`,
      ],
    },
    {
      heading: "Your rights",
      body: [
        `You can ask us for a copy of the personal data we hold about you, ask us to correct it, or ask us to delete it. Email ${site.supportEmail} and we will respond within 30 days.`,
        `Residents of California, Colorado, Connecticut, Utah and Virginia have specific rights of access, deletion and opt-out under their state privacy laws. We apply the same process to every request, wherever you live.`,
      ],
    },
    {
      heading: "Cookies",
      body: [
        `We use cookies that are necessary for the cart and checkout to function, and analytics cookies that tell us which pages are used. You can clear or block cookies in your browser; the cart will not work without the necessary ones.`,
      ],
    },
    {
      heading: "Children",
      body: [
        `This site is not directed at children under 13 and we do not knowingly collect their data. If you believe a child has given us personal information, contact ${site.supportEmail} and we will delete it.`,
      ],
    },
    { heading: "Data controller", body: identity(site) },
  ];
}

function legalNotice(site: EcomSite): PolicySection[] {
  return [
    { heading: "Site publisher", body: identity(site) },
    {
      heading: "Business details",
      body: [
        `Legal entity: ${site.legalName}, a limited liability company organised under the laws of the State of ${site.stateOfIncorporation}, United States.`,
        `Principal place of business: ${fullAddress(site)}, ${site.country}.`,
        `Trading name: ${site.brandName}. Billing descriptor: "${site.billingDescriptor}".`,
      ],
    },
    {
      heading: "Customer service",
      body: [
        `Email: ${site.supportEmail}`,
        `Phone: ${site.supportPhone}`,
        `Hours: ${site.supportHours}`,
        `We answer email within one business day.`,
      ],
    },
    {
      heading: "Intellectual property",
      body: [
        `The ${site.brandName} name, logo, site design, copy and photography are the property of ${site.legalName} and may not be reproduced without written permission.`,
      ],
    },
    ...(site.productDisclaimer ? [{ heading: "Product disclaimer", body: [site.productDisclaimer] }] : []),
  ];
}

const BUILDERS: Record<PolicySlug, (site: EcomSite) => PolicySection[]> = {
  "shipping-policy": shipping,
  "refund-policy": refund,
  terms,
  "privacy-policy": privacy,
  "legal-notice": legalNotice,
};

export function buildPolicy(site: EcomSite, slug: PolicySlug): PolicyDoc {
  return {
    slug,
    title: POLICY_LABELS[slug],
    updated: updatedOn(site),
    sections: BUILDERS[slug](site),
  };
}

export function buildAllPolicies(site: EcomSite): PolicyDoc[] {
  return POLICY_SLUGS.map((slug) => buildPolicy(site, slug));
}
