import { NextResponse } from "next/server";
import { readReferenceSite } from "@/lib/ecom-sites/reference";
import { addReference, listReferences, noteReferenceRead, removeReference } from "@/lib/ecom-sites/reference-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ references: await listReferences() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: "add" | "read"; domain?: string };
    if (!body.domain?.trim()) return NextResponse.json({ error: "Domaine requis" }, { status: 400 });

    if (body.action === "add") {
      return NextResponse.json({ reference: await addReference(body.domain) });
    }

    // Lecture du catalogue modèle : sert d'aperçu avant de lancer une copie.
    const read = await readReferenceSite(body.domain);
    await noteReferenceRead(read.domain, read.products.length);
    return NextResponse.json(read);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Modèle illisible" },
      { status: 502 }
    );
  }
}

export async function DELETE(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain") || "";
  const removed = await removeReference(domain);
  if (!removed) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
