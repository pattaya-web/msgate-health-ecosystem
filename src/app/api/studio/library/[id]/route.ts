import { NextResponse } from "next/server";
import { deleteStaticCreative, getStaticCreative } from "@/lib/studio/library";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getStaticCreative(id);
  if (!item) return NextResponse.json({ error: "Créa introuvable" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteStaticCreative(id);
  if (!ok) return NextResponse.json({ error: "Créa introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
