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

/**
 * Un enregistrement ne fait jamais reculer un packaging.
 *
 * L'onglet garde le site en brouillon pendant qu'on le remplit, et les
 * générations, elles, écrivent côté serveur au fil de l'eau. Le brouillon
 * vieillit donc pendant qu'on tape : cliquer « Enregistrer » renvoyait des
 * produits encore associés à la photo du site copié, et trois packs brandés
 * repartaient en arrière — silencieusement, avec le logo de quelqu'un d'autre
 * remis en ligne à leur place.
 *
 * Sur ce champ précis, le serveur a raison contre le brouillon : une photo
 * brandée ne se laisse pas remplacer par la photo d'origine. Tout le reste du
 * patch s'applique normalement, et supprimer un produit reste possible — c'est
 * une absence de la liste, pas un retour en arrière.
 */
function keepBrandedPacks(current: EcomSite, patch: Partial<EcomSite>) {
  if (!patch.products) return patch;
  const known = new Map(current.products.map((product) => [product.handle, product]));
  return {
    ...patch,
    products: patch.products.map((incoming) => {
      const stored = known.get(incoming.handle);
      const storedIsBranded = Boolean(stored?.imageUrl && stored.imageUrl !== stored.sourceImageUrl);
      const incomingIsSource = !incoming.imageUrl || incoming.imageUrl === incoming.sourceImageUrl;
      return storedIsBranded && incomingIsSource
        ? { ...incoming, imageUrl: stored!.imageUrl }
        : incoming;
    }),
  };
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const patch = (await request.json()) as Partial<EcomSite>;
    const current = await getEcomSite(id);
    if (!current) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
    const site = await updateEcomSite(id, keepBrandedPacks(current, patch));
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
