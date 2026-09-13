import { NextResponse } from "next/server";
import { importPage } from "@/lib/ecom-sites/pages";

export const dynamic = "force-dynamic";

/**
 * Reprend le contenu d'une page à partir de son adresse.
 *
 * Le navigateur ne peut pas lire un site étranger (CORS) : c'est le serveur qui
 * va chercher la page et la réduit à ses blocs. La page revient au client, qui
 * l'ajoute au brouillon ; l'enregistrement automatique fait le reste.
 */
export async function POST(request: Request) {
  let body: { url?: string; taken?: string[] };
  try {
    body = (await request.json()) as { url?: string; taken?: string[] };
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  if (!body.url?.trim()) return NextResponse.json({ error: "Adresse manquante" }, { status: 400 });
  try {
    const page = await importPage(body.url, { pages: (body.taken ?? []).map((slug) => ({ id: slug, slug, title: slug, blocks: [], inNav: false })) });
    return NextResponse.json({ page });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import impossible" }, { status: 502 });
  }
}
