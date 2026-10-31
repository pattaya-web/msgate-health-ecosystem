import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import {
  SHARED_ROOT,
  cleanName,
  cleanPath,
  copyEntry,
  createFolder,
  ensureSharedFolders,
  extensionFor,
  listAllFolders,
  listFolder,
  moveEntry,
  removeEntry,
  renameEntry,
  saveFile,
  searchFiles,
  type DriveFile,
  type DriveListing,
} from "@/lib/drive/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Le Drive vu par la personne connectée.
 *
 * L'admin voit tout l'arbre. L'associé voit le dossier « Commun » comme sa
 * racine : chaque chemin qu'il envoie est rangé dessous, chaque chemin rendu
 * en est retiré. Il ne peut ni lire ni écrire ailleurs, quoi qu'il envoie
 * (cleanPath retire déjà les « .. »).
 */
function scopeFor(request: Request) {
  const base = sessionFromRequest(request)?.role === "associate" ? SHARED_ROOT : "";
  const inside = (rel: string) => (base ? (rel ? `${base}/${rel}` : base) : rel);
  const outside = (rel: string) => (base ? (rel === base ? "" : rel.startsWith(`${base}/`) ? rel.slice(base.length + 1) : rel) : rel);
  return { base, inside, outside };
}

/** Lister un dossier, ou chercher dans tout le Drive. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  const { base, inside, outside } = scopeFor(request);
  try {
    await ensureSharedFolders();
    if (query) {
      const results = await searchFiles(query, 200, base);
      return NextResponse.json({ results: results.map((file: DriveFile) => ({ ...file, path: outside(file.path) })) });
    }
    if (params.get("tree")) {
      const folders = await listAllFolders(500, base);
      return NextResponse.json({ folders: folders.map(outside) });
    }
    const listing: DriveListing = await listFolder(inside(cleanPath(params.get("path"))));
    return NextResponse.json({
      path: outside(listing.path),
      folders: listing.folders.map((folder) => ({ ...folder, path: outside(folder.path) })),
      files: listing.files.map((file) => ({ ...file, path: outside(file.path) })),
    });
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
  // Le cookie de session ne part que vers l'outil lui-même, jamais vers un site extérieur.
  const sameOrigin = resolved.origin === new URL(request.url).origin;
  const res = await fetch(resolved.toString(), { cache: "no-store", headers: sameOrigin ? { cookie: request.headers.get("cookie") ?? "" } : {} });
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
  const { base, inside, outside } = scopeFor(request);
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const rel = inside(cleanPath(String(form.get("path") ?? "")));
      const saved: string[] = [];
      for (const entry of form.getAll("files")) {
        if (!(entry instanceof File) || !entry.size) continue;
        saved.push(outside(await saveFile(rel, entry.name, Buffer.from(await entry.arrayBuffer()))));
      }
      if (!saved.length) return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
      return NextResponse.json({ saved });
    }

    const body = (await request.json()) as Body;
    const rel = inside(cleanPath(body.path));
    // La racine de l'associé (« Commun ») ne se supprime, ne se renomme ni ne se déplace.
    const touchesRoot = base && rel === base;
    switch (body.action) {
      case "mkdir":
        if (!body.name?.trim()) return NextResponse.json({ error: "Nom du dossier manquant" }, { status: 400 });
        return NextResponse.json({ path: outside(await createFolder(rel, body.name)) });
      case "delete":
        if (touchesRoot) return NextResponse.json({ error: "La racine ne se supprime pas" }, { status: 400 });
        await removeEntry(rel);
        return NextResponse.json({ ok: true });
      case "rename":
        if (touchesRoot) return NextResponse.json({ error: "La racine ne se renomme pas" }, { status: 400 });
        if (!body.name?.trim()) return NextResponse.json({ error: "Nouveau nom manquant" }, { status: 400 });
        return NextResponse.json({ path: outside(await renameEntry(rel, body.name)) });
      case "move":
        if (touchesRoot) return NextResponse.json({ error: "La racine ne se déplace pas" }, { status: 400 });
        return NextResponse.json({ path: outside(await moveEntry(rel, inside(cleanPath(body.into)))) });
      case "copy":
        return NextResponse.json({ path: outside(await copyEntry(rel, inside(cleanPath(body.into)))) });
      case "import":
        if (!body.url?.trim()) return NextResponse.json({ error: "URL manquante" }, { status: 400 });
        return NextResponse.json({ path: outside(await importFromUrl(request, body.url, inside(cleanPath(body.into)), body.name)) });
      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opération impossible" }, { status: 500 });
  }
}
