import { inflateSync } from "zlib";

/**
 * Extraction de texte d'un PDF, sans dépendance.
 *
 * Le projet n'embarque aucune bibliothèque PDF et en ajouter une pour un simple
 * pré-remplissage serait disproportionné. On lit donc directement les flux de
 * contenu : ils sont soit en clair, soit compressés en Flate, que zlib sait
 * décompresser. Les chaînes affichées sont ensuite récupérées via les
 * opérateurs de texte.
 *
 * Limite assumée : un PDF scanné ne contient que des images, donc aucun texte à
 * extraire. L'appelant doit traiter le retour vide comme « colle le texte ».
 */

/** Séquences d'échappement PDF dans une chaîne littérale. */
const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "(": "(",
  ")": ")",
  "\\": "\\",
};

function decodeLiteral(raw: string) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    // \053 : caractère en octal sur trois chiffres.
    if (next >= "0" && next <= "7") {
      const octal = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
      out += String.fromCharCode(parseInt(octal, 8));
      i += octal.length;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i += 1;
  }
  return out;
}

/**
 * Table ToUnicode d'une police sous-ensemblée.
 *
 * Beaucoup de générateurs (Chromium, Word, la plupart des portails d'État)
 * n'écrivent pas les caractères mais des identifiants de glyphes : `<002C> Tj`.
 * Seule la CMap `ToUnicode` du PDF permet de revenir au texte.
 */
function parseToUnicode(cmap: string) {
  const map = new Map<string, string>();

  const hexToChars = (hex: string) =>
    (hex.match(/.{4}/g) || []).map((unit) => String.fromCharCode(parseInt(unit, 16))).join("");

  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(pair[1].toUpperCase(), hexToChars(pair[2]));
    }
  }

  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const row of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const from = parseInt(row[1], 16);
      const to = parseInt(row[2], 16);
      const start = parseInt(row[3], 16);
      // Une plage démesurée trahit une CMap mal lue : on l'ignore.
      if (to - from > 65535 || to < from) continue;
      for (let code = from; code <= to; code += 1) {
        const key = code.toString(16).toUpperCase().padStart(row[1].length, "0");
        map.set(key, String.fromCharCode(start + (code - from)));
      }
    }
  }

  return map;
}

function decodeHex(hex: string, unicode: Map<string, string>) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  // Les identifiants sont sur deux octets dans les polices composites.
  const units = clean.match(/.{1,4}/g) || [];
  return units.map((unit) => unicode.get(unit.padStart(4, "0")) ?? "").join("");
}

