import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { filePathOf, listInvoices } from "@/lib/accounting/supplier-invoices";

export const dynamic = "force-dynamic";

/** Le PDF (ou l'image) d'une facture fournisseur, ouvert dans le navigateur. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const invoice = (await listInvoices()).find((row) => row.id === id);
  if (!invoice) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
  try {
    const data = await readFile(filePathOf(invoice));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": invoice.contentType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(invoice.fileName)}`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable sur ce serveur" }, { status: 404 });
  }
}
