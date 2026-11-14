import { NextResponse } from "next/server";
import { blockingItems, checklistScore, evaluateSite } from "@/lib/ecom-sites/checklist";
import { getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import { sessionFromRequest } from "@/lib/auth/request";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type Body = { action?: "publish" | "unpublish"; overrides?: string[] };

/**
 * Mettre une boutique en ligne, ou la repasser en brouillon.
 *
 * La publication refuse tant qu'un point bloquant du contrôle reste ouvert,
 * sauf s'il est accepté explicitement : la requête doit alors nommer chaque
 * point accepté (`overrides`), et la liste est gardée avec le compte et la
 * date. Un point bloquant n'est jamais accepté « en bloc » sans être lu.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const site = await getEcomSite(id);
  if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  const who = sessionFromRequest(request)?.email;

  if (body.action === "unpublish") {
    const updated = await updateEcomSite(id, { status: "draft" });
    const checklist = evaluateSite(updated ?? site);
    return NextResponse.json({ site: updated, checklist, score: checklistScore(checklist) });
  }

  const checklist = evaluateSite(site);
  const blocking = blockingItems(checklist);
  const accepted = new Set(body.overrides ?? []);
  const open = blocking.filter((item) => !accepted.has(item.id));
  if (open.length) {
    return NextResponse.json(
      {
        error: `${open.length} point(s) bloquant(s) à résoudre ou à accepter explicitement avant la publication.`,
        blocking: open,
        checklist,
        score: checklistScore(checklist),
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const updated = await updateEcomSite(id, {
    status: "published",
    publishedAt: now,
    publishApproval: { at: now, by: who, overrides: blocking.map((item) => item.id) },
  });
  const after = evaluateSite(updated ?? site);
  return NextResponse.json({ site: updated, checklist: after, score: checklistScore(after) });
}
