import { NextResponse } from "next/server";
import { checklistScore, evaluateSite } from "@/lib/ecom-sites/checklist";
import { cloneEcomSite, createEcomSite, listEcomSites } from "@/lib/ecom-sites/store";
import type { EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const sites = await listEcomSites();
  return NextResponse.json({
    sites,
    // Le badge « prêt / bloqué » de la liste vient d'ici, pas d'un calcul client.
    scores: Object.fromEntries(sites.map((site) => [site.id, checklistScore(evaluateSite(site))])),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<EcomSite> & {
      brandName?: string;
      cloneOf?: string;
    };

    if (!body.brandName?.trim()) {
      return NextResponse.json({ error: "Nom de marque requis" }, { status: 400 });
    }

    const site = body.cloneOf
      ? await cloneEcomSite(body.cloneOf, body.brandName)
      : await createEcomSite({ ...body, brandName: body.brandName });

    if (!site) return NextResponse.json({ error: "Site source introuvable" }, { status: 404 });

    return NextResponse.json({ site });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Création impossible" },
      { status: 500 }
    );
  }
}
