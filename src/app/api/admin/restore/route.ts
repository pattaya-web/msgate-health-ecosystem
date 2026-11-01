import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { STORAGE_ROOT } from "@/lib/storage-root";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Transfert des données du PC vers le serveur (installation sur le VPS, 01/11/2026).
 *
 * Le script du PC envoie chaque fichier de data/, .msgate-cache/ et
 * .phoenix-cache/ ici ; il est écrit tel quel sur le disque persistant.
 * Fermé par défaut : il faut une session admin ET l'en-tête x-restore-token
 * égal à RESTORE_TOKEN (variable posée le temps du transfert, puis retirée).
 */

const ROOTS = ["data/", ".msgate-cache/", ".phoenix-cache/"];

function target(request: Request) {
  const rel = new URL(request.url).searchParams.get("path")?.replace(/\\/g, "/") ?? "";
  if (!rel || rel.includes("..") || rel.startsWith("/") || !ROOTS.some((root) => rel.startsWith(root))) return null;
  return path.join(STORAGE_ROOT, rel);
}

function allowed(request: Request) {
  const expected = process.env.RESTORE_TOKEN?.trim();
  if (!expected || expected.length < 24) return false;
  if (request.headers.get("x-restore-token") !== expected) return false;
  return sessionFromRequest(request)?.role === "admin";
}

/** La taille du fichier déjà présent (pour reprendre un transfert sans tout renvoyer). */
export async function GET(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const file = target(request);
  if (!file) return NextResponse.json({ error: "Chemin refusé" }, { status: 400 });
  const info = await stat(file).catch(() => null);
  return NextResponse.json({ size: info?.isFile() ? info.size : null });
}

export async function PUT(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const file = target(request);
  if (!file) return NextResponse.json({ error: "Chemin refusé" }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "Fichier vide" }, { status: 400 });
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.restore-${process.pid}.tmp`;
  await pipeline(Readable.fromWeb(request.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(tmp));
  await rename(tmp, file);
  const info = await stat(file);
  return NextResponse.json({ ok: true, size: info.size });
}
