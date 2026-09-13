import { NextResponse } from "next/server";
import {
  addProject,
  addShop,
  checkShop,
  listProjects,
  removeProject,
  removeShop,
  updateShop,
} from "@/lib/spyshop/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

type Body = {
  action?: "project-add" | "project-delete" | "shop-add" | "shop-delete" | "shop-update" | "shop-check" | "project-check";
  projectId?: string;
  shopId?: string;
  name?: string;
  url?: string;
  note?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "project-add":
        return NextResponse.json({ project: await addProject(body.name ?? "") });
      case "project-delete":
        if (!body.projectId) return NextResponse.json({ error: "Projet manquant" }, { status: 400 });
        await removeProject(body.projectId);
        return NextResponse.json({ ok: true });
      case "shop-add": {
        if (!body.projectId) return NextResponse.json({ error: "Projet manquant" }, { status: 400 });
        const shop = await addShop(body.projectId, body.url ?? "", body.note ?? "");
        // Première lecture dans la foulée : la carte arrive déjà remplie.
        return NextResponse.json({ shop: await checkShop(body.projectId, shop.id) });
      }
      case "shop-delete":
        if (!body.projectId || !body.shopId) return NextResponse.json({ error: "Boutique manquante" }, { status: 400 });
        await removeShop(body.projectId, body.shopId);
        return NextResponse.json({ ok: true });
      case "shop-update":
        if (!body.projectId || !body.shopId) return NextResponse.json({ error: "Boutique manquante" }, { status: 400 });
        return NextResponse.json({ shop: await updateShop(body.projectId, body.shopId, { note: body.note, name: body.name }) });
      case "shop-check":
        if (!body.projectId || !body.shopId) return NextResponse.json({ error: "Boutique manquante" }, { status: 400 });
        return NextResponse.json({ shop: await checkShop(body.projectId, body.shopId) });
      case "project-check": {
        if (!body.projectId) return NextResponse.json({ error: "Projet manquant" }, { status: 400 });
        const projects = await listProjects();
        const project = projects.find((item) => item.id === body.projectId);
        if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
        // Une boutique après l'autre : les catalogues publics n'aiment pas les rafales.
        for (const shop of project.shops) await checkShop(project.id, shop.id);
        return NextResponse.json({ projects: await listProjects() });
      }
      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opération impossible" }, { status: 500 });
  }
}
