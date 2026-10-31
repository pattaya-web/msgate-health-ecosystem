import { randomUUID } from "crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Comptabilité › Factures : la liste des factures fournisseurs qu'on paie,
 * pour tout tracer. Chaque ligne garde le PDF (ou l'image) de la facture, sa
 * date, la période qu'elle couvre (du… au…) et son montant. Commune à Mady et
 * Alison ; l'auteur de chaque ligne est noté.
 */

export type SupplierInvoice = {
  id: string;
  /** Libellé lisible : le nom du fichier, modifiable. */
  label: string;
  fileName: string;
  contentType: string;
  size: number;
  invoiceDate: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
  addedBy: string;
  createdAt: string;
};

const ROOT = path.join(STORAGE_ROOT, ".msgate-cache", "supplier-invoices");
const INDEX = path.join(ROOT, "index.json");
const FILES = path.join(ROOT, "files");
/** 25 Mo par facture : un PDF de fournisseur, pas une vidéo. */
export const MAX_INVOICE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"];

const state = ((globalThis as typeof globalThis & { __msgateSupplierInvoices?: { list: SupplierInvoice[] | null; queue: Promise<unknown> } }).__msgateSupplierInvoices ??= {
  list: null,
  queue: Promise.resolve(),
});

export const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function listInvoices(): Promise<SupplierInvoice[]> {
  if (state.list) return state.list;
  try {
    const parsed = JSON.parse(await readFile(INDEX, "utf8")) as { invoices?: SupplierInvoice[] };
    state.list = Array.isArray(parsed.invoices) ? parsed.invoices : [];
  } catch {
    state.list = [];
  }
  return state.list;
}

async function persist(list: SupplierInvoice[]) {
  await mkdir(ROOT, { recursive: true });
  const sorted = [...list].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.createdAt.localeCompare(a.createdAt));
  const tmp = `${INDEX}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ invoices: sorted }, null, 2));
  await rename(tmp, INDEX);
  state.list = sorted;
}

/** Une écriture à la fois : deux ajouts simultanés ne s'écrasent pas. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = state.queue.then(task, task);
  state.queue = run.catch(() => undefined);
  return run;
}

const extOf = (fileName: string, contentType: string) => {
  const fromName = path.extname(fileName).slice(1).toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return contentType === "application/pdf" ? "pdf" : contentType.split("/")[1] || "bin";
};

export function filePathOf(invoice: SupplierInvoice) {
  return path.join(FILES, `${invoice.id}.${extOf(invoice.fileName, invoice.contentType)}`);
}

export function addInvoice(input: Omit<SupplierInvoice, "id" | "createdAt" | "size"> & { data: Buffer }) {
  return serial(async () => {
    const invoice: SupplierInvoice = {
      id: randomUUID(),
      label: input.label,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.data.length,
      invoiceDate: input.invoiceDate,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      amount: input.amount,
      currency: input.currency,
      addedBy: input.addedBy,
      createdAt: new Date().toISOString(),
    };
    await mkdir(FILES, { recursive: true });
    await writeFile(filePathOf(invoice), input.data);
    await persist([invoice, ...(await listInvoices())]);
    return invoice;
  });
}

export function updateInvoice(id: string, patch: Partial<Pick<SupplierInvoice, "label" | "invoiceDate" | "periodStart" | "periodEnd" | "amount" | "currency">>) {
  return serial(async () => {
    const list = await listInvoices();
    if (!list.some((invoice) => invoice.id === id)) return false;
    await persist(list.map((invoice) => (invoice.id === id ? { ...invoice, ...patch } : invoice)));
    return true;
  });
}

export function deleteInvoice(id: string) {
  return serial(async () => {
    const list = await listInvoices();
    const target = list.find((invoice) => invoice.id === id);
    if (!target) return false;
    await unlink(filePathOf(target)).catch(() => undefined);
    await persist(list.filter((invoice) => invoice.id !== id));
    return true;
  });
}