/** Chaînes posées par les opérateurs Tj, TJ, ' et " du flux de contenu. */
function stringsFromContent(content: string, unicode: Map<string, string>) {
  const parts: string[] = [];

  for (const match of content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')/g)) {
    parts.push(decodeLiteral(match[1]));
  }

  for (const match of content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    const text = decodeHex(match[1], unicode);
    if (text) parts.push(text);
  }

  // TJ prend un tableau alternant chaînes et décalages ; on ne garde que le texte.
  for (const match of content.matchAll(/\[((?:[^[\]]|\\.)*)\]\s*TJ/g)) {
    const inner = match[1];
    let line = "";
    for (const piece of inner.matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g)) {
      line += piece[1] !== undefined ? decodeLiteral(piece[1]) : decodeHex(piece[2], unicode);
    }
    if (line) parts.push(line);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Un décodage raté produit du charabia qui remplirait des champs légaux avec
 * n'importe quoi. On exige donc une proportion crédible de caractères usuels
 * avant de renvoyer quoi que ce soit.
 */
function looksLikeText(value: string) {
  if (value.length < 30) return false;
  const readable = (value.match(/[A-Za-zÀ-ÿ0-9 .,'&:;()\-\/@\n]/g) || []).length;
  return readable / value.length > 0.85;
}

export type PdfRead = {
  text: string;
  /** Pourquoi rien n'est sorti — sert à dire à l'utilisateur quoi faire. */
  reason: "ok" | "scanned" | "encrypted" | "unreadable" | "garbled";
  streams: number;
  textStreams: number;
  glyphMap: number;
};

/**
 * Version détaillée : dit ce qui a été trouvé, pas seulement le texte. Un PDF
 * refusé sans explication ne laisse aucune prise à l'utilisateur.
 */
export function readPdf(buffer: Buffer): PdfRead {
  const raw = buffer.toString("latin1");

  if (/\/Encrypt\s/.test(raw)) {
    return { text: "", reason: "encrypted", streams: 0, textStreams: 0, glyphMap: 0 };
  }

  const streamRe = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  const decoded: string[] = [];
  let streams = 0;

  for (const match of raw.matchAll(streamRe)) {
    streams += 1;
    const header = raw.slice(Math.max(0, match.index - 400), match.index);
    if (/\/Filter/.test(header) && !/\/FlateDecode/.test(header)) continue;

    if (/\/FlateDecode/.test(header)) {
      try {
        decoded.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
      } catch {
        // Flux illisible : on passe au suivant.
      }
    } else {
      decoded.push(match[1]);
    }
  }

  const unicode = new Map<string, string>();
  for (const stream of decoded) {
    if (!/beginbf(?:char|range)/.test(stream)) continue;
    for (const [code, char] of parseToUnicode(stream)) unicode.set(code, char);
  }

  const chunks: string[] = [];
  let textStreams = 0;
  for (const stream of decoded) {
    if (!/\b(?:Tj|TJ)\b/.test(stream)) continue;
    textStreams += 1;
    const text = stringsFromContent(stream, unicode);
    if (text) chunks.push(text);
  }

  const out = chunks.join("\n").replace(/[ \t]{2,}/g, " ").trim();
  const stats = { streams, textStreams, glyphMap: unicode.size };

  // Aucun opérateur de texte : le PDF ne contient que des images.
  if (!textStreams) return { text: "", reason: "scanned", ...stats };
  if (!out) return { text: "", reason: "unreadable", ...stats };
  if (!looksLikeText(out)) return { text: "", reason: "garbled", ...stats };
  return { text: out, reason: "ok", ...stats };
}

export function pdfToText(buffer: Buffer): string {
  // latin1 conserve chaque octet, indispensable pour retrouver les bornes des
  // flux binaires dans une chaîne.
  const raw = buffer.toString("latin1");

  const streamRe = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  const decoded: string[] = [];

  for (const match of raw.matchAll(streamRe)) {
    // L'en-tête du dictionnaire précède le mot-clé `stream`.
    const header = raw.slice(Math.max(0, match.index - 400), match.index);
    if (/\/Filter/.test(header) && !/\/FlateDecode/.test(header)) continue;

    if (/\/FlateDecode/.test(header)) {
      try {
        decoded.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
      } catch {
        // Flux illisible : on passe au suivant.
      }
    } else {
      decoded.push(match[1]);
    }
  }

  // Les tables ToUnicode sont fusionnées : un document mêlant plusieurs polices
  // sous-ensemblées reste lisible, et le contrôle de vraisemblance en aval
  // écarte le cas où deux polices se disputent les mêmes identifiants.
  const unicode = new Map<string, string>();
  for (const stream of decoded) {
    if (!/beginbf(?:char|range)/.test(stream)) continue;
    for (const [code, char] of parseToUnicode(stream)) unicode.set(code, char);
  }

  const chunks: string[] = [];
  for (const stream of decoded) {
    if (!/\b(?:Tj|TJ)\b/.test(stream)) continue;
    const text = stringsFromContent(stream, unicode);
    if (text) chunks.push(text);
  }

  const out = chunks.join("\n").replace(/[ \t]{2,}/g, " ").trim();
  return looksLikeText(out) ? out : "";
}
