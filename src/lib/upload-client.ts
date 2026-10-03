"use client";

export interface Uploaded {
  name: string;
  url: string;
  size: number;
}

/** Au-dela, on n'essaie que l'envoi en flux : le multipart passerait par la memoire du serveur. */
const MULTIPART_MAX = 300 * 1024 * 1024;

/**
 * iPhone et iPad : Safari (et tout navigateur iOS, qui embarque WebKit) a
 * envoye des fichiers illisibles quand le corps brut de la requete etait un
 * File venant de la galerie photos. Le multipart, lui, lit le fichier en
 * entier avant l'envoi et passe sans probleme.
 */
function prefersMultipart(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iosLike = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iosLike;
}

/**
 * Cloudflare (plan gratuit) refuse tout corps de requete au-dela de 100 Mo :
 * il coupe la connexion apres le premier mega-octet, et le navigateur ne
 * voit qu'une erreur reseau. Au-dela de ce seuil, on decoupe le fichier en
 * morceaux envoyes l'un apres l'autre ; le serveur les recolle.
 */
const CHUNKED_FROM = 90 * 1024 * 1024;
/**
 * 8 Mo : sur une liaison instable, une coupure ne fait perdre que quelques
 * secondes d'envoi, et chaque requete reste courte (Cloudflare coupe au-dela
 * de 100 s sans reponse).
 */
const CHUNK_SIZE = 8 * 1024 * 1024;
/** Tentatives consecutives sur coupure reseau : la liaison est instable. */
const CHUNK_RETRIES = 6;
/**
 * Sans progression pendant ce delai, la connexion est consideree morte.
 * Un envoi s'est fige a 33 % pendant dix minutes : la liaison etait tombee
 * en plein morceau et le navigateur ne signale jamais rien dans ce cas, la
 * requete reste « en cours » pour toujours.
 */
const STALL_MS = 30_000;

interface Reply { name?: string; url?: string; size?: number; error?: string; unreadable?: boolean; ok?: boolean; received?: number }

/** Coupure reseau ou serveur injoignable : ca se retente. */
class Lost extends Error {}
/** Progression (0..1) et, en cas de reprise, un mot pour l'utilisateur. */
export type ProgressFn = (fraction: number, note?: string) => void;

function request(
  url: string,
  body: Blob | FormData,
  contentType: string | null,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ status: number; body: Reply }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    // Chien de garde : relance a chaque octet envoye, puis pendant l'attente
    // de la reponse. S'il expire, on coupe la requete nous-memes.
    const watch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        finish(() => {
          xhr.abort();
          reject(new Lost("Connexion perdue pendant l'envoi."));
        });
      }, STALL_MS);
    };
    xhr.open("POST", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      watch();
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.upload.onload = () => watch();
    xhr.onerror = () => finish(() => reject(new Lost("Connexion perdue pendant l'envoi.")));
    xhr.onabort = () => finish(() => reject(new Lost("Connexion perdue pendant l'envoi.")));
    xhr.onload = () => {
      let parsed: Reply = {};
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = {};
      }
      finish(() => resolve({ status: xhr.status, body: parsed }));
    };
    watch();
    xhr.send(body);
  });
}

/** Serveur en redemarrage ou passerelle Cloudflare en erreur : ca se retente. */
function transient(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504 || status === 520 || status === 521 || status === 522 || status === 524;
}

function refusal(status: number, body: Reply): Error & { unreadable?: boolean } {
  const err = new Error(body.error ?? `Envoi refusé (HTTP ${status}).`) as Error & { unreadable?: boolean };
  err.unreadable = Boolean(body.unreadable);
  return err;
}

