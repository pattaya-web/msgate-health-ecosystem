import { NextRequest, NextResponse } from "next/server";
import { insert, list, remove, removeMany, update } from "@/lib/db";
import type { CollectionName } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED: CollectionName[] = ["generations", "studioCharacters", "studioJobs"];

function resolve(name: string): CollectionName | null {
  return (ALLOWED as string[]).includes(name) ? (name as CollectionName) : null;
}

/**
 * Champs retires en mode allege : du texte long dont les listes n'ont aucun
 * usage. Sur 226 publications, les transcriptions pesent a elles seules 155 Ko
 * sur 422. Un booleen `hasTranscript` les remplace pour que l'interface sache
 * quand meme lesquelles sont deja transcrites.
 */
const HEAVY: Partial<Record<CollectionName, string[]>> = {};

export async function GET(req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });

  const rows = list(key);
  const heavy = HEAVY[key];
  if (req.nextUrl.searchParams.get("light") !== "1" || !heavy) {
    return NextResponse.json(rows);
  }

  const slim = (rows as unknown as Record<string, unknown>[]).map((row) => {
    const copy: Record<string, unknown> = { ...row, hasTranscript: Boolean(row.transcript) };
    for (const f of heavy) delete copy[f];
    return copy;
  });
  return NextResponse.json(slim);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });
  const body = (await req.json()) as Record<string, unknown>;
  return NextResponse.json(insert(key, body));
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });
  const { id, ...patch } = (await req.json()) as { id?: string } & Record<string, unknown>;
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  const row = update(key, id, patch);
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });
  // `ids` permet de vider une selection en une seule ecriture.
  const many = req.nextUrl.searchParams.get("ids");
  if (many) {
    const list = many.split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.length) return NextResponse.json({ error: "ids vide" }, { status: 400 });
    return NextResponse.json(removeMany(key, list));
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  return NextResponse.json(remove(key, id));
}
