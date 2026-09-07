import { NextResponse } from "next/server";
import { checklistScore, evaluateSite } from "@/lib/ecom-sites/checklist";
import { deleteEcomSite, getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import type { EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const site = await getEcomSite(id);
  if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  const checklist = evaluateSite(site);
  return NextResponse.json({ site, checklist, score: checklistScore(checklist) });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const patch = (await request.json()) as Partial<EcomSite>;
    const site = await updateEcomSite(id, patch);
    if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
    const checklist = evaluateSite(site);
    return NextResponse.json({ site, checklist, score: checklistScore(checklist) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mise à jour impossible" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const removed = await deleteEcomSite(id);
  if (!removed) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
