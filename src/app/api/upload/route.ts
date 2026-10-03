import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { newId } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
/** Morceaux en cours d'assemblage (envoi par morceaux, voir plus bas). */
const PARTS_DIR = path.join(MEDIA_DIR, ".parts");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 Go
/** Un envoi par morceaux abandonne depuis plus longtemps que ca est jete. */
const PARTS_TTL_MS = 24 * 60 * 60 * 1000;

const SAFE_EXT = new Set([
  ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv",
  ".png", ".jpg", ".jpeg", ".jfif", ".jpe", ".webp", ".gif",
  ".mp3", ".wav", ".m4a", ".aac",
]);

/** Extensions qui designent un JPEG sans en porter le nom. */
const JPEG_ALIASES: Record<string, string> = { ".jfif": ".jpg", ".jpe": ".jpg" };

class TooBig extends Error {}

/**
 * Verification de l'entete du fichier recu.
 *
 * Des telephones ont envoye des corps de requete qui n'etaient pas le
 * fichier (octets sans rapport, tailles plausibles) : acceptes tels quels,
 * ils cassaient la generation bien plus tard avec « Invalid data found ».
 * On lit les premiers octets et on refuse tout de suite ce qui n'est pas
 * une image, une video ou un son connu ; le navigateur retente autrement.
 */
const ASCII = (b: Buffer, from: number, text: string) => b.subarray(from, from + text.length).toString("latin1") === text;
function looksValid(head: Buffer, ext: string): boolean {
  if (head.length < 12) return false;
  const hex = head.subarray(0, 4).toString("hex");
  switch (ext) {
    case ".jpg": case ".jpeg": return hex.startsWith("ffd8ff");
    case ".png": return hex === "89504e47";
    case ".gif": return ASCII(head, 0, "GIF8");
    case ".webp": return ASCII(head, 0, "RIFF") && ASCII(head, 8, "WEBP");
    case ".mp4": case ".mov": case ".m4v": case ".m4a":
      return ["ftyp", "moov", "mdat", "wide", "free", "skip"].some((t) => ASCII(head, 4, t));
    case ".webm": case ".mkv": return hex === "1a45dfa3";
    case ".avi": return ASCII(head, 0, "RIFF") && ASCII(head, 8, "AVI ");
    case ".mp3": return ASCII(head, 0, "ID3") || (head[0] === 0xff && (head[1] & 0xe6) === 0xe2);
    case ".wav": return ASCII(head, 0, "RIFF") && ASCII(head, 8, "WAVE");
    case ".aac": return head[0] === 0xff && (head[1] & 0xf6) === 0xf0;
    default: return true;
  }
}

async function rejectIfUnreadable(target: string, stored: string, req: NextRequest, branch: string): Promise<NextResponse | null> {
  const fh = await fs.open(target, "r");
  const head = Buffer.alloc(16);
  let read = 0;
  try {
    read = (await fh.read(head, 0, 16, 0)).bytesRead;
  } finally {
    await fh.close();
  }
  const onDisk = (await fs.stat(target)).size;
  if (looksValid(head.subarray(0, read), path.extname(stored).toLowerCase())) return null;
  // Trace de diagnostic : ce que la route a vraiment recu.
  console.warn(
    `[upload] illisible branche=${branch} stored=${stored} taille=${onDisk} tete=${head.subarray(0, read).toString("hex")} ` +
      `ct=${req.headers.get("content-type")} len=${req.headers.get("content-length")} te=${req.headers.get("transfer-encoding")} ` +
      `enc=${req.headers.get("content-encoding")} ua=${(req.headers.get("user-agent") ?? "").slice(0, 60)}`,
  );
  await fs.rm(target, { force: true });
  return NextResponse.json(
    { error: "Fichier illisible reçu : le contenu envoyé n'est pas une image ou une vidéo valide. Réessaie, ou envoie-le depuis un ordinateur.", unreadable: true },
    { status: 415 },
  );
}

