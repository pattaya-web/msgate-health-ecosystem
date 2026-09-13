import { NextResponse } from "next/server";
import { addMessage, listMessages, removeMessage } from "@/lib/ecom-sites/messages";
import { getEcomSiteBySlug } from "@/lib/ecom-sites/store";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Les messages d'une boutique, pour l'éditeur. */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  if (!slug) return NextResponse.json({ error: "Boutique manquante" }, { status: 400 });
  return NextResponse.json({ messages: await listMessages(slug) });
}

/** Le formulaire de contact d'une boutique dépose ici. */
export async function POST(request: Request) {
  let body: { slug?: string; name?: string; email?: string; subject?: string; message?: string; website?: string; preview?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  // Champ piège : un robot le remplit, un humain ne le voit pas.
  if (body.website) return NextResponse.json({ ok: true });
  const slug = (body.slug ?? "").trim();
  const name = (body.name ?? "").trim().slice(0, 120);
  const email = (body.email ?? "").trim().slice(0, 200);
  const subject = (body.subject ?? "").trim().slice(0, 200);
  const message = (body.message ?? "").trim().slice(0, 5000);
  if (!slug || !(await getEcomSiteBySlug(slug))) return NextResponse.json({ error: "Unknown store" }, { status: 404 });
  if (!name || !EMAIL.test(email) || !message) return NextResponse.json({ error: "Please fill in your name, a valid email and a message." }, { status: 400 });
  const saved = await addMessage({ slug, name, email, subject, message, preview: Boolean(body.preview) });
  return NextResponse.json({ ok: true, id: saved.id });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Message manquant" }, { status: 400 });
  return NextResponse.json({ ok: await removeMessage(id) });
}
