import { NextResponse } from "next/server";
import { addIdea, cleanUrl, deleteIdea, listIdeas, updateIdea } from "@/lib/associate/product-ideas";
import { appUserFor } from "@/lib/auth/session";
import { sessionFromRequest } from "@/lib/auth/request";

export const dynamic = "force-dynamic";

/** Le tableau « Produits à lancer », commun à Mady et Alison. */
export async function GET() {
  return NextResponse.json({ ideas: await listIdeas() });
}

/**
 * Une seule méthode d'écriture (l'associée n'a que POST) :
 * { action: "add", reelUrl, productUrl } · { action: "update", id, reelUrl?, productUrl? } · { action: "delete", id }.
 */
export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  let body: { action?: unknown; id?: unknown; reelUrl?: unknown; productUrl?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  const reelUrl = body.reelUrl === undefined ? undefined : cleanUrl(body.reelUrl);
  const productUrl = body.productUrl === undefined ? undefined : cleanUrl(body.productUrl);
  if (reelUrl === null || productUrl === null) return NextResponse.json({ error: "Lien invalide : colle une adresse qui commence par https://" }, { status: 400 });

  if (body.action === "add") {
    if (!reelUrl && !productUrl) return NextResponse.json({ error: "Mets au moins un lien" }, { status: 400 });
    await addIdea({ reelUrl: reelUrl ?? "", productUrl: productUrl ?? "" }, appUserFor(session).full_name);
  } else if (body.action === "update" && typeof body.id === "string") {
    const patch = { ...(reelUrl !== undefined ? { reelUrl } : {}), ...(productUrl !== undefined ? { productUrl } : {}) };
    if (!(await updateIdea(body.id, patch))) return NextResponse.json({ error: "Ligne introuvable" }, { status: 404 });
  } else if (body.action === "delete" && typeof body.id === "string") {
    if (!(await deleteIdea(body.id))) return NextResponse.json({ error: "Ligne introuvable" }, { status: 404 });
  } else {
    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  }
  return NextResponse.json({ ideas: await listIdeas() });
}
