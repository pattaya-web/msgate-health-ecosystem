import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sessionFromRequest } from "@/lib/auth/request";
import { readNoah, writeNoah, type NoahConfig } from "@/lib/noah/store";

export const dynamic = "force-dynamic";

/** L'espace Instagram de Noah : ses réels publiés et ce que Mady lui prépare. */
export async function GET() {
  return NextResponse.json(await readNoah());
}

type Body =
  | { action: "log-post"; url?: string; note?: string }
  | { action: "delete-post"; id: string }
  | { action: "save-config"; config: Partial<NoahConfig> };

export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  const store = await readNoah();

  if (body.action === "log-post") {
    const url = (body.url ?? "").trim().slice(0, 500);
    if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Le lien doit commencer par https://" }, { status: 400 });
    store.posts.unshift({ id: randomUUID(), at: new Date().toISOString(), url, note: (body.note ?? "").trim().slice(0, 300), by: session.email });
    // La chauffe démarre au premier réel si Mady n'a pas fixé de date.
    if (!store.config.warmupStart) store.config.warmupStart = new Date().toISOString().slice(0, 10);
    store.posts = store.posts.slice(0, 5000);
    await writeNoah(store);
    return NextResponse.json(store);
  }

  if (body.action === "delete-post") {
    const post = store.posts.find((item) => item.id === body.id);
    if (!post) return NextResponse.json({ error: "Réel introuvable" }, { status: 404 });
    // Noah retire ses propres réels (une erreur de clic) ; l'admin, n'importe lequel.
    if (session.role !== "admin" && post.by !== session.email) return NextResponse.json({ error: "Seul l'admin peut retirer ce réel" }, { status: 403 });
    store.posts = store.posts.filter((item) => item.id !== body.id);
    await writeNoah(store);
    return NextResponse.json(store);
  }

  if (body.action === "save-config") {
    // Les tutos, la stratégie, les prompts et la montée en charge : réservés à l'admin.
    if (session.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
    const next = { ...store.config, ...body.config };
    next.ramp = (next.ramp ?? [])
      .map((step) => ({ fromDay: Math.max(1, Math.round(Number(step.fromDay) || 1)), perDay: Math.min(50, Math.max(0, Math.round(Number(step.perDay) || 0))) }))
      .sort((a, b) => a.fromDay - b.fromDay);
    store.config = next;
    await writeNoah(store);
    return NextResponse.json(store);
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