async function send(file: File, multipart: boolean, onProgress?: ProgressFn): Promise<Uploaded> {
  let body: Blob | FormData = file;
  if (multipart) {
    const form = new FormData();
    form.append("file", file, file.name);
    body = form;
  }
  // Un petit fichier se renvoie en entier : deux reprises suffisent.
  for (let attempt = 1; ; attempt++) {
    try {
      const { status, body: reply } = await request(
        multipart ? "/api/upload" : `/api/upload?name=${encodeURIComponent(file.name)}`,
        body,
        multipart ? null : file.type || "application/octet-stream",
        (loaded, total) => onProgress?.(loaded / total),
      );
      if (status >= 200 && status < 300 && reply.url) {
        return { name: reply.name ?? file.name, url: reply.url, size: reply.size ?? file.size };
      }
      if (transient(status) && attempt < 3) throw new Lost(`Envoi refusé (HTTP ${status}).`);
      throw refusal(status, reply);
    } catch (e) {
      if (!(e instanceof Lost) || attempt >= 3) throw e;
      onProgress?.(0, "Connexion instable, nouvel essai…");
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** Identifiant d'envoi cote navigateur : lettres et chiffres, valide par le serveur. */
function uploadId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

async function sendChunked(file: File, onProgress?: ProgressFn): Promise<Uploaded> {
  const id = uploadId();
  const parts = Math.ceil(file.size / CHUNK_SIZE);
  const type = file.type || "application/octet-stream";
  // Echecs consecutifs : remis a zero des qu'un morceau passe.
  let failures = 0;
  let part = 1;
  while (part <= parts) {
    const offset = (part - 1) * CHUNK_SIZE;
    const chunk = file.slice(offset, Math.min(file.size, offset + CHUNK_SIZE), type);
    const url =
      `/api/upload?name=${encodeURIComponent(file.name)}&upload=${id}` +
      `&part=${part}&parts=${parts}&offset=${offset}&size=${file.size}`;
    try {
      const { status, body } = await request(url, chunk, type, (loaded) => onProgress?.((offset + loaded) / file.size));
      if (status >= 200 && status < 300) {
        if (part === parts) {
          if (!body.url) throw refusal(status, body);
          return { name: body.name ?? file.name, url: body.url, size: body.size ?? file.size };
        }
        failures = 0;
        part++;
        continue;
      }
      // Le serveur a moins d'octets que prevu (un morceau s'est perdu en
      // route) : on reprend au morceau qui contient ce qu'il a recu.
      if (status === 409 && typeof body.received === "number" && body.received >= 0) {
        const resume = Math.floor(body.received / CHUNK_SIZE) + 1;
        if (resume < part) {
          part = resume;
          throw new Lost("Reprise de l'envoi.");
        }
      }
      if (transient(status)) throw new Lost(`Envoi refusé (HTTP ${status}).`);
      // Refus franc du serveur (extension, taille, fichier illisible) : inutile d'insister.
      throw refusal(status, body);
    } catch (e) {
      if (!(e instanceof Lost)) throw e;
      failures++;
      if (failures >= CHUNK_RETRIES) {
        throw new Error("Connexion perdue pendant l'envoi, malgré plusieurs tentatives. Vérifie ta connexion et réessaie.");
      }
      onProgress?.(((part - 1) * CHUNK_SIZE) / file.size, `Connexion instable, reprise (${failures}/${CHUNK_RETRIES})…`);
      // Petite pause avant de renvoyer le meme morceau.
      await new Promise((r) => setTimeout(r, 1500 * failures));
    }
  }
  throw new Error("Envoi incomplet.");
}

/**
 * Envoi d'un fichier avec suivi de progression.
 *
 * `fetch` ne sait pas dire ou en est un envoi : sur un rush de 800 Mo depuis
 * un telephone, l'utilisateur regarde un spinner pendant trois minutes sans
 * savoir si ca avance. XMLHttpRequest, lui, publie la progression.
 *
 * Par defaut le fichier part tel quel dans le corps de la requete : le
 * serveur l'ecrit sur disque au fil de l'eau, sans le charger en memoire.
 * Sur iOS, ou pour un fichier que le serveur declare illisible, on repasse
 * par un envoi multipart (le serveur verifie l'entete du fichier recu).
 */
export async function uploadFile(file: File, onProgress?: ProgressFn): Promise<Uploaded> {
  // Gros rush : par morceaux, seule facon de passer Cloudflare (voir CHUNKED_FROM).
  if (file.size > CHUNKED_FROM) return sendChunked(file, onProgress);
  const small = file.size <= MULTIPART_MAX;
  if (prefersMultipart() && small) return send(file, true, onProgress);
  try {
    return await send(file, false, onProgress);
  } catch (e) {
    const err = e as Error & { unreadable?: boolean };
    if (err.unreadable && small) return send(file, true, onProgress);
    throw err;
  }
}

/** Au-dela, on ne copie pas en memoire : un rush de 800 Mo reste un simple handle. */
const CLONE_MAX = 64 * 1024 * 1024;

/**
 * Recupere les fichiers d'un <input type="file"> de facon sure.
 *
 * Vider `input.value` tout de suite apres le choix (pour pouvoir rechoisir le
 * meme fichier) invalidait le fichier sur telephone : le navigateur liberait
 * la copie temporaire de la galerie avant que l'envoi ne l'ait lue, et le
 * serveur recevait un corps vide ou des octets sans rapport. On copie donc
 * d'abord les fichiers raisonnables en memoire, puis seulement on vide le
 * champ ; un gros fichier garde son handle et le champ n'est pas vide.
 */
export async function takeFiles(input: HTMLInputElement): Promise<File[]> {
  const picked = Array.from(input.files ?? []);
  const files = await Promise.all(
    picked.map(async (f) => {
      if (f.size > CLONE_MAX) return f;
      try {
        return new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified });
      } catch {
        return f;
      }
    }),
  );
  if (files.every((f, i) => f !== picked[i])) {
    try { input.value = ""; } catch { /* certains navigateurs refusent : sans consequence */ }
  }
  return files;
}

/**
 * Fichiers images (et videos) d'un collage Ctrl+V.
 *
 * Une capture d'ecran arrive sans nom, ou nommee « image.png » : on lui
 * donne un nom date pour la retrouver dans les vignettes et les fiches.
 */
export function clipboardFiles(e: ClipboardEvent): File[] {
  const out: File[] = [];
  const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
  for (const it of items) {
    if (it.kind !== "file") continue;
    const f = it.getAsFile();
    if (!f) continue;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) continue;
    const generic = !f.name || /^image\.(png|jpe?g|webp|gif)$/i.test(f.name) || /^blob$/i.test(f.name);
    const ext = f.type === "image/jpeg" ? "jpg" : f.type.split("/")[1]?.replace("quicktime", "mov") || "png";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    out.push(generic ? new File([f], `capture-${stamp}.${ext}`, { type: f.type, lastModified: Date.now() }) : f);
  }
  return out;
}

/** Fichiers deposes par glisser-deposer, images et videos seulement. */
export function droppedFiles(e: { dataTransfer: DataTransfer | null }): File[] {
  return Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || /\.(png|jpe?g|webp|gif|heic|heif|avif|mp4|mov|webm|m4v)$/i.test(f.name));
}

export function formatBytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} Go`;
  if (n > 1e6) return `${Math.round(n / 1e6)} Mo`;
  return `${Math.round(n / 1e3)} Ko`;
}
