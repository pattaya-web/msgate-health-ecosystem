import { NextResponse } from "next/server";
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from "@/lib/studio/templates";
import type { PromptTemplateInput } from "@/lib/studio/template-types";

export const dynamic = "force-dynamic";

/** Les templates de prompt de Static : liste, création, modification, suppression. */
export async function GET() {
  try {
    return NextResponse.json({ templates: await listTemplates() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Templates illisibles" }, { status: 500 });
  }
}

type Body = { action?: "create" | "update" | "delete"; id?: string } & Partial<PromptTemplateInput>;

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  const input: Partial<PromptTemplateInput> = {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(typeof body.description === "string" ? { description: body.description } : {}),
    ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
    ...(typeof body.category === "string" ? { category: body.category } : {}),
    ...(typeof body.noLogo === "boolean" ? { noLogo: body.noLogo } : {}),
  };
  try {
    switch (body.action) {
      case "create":
        return NextResponse.json({ template: await createTemplate(input) });
      case "update":
        if (!body.id) return NextResponse.json({ error: "Template manquant" }, { status: 400 });
        return NextResponse.json({ template: await updateTemplate(body.id, input) });
      case "delete":
        if (!body.id) return NextResponse.json({ error: "Template manquant" }, { status: 400 });
        await deleteTemplate(body.id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opération impossible" }, { status: 400 });
  }
}