function storedName(original: string): { stored: string; error?: NextResponse } {
  const ext = path.extname(original).toLowerCase();
  if (!SAFE_EXT.has(ext)) {
    return {
      stored: "",
      error: NextResponse.json(
        { error: `Extension non autorisée (${ext || "aucune"}). Formats acceptés : vidéo, image, audio.` },
        { status: 415 },
      ),
    };
  }
  // Nom de stockage généré : on ne fait jamais confiance au nom d'origine
  // pour construire un chemin sur le disque.
  // .jfif et .jpe sont des JPEG : seule l'extension change. On la normalise,
  // sinon les services distants refusent le fichier sur son seul suffixe.
  return { stored: `${newId()}${JPEG_ALIASES[ext] ?? ext}` };
}

function respond(name: string, stored: string, size: number) {
  // Les modeles image de KIE vont chercher le fichier sur internet : ils ne
  // peuvent pas lire /api/media, servi en local. On renvoie donc aussi l'URL
  // du serveur medias expose, quand il est configure.
  const publicBase = process.env.MEDIA_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return NextResponse.json({
    name,
    url: `/api/media/${stored}`,
    publicUrl: publicBase ? `${publicBase}/${stored}` : "",
    stored,
    size,
  });
}

/**
 * Envoi par morceaux (`?upload=<id>&part=n&parts=N&offset=o&size=S`).
 *
 * Cloudflare (plan gratuit) coupe toute requete dont le corps depasse
 * 100 Mo : un rush de 800 Mo n'arrivait jamais jusqu'ici. Le navigateur
 * envoie donc des tranches de 32 Mo, dans l'ordre, que l'on ajoute a un
 * fichier temporaire ; la derniere tranche declenche l'assemblage et les
 * memes verifications qu'un envoi d'un seul tenant.
 *
 * Un morceau renvoye apres une coupure reseau retrouve le fichier a l'offset
 * attendu : on tronque ce qui avait ete ecrit au-dela avant de reprendre.
 */
/**
 * Vide le corps d'une requete qu'on refuse sans l'avoir lu. Repondre avant
 * d'avoir tout lu fait couper la connexion par Node, et le navigateur voit
 * une erreur reseau a la place de notre reponse : il reessaierait pour rien.
 */
async function drain(req: NextRequest) {
  try {
    if (req.body) for await (const _ of req.body as never as AsyncIterable<Uint8Array>) { /* on jette */ }
  } catch {
    // Connexion deja fermee : rien a vider.
  }
}

async function receiveChunk(req: NextRequest, name: string, stored: string): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const id = q.get("upload") ?? "";
  const part = Number(q.get("part"));
  const parts = Number(q.get("parts"));
  const offset = Number(q.get("offset"));
  const total = Number(q.get("size"));
  const bad = async (why: string) => {
    await drain(req);
    return NextResponse.json({ error: `Envoi par morceaux invalide : ${why}.` }, { status: 400 });
  };
  if (!/^[a-z0-9]{8,40}$/.test(id)) return bad("identifiant");
  if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 1 || parts < 1 || part > parts || parts > 1000) return bad("numéro de morceau");
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || total <= 0) return bad("position");
  if (total > MAX_BYTES) {
    await drain(req);
    return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
  }

  await fs.mkdir(PARTS_DIR, { recursive: true });
  const tmp = path.join(PARTS_DIR, `${id}.part`);

  // Reprise : le disque doit etre exactement a l'offset annonce.
  const onDisk = await fs.stat(tmp).then((s) => s.size).catch(() => -1);
  if (part === 1) {
    if (onDisk >= 0) await fs.rm(tmp, { force: true });
  } else if (onDisk < offset) {
    // Le navigateur reprend au morceau qui contient `received`.
    await drain(req);
    return NextResponse.json(
      { error: "Envoi par morceaux invalide : morceau manquant, recommence l'envoi.", received: Math.max(0, onDisk) },
      { status: 409 },
    );
  } else if (onDisk > offset) {
    await fs.truncate(tmp, offset);
  }

  let size = offset;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > total) cb(new TooBig());
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body as never), meter, createWriteStream(tmp, { flags: part === 1 ? "w" : "a" }));
  } catch (e) {
    if (e instanceof TooBig) {
      await fs.rm(tmp, { force: true });
      return NextResponse.json({ error: "Envoi par morceaux invalide : plus d'octets qu'annoncé." }, { status: 400 });
    }
    // Coupure en plein morceau : on garde ce qui est arrive, le navigateur renverra ce morceau.
    return NextResponse.json({ error: "Envoi interrompu." }, { status: 400 });
  }

  if (part < parts) return NextResponse.json({ ok: true, received: size });

  if (size !== total) {
    await fs.rm(tmp, { force: true });
    return NextResponse.json({ error: `Envoi incomplet (${size} octets reçus sur ${total}).` }, { status: 400 });
  }
  const target = path.join(MEDIA_DIR, stored);
  await fs.rename(tmp, target);
  void sweepParts();
  const unreadable = await rejectIfUnreadable(target, stored, req, "morceaux");
  if (unreadable) return unreadable;
  return respond(name, stored, size);
}

