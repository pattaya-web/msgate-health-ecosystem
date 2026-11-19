import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { STORAGE_ROOT } from "@/lib/storage-root";
import { workspaceFromRequest } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Le montage en cours, sauvegardé en continu sur le serveur (disque permanent).
 *
 * Un projet par espace (Montage général, Moosha…) : on ferme la page, on
 * revient plus tard ou depuis un autre ordinateur, la timeline est là. Les
 * vidéos et la musique sont déjà envoyées dans les médias du site dès leur
 * ajout ; le projet ne garde que leurs adresses, les coupes, les textes, les
 * emojis et les réglages.
 */
const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "montage-projects.json");
const MAX_BYTES = 2 * 1024 * 1024;

type Store = Record<string, { savedAt: string; project: unknown }>;

async function load(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const key = workspaceFromRequest(request)?.id ?? "default";
  const store = await load();
  return NextResponse.json(store[key] ?? { savedAt: null, project: null });
}

export async function PUT(request: Request) {
  const key = workspaceFromRequest(request)?.id ?? "default";
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Projet trop lourd" }, { status: 413 });
  let body: { project?: unknown };
  try {
    body = JSON.parse(raw) as { project?: unknown };
  } catch {
    return NextResponse.json({ error: "Projet illisible" }, { status: 400 });
  }
  const store = await load();
  const savedAt = new Date().toISOString();
  if (body.project === null) delete store[key];
  else store[key] = { savedAt, project: body.project };
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store));
  await rename(tmp, FILE);
  return NextResponse.json({ savedAt });
}
