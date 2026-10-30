import { NextResponse } from "next/server";
import { getAssociateScope, getAssociateScopeOptions, saveAssociateScope } from "@/lib/associate/scope";
import { sessionFromRequest } from "@/lib/auth/request";

export const dynamic = "force-dynamic";

/** Le périmètre Straight Sale et ses choix possibles : réservé à l'admin, l'associé n'y a pas accès (guard). */
export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
  const [scope, options] = await Promise.all([getAssociateScope(), getAssociateScopeOptions()]);
  return NextResponse.json({ scope, options });
}

export async function PUT(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
  let body: { stores?: unknown; metaAccountIds?: unknown; campaignKeyword?: unknown; processingRate?: unknown; targetMargin?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined);
  const scope = await saveAssociateScope({
    stores: list(body.stores),
    metaAccountIds: list(body.metaAccountIds),
    campaignKeyword: typeof body.campaignKeyword === "string" ? body.campaignKeyword : undefined,
    processingRate: body.processingRate,
    targetMargin: body.targetMargin,
  });
  return NextResponse.json({ scope });
}