/** Jette les assemblages abandonnes (navigateur ferme en cours d'envoi). */
async function sweepParts() {
  try {
    const now = Date.now();
    for (const f of await fs.readdir(PARTS_DIR)) {
      const p = path.join(PARTS_DIR, f);
      const st = await fs.stat(p).catch(() => null);
      if (st && now - st.mtimeMs > PARTS_TTL_MS) await fs.rm(p, { force: true });
    }
  } catch {
    // Nettoyage de confort : un echec n'a pas d'importance.
  }
}

/**
 * Deux facons d'envoyer un fichier :
 *
 *  - multipart/form-data (champ `file`) : l'historique, utilise par le Studio.
 *    Le fichier passe par la memoire, ce qui convient a des images.
 *  - corps brut avec `?name=` : pour les rushs video. Le flux est ecrit sur
 *    disque au fur et a mesure : un rush de 1 Go ne coute pas 1 Go de RAM
 *    au serveur, et l'envoi peut afficher sa progression cote navigateur.
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      console.warn(`[upload] multipart sans fichier : champs=${[...form.keys()].join(",") || "(aucun)"} type=${typeof file} len=${req.headers.get("content-length")} te=${req.headers.get("transfer-encoding")} ua=${(req.headers.get("user-agent") ?? "").slice(0, 60)}`);
      return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
    }
    const { stored, error } = storedName(file.name);
    if (error) return error;
    // En flux vers le disque : un fichier de 200 Mo ne coute pas 200 Mo de memoire.
    const target = path.join(MEDIA_DIR, stored);
    try {
      await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(target));
    } catch {
      await fs.rm(target, { force: true });
      return NextResponse.json({ error: "Envoi interrompu." }, { status: 400 });
    }
    const bad = await rejectIfUnreadable(target, stored, req, "multipart");
    if (bad) return bad;
    return respond(file.name, stored, file.size);
  }

  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "Nom de fichier manquant (?name=)" }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
  const { stored, error } = storedName(name);
  if (error) return error;

  if (req.nextUrl.searchParams.has("upload")) return receiveChunk(req, name, stored);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
  }

  const target = path.join(MEDIA_DIR, stored);
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) cb(new TooBig());
      else cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(req.body as never), meter, createWriteStream(target));
  } catch (e) {
    await fs.rm(target, { force: true });
    if (e instanceof TooBig) return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
    return NextResponse.json({ error: "Envoi interrompu." }, { status: 400 });
  }

  const bad = await rejectIfUnreadable(target, stored, req, "brut");
  if (bad) return bad;
  return respond(name, stored, size);
}
