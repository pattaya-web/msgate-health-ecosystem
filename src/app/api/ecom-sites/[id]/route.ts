import { NextResponse } from "next/server";
import { checklistScore, evaluateSite } from "@/lib/ecom-sites/checklist";
import { deleteEcomSite, getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import type { EcomSite } from "@/lib/ecom-sites/types";
import { sessionFromRequest } from "@/lib/auth/request";

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
      const stored = known.get(incoming.handle) ?? incoming.previousHandles?.map((handle) => known.get(handle)).find(Boolean);
      const storedIsBranded = Boolean(stored?.imageUrl && stored.imageUrl !== stored.sourceImageUrl);
      const incomingIsSource = !incoming.imageUrl || incoming.imageUrl === incoming.sourceImageUrl;
      return storedIsBranded && incomingIsSource
        ? { ...incoming, imageUrl: stored!.imageUrl }
        : incoming;
    }),
  };
}

/**
 * Un brouillon ne retire pas un produit qu'il n'a jamais vu.
 *
 * « Produits manquants du modèle » ajoute des produits côté serveur ; un onglet
 * ouvert depuis plus longtemps renvoie sa liste sans eux. Un produit absent du
 * patch mais ajouté après la dernière version connue du brouillon est gardé :
 * c'est un oubli du brouillon, pas une suppression.
 */
function keepServerAdditions(current: EcomSite, patch: Partial<EcomSite>) {
  if (!patch.products || !patch.updatedAt) return patch;
  const seen = Date.parse(patch.updatedAt);
  const sent = new Set(patch.products.flatMap((product) => [product.handle, ...(product.previousHandles ?? [])]));
  const unseen = current.products.filter(
    (product) => !sent.has(product.handle) && product.addedAt && Date.parse(product.addedAt) > seen
  );
  return unseen.length ? { ...patch, products: [...patch.products, ...unseen] } : patch;
}

/**
 * Ce que le serveur tient lui-même à jour sur chaque fiche.
 *
 * - Une image remplacée dans l'éditeur sans passer par la génération devient
 *   « choisie à la main » pour le nom du produit à cet instant : sinon l'ancienne
 *   étiquette (« faite pour X ») suivrait une autre image.
 * - Une validation nouvellement posée est signée du compte connecté.
 * - Le statut de publication ne change que par /publish, jamais par un
 *   enregistrement du brouillon.
 */
function serverOwnedFields(current: EcomSite, patch: Partial<EcomSite>, who: string | undefined): Partial<EcomSite> {
  const rest = { ...patch };
  delete rest.status;
  delete rest.publishedAt;
  delete rest.publishApproval;
  if (!rest.products) return rest;
  const known = new Map(current.products.map((product) => [product.handle, product]));
  return {
    ...rest,
    products: rest.products.map((incoming) => {
      // Une adresse alignée sur le nom garde l'ancienne dans previousHandles : on retrouve la fiche par elle.
      const stored = known.get(incoming.handle) ?? incoming.previousHandles?.map((handle) => known.get(handle)).find(Boolean);
      let next = incoming;
      // L'origine de l'image est tenue par le serveur (génération, rattachement) : un brouillon ne la réécrit pas.
      if (stored) {
        next =
          incoming.imageUrl && incoming.imageUrl !== stored.imageUrl
            ? { ...next, imageInfo: { kind: "manual", forName: incoming.name, reference: "none", at: new Date().toISOString() } }
            : { ...next, imageInfo: stored.imageInfo };
      }
      if (next.review && next.review.at !== stored?.review?.at) next = { ...next, review: { ...next.review, by: who } };
      return next;
    }),
  };
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const patch = (await request.json()) as Partial<EcomSite>;
    const current = await getEcomSite(id);
    if (!current) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
    const who = sessionFromRequest(request)?.email;
    const site = await updateEcomSite(id, serverOwnedFields(current, keepServerAdditions(current, keepBrandedPacks(current, patch)), who));
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
