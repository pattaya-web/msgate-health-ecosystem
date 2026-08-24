/** Couleur d'accent du modèle ScaleXReach (bandeau tableau, encadré total, titre). */
export const INVOICE_ACCENT = "#ff6b81";
export const INVOICE_ACCENT_STRONG = "#ff5f75";

export type InvoiceLine = {
  id: string;
  description: string;
  amount: number;
};

export type InvoiceBank = {
  bankName: string;
  beneficiary: string;
  accountNumber: string;
  routing: string;
  swift: string;
  bankAddress: string;
  beneficiaryAddress: string;
};

export type Invoice = {
  brandName: string;
  issuerLegalName: string;
  issuerAddress: string;
  issuerEmail: string;
  clientName: string;
  clientAddress: string;
  clientEmail: string;
  /** Format ISO `YYYY-MM-DD` (les <input type="date"/>), rendu en MM/DD/YYYY. */
  invoiceDate: string;
  paymentMethod: string;
  serviceFrom: string;
  serviceTo: string;
  lines: InvoiceLine[];
  bank: InvoiceBank;
};

export function newLineId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Le modèle de référence, pré-rempli : seul le bloc client / lignes change d'une facture à l'autre. */
export function defaultInvoice(): Invoice {
  return {
    brandName: "ScaleXReach",
    issuerLegalName: "SCALEXBYECOM LLC",
    issuerAddress: "8206 Louisiana Blvd NE Ste A\nAlbuquerque, NM 87113-1738, US",
    issuerEmail: "contact@scalexbyecom.com",
    clientName: "SKINRENEW LLC",
    clientAddress: "1831 13th Ave E Apt 1323\nBradenton, FL 34208-3303, US",
    clientEmail: "admin@upskinrenew.com",
    invoiceDate: "2026-07-20",
    paymentMethod: "Bank Transfer",
    serviceFrom: "2026-07-13",
    serviceTo: "2026-07-17",
    lines: [
      { id: newLineId(), description: "Growth Marketing & Advertising Management Services", amount: 4000 },
      { id: newLineId(), description: "Meta & TikTok Ads Management / BM Infrastructure", amount: 2000 },
      { id: newLineId(), description: "Invoice Processing & Payment Operations Services", amount: 1500 },
      { id: newLineId(), description: "Strategic Consulting & Performance Reporting", amount: 500 },
    ],
    bank: {
      bankName: "Column Bank",
      beneficiary: "SCALEXBYECOM LLC",
      accountNumber: "628709471651006",
      routing: "121145307",
      swift: "CLNOUS66XXX",
      bankAddress: "1 Letterman Drive, Suite A4-700\nSan Francisco, CA 94129, US",
      beneficiaryAddress: "8206 Louisiana Blvd NE Ste A\nAlbuquerque, NM 87113-1738, US",
    },
  };
}

export function invoiceTotal(lines: InvoiceLine[]) {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0);
}

/** `$8,000.00` — le modèle affiche toujours deux décimales. */
export function formatInvoiceAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/** `2026-07-20` → `07/20/2026` (le modèle est en date US). */
export function formatInvoiceDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${month}/${day}/${year}`;
}

/**
 * Nom de fichier proposé par le navigateur au moment de l'impression PDF :
 * société facturée + période de service, pour classer les factures sans les ouvrir.
 */
export function invoiceFileName(invoice: Invoice) {
  const client =
    invoice.clientName
      .trim()
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "Invoice";

  const from = invoice.serviceFrom.trim();
  const to = invoice.serviceTo.trim();
  const period = from && to ? `${from}_${to}` : from || to || invoice.invoiceDate.trim();

  return period ? `${client}-Invoice-${period}` : `${client}-Invoice`;
}
