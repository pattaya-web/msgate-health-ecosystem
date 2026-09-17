import { NextResponse } from "next/server";
import {
  cleanName,
  cleanPath,
  copyEntry,
  createFolder,
  extensionFor,
  listAllFolders,
  listFolder,
  moveEntry,
  removeEntry,
  renameEntry,
  saveFile,
  searchFiles,
} from "@/lib/drive/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Lister un dossier, ou chercher dans tout le Drive. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  try {
    if (query) return NextResponse.json({ results: await searchFiles(query) });
    if (params.get("tree")) return NextResponse.json({ folders: await listAllFolders() });
    return NextResponse.json(await listFolder(cleanPath(params.get("path"))));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Drive illisible" }, { status: 500 });
  }
}

type Body = {
  action?: "mkdir" | "delete" | "rename" | "move" | "copy" | "import";
  path?: string;
  name?: string;
  into?: string;
  /** Import : URL http(s) ou chemin local de l'app, copié par le serveur. */
  url?: string;
};

/**
 * Copie une créa de l'outil dans le Drive depuis son URL. Un chemin local
 * (/api/studio/…) se résout sur l'app elle-même ; une URL Kie est rapatriée
 * avant d'expirer. Le nom vient de l'appelant, sinon de l'URL, sinon du type.
 */
async function importFromUrl(request: Request, rawUrl: string, into: string, wanted?: string) {
  const resolved = new URL(rawUrl, request.url);
  if (!/^https?:$/.test(resolved.protocol)) throw new Error("URL refusée");
  const res = await fetch(resolved.toString(), { cache: "no-store", headers: { cookie: request.headers.get("cookie") ?? "" } });
  if (!res.ok) throw new Error(`Source injoignable (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.length) throw new Error("Fichier vide");
  const ext = extensionFor(res.headers.get("content-type"));
  const fromUrl = decodeURIComponent(resolved.pathname.split("/").pop() ?? "").replace(/^file_0+/, "");
  const fromParam = resolved.searchParams.get("file") ?? "";
  let name = (wanted ?? "").trim() || fromParam || fromUrl || "crea";
  if (!/\.[a-z0-9]{2,4}$/i.test(name) && ext) name = `${name}.${ext}`;
  return saveFile(into, cleanName(name), data);
}

/**
 * Deux formes de requête : du JSON pour les opérations sur l'arbre, un
 * formulaire multipart pour déposer des fichiers — la seule façon d'envoyer
 * une vidéo de cent mégaoctets sans la gonfler en base64.
 */
export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const rel = cleanPath(String(form.get("path") ?? ""));
      const saved: string[] = [];
      for (const entry of form.getAll("files")) {
        if (!(entry instanceof File) || !entry.size) continue;
        saved.push(await saveFile(rel, entry.name, Buffer.from(await entry.arrayBuffer())));
      }
      if (!saved.length) return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
      return NextResponse.json({ saved });
    }

    const body = (await request.json()) as Body;
    const rel = cleanPath(body.path);
    switch (body.action) {
      case "mkdir":
        if (!body.name?.trim()) return NextResponse.json({ error: "Nom du dossier manquant" }, { status: 400 });
        return NextResponse.json({ path: await createFolder(rel, body.name) });
      case "delete":
        await removeEntry(rel);
        return NextResponse.json({ ok: true });
      case "rename":
        if (!body.name?.trim()) return NextResponse.json({ error: "Nouveau nom manquant" }, { status: 400 });
        return NextResponse.json({ path: await renameEntry(rel, body.name) });
      case "move":
        return NextResponse.json({ path: await moveEntry(rel, cleanPath(body.into)) });
      case "copy":
        return NextResponse.json({ path: await copyEntry(rel, cleanPath(body.into)) });
      case "import":
        if (!body.url?.trim()) return NextResponse.json({ error: "URL manquante" }, { status: 400 });
        return NextResponse.json({ path: await importFromUrl(request, body.url, cleanPath(body.into), body.name) });
      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opération impossible" }, { status: 500 });
  }
}
